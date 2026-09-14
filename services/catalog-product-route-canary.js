/**
 * @komerce-arch
 * @role          catalog-product-route-canary-compatibility
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        visible_legacy_product, internal_v1_header, allowlisted_product_id
 * @outputs       safe_hybrid_or_strict_legacy_row, internal_diagnostic
 * @depends       services/catalog-product-source-read-service.js
 * @used-by       tests/unit/catalog-product-route-canary.test.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOG_PRODUCT_ROUTE_CANARY.md, docs/doctrine/DOCTRINE_CATALOG_PRODUCT_READ_AUTHORITY.md
 * @impact-areas  catalog, sourcing
 * @version       2026-09
 */
'use strict';

const {
  READ_MODES,
  readCatalogProductSource,
  _canaryGatesOpen,
} = require('./catalog-product-source-read-service');

async function maybeApplyCatalogProductRouteCanary(options = {}) {
  const result = await readCatalogProductSource({ ...options, mode: READ_MODES.CANARY });
  if (!_canaryGatesOpen(options.productId, options.headers || {}, options.env || process.env)) {
    return { row: options.legacyRow, diagnostic: null };
  }
  return { row: result.row, diagnostic: result.diagnostic };
}

module.exports = { maybeApplyCatalogProductRouteCanary, _gatesOpen: _canaryGatesOpen };
