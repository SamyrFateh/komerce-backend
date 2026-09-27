/**
 * @komerce-arch
 * @role          catalog-certification
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        canonical catalog candidate facts
 * @outputs       versioned certification verdict and reasons
 * @depends       services/product-publication-guard.js, utils/certification-accounting.js
 * @used-by       scripts/catalog-e2e-712-acceptance.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      certification_is_provider_independent_fail_closed_and_versioned
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
  if (Number(row.active_supplier_skus || 0) < 1) reasons.push('active_supplier_sku_missing');
  if (Number(row.complete_supplier_skus || 0) !== Number(row.active_supplier_skus || 0)) {
    reasons.push('supplier_order_identity_incomplete');
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
    patch: { is_active: true },
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
  certifyCatalogBatch,
};
