/**
 * @komerce-arch
 * @role          canonical-unit-purchasing-hard-stop-gate
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        product_sku_id, quantity, canonical Unit resolver, provider adapters
 * @outputs       blocked_verdict_or_built_payload_hard_stop
 * @depends       services/sourcing-canonical-unit-product-sku-resolution.js, services/suppliers/supplier-order-identity.js, services/suppliers/supplier-fulfillment-adapter-contract.js
 * @used-by       future purchasing cutover composition root
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CANONICAL_UNIT_PURCHASING.md
 * @impact-areas  purchasing, sourcing
 * @version       2026-09
 */
'use strict';

const canonicalResolver = require('../sourcing-canonical-unit-product-sku-resolution');
const identityContract = require('./supplier-order-identity');
const adapterContract = require('./supplier-fulfillment-adapter-contract');

const BLOCKED = 'BLOCKED_SUPPLIER_IDENTITY';

function blocked(reason, evidence = {}) {
  return { status: BLOCKED, ready: false, reason, evidence, place_order_invoked: false };
}

async function prepareCanonicalUnitPurchase({
  productSkuId,
  quantity = 1,
  query,
  adapters = {},
  context = {},
  resolveFn = canonicalResolver.resolveCanonicalUnitForProductSku,
} = {}) {
  const requestedQuantity = Number(quantity);
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    return blocked('INVALID_QUANTITY', { product_sku_id: productSkuId, quantity });
  }

  let resolution;
  try {
    resolution = await resolveFn(productSkuId, query);
  } catch (error) {
    return blocked('CANONICAL_RESOLUTION_UNAVAILABLE', { product_sku_id: productSkuId, error_name: error?.name || 'Error' });
  }
  if (resolution.status !== canonicalResolver.STATUS.RESOLVED) {
    return blocked(resolution.status, { product_sku_id: productSkuId, canonical_resolution: resolution.status });
  }

  let identity;
  try {
    identity = identityContract.normalizeIdentity(
      resolution.supplier_order_identity,
      resolution.supplier_unit_ref
    );
  } catch (error) {
    return blocked(error.message, { product_sku_id: productSkuId, canonical_unit_id: resolution.canonical_unit_id });
  }
  const adapterCheck = adapterContract.validateAdapter(identity.provider, adapters[identity.provider]);
  if (!adapterCheck.ok) return blocked(adapterCheck.reason, { provider: identity.provider });

  const state = resolution.canonical_unit.current_state || {};
  if (state.is_active === false) return blocked('INACTIVE_UNIT', { canonical_unit_id: resolution.canonical_unit_id });

  if (state.stock_available === null || state.stock_available === undefined || state.stock_available === '') {
    return blocked('STOCK_UNAVAILABLE', { canonical_unit_id: resolution.canonical_unit_id });
  }
  const stock = Number(state.stock_available);
  if (!Number.isFinite(stock)) return blocked('STOCK_UNAVAILABLE', { stock_available: state.stock_available });
  if (stock < requestedQuantity) return blocked('OUT_OF_STOCK', { stock_available: stock, quantity: requestedQuantity });

  const price = Number(state.purchase_price);
  if (!Number.isFinite(price) || price <= 0) return blocked('PRICE_UNAVAILABLE');
  if (!String(state.currency || '').trim()) return blocked('CURRENCY_UNAVAILABLE');

  let verdict;
  try {
    verdict = await adapterCheck.adapter.evaluate({
      row: { ...resolution.legacy_sku, supplier_unit_ref: resolution.supplier_unit_ref },
      identity,
      quantity: requestedQuantity,
      context,
      canonicalUnit: resolution.canonical_unit,
    });
  } catch (error) {
    return blocked('PREFLIGHT_ERROR', { provider: identity.provider, error_name: error?.name || 'Error' });
  }
  if (!verdict?.ready) return { ...verdict, place_order_invoked: false };
  if (typeof adapterCheck.adapter.buildOrderPayload !== 'function') {
    return blocked('BUILD_ORDER_PAYLOAD_CAPABILITY_UNAVAILABLE', { provider: identity.provider });
  }

  let payload;
  try {
    payload = await adapterCheck.adapter.buildOrderPayload({
      identity,
      quantity: requestedQuantity,
      canonicalUnit: resolution.canonical_unit,
      preflight: verdict,
      context,
    });
  } catch (error) {
    return blocked('BUILD_ORDER_PAYLOAD_ERROR', { provider: identity.provider, error_name: error?.name || 'Error' });
  }
  if (payload === null || payload === undefined) {
    return blocked('BUILD_ORDER_PAYLOAD_EMPTY', { provider: identity.provider });
  }

  return {
    status: 'HARD_STOP',
    ready: false,
    provider: identity.provider,
    canonical_unit_id: resolution.canonical_unit_id,
    payload,
    preflight: verdict,
    place_order_invoked: false,
  };
}

module.exports = { BLOCKED, prepareCanonicalUnitPurchase };
