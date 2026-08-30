/**
 * @komerce-arch
 * @role          catalog-promotion-classifier
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        raw_json_source_product, import_profile_v1
 * @outputs       promotion_classification, findings
 * @depends       services/suppliers/pipeline-constants.js, services/suppliers/media-normalizer.js, services/suppliers/source-product-normalizer.js
 * @used-by       services/suppliers/json-source-pipeline.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md (ING-I1..I4, ING-I9 proposé), docs/doctrine/CHANTIERS_INGESTION_CATALOGUE.md (ING-6 proposé)
 * @impact-areas  catalog, product-discovery
 * @version       2026-08 (nettoyage architectural — ne porte plus que la classification ; parsing/poids/devise/contrat déplacés vers services/suppliers/source-product-normalizer.js)
 */

/**
 * KOMERCE — Classification de promotion par produit (ING-6)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ce module ne porte QUE classifyPromotion() : la décision de statut de
 * promotion d'un produit source, dans l'ordre documenté en tête de
 * services/suppliers/json-source-pipeline.js :
 *
 *   1. validation des données sources minimales  → REJECTED_SOURCE_DATA_INVALID
 *   2. résolution de la devise selon le profil   → QUARANTINED_CURRENCY_POLICY
 *   3. construction du contrat
 *   4. validation AJV réelle du contrat          → REJECTED_CONTRACT_INVALID
 *   5. analyse de fidélité média                 → QUARANTINED_UNSUPPORTED_MEDIA
 *                                                → QUARANTINED_LOSSY_MAPPING
 *   6. classification de promotion               → READY_FOR_PROMOTION
 *
 * ⚠️ Asymétrie VOLONTAIRE (devise avant AJV, vidéo après AJV) — voir la
 * doctrine complète dans l'en-tête de json-source-pipeline.js.
 *
 * Le parsing scalaire (prix/stock/catégorie/poids), la résolution de devise,
 * et l'assemblage du contrat NormalizedSupplierProduct (V1/V2) vivent dans
 * services/suppliers/source-product-normalizer.js — ce module s'y limite à
 * les APPELER dans l'ordre ci-dessus ; il n'implémente aucune de ces règles
 * lui-même. Ce découpage ne change PAS la séquence d'appel ni aucune règle :
 * seules des fonctions ont été déplacées de fichier.
 */

'use strict';

const { FINDINGS, REASON_CODES, finding } = require('./pipeline-constants');
const { detectVideoForms, normalizeMedia } = require('./media-normalizer');
const {
  parseSourceProduct,
  resolveCurrency,
  resolveSupplierProductId,
  normalizeProduct,
  validateContract,
} = require('./source-product-normalizer');

// ── Classification de promotion — priorité déterministe ────────────────────

/**
 * Point d'entrée unique par produit. Applique l'ordre documenté ci-dessus.
 * Les motifs secondaires restent dans `findings` ; le statut primaire suit
 * STATUS_PRIORITY et rien d'autre.
 */
function classifyPromotion(p, profile) {
  const findings = [];
  const supplierProductId = resolveSupplierProductId(p, profile);
  const parsed = parseSourceProduct(p, profile);
  const videoInfo = detectVideoForms(p);

  findings.push(...parsed.weight.findings);
  if (parsed.category.changed) {
    findings.push(finding(FINDINGS.CATEGORY_NORMALIZED,
      `catégorie source "${p.category}" -> "${parsed.category.proposed}" (proposition source, jamais une catégorie Komerce)`));
  }
  if (parsed.price.transformed) findings.push(finding(FINDINGS.PRICE_STRING_PARSED, `prix "${parsed.price.original}" -> ${parsed.price.value} + devise ${parsed.price.currency}`));
  if (parsed.stock.transformed) findings.push(finding(FINDINGS.STOCK_STRING_PARSED, `stock "${parsed.stock.original}" -> ${parsed.stock.value}`));
  if (!p.brand) findings.push(finding(FINDINGS.MISSING_BRAND, `marque absente (policies.missing_brand=${profile.policies.missing_brand})`));

  const base = { supplierProductId, findings, videoInfo, parsed, sourceId: p.id };

  // ── Étape 1 : données sources minimales ────────────────────────────────
  if (parsed.price.unparsed || parsed.stock.unparsed) {
    const reasons = [];
    if (parsed.price.unparsed) reasons.push(`price non interprétable : ${JSON.stringify(parsed.price.original)}`);
    if (parsed.stock.unparsed) reasons.push(`stock non interprétable : ${JSON.stringify(parsed.stock.original)}`);
    return { ...base, status: 'REJECTED_SOURCE_DATA_INVALID', reasonCode: REASON_CODES.SOURCE_VALUE_UNPARSABLE, eligible: false, reasons, contract: null };
  }
  if (profile.weight.unknown_unit_policy === 'REJECT_PRODUCT'
      && parsed.weight.provenance.basis === 'source_unit_unconfirmed') {
    return {
      ...base, status: 'REJECTED_SOURCE_DATA_INVALID', reasonCode: REASON_CODES.SOURCE_WEIGHT_UNIT_UNKNOWN, eligible: false,
      reasons: ['poids d\'unité inconnue et weight.unknown_unit_policy=REJECT_PRODUCT'], contract: null,
    };
  }

  // ── Étape 2 : devise — AVANT l'AJV (cf. doctrine dans json-source-pipeline.js : currency est required) ─
  const currencyResolved = resolveCurrency(parsed.price.currency, profile);
  if (currencyResolved.quarantined) {
    return {
      ...base, status: 'QUARANTINED_CURRENCY_POLICY', eligible: false,
      reasons: [`devise source "${parsed.price.currency}" hors currency.allowed (${profile.currency.allowed.join(', ')})`],
      contract: null, currencyResolved,
    };
  }
  findings.push(currencyResolved.origin === 'source'
    ? finding(FINDINGS.CURRENCY_FROM_SOURCE, `devise ${currencyResolved.value} lue dans la source (SOURCE_THEN_DEFAULT)`)
    : finding(FINDINGS.CURRENCY_FROM_PROFILE_DEFAULT, `aucune devise source : repli sur currency.default=${currencyResolved.value} du profil`));

  // ── Étape 3 : construction du contrat ──────────────────────────────────
  const mediaResult = normalizeMedia(p, profile);
  findings.push(...mediaResult.findings);
  const normalized = normalizeProduct(p, profile, parsed, currencyResolved, supplierProductId, mediaResult);

  const common = {
    ...base, currencyResolved,
    contract: normalized.contract,
    schemaVersionUsed: normalized.schemaVersionUsed,
    galleryPreserved: normalized.galleryPreserved,
    roleAssignmentBasis: normalized.roleAssignmentBasis,
    droppedFields: normalized.droppedFields,
    mediaCount: normalized.mediaResult.media.length,
  };

  // ── Étape 4 : AJV réelle — AVANT la vidéo ──────────────────────────────
  // Un produit vidéo ne masque JAMAIS un contrat de base invalide.
  const verdict = validateContract(normalized.contract);
  if (!verdict.valid) {
    return {
      ...common, status: 'REJECTED_CONTRACT_INVALID', reasonCode: REASON_CODES.CONTRACT_SCHEMA_INVALID, eligible: false, reasons: verdict.errors,
      contractValidation: { attempted: true, valid: false, errors: verdict.errors },
    };
  }

  // ── Étape 5 : fidélité média ───────────────────────────────────────────
  if (videoInfo.hasVideo) {
    findings.push(finding(FINDINGS.UNSUPPORTED_VIDEO_PRESENT,
      `vidéo détectée (${videoInfo.forms.join(', ')}) — aucun support schéma/DB/modale ; champs vidéo intégralement conservés dans raw_payload (ING-I3)`));
    if (profile.policies.unsupported_video === 'REJECT_PRODUCT') {
      return {
        ...common, status: 'REJECTED_SOURCE_DATA_INVALID', reasonCode: REASON_CODES.UNSUPPORTED_VIDEO_REJECTED_BY_POLICY, eligible: false,
        reasons: ['vidéo présente et policies.unsupported_video=REJECT_PRODUCT'],
        contractValidation: { attempted: true, valid: true, errors: [] },
      };
    }
    return {
      ...common, status: 'QUARANTINED_UNSUPPORTED_MEDIA', eligible: false,
      reasons: [`média vidéo présent (${videoInfo.forms.join(', ')}) — aucun support schéma/DB/modale actuel ; policies.unsupported_video=${profile.policies.unsupported_video}`],
      contractValidation: { attempted: true, valid: true, errors: [] },
      // Le contrat de base est AJV-valide mais NE représente PAS la fiche
      // entière. Ne jamais laisser un lecteur en conclure l'inverse.
      videoRepresentation: {
        base_product_contract_validation: { attempted: true, valid: true, schema_version: normalized.schemaVersionUsed },
        source_fidelity: { complete: false, unsupported_fields: ['video'] },
        promotion: { eligible: false, status: 'QUARANTINED_UNSUPPORTED_MEDIA' },
      },
    };
  }

  if (normalized.lossy) {
    if (profile.policies.lossy_mapping === 'REJECT_PRODUCT') {
      return {
        ...common, status: 'REJECTED_SOURCE_DATA_INVALID', reasonCode: REASON_CODES.LOSSY_MAPPING_REJECTED_BY_POLICY, eligible: false, reasons: normalized.lossyReasons,
        contractValidation: { attempted: true, valid: true, errors: [] },
      };
    }
    findings.push(finding(FINDINGS.GALLERY_TRUNCATED_BY_V1, normalized.lossyReasons.join(' | ')));
    return {
      ...common, status: 'QUARANTINED_LOSSY_MAPPING', eligible: false, reasons: normalized.lossyReasons,
      contractValidation: { attempted: true, valid: true, errors: [] },
    };
  }

  // ── Étape 6 : promotion ────────────────────────────────────────────────
  return {
    ...common, status: 'READY_FOR_PROMOTION', eligible: true, reasons: [],
    contractValidation: { attempted: true, valid: true, errors: [] },
  };
}

module.exports = {
  classifyPromotion,
};
