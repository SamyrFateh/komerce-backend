'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { prepareCanonicalUnitPurchase } = require('../../services/suppliers/canonical-unit-purchasing-gate');

const soi = (provider, payload) => ({ provider, version: 1, payload });
const resolved = (identity, state = {}) => ({
  status: 'RESOLVED', canonical_unit_id: 'u1', supplier_unit_ref: state.ref || 'UNIT1',
  supplier_order_identity: identity, legacy_sku: { id: 'sku1', product_id: 'p1', supplier_sku: 'SKU' },
  canonical_unit: { canonical_unit_id: 'u1', current_state: { stock_available: 5, purchase_price: 10, currency: 'USD', is_active: true, ...state } },
});
function adapter(provider) {
  return { provider, evaluate: jest.fn(async ({ identity }) => ({ ready: true, status: 'FULFILLMENT_READY', evidence: { identity }, reason: null })),
    buildOrderPayload: jest.fn(async ({ identity }) => ({ provider: identity.provider, native: identity.payload })) };
}

test.each([
  ['aliexpress', { sku_id: 'AE1', sku_attr: '14:10' }],
  ['cj', { pid: 'P1', vid: 'V1', variant_sku: 'CJ-SKU' }],
])('%s garde le payload natif opaque dans son adapter', async (provider, payload) => {
  const a = adapter(provider);
  const out = await prepareCanonicalUnitPurchase({ productSkuId: 'sku1', adapters: { [provider]: a }, resolveFn: async () => resolved(soi(provider, payload)) });
  expect(out).toMatchObject({ status: 'HARD_STOP', provider, place_order_invoked: false, payload: { provider, native: payload } });
  expect(a.buildOrderPayload).toHaveBeenCalledTimes(1);
});

test.each([
  ['NO_UNIT'], ['AMBIGUOUS_PRODUCT'], ['AMBIGUOUS_UNIT'], ['NO_SUPPLIER_IDENTITY'], ['INACTIVE_UNIT'],
])('%s bloque avant adapter', async (status) => {
  const a = adapter('cj');
  const out = await prepareCanonicalUnitPurchase({ productSkuId: 'sku1', adapters: { cj: a }, resolveFn: async () => ({ status }) });
  expect(out.status).toBe('BLOCKED_SUPPLIER_IDENTITY');
  expect(a.evaluate).not.toHaveBeenCalled();
});

test('adapter absent, stock zéro, stock inconnu et prix absent bloquent', async () => {
  expect((await prepareCanonicalUnitPurchase({ productSkuId: 'sku1', resolveFn: async () => resolved(soi('cj', { vid: 'V1' })) })).status).toBe('BLOCKED_SUPPLIER_IDENTITY');
  expect((await prepareCanonicalUnitPurchase({ productSkuId: 'sku1', adapters: { cj: adapter('cj') }, resolveFn: async () => resolved(soi('cj', { vid: 'V1' }), { stock_available: 0 }) })).reason).toBe('OUT_OF_STOCK');
  expect((await prepareCanonicalUnitPurchase({ productSkuId: 'sku1', adapters: { cj: adapter('cj') }, resolveFn: async () => resolved(soi('cj', { vid: 'V1' }), { stock_available: null }) })).reason).toBe('STOCK_UNAVAILABLE');
  expect((await prepareCanonicalUnitPurchase({ productSkuId: 'sku1', adapters: { cj: adapter('cj') }, resolveFn: async () => resolved(soi('cj', { vid: 'V1' }), { purchase_price: null }) })).reason).toBe('PRICE_UNAVAILABLE');
});

test('quantité invalide bloque avant résolution', async () => {
  const resolveFn = jest.fn();
  const out = await prepareCanonicalUnitPurchase({ productSkuId: 'sku1', quantity: 0, resolveFn });
  expect(out).toMatchObject({ status: 'BLOCKED_SUPPLIER_IDENTITY', reason: 'INVALID_QUANTITY', place_order_invoked: false });
  expect(resolveFn).not.toHaveBeenCalled();
});

test('exception resolver, preflight et build payload restent fail-closed', async () => {
  const resolverFailure = await prepareCanonicalUnitPurchase({
    productSkuId: 'sku1',
    resolveFn: async () => { throw new Error('db unavailable'); },
  });
  expect(resolverFailure.reason).toBe('CANONICAL_RESOLUTION_UNAVAILABLE');

  const preflightAdapter = adapter('cj');
  preflightAdapter.evaluate.mockImplementation(async () => { throw new Error('provider down'); });
  const preflightFailure = await prepareCanonicalUnitPurchase({
    productSkuId: 'sku1', adapters: { cj: preflightAdapter },
    resolveFn: async () => resolved(soi('cj', { vid: 'V1' })),
  });
  expect(preflightFailure).toMatchObject({ status: 'BLOCKED_SUPPLIER_IDENTITY', reason: 'PREFLIGHT_ERROR', place_order_invoked: false });

  const payloadAdapter = adapter('cj');
  payloadAdapter.buildOrderPayload.mockImplementation(async () => { throw new Error('payload fail'); });
  const payloadFailure = await prepareCanonicalUnitPurchase({
    productSkuId: 'sku1', adapters: { cj: payloadAdapter },
    resolveFn: async () => resolved(soi('cj', { vid: 'V1' })),
  });
  expect(payloadFailure).toMatchObject({ status: 'BLOCKED_SUPPLIER_IDENTITY', reason: 'BUILD_ORDER_PAYLOAD_ERROR', place_order_invoked: false });
});

test('manual/CSV sans SOI reste sourcing mais Purchasing blocked; placeOrder est inexistant', async () => {
  const out = await prepareCanonicalUnitPurchase({ productSkuId: 'sku1', resolveFn: async () => ({ status: 'NO_SUPPLIER_IDENTITY' }) });
  expect(out).toMatchObject({ status: 'BLOCKED_SUPPLIER_IDENTITY', place_order_invoked: false });
  expect(out).not.toHaveProperty('placeOrder');
});
