/**
 * @komerce-arch
 * @role          json-source-pipeline
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        raw_json_source_batch, import_profile_v1
 * @outputs       normalized_supplier_product_v1_or_v2, promotion_classification, findings
 * @depends       services/suppliers/normalized-product.js, schemas/catalog/import-profile.v1.schema.json
 * @used-by       services/suppliers/connectors/json-connector.js, scripts/dry-run-import.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md (ING-I1..I4, ING-I9 proposé), docs/doctrine/CHANTIERS_INGESTION_CATALOGUE.md (ING-6 proposé)
 * @impact-areas  catalog, product-discovery
 * @version       2026-07 (ING-6 — extrait des dry-run v1..v4, corrections 1..8)
 */

/**
 * KOMERCE — Pipeline pur pour sources JSON « à plat + galerie » (ING-6)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Ce module est le SEUL endroit qui décide comment un produit d'une source
 * JSON de cette forme (title/price/stock/category/images[]/thumbnail/vidéo
 * sous 3 formes possibles) devient un NormalizedSupplierProduct + une
 * classification de promotion. Le dry-run officiel et le connecteur d'import
 * réel APPELLENT ces fonctions — aucune règle n'est dupliquée ailleurs.
 *
 * Portée volontairement limitée : ce n'est pas un mapping JSON générique. Il
 * encode la forme de source validée par la raffinerie (dry-run v1→v4, 82
 * produits fixture DummyJSON). Un fournisseur JSON de forme différente aura
 * son propre pipeline — jamais un branchement conditionnel accumulé ici.
 *
 * ING-I9 (proposé) — toute configuration d'un batch est résolue depuis un
 * profil versionné, validé AJV et auditable, AVANT le traitement des
 * produits. Aucune valeur de repli n'est fabriquée ici.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ORDRE DES DÉCISIONS — asymétrie VOLONTAIRE, ne pas « simplifier »
 * ─────────────────────────────────────────────────────────────────────────
 *   1. validation des données sources minimales  → REJECTED_SOURCE_DATA_INVALID
 *   2. résolution de la devise selon le profil   → QUARANTINED_CURRENCY_POLICY
 *   3. construction du contrat
 *   4. validation AJV réelle du contrat          → REJECTED_CONTRACT_INVALID
 *   5. analyse de fidélité média                 → QUARANTINED_UNSUPPORTED_MEDIA
 *                                                → QUARANTINED_LOSSY_MAPPING
 *   6. classification de promotion               → READY_FOR_PROMOTION
 *
 * POURQUOI la devise passe AVANT l'AJV, alors que la vidéo passe APRÈS :
 *
 *   • `currency` est `required` dans normalized-supplier-product.v{1,2}.
 *     Un contrat construit avec currency=null échoue TOUJOURS l'AJV. Valider
 *     avant de trancher la politique de devise ferait remonter une devise
 *     absente ou interdite en REJECTED_CONTRACT_INVALID « currency
 *     manquante » — un symptôme, jamais le motif réel. La devise est donc
 *     résolue d'abord pour que son refus porte SON nom.
 *
 *   • La vidéo, elle, n'empêche pas le contrat de base d'être AJV-valide :
 *     un produit vidéo a un titre, un prix, une devise, une image. Le contrat
 *     est valide ; c'est la FIDÉLITÉ à la source qui est fausse (la vidéo
 *     n'est représentable nulle part). Un contrat de base réellement invalide
 *     doit donc être rejeté AVANT que la vidéo ne le masque en quarantaine.
 *
 *   Les deux cas ne sont PAS symétriques : l'un est un motif que l'AJV
 *   masquerait, l'autre est un motif qui masquerait l'AJV. Toute réécriture
 *   qui les aligne « pour la cohérence » détruit un motif de rejet.
 * ─────────────────────────────────────────────────────────────────────────
 */

'use strict';

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const importProfileSchema = require('../../schemas/catalog/import-profile.v1.schema.json');
const { validateNormalizedProduct } = require('./normalized-product');

const PIPELINE_VERSION = '2026-07-ING6';

/** Codes de finding — stables, consommables par l'orchestrateur et l'audit. */
const FINDINGS = Object.freeze({
  SOURCE_WEIGHT_UNIT_UNKNOWN: 'SOURCE_WEIGHT_UNIT_UNKNOWN',
  SOURCE_WEIGHT_ABSENT: 'SOURCE_WEIGHT_ABSENT',
  SOURCE_WEIGHT_CONVERTED: 'SOURCE_WEIGHT_CONVERTED',
  THUMBNAIL_FALLBACK_USED: 'THUMBNAIL_FALLBACK_USED',
  MEDIA_RELATION_DEDUPLICATED: 'MEDIA_RELATION_DEDUPLICATED',
  ASSET_REUSED_ACROSS_ROLES: 'ASSET_REUSED_ACROSS_ROLES',
  ASSET_SHARED_ACROSS_PRODUCTS: 'ASSET_SHARED_ACROSS_PRODUCTS',
  MISSING_IMAGE: 'MISSING_IMAGE',
  MISSING_BRAND: 'MISSING_BRAND',
  CATEGORY_NORMALIZED: 'CATEGORY_NORMALIZED',
  PRICE_STRING_PARSED: 'PRICE_STRING_PARSED',
  STOCK_STRING_PARSED: 'STOCK_STRING_PARSED',
  CURRENCY_FROM_SOURCE: 'CURRENCY_FROM_SOURCE',
  CURRENCY_FROM_PROFILE_DEFAULT: 'CURRENCY_FROM_PROFILE_DEFAULT',
  UNSUPPORTED_VIDEO_PRESENT: 'UNSUPPORTED_VIDEO_PRESENT',
  GALLERY_TRUNCATED_BY_V1: 'GALLERY_TRUNCATED_BY_V1',
});

/**
 * Codes de rejet machine-lisibles, stables, distincts du texte du motif.
 * `promotion_status` porte la CATÉGORIE (source vs contrat) ; `reason_code`
 * porte la CAUSE exploitable automatiquement. Persistés dans
 * supplier_catalog_import_rejections.reason_code.
 */
const REASON_CODES = Object.freeze({
  // Défauts de ligne détectés AVANT la classification métier.
  SOURCE_ROW_NOT_OBJECT: 'SOURCE_ROW_NOT_OBJECT',
  MISSING_SUPPLIER_PRODUCT_ID: 'MISSING_SUPPLIER_PRODUCT_ID',
  DUPLICATE_SUPPLIER_PRODUCT_ID_IN_BATCH: 'DUPLICATE_SUPPLIER_PRODUCT_ID_IN_BATCH',
  SOURCE_FIELD_TOO_LARGE: 'SOURCE_FIELD_TOO_LARGE',
  SOURCE_PRODUCT_TOO_DEEP: 'SOURCE_PRODUCT_TOO_DEEP',
  // Défauts détectés PENDANT la classification.
  SOURCE_VALUE_UNPARSABLE: 'SOURCE_VALUE_UNPARSABLE',
  CONTRACT_SCHEMA_INVALID: 'CONTRACT_SCHEMA_INVALID',
  // Rejets PAR POLITIQUE de profil — la donnée n'est pas fautive, le profil
  // a décidé de ne pas l'accepter. Codes ajoutés à la liste initiale : sans
  // eux, policies.*=REJECT_PRODUCT produirait un rejet sans cause lisible.
  SOURCE_WEIGHT_UNIT_UNKNOWN: 'SOURCE_WEIGHT_UNIT_UNKNOWN',
  UNSUPPORTED_VIDEO_REJECTED_BY_POLICY: 'UNSUPPORTED_VIDEO_REJECTED_BY_POLICY',
  LOSSY_MAPPING_REJECTED_BY_POLICY: 'LOSSY_MAPPING_REJECTED_BY_POLICY',
});

const PROMOTION_STATUSES = Object.freeze([
  'READY_FOR_PROMOTION',
  'QUARANTINED_UNSUPPORTED_MEDIA',
  'QUARANTINED_LOSSY_MAPPING',
  'QUARANTINED_CURRENCY_POLICY',
  'REJECTED_CONTRACT_INVALID',
  'REJECTED_SOURCE_DATA_INVALID',
]);

/** Priorité déterministe : valeur basse = priorité haute. */
const STATUS_PRIORITY = Object.freeze({
  REJECTED_SOURCE_DATA_INVALID: 1,
  QUARANTINED_CURRENCY_POLICY: 2,
  REJECTED_CONTRACT_INVALID: 3,
  QUARANTINED_UNSUPPORTED_MEDIA: 4,
  QUARANTINED_LOSSY_MAPPING: 5,
  READY_FOR_PROMOTION: 6,
});

function finding(code, detail, extra) {
  return { code, detail, ...(extra || {}) };
}

// ── 1. Profil d'import — validation AJV RÉELLE (ING-I9) ───────────────────

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateProfileSchema = ajv.compile(importProfileSchema);

const WEIGHT_CONVERSIONS_TO_KG = Object.freeze({ kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125 });

function humanizeAjvError(e) {
  const where = e.instancePath || '(racine)';
  const extra = e.params && Object.keys(e.params).length ? ` ${JSON.stringify(e.params)}` : '';
  return `${where} ${e.message}${extra}`;
}

/**
 * Valide le profil contre le schéma OFFICIEL + les contrôles inter-champs
 * que JSON Schema ne peut pas exprimer. Toute invalidité est une erreur de
 * BATCH (BATCH_CONFIGURATION_ERROR), jamais un statut produit.
 *
 * @param {Object} profile
 * @param {Object} [opts] { expectedSourceType }
 * @returns {{ ok: boolean, errors: string[] }}
 */
function resolveImportProfile(profile, opts) {
  const expectedSourceType = (opts && opts.expectedSourceType) || 'json';
  const errors = [];

  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return { ok: false, errors: ['profil absent ou non-objet'] };
  }

  if (!validateProfileSchema(profile)) {
    for (const e of validateProfileSchema.errors || []) errors.push(humanizeAjvError(e));
    // Les contrôles inter-champs supposent une forme déjà valide.
    return { ok: false, errors };
  }

  // Inter-champs 1 : la devise par défaut doit appartenir à currency.allowed.
  if (profile.currency.default !== null && !profile.currency.allowed.includes(profile.currency.default)) {
    errors.push(`currency.default "${profile.currency.default}" absent de currency.allowed (${profile.currency.allowed.join(', ')})`);
  }

  // Inter-champs 2 : ce connecteur ne traite que source_type=json.
  if (profile.source_type !== expectedSourceType) {
    errors.push(`source_type "${profile.source_type}" — ce connecteur exige "${expectedSourceType}" (un fichier JSON ne se déclare jamais "api" : cela falsifierait provenance, connecteur, config applicable, métriques et reprise)`);
  }

  // Inter-champs 3 : une unité source déclarée doit être convertible.
  if (profile.weight.source_unit !== null) {
    if (!Object.prototype.hasOwnProperty.call(WEIGHT_CONVERSIONS_TO_KG, profile.weight.source_unit)) {
      errors.push(`weight.source_unit "${profile.weight.source_unit}" sans facteur de conversion connu`);
    }
    if (profile.weight.source_field === null) {
      errors.push('weight.source_unit déclarée mais weight.source_field=null — configuration contradictoire');
    }
  }

  return { ok: errors.length === 0, errors };
}

// ── 2. Prévalidation du batch source (BATCH_SOURCE_FORMAT_ERROR) ──────────

function jsonDepth(value, cap) {
  let max = 0;
  const walk = (v, d) => {
    if (d > max) max = d;
    if (max > cap) return;
    if (Array.isArray(v)) { for (const i of v) walk(i, d + 1); return; }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) walk(v[k], d + 1); }
  };
  walk(value, 0);
  return max;
}

/**
 * PRÉFLIGHT DE L'ENVELOPPE — seul niveau autorisé à empêcher la naissance
 * du batch.
 *
 * Frontière stricte : ne contrôle QUE ce qui, en défaut, rend la source
 * inexploitable dans son ensemble — racine, products[], taille globale,
 * nombre global. Aucun contenu de ligne. Une ligne fautive n'empêche pas de
 * lire les 81 autres : elle devient un rejet motivé et participe au seuil
 * (ING-I4), elle ne fait pas disparaître le fichier.
 *
 * Ne transforme JAMAIS un format incorrect en catalogue vide.
 *
 * @param {*} root            racine JSON déjà parsée
 * @param {Object} profile    profil DÉJÀ validé par resolveImportProfile
 * @param {Object} [opts]     { sourceBytes }
 * @returns {{ ok: boolean, errors: string[] }}
 */
function preflightSourceEnvelope(root, profile, opts) {
  const b = profile.batch;
  const sourceBytes = opts && typeof opts.sourceBytes === 'number' ? opts.sourceBytes : null;

  if (sourceBytes !== null && sourceBytes > b.max_file_bytes) {
    return { ok: false, errors: [`taille source ${sourceBytes} octets > batch.max_file_bytes (${b.max_file_bytes})`] };
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    return { ok: false, errors: ['la racine JSON n\'est pas un objet'] };
  }
  if (!Object.prototype.hasOwnProperty.call(root, 'products')) {
    return { ok: false, errors: ['champ "products" absent de la racine — un format inconnu n\'est pas un catalogue vide'] };
  }
  if (!Array.isArray(root.products)) {
    return { ok: false, errors: [`champ "products" de type ${typeof root.products} — tableau attendu`] };
  }
  if (root.products.length === 0 && !b.allow_empty_products) {
    return { ok: false, errors: ['tableau "products" vide et batch.allow_empty_products=false'] };
  }
  if (root.products.length > b.max_products) {
    return { ok: false, errors: [`${root.products.length} produits > batch.max_products (${b.max_products})`] };
  }
  return { ok: true, errors: [] };
}

/**
 * Préanalyse déterministe des identités — AVANT toute classification métier.
 *
 * Un identifiant dupliqué ne peut pas être arbitré : choisir la première ou
 * la dernière occurrence serait un « dernier écrit gagne » déguisé, et le
 * résultat dépendrait de l'ordre des lignes. TOUTES les occurrences d'un
 * identifiant dupliqué sont donc rejetées, aucune n'est privilégiée. Les
 * lignes saines du même fichier continuent.
 *
 * @returns {Map<number, { reason_code, detail, extra }>} défauts par index
 */
function analyzeRowIdentities(rows, profile) {
  const idField = profile.identity.supplier_id_field;
  const defects = new Map();
  const occurrences = new Map();

  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    if (p === null || typeof p !== 'object' || Array.isArray(p)) {
      defects.set(i, {
        reason_code: REASON_CODES.SOURCE_ROW_NOT_OBJECT,
        detail: `products[${i}] : objet produit nul ou non-objet (${p === null ? 'null' : typeof p})`,
      });
      continue;
    }
    const rawId = p[idField];
    if (rawId === undefined || rawId === null || String(rawId).trim() === '') {
      defects.set(i, {
        reason_code: REASON_CODES.MISSING_SUPPLIER_PRODUCT_ID,
        detail: `products[${i}] : identity.supplier_id_field "${idField}" absent ou vide — sans identité fournisseur, aucun candidat ne peut être ni créé ni retrouvé`,
      });
      continue;
    }
    const id = String(rawId);
    const list = occurrences.get(id) || [];
    list.push(i);
    occurrences.set(id, list);
  }

  for (const [id, indices] of occurrences.entries()) {
    if (indices.length < 2) continue;
    for (const i of indices) {
      defects.set(i, {
        reason_code: REASON_CODES.DUPLICATE_SUPPLIER_PRODUCT_ID_IN_BATCH,
        detail: `supplier_product_id "${id}" présent ${indices.length} fois dans le batch (index ${indices.join(', ')}) — AUCUNE occurrence n'est privilégiée : élire la première ou la dernière serait un choix implicite dépendant de l'ordre des lignes, et ON CONFLICT (supplier_name, supplier_product_id) ferait s'écraser deux lignes de la MÊME exécution`,
        extra: { duplicate_supplier_product_id: id, source_indices: indices },
      });
    }
  }

  return defects;
}

/** Défauts de taille/profondeur — d'une ligne, pas du batch. */
function analyzeRowShape(p, index, profile) {
  const b = profile.batch;
  if (typeof b.max_depth === 'number') {
    const d = jsonDepth(p, b.max_depth);
    if (d > b.max_depth) {
      return {
        reason_code: REASON_CODES.SOURCE_PRODUCT_TOO_DEEP,
        detail: `products[${index}] : profondeur JSON ${d} > batch.max_depth (${b.max_depth})`,
      };
    }
  }
  if (typeof b.max_field_bytes === 'number') {
    for (const k of Object.keys(p)) {
      const v = p[k];
      if (typeof v === 'string' && Buffer.byteLength(v, 'utf8') > b.max_field_bytes) {
        return {
          reason_code: REASON_CODES.SOURCE_FIELD_TOO_LARGE,
          detail: `products[${index}] : champ "${k}" de ${Buffer.byteLength(v, 'utf8')} octets > batch.max_field_bytes (${b.max_field_bytes})`,
        };
      }
    }
  }
  return null;
}

/** Diagnostics d'une ligne rejetée AVANT la classification métier. */
function buildRowRejectionDiagnostics(p, index, defect, profile) {
  const supplierProductId = (p && typeof p === 'object' && !Array.isArray(p))
    ? (p[profile.identity.supplier_id_field] != null ? String(p[profile.identity.supplier_id_field]) : null)
    : null;
  return {
    source_index: index,
    supplier_product_id: defect.reason_code === REASON_CODES.MISSING_SUPPLIER_PRODUCT_ID ? null : supplierProductId,
    source_id: (p && typeof p === 'object') ? p.id : null,
    status: 'REJECTED_SOURCE_DATA_INVALID',
    status_priority: STATUS_PRIORITY.REJECTED_SOURCE_DATA_INVALID,
    reason_code: defect.reason_code,
    reasons: [defect.detail],
    findings: [finding(defect.reason_code, defect.detail, defect.extra)],
    profile: { profile_id: profile.profile_id, profile_version: profile.profile_version },
    contract_validation: { attempted: false, valid: null, errors: [] },
    schema_version_used: null,
    currency: null,
    media: {
      role_assignment_basis: null, thumbnail_fallback_used: false, relations_kept: null,
      gallery_preserved: null, dropped_fields: [], deduplicated: [], reused_across_roles: [],
    },
    weight_provenance: null,
    transformations: { price: null, stock: null, category: null },
    source_fidelity: { complete: false, unsupported_fields: [] },
    video_representation: null,
    ...(defect.extra || {}),
  };
}

/**
 * ANALYSE DES LIGNES — ne lève JAMAIS d'exception pour une donnée produit
 * incorrecte. Chaque ligne repart en ready | quarantined | rejected, avec
 * son index source, son RAW et ses diagnostics.
 *
 * Ordre des défauts de ligne (déterministe) :
 *   1. forme       (non-objet)                  — on ne peut rien lire d'autre
 *   2. identité    (absente, puis dupliquée)    — sans identité, aucun staging
 *   3. gabarit     (champ trop gros, trop profond)
 *   4. classification métier (classifyPromotion)
 *
 * L'identité prime sur le reste : une ligne dupliquée ET au prix illisible
 * est rejetée pour son doublon. Le motif secondaire reste dans `findings`.
 *
 * @returns {Array} entrées uniformes { source_index, supplier_product_id,
 *                  status, contract, raw_payload, diagnostics }
 */
function analyzeSourceRows(rows, profile) {
  const identityDefects = analyzeRowIdentities(rows, profile);
  const entries = [];

  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];

    const defect = identityDefects.get(i) || (
      (p && typeof p === 'object' && !Array.isArray(p)) ? analyzeRowShape(p, i, profile) : null
    );

    if (defect) {
      const diagnostics = buildRowRejectionDiagnostics(p, i, defect, profile);
      entries.push({
        source_index: i,
        supplier_product_id: diagnostics.supplier_product_id,
        status: 'REJECTED_SOURCE_DATA_INVALID',
        reason_code: defect.reason_code,
        contract: null,
        raw_payload: p,
        diagnostics,
      });
      continue;
    }

    const verdict = classifyPromotion(p, profile);
    const diagnostics = buildDiagnostics(verdict, profile, i);
    entries.push({
      source_index: i,
      supplier_product_id: verdict.supplierProductId,
      status: verdict.status,
      reason_code: verdict.reasonCode || null,
      contract: verdict.contract || null,
      raw_payload: p,
      diagnostics,
    });
  }

  return entries;
}

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

// ── 5. Détection vidéo (3 formes possibles, jamais représentable) ─────────

function classifyUrlSyntactically(u) {
  if (u === null || u === undefined) return { present: false };
  if (typeof u !== 'string' || !u.trim()) return { present: true, syntacticallyValid: false, reason: 'valeur vide ou non-string' };
  if (!/^https?:\/\//i.test(u.trim())) return { present: true, syntacticallyValid: false, reason: 'schéma non http(s)' };
  if (/invalid\.example\.test|not-found|broken/i.test(u)) {
    return { present: true, syntacticallyValid: false, reason: 'marqueur explicite d\'invalidité dans l\'URL' };
  }
  return { present: true, syntacticallyValid: true };
}

function detectVideoForms(p) {
  const forms = [];
  const videoItems = [];
  if (Array.isArray(p.videos) && p.videos.length > 0) {
    forms.push('form1_videos_array');
    for (const v of p.videos) videoItems.push({ form: 'form1_videos_array', url: v.url, poster: v.poster || null, urlCheck: classifyUrlSyntactically(v.url) });
  }
  if (p.video) {
    forms.push('form2_video_string');
    videoItems.push({ form: 'form2_video_string', url: p.video, poster: p.videoPoster || null, urlCheck: classifyUrlSyntactically(p.video) });
  }
  if (Array.isArray(p.media)) {
    const videoMedia = p.media.filter((m) => m && m.type === 'video');
    for (const m of videoMedia) videoItems.push({ form: 'form3_media_array', url: m.url, poster: m.poster || null, urlCheck: classifyUrlSyntactically(m.url) });
    if (videoMedia.length > 0) forms.push('form3_media_array');
  }
  return { forms, videoItems, hasVideo: forms.length > 0 };
}

// ── 6. Galerie médias déterministe + déduplication des relations ──────────

/**
 * Un rôle média n'est JAMAIS déduit d'une position. Toute entrée de la
 * galerie source est role=PRODUCT ; display_order est une position
 * d'affichage, pas une sémantique.
 *
 * Déduplication (policies.duplicate_relation) :
 *   • même (url + type + rôle) dans le même produit -> une seule relation,
 *     événement d'audit MEDIA_RELATION_DEDUPLICATED ;
 *   • même url sous plusieurs rôles -> les DEUX relations sont conservées,
 *     finding ASSET_REUSED_ACROSS_ROLES. Une réutilisation légitime n'est
 *     jamais supprimée ;
 *   • même asset partagé entre produits -> hors de portée d'un produit,
 *     traité au niveau batch par le connecteur (policies.asset_reuse).
 *
 * @returns {{ media: Array, roleAssignmentBasis: string|null, findings: Array }}
 */
function normalizeMedia(p, profile) {
  const field = profile.media.gallery_source_field;
  const findings = [];
  const rawImages = Array.isArray(p[field]) ? p[field] : [];

  let candidates;
  let roleAssignmentBasis;

  if (rawImages.length > 0) {
    // La thumbnail n'est JAMAIS ajoutée à une galerie non vide : c'est un
    // aperçu technique, pas un média catalogue.
    candidates = rawImages.map((url, idx) => ({ url, type: 'image', role: 'PRODUCT', source_index: idx }));
    roleAssignmentBasis = 'source_field_images';
  } else if (profile.media.thumbnail_fallback && typeof p.thumbnail === 'string' && p.thumbnail.trim()) {
    // Point 7 — le fallback est RÉELLEMENT utilisé sur ce dataset (id 15 :
    // images: [], thumbnail valide). La base est exposée en V1 comme en V2,
    // jamais laissée à null.
    candidates = [{ url: p.thumbnail, type: 'image', role: 'PRODUCT', source_index: 0 }];
    roleAssignmentBasis = 'thumbnail_fallback';
    findings.push(finding(FINDINGS.THUMBNAIL_FALLBACK_USED,
      `${field} vide : thumbnail utilisée comme image principale (role=PRODUCT, display_order=0)`));
  } else {
    findings.push(finding(FINDINGS.MISSING_IMAGE,
      `aucun média : ${field} vide et pas de thumbnail exploitable (policies.missing_image=${profile.policies.missing_image})`));
    return { media: [], roleAssignmentBasis: null, findings };
  }

  const kept = [];
  const seenTriples = new Map();
  const urlRoles = new Map();
  for (const c of candidates) {
    const triple = `${c.url}|${c.type}|${c.role}`;
    if (seenTriples.has(triple)) {
      findings.push(finding(FINDINGS.MEDIA_RELATION_DEDUPLICATED,
        `relation média identique (url + type + rôle) déjà présente à la position source ${seenTriples.get(triple)} : position source ${c.source_index} dédupliquée (policies.duplicate_relation=${profile.policies.duplicate_relation})`,
        { url: c.url, role: c.role, media_type: c.type, source_index: c.source_index, kept_source_index: seenTriples.get(triple) }));
      continue;
    }
    seenTriples.set(triple, c.source_index);
    const roles = urlRoles.get(c.url) || new Set();
    roles.add(c.role);
    urlRoles.set(c.url, roles);
    kept.push(c);
  }

  for (const [url, roles] of urlRoles.entries()) {
    if (roles.size > 1) {
      findings.push(finding(FINDINGS.ASSET_REUSED_ACROSS_ROLES,
        `asset réutilisé sous ${roles.size} rôles (${[...roles].join(', ')}) — relations conservées, une réutilisation légitime n'est jamais supprimée (policies.asset_reuse=${profile.policies.asset_reuse})`,
        { url, roles: [...roles] }));
    }
  }

  // display_order = position d'affichage finale, recalculée après dédup pour
  // rester contiguë. La position source d'origine reste dans les findings.
  const media = kept.map((c, idx) => ({ url: c.url, role: c.role, display_order: idx }));
  return { media, roleAssignmentBasis, findings };
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

// ── 9. Classification de promotion — priorité déterministe ────────────────

/**
 * Point d'entrée unique par produit. Applique l'ordre documenté en tête de
 * fichier. Les motifs secondaires restent dans `findings` ; le statut
 * primaire suit STATUS_PRIORITY et rien d'autre.
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

  // ── Étape 2 : devise — AVANT l'AJV (cf. en-tête : currency est required) ─
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

/**
 * Diagnostics par produit — c'est CE bloc que le rapport officiel et le
 * staging consomment. Le V4 n'est plus l'unique endroit à porter ces
 * analyses.
 *
 * NOTE : normalized-supplier-product.v{1,2} est additionalProperties:false.
 * Ni les findings ni weight_provenance ne peuvent voyager DANS le contrat :
 * ils sont persistés à côté (cf. projet de migration, colonne findings).
 */
function buildDiagnostics(verdict, profile, sourceIndex) {
  return {
    source_index: sourceIndex != null ? sourceIndex : null,
    supplier_product_id: verdict.supplierProductId,
    source_id: verdict.sourceId,
    status: verdict.status,
    status_priority: STATUS_PRIORITY[verdict.status],
    reason_code: verdict.reasonCode || null,
    reasons: verdict.reasons,
    findings: verdict.findings,
    profile: { profile_id: profile.profile_id, profile_version: profile.profile_version },
    contract_validation: verdict.contractValidation || { attempted: false, valid: null, errors: [] },
    schema_version_used: verdict.schemaVersionUsed || null,
    currency: verdict.currencyResolved
      ? { value: verdict.currencyResolved.value, origin: verdict.currencyResolved.origin }
      : null,
    media: {
      role_assignment_basis: verdict.roleAssignmentBasis || null,
      thumbnail_fallback_used: verdict.roleAssignmentBasis === 'thumbnail_fallback',
      relations_kept: verdict.mediaCount != null ? verdict.mediaCount : null,
      gallery_preserved: verdict.galleryPreserved != null ? verdict.galleryPreserved : null,
      dropped_fields: verdict.droppedFields || [],
      deduplicated: (verdict.findings || []).filter((f) => f.code === FINDINGS.MEDIA_RELATION_DEDUPLICATED),
      reused_across_roles: (verdict.findings || []).filter((f) => f.code === FINDINGS.ASSET_REUSED_ACROSS_ROLES),
    },
    weight_provenance: verdict.parsed && verdict.parsed.weight ? verdict.parsed.weight.provenance : null,
    transformations: {
      price: verdict.parsed.price.transformed
        ? { from: verdict.parsed.price.original, to: verdict.parsed.price.value, currency_extracted: verdict.parsed.price.currency }
        : null,
      stock: verdict.parsed.stock.transformed ? { from: verdict.parsed.stock.original, to: verdict.parsed.stock.value } : null,
      category: verdict.parsed.category.changed ? { to: verdict.parsed.category.proposed } : null,
    },
    source_fidelity: verdict.videoRepresentation
      ? verdict.videoRepresentation.source_fidelity
      : { complete: verdict.status === 'READY_FOR_PROMOTION' && verdict.galleryPreserved === true, unsupported_fields: [] },
    video_representation: verdict.videoRepresentation || null,
  };
}

module.exports = {
  PIPELINE_VERSION,
  PROMOTION_STATUSES,
  STATUS_PRIORITY,
  FINDINGS,
  REASON_CODES,
  resolveImportProfile,
  preflightSourceEnvelope,
  analyzeSourceRows,
  analyzeRowIdentities,
  parseSourceProduct,
  resolveWeight,
  resolveCurrency,
  normalizeMedia,
  normalizeProduct,
  validateContract,
  classifyPromotion,
  buildDiagnostics,
  // exposés pour tests / dry-run détaillé
  detectVideoForms,
  classifyUrlSyntactically,
  buildV1,
  buildV2,
};
