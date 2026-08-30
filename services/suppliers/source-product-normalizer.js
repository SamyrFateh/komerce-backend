/**
 * @komerce-arch
 * @role          catalog-source-product-normalizer
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        raw_json_source_product, import_profile_v1
 * @outputs       normalized_supplier_product_v1, normalized_supplier_product_v2
 * @depends       services/suppliers/pipeline-constants.js, services/suppliers/media-normalizer.js, services/suppliers/normalized-product.js
 * @used-by       services/suppliers/promotion-classifier.js, services/suppliers/json-source-pipeline.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md (ING-I1..I4, ING-I9 proposé), docs/doctrine/CHANTIERS_INGESTION_CATALOGUE.md (ING-6 proposé)
 * @impact-areas  catalog, product-discovery
 * @version       2026-08 (nettoyage architectural post-ING-6 — extrait de promotion-classifier.js, domaine 2/5)
 */

/**
 * KOMERCE — Normalisation produit source / contrat (parsing, poids, devise,
 * assemblage V1/V2, validation AJV)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Extrait de services/suppliers/promotion-classifier.js. Ce module ne porte
 * AUCUNE décision de classification de promotion : uniquement le parsing
 * scalaire, la résolution poids/devise, l'assemblage du contrat
 * NormalizedSupplierProduct (V1/V2) et la délégation à la validation AJV
 * réelle. classifyPromotion() (promotion-classifier.js) reste le SEUL point
 * d'entrée qui orchestre ces fonctions dans l'ordre documenté en tête de
 * services/suppliers/json-source-pipeline.js.
 *
 * Aucune règle ni aucun ordre n'a été modifié par cette extraction : seules
 * des fonctions ont été déplacées de fichier.
 */

'use strict';

const { FINDINGS, finding, WEIGHT_CONVERSIONS_TO_KG } = require('./pipeline-constants');
const { normalizeMedia } = require('./media-normalizer');
const { validateNormalizedProduct } = require('./normalized-product');

// ── 3. Parsing scalaire explicite (aucune conversion silencieuse) ─────────

function parsePrice(raw) {
  if (typeof raw === 'number') return { value: raw, currency: null, transformed: false };
  if (typeof raw === 'string') {
    const m = raw.trim().match(/^([\d]+)[,.]([\d]+)\s*([A-Z]{3})$/);
    if (m) return { value: parseFloat(`${m[1]}.${m[2]}`), currency: m[3], transformed: true, original: raw };
    return { value: null, currency: null, transformed: false, original: raw, unparsed: true };
  }
  return { value: null, currency: null, transformed: false, original: raw, unparsed: true };
}

function parseStock(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw)) return { value: raw, transformed: false };
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    return { value: parseInt(raw.trim(), 10), transformed: true, original: raw };
  }
  return { value: null, transformed: false, original: raw, unparsed: true };
}

function normalizeCategoryProposed(raw) {
  if (typeof raw !== 'string') return { proposed: null, changed: false };
  const normalized = raw.trim().toLowerCase();
  return { proposed: normalized, changed: normalized !== raw };
}

/**
 * Poids : AUCUNE unité inventée (ING-I2).
 *
 * Tant que profile.weight.source_unit est null, l'unité du champ source
 * n'est pas confirmée par le fournisseur : `weight_kg = null`. La valeur
 * brute reste intégralement dans raw_payload (ING-I3) et un finding
 * SOURCE_WEIGHT_UNIT_UNKNOWN est produit.
 *
 * IMPORTANT — ce que ce null déclenche en aval :
 * supplier-catalog-scanner.estimateWeight() remplace un weight_kg absent par
 * une estimation (table codée en dur, puis 0.5). Ce comportement est un
 * CHANTIER DISTINCT, non modifié ici. Mais le pipeline ne ment plus : il ne
 * présente plus un poids d'unité inconnue comme source=supplier /
 * confidence=high. `provenance` permet au scanner de signaler explicitement
 * ESTIMATED_WEIGHT_FALLBACK_USED / confidence=low, et à la décision aval de
 * distinguer : poids confirmé | poids estimé | poids absent.
 *
 * @returns {{ value: number|null, findings: Array, provenance: Object }}
 */
function resolveWeight(p, profile) {
  const cfg = profile.weight;
  const findings = [];
  const field = cfg.source_field;
  const raw = field ? p[field] : undefined;
  const hasRaw = typeof raw === 'number' && Number.isFinite(raw);

  const provenance = {
    source_field: field,
    raw_value: raw === undefined ? null : raw,
    source_unit: cfg.source_unit,
    target_unit: cfg.target_unit,
    unit_confirmed: cfg.source_unit !== null,
    resolved_kg: null,
    basis: null,
    downstream_expectation: null,
  };

  if (!hasRaw) {
    provenance.basis = 'source_absent';
    provenance.downstream_expectation = 'ESTIMATED_WEIGHT_FALLBACK_USED';
    findings.push(finding(FINDINGS.SOURCE_WEIGHT_ABSENT,
      `aucun poids source exploitable dans "${field}" — le scanner produira une estimation (confidence=low)`));
    return { value: null, findings, provenance };
  }

  if (cfg.source_unit === null) {
    provenance.basis = 'source_unit_unconfirmed';
    provenance.downstream_expectation = 'ESTIMATED_WEIGHT_FALLBACK_USED';
    findings.push(finding(FINDINGS.SOURCE_WEIGHT_UNIT_UNKNOWN,
      `poids source "${field}"=${raw} conservé dans raw_payload mais NON mappé : weight.source_unit n'est pas confirmée par le profil. Aucune unité n'est inventée (ING-I2). weight_kg=null -> le scanner estimera (ESTIMATED_WEIGHT_FALLBACK_USED, confidence=low) ; il ne doit jamais présenter cette valeur comme source=supplier/confidence=high.`,
      { raw_value: raw, source_field: field }));
    return { value: null, findings, provenance };
  }

  const factor = WEIGHT_CONVERSIONS_TO_KG[cfg.source_unit];
  const kg = raw * factor;
  provenance.resolved_kg = kg;
  provenance.basis = 'source_unit_confirmed';
  provenance.downstream_expectation = 'SUPPLIER_WEIGHT_USED';
  if (cfg.source_unit !== 'kg') {
    findings.push(finding(FINDINGS.SOURCE_WEIGHT_CONVERTED,
      `poids ${raw} ${cfg.source_unit} converti en ${kg} kg (facteur ${factor}, unité déclarée explicitement au profil)`));
  }
  return { value: kg, findings, provenance };
}

/** Normalise les champs scalaires bruts d'un produit source. */
function parseSourceProduct(p, profile) {
  const out = {
    price: parsePrice(p.price),
    stock: parseStock(p.stock),
    category: normalizeCategoryProposed(p.category),
  };
  if (profile) out.weight = resolveWeight(p, profile);
  return out;
}

// ── 4. Devise : SOURCE_THEN_DEFAULT ───────────────────────────────────────

function resolveCurrency(sourceCurrency, profile) {
  const allowed = profile.currency.allowed;
  const defaultCurrency = profile.currency.default;
  if (sourceCurrency) {
    if (!allowed.includes(sourceCurrency)) {
      return { value: null, origin: 'source_rejected_by_policy', quarantined: true };
    }
    return { value: sourceCurrency, origin: 'source', quarantined: false };
  }
  if (defaultCurrency) return { value: defaultCurrency, origin: 'import_profile', quarantined: false };
  return { value: null, origin: 'absent', quarantined: false };
}

// ── 7. Assemblage NormalizedSupplierProduct (V1 / V2) ─────────────────────

function resolveSupplierProductId(p, profile) {
  const raw = p[profile.identity.supplier_id_field];
  return raw != null ? String(raw) : null;
}

function baseFields(p, profile, parsed, currencyResolved, supplierProductId) {
  return {
    supplier_name: profile.supplier_name,
    supplier_product_id: supplierProductId,
    product_name: p.title || null,
    supplier_category: parsed.category.proposed,
    purchase_price: parsed.price.value,
    currency: currencyResolved.value,
    product_url: null,
    description: p.description || null,
    stock_available: parsed.stock.value,
    min_order_qty: (typeof p.minimumOrderQuantity === 'number') ? p.minimumOrderQuantity : null,
    supplier_delay_days: null,
    // Point 4 — jamais p.weight brut : cf. resolveWeight(). null tant que
    // l'unité source n'est pas déclarée au profil.
    weight_kg: parsed.weight.value,
    dimensions: null,
    raw_payload: p,
  };
}

function buildV1(p, profile, parsed, currencyResolved, supplierProductId, mediaResult) {
  const media = mediaResult.media;
  const droppedFields = media.length > 1
    ? [{ field: `${profile.media.gallery_source_field}[1..]`, count: media.length - 1, reason: 'V1 ne porte qu\'un image_url singulier.' }]
    : [];
  return {
    contract: {
      schema_version: '1',
      image_url: media.length > 0 ? media[0].url : null,
      ...baseFields(p, profile, parsed, currencyResolved, supplierProductId),
    },
    droppedFields,
    galleryPreserved: media.length <= 1,
    roleAssignmentBasis: mediaResult.roleAssignmentBasis,
  };
}

function buildV2(p, profile, parsed, currencyResolved, supplierProductId, mediaResult) {
  return {
    contract: {
      schema_version: '2',
      image_url: mediaResult.media.length > 0 ? mediaResult.media[0].url : null,
      media: mediaResult.media,
      ...baseFields(p, profile, parsed, currencyResolved, supplierProductId),
    },
    roleAssignmentBasis: mediaResult.roleAssignmentBasis,
  };
}

/**
 * Contrat cible du connecteur JSON : V2 dans TOUS les cas.
 *
 * La promotion catalogue officielle refuse explicitement V1. Un produit
 * déclaré READY_FOR_PROMOTION doit donc être réellement promouvable, qu'il
 * possède zéro, une ou plusieurs images. Le schéma V2 accepte media[] vide
 * ou mono-élément : aucune raison honnête de produire V1 ici.
 *
 * V1 reste supporté par les connecteurs legacy, mais le connecteur JSON
 * profilé ne fabrique jamais un statut READY adossé à un contrat impossible
 * à promouvoir.
 */
function normalizeProduct(p, profile, parsed, currencyResolved, supplierProductId, mediaResult) {
  const media = mediaResult || normalizeMedia(p, profile);
  const v2 = buildV2(p, profile, parsed, currencyResolved, supplierProductId, media);
  return {
    contract: v2.contract,
    schemaVersionUsed: '2',
    galleryPreserved: true,
    roleAssignmentBasis: v2.roleAssignmentBasis,
    droppedFields: [],
    lossy: false,
    mediaResult: media,
  };
}

// ── 8. Validation de contrat (délègue à l'AJV réel, aucune duplication) ───

function validateContract(contract) {
  return validateNormalizedProduct(contract);
}

module.exports = {
  parsePrice,
  parseStock,
  normalizeCategoryProposed,
  parseSourceProduct,
  resolveWeight,
  resolveCurrency,
  resolveSupplierProductId,
  normalizeProduct,
  validateContract,
  buildV1,
  buildV2,
};
