/**
 * @komerce-arch
 * @role          allegro-sandbox-fulfillment-adapter
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        exact sandbox offer identity, quantity
 * @outputs       live stock and price evidence, blocked purchase verdict
 * @depends       services/suppliers/connectors/allegro-connector.js, services/suppliers/supplier-fulfillment-readiness.js
 * @used-by       scripts/allegro-sandbox-check.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  purchasing, supplier-integration
 */
'use strict';
const connector = require('./connectors/allegro-connector');
const { VERDICT, result } = require('./supplier-fulfillment-readiness');
const provider = 'allegro';

async function evaluate({ row, identity, quantity, context = {} }) {
  const evidence = { provider, environment: 'sandbox', place_order_invoked: false, payment_invoked: false };
  const id = identity?.payload?.offer_id;
  if (identity?.provider !== provider || identity.version !== 1 || identity.payload.environment !== 'sandbox'
    || typeof id !== 'string' || !/^[0-9]{1,30}$/.test(id) || row?.supplier_unit_ref !== id
    || row.supplier_sku !== `allegro-sandbox:${id}`) return result(VERDICT.BLOCKED_IDENTITY, evidence, 'ALLEGRO_IDENTITY_MISMATCH');
  if (!Number.isSafeInteger(quantity) || quantity < 1) return result(VERDICT.PREFLIGHT_FAILED, evidence, 'INVALID_QUANTITY');
  let fetched;
  try { fetched = await connector.fetchProducts({ productIds: [id], client: context.allegroClient }); }
  catch { return result(VERDICT.SUPPLIER_UNAVAILABLE, evidence, 'ALLEGRO_LIVE_READ_FAILED'); }
  if (fetched.products.length !== 1 || fetched.invalid.length) return result(VERDICT.PREFLIGHT_FAILED, evidence, 'ALLEGRO_INVALID_LIVE_OFFER');
  const unit = fetched.products[0].sellable_units[0];
  Object.assign(evidence, { supplier_unit_ref: id, stock_available: unit.stock_available,
    unit_price: unit.purchase_price, currency: unit.currency, exact_unit_resolved: true,
    live_stock_checked: true, live_price_checked: true, supplier_leg_checked: false });
  if (!unit.is_active) return result(VERDICT.SKU_INACTIVE, evidence, 'ALLEGRO_OFFER_NOT_ACTIVE');
  if (unit.stock_available < quantity) return result(VERDICT.OUT_OF_STOCK, evidence, 'ALLEGRO_INSUFFICIENT_STOCK');
  // Seller order endpoints do not create a buyer checkout. Never fabricate READY or an order ID.
  return result(VERDICT.PREFLIGHT_FAILED, evidence, 'ALLEGRO_BUYER_CHECKOUT_UNSUPPORTED');
}

module.exports = { provider, evaluate };
