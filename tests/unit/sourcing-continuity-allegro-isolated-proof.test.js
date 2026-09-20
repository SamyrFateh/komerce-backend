'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn(), pool: { end: jest.fn() } }));
jest.mock('../../services/sourcing-import-dispatch', () => ({
  CONNECTORS: { api: { allegro: { active: true } } },
  dispatchToConnector: jest.fn(),
}));
jest.mock('../../services/suppliers/normalized-product', () => ({
  buildNormalizedSourceContractSnapshot: jest.fn(product => ({ ...product })),
}));
jest.mock('../../scripts/sourcing-continuity-targeted-proof', () => ({
  run: jest.fn(),
}));
const { assertIsolatedContext, exactOne, summarize, main } = require('../../scripts/sourcing-continuity-allegro-isolated-proof');

const ctx = {
  GITHUB_ACTIONS: 'true', NODE_ENV: 'test', KOMERCE_ENV: 'staging',
  KOMERCE_ALLOW_SOURCE_CONTINUITY_PROOF: '1', KOMERCE_ALLOW_ALLEGRO_SANDBOX: '1',
  DATABASE_URL: 'postgresql://komerce:komerce@127.0.0.1:5432/komerce_sourcing_proof',
  ALLEGRO_SANDBOX_CLIENT_ID: 'dedicated-test-id',
  ALLEGRO_SANDBOX_CLIENT_SECRET: 'dedicated-test-secret',
  ALLEGRO_SANDBOX_REFRESH_TOKEN: 'dedicated-test-token',
  ALLEGRO_SANDBOX_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
  ALLEGRO_SANDBOX_USER_AGENT: 'Komerce-test',
};
function snapshot() {
  return { schema_version: '2', supplier_name: 'Allegro Sandbox',
    supplier_product_id: '12345', product_name: 'test', purchase_price: 10,
    currency: 'PLN', stock_available: 3, sellable_units: [{
      supplier_unit_ref: '12345',
      supplier_order_identity: { provider: 'allegro', version: 1,
        payload: { environment: 'sandbox', offer_id: '12345' } },
    }] };
}

test('reject production context, remote DB, absent authorization or malformed offer id', () => {
  expect(assertIsolatedContext(ctx, '12345')).toBe('12345');
  expect(() => assertIsolatedContext(ctx, '12345; rm -rf /')).toThrow('PROOF_EXACT_ALLEGRO_ID_REQUIRED');
  expect(() => assertIsolatedContext({ ...ctx, KOMERCE_ENV: 'production' }, '12345'))
    .toThrow('PROOF_ISOLATED_STAGING_REQUIRED');
  expect(() => assertIsolatedContext({ ...ctx, DATABASE_URL: 'postgresql://komerce:pass@db.railway.internal:5432/komerce_sourcing_proof' }, '12345'))
    .toThrow('PROOF_EPHEMERAL_DB_REQUIRED');
  expect(() => assertIsolatedContext({ ...ctx, DATABASE_URL: 'postgresql://komerce:pass@127.0.0.1:5432/komerce' }, '12345'))
    .toThrow('PROOF_EPHEMERAL_DB_REQUIRED');
  expect(() => assertIsolatedContext({ ...ctx, GITHUB_ACTIONS: 'false' }, '12345'))
    .toThrow('PROOF_ISOLATED_STAGING_REQUIRED');
  expect(() => assertIsolatedContext({ ...ctx, ALLEGRO_SANDBOX_REFRESH_TOKEN: '' }, '12345'))
    .toThrow('PROOF_DEDICATED_SANDBOX_CREDENTIALS_REQUIRED');
});

test('accept exactly one validated sandbox identity, not a third-party or ambiguous response', () => {
  expect(exactOne({ products: [snapshot()], invalid: [] }, '12345').supplier_product_id).toBe('12345');
  expect(() => exactOne({ products: [], invalid: [] }, '12345'))
    .toThrow('PROOF_EXACT_PROVIDER_RESPONSE_UNKNOWN');
  expect(() => exactOne({ products: [snapshot(), snapshot()], invalid: [] }, '12345'))
    .toThrow('PROOF_EXACT_PROVIDER_RESPONSE_UNKNOWN');
  const wrong = snapshot();
  wrong.sellable_units[0].supplier_order_identity.payload.environment = 'production';
  expect(() => exactOne({ products: [wrong], invalid: [] }, '12345'))
    .toThrow('PROOF_ALLEGRO_SANDBOX_IDENTITY_UNPROVEN');
});

test('report only safe facts and do not assert an unobserved stock 3-to-0 delta', () => {
  const out = summarize({
    status: 'UNCHANGED',
    offer: { status: 'UNCHANGED', changes: [], unreported_fields: ['availability'] },
    units: [{ unit_ref: '12345', status: 'UNCHANGED', changes: [] }],
  }, '12345');
  expect(out).toMatchObject({
    comparison: 'UNCHANGED', stock_three_to_zero_proved: false,
    catalog_mutated: false, purchasing_invoked: false, source_switch_off_proved: true,
  });
  const changed = summarize({
    status: 'CHANGED',
    offer: { status: 'CHANGED', changes: [{ field: 'raw_payload', before: 'secret', after: 'secret' }] },
    units: [{ unit_ref: '12345', status: 'CHANGED',
      changes: [{ field: 'stock_available', before: 3, after: 0 }] }],
  }, '12345');
  expect(changed.stock_three_to_zero_proved).toBe(true);
  expect(JSON.stringify(changed)).not.toContain('secret');
});

test('ephemeral seeded OFF then ON performs exactly two bounded supplier reads, never an order', async () => {
  const statements = [];
  const query = jest.fn(async (sql) => { statements.push(String(sql)); return { rows: [] }; });
  const dispatchToConnector = jest.fn().mockResolvedValue({ products: [snapshot()], invalid: [] });
  // First execution is OFF. The second (ON) performs the exact second
  // provider read through the same single-reference dispatcher.
  const probe = jest.fn()
    .mockResolvedValueOnce({ status: 'SKIPPED', reason: 'SOURCING_SWITCH_OFF' })
    .mockImplementationOnce(async (_args, _env, deps) => {
    await deps.dispatchToConnector({ source_type: 'api', supplier_id: 'allegro', product_ids: ['12345'] });
    return { status: 'UNCHANGED', supplier_api_called: true, writes: false,
      catalog_mutated: false, offer: { status: 'UNCHANGED', changes: [] },
      units: [{ unit_ref: '12345', status: 'UNCHANGED', changes: [] }] };
  });
  const out = await main({ argv: ['--offer-id=12345'], env: ctx, query, dispatchToConnector, probe });
  expect(out.comparison).toBe('UNCHANGED');
  expect(dispatchToConnector).toHaveBeenCalledTimes(2);
  for (const [body] of dispatchToConnector.mock.calls) {
    expect(body).toEqual({ source_type: 'api', supplier_id: 'allegro', product_ids: ['12345'] });
  }
  expect(statements.filter(sql => /^INSERT|^UPDATE/.test(sql.trim()))).toHaveLength(3);
  expect(statements.some(sql => /purchase_orders|orders\s*\(/i.test(sql))).toBe(false);
});
