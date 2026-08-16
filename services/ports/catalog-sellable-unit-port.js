/**
 * @komerce-arch
 * @role          catalog-sellable-unit-port
 * @domain        operations
 * @layer         service-adapter
 * @criticality   high
 * @inputs        product_id, variant_combo, quantity, transaction_client
 * @outputs       canonical_sellable_unit
 * @depends       services/product-admin-service.js
 * @used-by       services/shared-cart-creation.js
 * @db-read       none_direct
 * @db-write      none
 * @db-txn        caller_owned
 * @doctrine      feature_boundary_adapter, no_business_rule_ownership
 * @impact-areas  shared-cart, catalog, sellable-unit-resolution
 * @version       2026-08
 */
'use strict';
const productAdminService = require('../product-admin-service');
async function resolveSellableUnit(client, input) { return productAdminService.resolveSellableUnit(client, input); }
module.exports = { resolveSellableUnit };
