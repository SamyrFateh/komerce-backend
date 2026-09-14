/**
 * @komerce-arch
 * @role          catalog-product-route-canary
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        visible_legacy_product, internal_v1_header, allowlisted_product_id
 * @outputs       safe_hybrid_or_strict_legacy_row, internal_diagnostic
 * @depends       services/sourcing-catalog-product-linkage.js, services/sourcing-canonical-product-projection.js, services/catalog-product-read-cutover-trial.js
 * @used-by       routes/products.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOG_PRODUCT_ROUTE_CANARY.md
 * @impact-areas  catalog, sourcing
 * @version       2026-09
 */
'use strict';

const linkage = require('./sourcing-catalog-product-linkage');
const projection = require('./sourcing-canonical-product-projection');
const { applyCanonicalSourceReadSeam } = require('./catalog-product-read-cutover-trial');

function gatesOpen(productId, headers, env) {
  if (env.CATALOG_PRODUCT_ROUTE_CANARY_ENABLED !== 'true') return false;
  if (String(headers['x-komerce-catalog-canary'] || '').toLowerCase() !== 'v1') return false;
  const allowlist = String(env.CATALOG_PRODUCT_ROUTE_CANARY_PRODUCT_IDS || '')
    .split(',').map((id) => id.trim()).filter(Boolean);
  return allowlist.includes(productId);
}

async function maybeApplyCatalogProductRouteCanary({
  productId,
  legacyRow,
  query,
  headers = {},
  env = process.env,
  linkageFn = linkage.findCanonicalProductIdsForCatalogProduct,
  projectionFn = projection.collectCanonicalProductProjectionById,
  seamFn = applyCanonicalSourceReadSeam,
} = {}) {
  const base = { row: legacyRow, diagnostic: null };
  if (!gatesOpen(productId, headers, env)) return base;
  try {
    const canonicalIds = await linkageFn(productId, query);
    if (!canonicalIds.length) return { row: legacyRow, diagnostic: diagnostic('legacy_no_link') };
    if (canonicalIds.length > 1) {
      return { row: legacyRow, diagnostic: diagnostic('legacy_ambiguity', { canonical_product_ids: canonicalIds }) };
    }
    const projectedProduct = await projectionFn(canonicalIds[0], query);
    if (!projectedProduct) return { row: legacyRow, diagnostic: diagnostic('legacy_no_projection') };
    const seam = seamFn(legacyRow, projectedProduct);
    const summary = seam.summary || {};
    const details = {
      canonical_product_id: canonicalIds[0],
      canonical_fields_applied: summary.canonical_fields_applied || 0,
      conflict_fallbacks: summary.conflict_fallbacks || 0,
      absent_fallbacks: summary.absent_fallbacks || 0,
    };
    if (seam.status !== 'SAFE') return { row: legacyRow, diagnostic: diagnostic('legacy_unsafe', details) };
    if (details.conflict_fallbacks > 0) return { row: seam.hybrid_row, diagnostic: diagnostic('legacy_conflict', details) };
    if (details.canonical_fields_applied > 0) return { row: seam.hybrid_row, diagnostic: diagnostic('canonical_applied', details) };
    return { row: legacyRow, diagnostic: diagnostic('legacy_no_projection', details) };
  } catch (error) {
    return { row: legacyRow, diagnostic: diagnostic('legacy_canary_error', { error_name: error?.name || 'Error' }) };
  }
}

function diagnostic(status, details = {}) {
  return { status, canonical_fields_applied: 0, conflict_fallbacks: 0, absent_fallbacks: 0, ...details };
}

module.exports = { maybeApplyCatalogProductRouteCanary, _gatesOpen: gatesOpen };
