/**
 * @komerce-arch
 * @role          allegro-sandbox-fulfillment-adapter
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        exact sandbox offer identity, quantity
 * @outputs       live stock/price evidence and exact manual procurement payload
 * @depends       services/suppliers/connectors/allegro-connector.js, services/suppliers/supplier-fulfillment-readiness.js
 * @used-by       scripts/allegro-sandbox-check.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md, docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
 * @impact-areas  purchasing, supplier-integration
 */
'use strict';
const connector = require('./connectors/allegro-connector');
const { VERDICT, result } = require('./supplier-fulfillment-readiness');
const provider = 'allegro';

function exactOfferId(row, identity) {
  const id = identity?.payload?.offer_id;
  if (identity?.provider !== provider || identity.version !== 1 || identity.payload.environment !== 'sandbox'
    || typeof id !== 'string' || !/^[0-9]{1,30}$/.test(id) || row?.supplier_unit_ref !== id
    || row.supplier_sku !== `allegro-sandbox:${id}`) return null;
  return id;
}

async function evaluate({ row, identity, quantity, context = {} }) {
  const evidence = {
    provider,
    environment: 'sandbox',
    execution_mode: 'manual',
    manual_procurement_ready: false,
    auto_order_ready: false,
    buyer_checkout_api_supported: false,
    place_order_invoked: false,
    payment_invoked: false,
  };
  const id = exactOfferId(row, identity);
  if (!id) return result(VERDICT.BLOCKED_IDENTITY, evidence, 'ALLEGRO_IDENTITY_MISMATCH');
  if (!Number.isSafeInteger(quantity) || quantity < 1) return result(VERDICT.PREFLIGHT_FAILED, evidence, 'INVALID_QUANTITY');
  let fetched;
  try { fetched = await connector.fetchProducts({ productIds: [id], client: context.allegroClient }); }
  catch { return result(VERDICT.SUPPLIER_UNAVAILABLE, evidence, 'ALLEGRO_LIVE_READ_FAILED'); }
  if (fetched.products.length !== 1 || fetched.invalid.length) return result(VERDICT.PREFLIGHT_FAILED, evidence, 'ALLEGRO_INVALID_LIVE_OFFER');
  const unit = fetched.products[0].sellable_units[0];
  Object.assign(evidence, {
    supplier_unit_ref: id,
    supplier_sku: `allegro-sandbox:${id}`,
    supplier_offer_url: `https://allegro.pl.allegrosandbox.pl/oferta/${id}`,
    quantity,
    stock_available: unit.stock_available,
    unit_price: unit.purchase_price,
    currency: unit.currency,
    exact_unit_resolved: true,
    live_stock_checked: true,
    live_price_checked: true,
    supplier_leg_checked: false,
  });
  if (!unit.is_active) return result(VERDICT.SKU_INACTIVE, evidence, 'ALLEGRO_OFFER_NOT_ACTIVE');
  if (unit.stock_available < quantity) return result(VERDICT.OUT_OF_STOCK, evidence, 'ALLEGRO_INSUFFICIENT_STOCK');

  // Allegro does not expose a REST buyer checkout creation endpoint. That is an
  // auto-order capability limit, not a reason to deny exact manual procurement.
  evidence.manual_procurement_ready = true;
  return result(VERDICT.READY, evidence);
}

async function buildOrderPayload({ identity, quantity, preflight }) {
  const id = identity?.payload?.offer_id;
  if (identity?.provider !== provider || identity?.version !== 1 || identity?.payload?.environment !== 'sandbox'
    || typeof id !== 'string' || !/^[0-9]{1,30}$/.test(id)) throw new Error('ALLEGRO_IDENTITY_MISMATCH');
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('INVALID_QUANTITY');
  if (!preflight?.ready || preflight?.evidence?.manual_procurement_ready !== true) throw new Error('ALLEGRO_MANUAL_PREFLIGHT_REQUIRED');
  return {
    provider,
    environment: 'sandbox',
    execution_mode: 'manual',
    supplier_unit_ref: id,
    supplier_sku: `allegro-sandbox:${id}`,
    offer_id: id,
    offer_url: `https://allegro.pl.allegrosandbox.pl/oferta/${id}`,
    quantity,
    expected_unit_price: preflight.evidence.unit_price,
    expected_currency: preflight.evidence.currency,
    auto_order_ready: false,
    place_order_invoked: false,
  };
}

module.exports = { provider, exactOfferId, evaluate, buildOrderPayload };
