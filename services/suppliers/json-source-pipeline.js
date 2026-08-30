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

// Domaine 2/5 (ING-6, 2026-08) : classifyPromotion() et le bloc média/vidéo
// ont été extraits vers promotion-classifier.js et media-normalizer.js
// (audit Phase 1). Nettoyage architectural ultérieur : le parsing scalaire,
// la résolution poids/devise et l'assemblage du contrat V1/V2 vivent
// désormais dans source-product-normalizer.js ; promotion-classifier.js ne
// porte plus que la décision de classification elle-même. Les constantes
// communes (FINDINGS, REASON_CODES,
// PROMOTION_STATUSES, STATUS_PRIORITY, finding(), WEIGHT_CONVERSIONS_TO_KG)
// vivent désormais dans pipeline-constants.js pour que ces deux modules ne
// dépendent pas en retour de ce fichier. Ce fichier réexporte l'API
// publique inchangée : aucun appelant externe (json-connector.js, tests)
// n'a besoin d'être modifié.
const {
  PIPELINE_VERSION,
  FINDINGS,
  REASON_CODES,
  PROMOTION_STATUSES,
  STATUS_PRIORITY,
  finding,
  WEIGHT_CONVERSIONS_TO_KG,
} = require('./pipeline-constants');

const {
  detectVideoForms,
  classifyUrlSyntactically,
  normalizeMedia,
} = require('./media-normalizer');

const {
  parseSourceProduct,
  resolveWeight,
  resolveCurrency,
  normalizeProduct,
  validateContract,
  buildV1,
  buildV2,
} = require('./source-product-normalizer');

const {
  classifyPromotion,
} = require('./promotion-classifier');

// ── 1. Profil d'import — validation AJV RÉELLE (ING-I9) ───────────────────

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateProfileSchema = ajv.compile(importProfileSchema);

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
