/**
 * @komerce-arch
 * @role          catalog-pipeline-constants
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        none
 * @outputs       finding_codes, reason_codes, promotion_statuses, status_priority
 * @depends       none
 * @used-by       services/suppliers/json-source-pipeline.js, services/suppliers/promotion-classifier.js, services/suppliers/source-product-normalizer.js, services/suppliers/media-normalizer.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md (ING-I1..I4, ING-I9 proposé), docs/doctrine/CHANTIERS_INGESTION_CATALOGUE.md (ING-6 proposé)
 * @impact-areas  catalog, product-discovery
 * @version       2026-08 (ING-6 — extrait de json-source-pipeline.js, domaine 2/5)
 */

/**
 * KOMERCE — Constantes partagées du pipeline JSON « à plat + galerie » (ING-6)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Extrait de services/suppliers/json-source-pipeline.js pour que
 * promotion-classifier.js, source-product-normalizer.js et
 * media-normalizer.js puissent consommer ces codes sans dépendre en retour
 * de json-source-pipeline.js (qui, lui, consomme classifyPromotion).
 * Aucune valeur, aucun code n'est modifié : copie exacte des constantes
 * d'origine.
 */

'use strict';

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

/** Facteurs de conversion vers le kg — utilisés par resolveImportProfile (validation du profil) ET resolveWeight (résolution par produit). */
const WEIGHT_CONVERSIONS_TO_KG = Object.freeze({ kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125 });

module.exports = {
  PIPELINE_VERSION,
  FINDINGS,
  REASON_CODES,
  PROMOTION_STATUSES,
  STATUS_PRIORITY,
  finding,
  WEIGHT_CONVERSIONS_TO_KG,
};
