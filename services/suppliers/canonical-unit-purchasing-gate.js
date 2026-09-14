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
  const resolution = await resolveFn(productSkuId, query);
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
  if (Number(state.stock_available) < Number(quantity)) return blocked('OUT_OF_STOCK', { stock_available: state.stock_available });
  if (!(Number(state.purchase_price) > 0)) return blocked('PRICE_UNAVAILABLE');
  if (!state.currency) return blocked('CURRENCY_UNAVAILABLE');

  const verdict = await adapterCheck.adapter.evaluate({
    row: { ...resolution.legacy_sku, supplier_unit_ref: resolution.supplier_unit_ref },
    identity,
    quantity,
    context,
    canonicalUnit: resolution.canonical_unit,
  });
  if (!verdict?.ready) return { ...verdict, place_order_invoked: false };
  if (typeof adapterCheck.adapter.buildOrderPayload !== 'function') {
    return blocked('BUILD_ORDER_PAYLOAD_CAPABILITY_UNAVAILABLE', { provider: identity.provider });
  }
  const payload = await adapterCheck.adapter.buildOrderPayload({
    identity,
    quantity,
    canonicalUnit: resolution.canonical_unit,
    preflight: verdict,
    context,
  });
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
