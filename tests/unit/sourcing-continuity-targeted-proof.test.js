'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn(), pool: { end: jest.fn() } }));
jest.mock('../../services/sourcing-import-dispatch', () => ({
  CONNECTORS: { api: {} },
  dispatchToConnector: jest.fn(),
}));
const { parseArgs, assertExecutionAllowed, compareExactProduct, run } = require('../../scripts/sourcing-continuity-targeted-proof');

const product = (stock = 3, options = {}) => ({
  supplier_product_id: 'p-1', purchase_price: 10, currency: 'PLN', stock_available: stock,
  sellable_units: [{ supplier_unit_ref: 'unit-1', stock_available: stock, purchase_price: 10, currency: 'PLN', is_active: stock > 0 }],
  ...options,
});
const connectors = { allegro: { supplierName: 'Allegro Sandbox', active: true, module: { fetchProducts: () => {} } } };
const query = jest.fn();
const dispatchToConnector = jest.fn();
const staging = { KOMERCE_ENV: 'staging', KOMERCE_ALLOW_SOURCE_CONTINUITY_PROOF: '1' };

function queryBaseline({ enabled = true, baseline = product(3), offAfter = false } = {}) {
  query.mockReset();
  query.mockResolvedValueOnce({ rows: [{ source_id: 'api:allegro', status: 'active', autopilot_enabled: enabled }] });
  if (!enabled) return;
  query.mockResolvedValueOnce({ rows: baseline ? [{ supplier_product_id: 'p-1', normalized_source_contract: baseline, updated_at: '2026-09-20T10:00:00Z' }] : [] });
  query.mockResolvedValueOnce({ rows: [{ status: 'active', autopilot_enabled: !offAfter }] });
}

beforeEach(() => { query.mockReset(); dispatchToConnector.mockReset(); });

test('unknown args and broad or missing refs are refused', () => {
  expect(() => parseArgs(['--supplier=allegro'])).toThrow('CONTINUITY_PROOF_EXACT_PRODUCT_ID_REQUIRED');
  expect(() => parseArgs(['--supplier=allegro', '--product-id=p-1', '--limit=100'])).toThrow('CONTINUITY_PROOF_UNKNOWN_ARGUMENT');
  expect(() => parseArgs(['--supplier=allegro', '--product-id=../../secret'])).toThrow('CONTINUITY_PROOF_EXACT_PRODUCT_ID_REQUIRED');
});

test('live supplier reads refused in production and without explicit staging permission', () => {
  const options = parseArgs(['--supplier=allegro', '--product-id=p-1', '--execute']);
  expect(() => assertExecutionAllowed(options, { KOMERCE_ENV: 'production', KOMERCE_ALLOW_SOURCE_CONTINUITY_PROOF: '1' }))
    .toThrow('CONTINUITY_PROOF_STAGING_ONLY');
  expect(() => assertExecutionAllowed(options, { KOMERCE_ENV: 'staging' }))
    .toThrow('CONTINUITY_PROOF_EXPLICIT_APPROVAL_REQUIRED');
});

test('stock 3 -> 0 is a change; unit never silently removed', () => {
  const d = compareExactProduct(product(3), product(0), 'api:allegro');
  expect(d.status).toBe('CHANGED');
  expect(d.offer.changes).toContainEqual({ field: 'stock_available', before: 3, after: 0 });
  expect(d.units[0].changes).toContainEqual({ field: 'stock_available', before: 3, after: 0 });
  expect(d.removal_confirmed).toBe(false);
});

test('not returned unit means UNKNOWN, not removal or zero', () => {
  const d = compareExactProduct(product(3), product(3, { sellable_units: [] }), 'api:allegro');
  expect(d.units).toMatchObject([{ unit_ref: 'unit-1', status: 'UNKNOWN', reason: 'UNIT_NOT_IN_TARGETED_RESPONSE_NOT_REMOVAL' }]);
  expect(d.removal_confirmed).toBe(false);
});

test('missing new stock fact is UNKNOWN, not out-of-stock', () => {
  const after = product(3, { stock_available: null });
  after.sellable_units[0].stock_available = null;
  const d = compareExactProduct(product(3), after, 'api:allegro');
  expect(d.status).toBe('UNKNOWN');
  expect(d.offer.unknown_fields).toContain('stock_available');
  expect(d.units[0].unknown_fields).toContain('stock_available');
});

test('provider product mismatch or ambiguous variants fail closed', () => {
  expect(compareExactProduct(product(3), product(3, { supplier_product_id: 'another' }), 'api:allegro'))
    .toMatchObject({ status: 'UNKNOWN', reason: 'PRODUCT_IDENTITY_MISMATCH' });
  const bad = product(3);
  bad.sellable_units.push({ ...bad.sellable_units[0] });
  expect(compareExactProduct(product(3), bad, 'api:allegro'))
    .toMatchObject({ status: 'UNKNOWN', reason: 'UNIT_IDENTITIES_AMBIGUOUS' });
});

test('switch OFF skips exact API call and never mutates catalogue', async () => {
  queryBaseline({ enabled: false });
  const out = await run(['--supplier=allegro', '--product-id=p-1', '--execute'], staging,
    { query, connectors, dispatchToConnector });
  expect(out).toMatchObject({ status: 'SKIPPED', reason: 'SOURCING_SWITCH_OFF', writes: false });
  expect(dispatchToConnector).not.toHaveBeenCalled();
  expect(query).toHaveBeenCalledTimes(1);
});

test('one switch ON dry run never calls API or writes DB', async () => {
  queryBaseline();
  const out = await run(['--supplier=allegro', '--product-id=p-1'], staging,
    { query, connectors, dispatchToConnector });
  expect(out).toMatchObject({ status: 'READY_FOR_TARGETED_READ', supplier_api_called: false, writes: false });
  expect(dispatchToConnector).not.toHaveBeenCalled();
  expect(query.mock.calls.every(([sql]) => /^SELECT/i.test(String(sql).trim()))).toBe(true);
});

test('ON reads only requested exact ref and yields a read-only delta', async () => {
  queryBaseline();
  dispatchToConnector.mockResolvedValueOnce({ products: [product(0)], invalid: [] });
  const out = await run(['--supplier=allegro', '--product-id=p-1', '--execute'], staging,
    { query, connectors, dispatchToConnector });
  expect(dispatchToConnector).toHaveBeenCalledWith({ source_type: 'api', supplier_id: 'allegro', product_ids: ['p-1'] });
  expect(out).toMatchObject({ status: 'CHANGED', writes: false, catalog_mutated: false, purchasing_invoked: false });
  expect(query.mock.calls.every(([sql]) => /^SELECT/i.test(String(sql).trim()))).toBe(true);
});

test('OFF during external request discards result, no catalogue action', async () => {
  queryBaseline({ offAfter: true });
  dispatchToConnector.mockResolvedValueOnce({ products: [product(0)], invalid: [] });
  const out = await run(['--supplier=allegro', '--product-id=p-1', '--execute'], staging,
    { query, connectors, dispatchToConnector });
  expect(out).toMatchObject({ status: 'SKIPPED', reason: 'SOURCING_SWITCH_TURNED_OFF', writes: false });
});

test('no exact baseline or incomplete provider response never confirms removal', async () => {
  queryBaseline({ baseline: null });
  let out = await run(['--supplier=allegro', '--product-id=p-1', '--execute'], staging,
    { query, connectors, dispatchToConnector });
  expect(out).toMatchObject({ status: 'UNKNOWN', reason: 'NO_EXACT_BASELINE', writes: false });
  expect(dispatchToConnector).not.toHaveBeenCalled();
  queryBaseline();
  dispatchToConnector.mockResolvedValueOnce({ products: [], invalid: [] });
  out = await run(['--supplier=allegro', '--product-id=p-1', '--execute'], staging,
    { query, connectors, dispatchToConnector });
  expect(out).toMatchObject({ status: 'UNKNOWN', reason: 'INCOMPLETE_EXACT_RESPONSE', removal_confirmed: false });
});

test('supplier API failure yields UNKNOWN, never product withdrawal', async () => {
  queryBaseline();
  dispatchToConnector.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 'SUPPLIER_TIMEOUT' }));
  const out = await run(['--supplier=allegro', '--product-id=p-1', '--execute'], staging,
    { query, connectors, dispatchToConnector });
  expect(out).toMatchObject({
    status: 'UNKNOWN', reason: 'SUPPLIER_EXACT_READ_FAILED',
    supplier_error_code: 'SUPPLIER_TIMEOUT', removal_confirmed: false, writes: false,
  });
});

test('exact Allegro refresh unchanged with optional fields never supplied stays UNCHANGED', () => {
  const d = compareExactProduct(product(3), product(3), 'api:allegro');
  expect(d.status).toBe('UNCHANGED');
  expect(d.offer.unreported_fields).toContain('availability');
  expect(d.units[0].unreported_fields).toContain('availability');
  expect(d.offer.compared_fields).toBeGreaterThan(0);
});

test('field known in baseline but dropped by supplier becomes UNKNOWN', () => {
  const before = product(3, { supplier_delay_days: 3 });
  const after = product(3);
  const d = compareExactProduct(before, after, 'api:allegro');
  expect(d.status).toBe('UNKNOWN');
  expect(d.offer.unknown_fields).toContain('supplier_delay_days');
  expect(d.offer.unreported_fields).not.toContain('supplier_delay_days');
});
