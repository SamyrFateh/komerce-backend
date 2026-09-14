/**
 * @komerce-arch
 * @role          catalog-product-source-read-authority
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        visible_legacy_product, configured_read_mode
 * @outputs       public_contract_safe_product_row, internal_read_diagnostic
 * @depends       services/sourcing-catalog-product-linkage.js, services/sourcing-canonical-product-projection.js, services/catalog-product-read-cutover-trial.js
 * @used-by       routes/products.js, services/catalog-product-route-canary.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOG_PRODUCT_READ_AUTHORITY.md
 * @impact-areas  catalog, sourcing
 * @version       2026-09
 */
'use strict';

const linkage = require('./sourcing-catalog-product-linkage');
const projection = require('./sourcing-canonical-product-projection');
const { applyCanonicalSourceReadSeam } = require('./catalog-product-read-cutover-trial');

const READ_MODES = Object.freeze({
  LEGACY_ONLY: 'LEGACY_ONLY',
  CANARY: 'CANARY',
  CANONICAL_PREFERRED: 'CANONICAL_PREFERRED',
});

function normalizeReadMode(value) {
  const requested = String(value || '').trim().toUpperCase();
  return Object.values(READ_MODES).includes(requested) ? requested : READ_MODES.LEGACY_ONLY;
}

function resolveCatalogProductReadMode(env = process.env) {
  return normalizeReadMode(env.CATALOG_PRODUCT_READ_MODE);
}

function canaryGatesOpen(productId, headers, env) {
  if (env.CATALOG_PRODUCT_ROUTE_CANARY_ENABLED !== 'true') return false;
  if (String(headers['x-komerce-catalog-canary'] || '').toLowerCase() !== 'v1') return false;
  return String(env.CATALOG_PRODUCT_ROUTE_CANARY_PRODUCT_IDS || '')
    .split(',').map((id) => id.trim()).filter(Boolean).includes(productId);
}

function diagnostic(status, details = {}) {
  return { status, canonical_fields_applied: 0, conflict_fallbacks: 0, absent_fallbacks: 0, ...details };
}

async function resolveCanonicalPreferred({
  productId,
  legacyRow,
  query,
  linkageFn,
  projectionFn,
  seamFn,
}) {
  try {
    const canonicalIds = await linkageFn(productId, query);
    if (!canonicalIds.length) return { row: legacyRow, diagnostic: diagnostic('legacy_no_link') };
    if (canonicalIds.length > 1) {
      return { row: legacyRow, diagnostic: diagnostic('legacy_ambiguity', { canonical_product_ids: canonicalIds }) };
    }

    const canonicalProductId = canonicalIds[0];
    const projectedProduct = await projectionFn(canonicalProductId, query);
    if (!projectedProduct) {
      return { row: legacyRow, diagnostic: diagnostic('legacy_no_projection', { canonical_product_id: canonicalProductId }) };
    }

    const seam = seamFn(legacyRow, projectedProduct);
    const summary = seam?.summary || {};
    const details = {
      canonical_product_id: canonicalProductId,
      canonical_fields_applied: summary.canonical_fields_applied || 0,
      conflict_fallbacks: summary.conflict_fallbacks || 0,
      absent_fallbacks: summary.absent_fallbacks || 0,
    };
    if (seam?.status !== 'SAFE' || summary.public_contract_equal !== true) {
      return { row: legacyRow, diagnostic: diagnostic('legacy_unsafe', details) };
    }
    if (details.conflict_fallbacks > 0) {
      return { row: seam.hybrid_row, diagnostic: diagnostic('legacy_conflict', details) };
    }
    if (details.canonical_fields_applied > 0) {
      return { row: seam.hybrid_row, diagnostic: diagnostic('canonical_applied', details) };
    }
    return { row: legacyRow, diagnostic: diagnostic('legacy_no_projection', details) };
  } catch (error) {
    return { row: legacyRow, diagnostic: diagnostic('legacy_read_error', { error_name: error?.name || 'Error' }) };
  }
}

async function readCatalogProductSource({
  productId,
  legacyRow,
  query,
  headers = {},
  env = process.env,
  mode = resolveCatalogProductReadMode(env),
  linkageFn = linkage.findCanonicalProductIdsForCatalogProduct,
  projectionFn = projection.collectCanonicalProductProjectionById,
  seamFn = applyCanonicalSourceReadSeam,
} = {}) {
  const effectiveMode = normalizeReadMode(mode);
  if (effectiveMode === READ_MODES.LEGACY_ONLY) {
    return { row: legacyRow, diagnostic: diagnostic('legacy_mode'), mode: effectiveMode };
  }
  if (effectiveMode === READ_MODES.CANARY && !canaryGatesOpen(productId, headers, env)) {
    return { row: legacyRow, diagnostic: diagnostic('legacy_mode'), mode: effectiveMode };
  }
  const result = await resolveCanonicalPreferred({ productId, legacyRow, query, linkageFn, projectionFn, seamFn });
  return { ...result, mode: effectiveMode };
}

module.exports = {
  READ_MODES,
  resolveCatalogProductReadMode,
  readCatalogProductSource,
  _canaryGatesOpen: canaryGatesOpen,
};
