/**
 * @komerce-arch
 * @role          catalog-certification
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        canonical catalog candidate facts
 * @outputs       versioned certification verdict and reasons
 * @depends       services/product-publication-guard.js, utils/certification-accounting.js
 * @used-by       services/catalog-approval.js, scripts/catalog-e2e-712-acceptance.js, scripts/catalog-refinery-final-acceptance.js
 * @db-read       boutique_categories, boutique_subcategories, catalog_media, product_market_exposure, product_skus, products, sourcing_candidates
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CERTIFICATION_CATALOGUE_SOURCING.md
 * @impact-areas  catalog, sourcing, staging-e2e, ci
 * @version       2026-09-v1
 */
'use strict';

const { validatePublicationUpdate } = require('./product-publication-guard');
const { reconcileCertificationBatch } = require('../utils/certification-accounting');

const CATALOG_CERTIFICATION_VERSION = 'catalog-certification-v1';
const ACCEPTED_SOURCING_DECISIONS = Object.freeze(['TEST', 'PRIORITY']);

function nonEmpty(value) {
  return String(value || '').trim().length > 0;
}

function sourceContractV2(row = {}) {
  return String(row?.normalized_source_contract?.schema_version || '') === '2';
}

function editorialReady(row = {}) {
  const locale = String(row.source_locale || '').trim().toLowerCase().replace('_', '-');
  const sourceAllowed = row.content_source === 'manual'
    || row.content_source === 'ai_enriched'
    || (row.content_source === 'connector_raw' && (locale === 'fr' || locale.startsWith('fr-')));
  return row.needs_review === false && sourceAllowed;
}

function evaluateCatalogProductCertification(row = {}, options = {}) {
  const reasons = [];
  const publicationGuard = options.publicationGuard || validatePublicationUpdate;
  const requireAcceptedSourcingDecision = options.requireAcceptedSourcingDecision !== false;
  const requireSourceIdentity = options.requireSourceIdentity !== false;
  const requireSourceContractV2 = options.requireSourceContractV2 !== false;
  const requireSupplierSku = options.requireSupplierSku !== false;

  if (requireSourceIdentity) {
    if (!nonEmpty(row.supplier_name)) reasons.push('supplier_name_missing');
    if (!nonEmpty(row.supplier_product_id)) reasons.push('supplier_product_id_missing');
  }

  if (requireAcceptedSourcingDecision
      && !ACCEPTED_SOURCING_DECISIONS.includes(String(row.sourcing_decision || '').toUpperCase())) {
    reasons.push('decision_not_accepted');
  }

  if (requireSourceContractV2 && !sourceContractV2(row)) reasons.push('source_contract_v2_missing');
  if (!nonEmpty(row.name)) reasons.push('name_missing');
  if (!nonEmpty(row.description)) reasons.push('description_missing');
  if (!editorialReady(row)) reasons.push('french_editorial_not_ready');

  if (!nonEmpty(row.category)) reasons.push('customs_category_missing');
  if (!nonEmpty(row.boutique_category_key)) reasons.push('boutique_category_missing');
  if (!nonEmpty(row.boutique_subcategory_key)) reasons.push('boutique_subcategory_missing');
  if (row.taxonomy_active !== true) reasons.push('boutique_taxonomy_inactive_or_invalid');

  if (Number(row.active_media || 0) < 1) reasons.push('media_missing');
  if (requireSupplierSku) {
    if (Number(row.active_supplier_skus || 0) < 1) reasons.push('active_supplier_sku_missing');
    if (Number(row.complete_supplier_skus || 0) !== Number(row.active_supplier_skus || 0)) {
      reasons.push('supplier_order_identity_incomplete');
    }
  }

  if (row.lifecycle_status !== 'candidate' || row.is_active === true) {
    reasons.push('not_inactive_candidate');
  }
  if (Number(row.enabled_markets || 0) > 0) reasons.push('market_exposure_enabled');

  const publication = publicationGuard({
    before: {
      ...row,
      is_active: false,
      is_available: false,
    },
    patch: { is_active: true, is_available: true },
    context: { catalogMediaCount: Number(row.active_media || 0) },
  });
  if (!publication.ok) reasons.push(`publication_guard:${publication.code}`);

  return {
    certification_version: CATALOG_CERTIFICATION_VERSION,
    certified: reasons.length === 0,
    reasons,
    publication_guard: publication.ok ? 'PASS' : publication.code,
  };
}

async function loadCatalogProductCertificationFacts(q, productId) {
  const { rows } = await q.query(
    `WITH media AS (
       SELECT product_id,
              COUNT(*) FILTER (WHERE is_active=TRUE)::int AS active_media
         FROM catalog_media
        WHERE product_id=$1
        GROUP BY product_id
     ),
     sku AS (
       SELECT product_id,
              COUNT(*) FILTER (WHERE source='SUPPLIER')::int AS supplier_skus,
              COUNT(*) FILTER (WHERE source='SUPPLIER' AND is_active=TRUE)::int AS active_supplier_skus,
              COUNT(*) FILTER (
                WHERE source='SUPPLIER'
                  AND is_active=TRUE
                  AND supplier_unit_ref IS NOT NULL
                  AND supplier_order_identity IS NOT NULL
              )::int AS complete_supplier_skus
         FROM product_skus
        WHERE product_id=$1
        GROUP BY product_id
     ),
     exposure AS (
       SELECT product_id,
              COUNT(*) FILTER (WHERE commercial_exposure='ENABLED')::int AS enabled_markets
         FROM product_market_exposure
        WHERE product_id=$1
        GROUP BY product_id
     )
     SELECT p.id AS product_id,
            p.product_ref,
            p.name,
            p.description,
            p.source_locale,
            p.category,
            p.boutique_category_key,
            p.boutique_subcategory_key,
            CASE WHEN bc.key IS NOT NULL AND bs.key IS NOT NULL THEN TRUE ELSE FALSE END AS taxonomy_active,
            p.price_kmf,
            p.stock,
            p.content_source,
            p.needs_review,
            p.lifecycle_status,
            p.is_active,
            p.is_available,
            p.inventory_model,
            p.has_variants,
            sc.id IS NOT NULL AS has_sourcing_candidate,
            sc.supplier_name,
            sc.supplier_product_id,
            sc.normalized_source_contract,
            UPPER(COALESCE(sc.scan_result->>'sourcing_decision','UNKNOWN')) AS sourcing_decision,
            COALESCE(media.active_media,0)::int AS active_media,
            COALESCE(sku.supplier_skus,0)::int AS supplier_skus,
            COALESCE(sku.active_supplier_skus,0)::int AS active_supplier_skus,
            COALESCE(sku.complete_supplier_skus,0)::int AS complete_supplier_skus,
            COALESCE(exposure.enabled_markets,0)::int AS enabled_markets
       FROM products p
       LEFT JOIN LATERAL (
         SELECT candidate.id,
                candidate.supplier_name,
                candidate.supplier_product_id,
                candidate.normalized_source_contract,
                candidate.scan_result
           FROM sourcing_candidates candidate
          WHERE candidate.product_id=p.id
            AND candidate.state='imported_to_catalog'
          ORDER BY candidate.updated_at DESC NULLS LAST, candidate.created_at DESC
          LIMIT 1
       ) sc ON TRUE
       LEFT JOIN media ON media.product_id=p.id
       LEFT JOIN sku ON sku.product_id=p.id
       LEFT JOIN exposure ON exposure.product_id=p.id
       LEFT JOIN boutique_categories bc
         ON bc.key=p.boutique_category_key AND bc.is_active=TRUE
       LEFT JOIN boutique_subcategories bs
         ON bs.category_key=bc.key
        AND bs.key=p.boutique_subcategory_key
        AND bs.is_active=TRUE
      WHERE p.id=$1
      LIMIT 1`,
    [productId]
  );
  return rows[0] || null;
}

async function certifyCatalogProduct(q, productId, options = {}) {
  const row = await loadCatalogProductCertificationFacts(q, productId);
  if (!row) return null;
  const sourced = row.has_sourcing_candidate === true;
  const certification = evaluateCatalogProductCertification(row, {
    ...options,
    requireSourceIdentity: options.requireSourceIdentity ?? sourced,
    requireSourceContractV2: options.requireSourceContractV2 ?? sourced,
    requireAcceptedSourcingDecision: options.requireAcceptedSourcingDecision ?? sourced,
    requireSupplierSku: options.requireSupplierSku ?? sourced,
  });
  return { row, certification };
}

function certifyCatalogBatch(rows = [], { inputTotal = rows.length, options = {} } = {}) {
  const products = rows.map(row => ({
    ...row,
    certification: evaluateCatalogProductCertification(row, options),
  }));
  const certified = products.filter(row => row.certification.certified).length;
  const accounting = reconcileCertificationBatch({
    input_total: inputTotal,
    certified,
  });

  return {
    certification_version: CATALOG_CERTIFICATION_VERSION,
    products,
    accounting,
  };
}

module.exports = {
  CATALOG_CERTIFICATION_VERSION,
  ACCEPTED_SOURCING_DECISIONS,
  sourceContractV2,
  editorialReady,
  evaluateCatalogProductCertification,
  loadCatalogProductCertificationFacts,
  certifyCatalogProduct,
  certifyCatalogBatch,
};
