'use strict';
const adapter = require('../../services/suppliers/allegro-fulfillment-adapter');
const gate = require('../../services/suppliers/canonical-unit-purchasing-gate');
const readiness = require('../../services/suppliers/supplier-fulfillment-readiness');
function args() {
  return { row: { supplier_unit_ref: '123', supplier_sku: 'allegro-sandbox:123' },
    identity: { provider: 'allegro', version: 1, payload: { environment: 'sandbox', offer_id: '123' } }, quantity: 1,
    context: { allegroClient: { get: jest.fn().mockResolvedValue({ id: '123', name: 'Sandbox product',
      productSet: [{ quantity: { value: 1 } }], sellingMode: { format: 'BUY_NOW', price: { amount: '10.00', currency: 'PLN' } },
      stock: { available: 2 }, publication: { status: 'ACTIVE' } }) } } };
}
test('healthy live offer is manual-fulfillment ready without claiming auto-order', async () => {
  const r = await adapter.evaluate(args());
  expect(r).toMatchObject({ ready: true, status: 'FULFILLMENT_READY', reason: null,
    evidence: { exact_unit_resolved: true, stock_available: 2, unit_price: 10, currency: 'PLN',
      execution_mode: 'manual', manual_procurement_ready: true, auto_order_ready: false,
      buyer_checkout_api_supported: false, place_order_invoked: false, payment_invoked: false,
      supplier_offer_url: 'https://allegro.pl.allegrosandbox.pl/oferta/123' } });
});
test.each([
  { identity: null }, { identity: { provider: 'allegro', version: 2 } },
  { identity: { provider: 'allegro', version: 1, payload: { environment: 'production', offer_id: '123' } } },
  { identity: { provider: 'allegro', version: 1, payload: { environment: 'sandbox', offer_id: 'UUID' } } },
  { row: { supplier_unit_ref: '124' } }, { row: { supplier_unit_ref: '123', supplier_sku: 'wrong' } }, { row: null },
])('identity mismatch fails before network: %j', async changes => {
  const a = { ...args(), ...changes };
  expect((await adapter.evaluate(a)).status).toBe('BLOCKED_SUPPLIER_IDENTITY');
  expect(a.context.allegroClient.get).not.toHaveBeenCalled();
});
test.each([0, 1.5, '1', NaN])('invalid quantity %s', async quantity => {
  expect((await adapter.evaluate({ ...args(), quantity })).reason).toBe('INVALID_QUANTITY');
});
test('network failure and invalid live facts block', async () => {
  const a = args(); a.context.allegroClient.get.mockRejectedValueOnce(new Error('SECRET'));
  expect(await adapter.evaluate(a)).toMatchObject({ status: 'SUPPLIER_UNAVAILABLE', reason: 'ALLEGRO_LIVE_READ_FAILED' });
  a.context.allegroClient.get.mockResolvedValueOnce({});
  expect((await adapter.evaluate(a)).reason).toBe('ALLEGRO_INVALID_LIVE_OFFER');
});
test('inactive and insufficient stock have canonical verdicts', async () => {
  const a = args(); const raw = await a.context.allegroClient.get();
  a.context.allegroClient.get.mockResolvedValueOnce({ ...raw, publication: { status: 'ENDED' } });
  expect((await adapter.evaluate(a)).status).toBe('SKU_INACTIVE');
  expect((await adapter.evaluate({ ...a, quantity: 3 })).status).toBe('OUT_OF_STOCK');
});
test('both Purchasing gates expose manual readiness while preserving the external-order hard stop', async () => {
  const a = args();
  const row = { ...a.row, id: 1, is_active: true, source: 'SUPPLIER', supplier_order_identity: a.identity };
  const db = { query: jest.fn().mockResolvedValue({ rows: [row] }) };
  const out = await readiness.evaluateSupplierFulfillmentReadiness({ db, productSkuId: 1,
    procurementRoute: { mode: 'PROCUREMENT_HUB', hub: { id: 1, country_code: 'PL' } },
    adapters: { allegro: adapter }, context: a.context });
  expect(out).toMatchObject({ ready: true, status: 'FULFILLMENT_READY',
    evidence: { procurement_route_mode: 'PROCUREMENT_HUB', manual_procurement_ready: true, auto_order_ready: false } });
  const resolver = require('../../services/sourcing-canonical-unit-product-sku-resolution');
  const canonical = await gate.prepareCanonicalUnitPurchase({ productSkuId: 1, adapters: { allegro: adapter }, context: a.context,
    resolveFn: async () => ({ status: resolver.STATUS.RESOLVED, supplier_order_identity: a.identity, supplier_unit_ref: '123', legacy_sku: row,
      canonical_unit: { current_state: { stock_available: 2, purchase_price: 10, currency: 'PLN' } } }) });
  expect(canonical).toMatchObject({
    ready: false, status: 'HARD_STOP', provider: 'allegro', place_order_invoked: false,
    payload: { execution_mode: 'manual', offer_id: '123', quantity: 1, auto_order_ready: false, place_order_invoked: false },
    preflight: { ready: true, status: 'FULFILLMENT_READY' },
  });
});
test('manual order payload requires a successful exact preflight and never fabricates execution', async () => {
  const a = args();
  const preflight = await adapter.evaluate(a);
  await expect(adapter.buildOrderPayload({ identity: a.identity, quantity: 1, preflight })).resolves.toMatchObject({
    provider: 'allegro', environment: 'sandbox', execution_mode: 'manual', offer_id: '123', quantity: 1,
    expected_unit_price: 10, expected_currency: 'PLN', auto_order_ready: false, place_order_invoked: false,
  });
  await expect(adapter.buildOrderPayload({ identity: a.identity, quantity: 1, preflight: { ready: false } }))
    .rejects.toThrow('MANUAL_PREFLIGHT_REQUIRED');
});
test('default context uses configured client boundary', async () => {
  const a = args(); delete a.context;
  expect((await adapter.evaluate(a)).status).toBe('SUPPLIER_UNAVAILABLE');
});
