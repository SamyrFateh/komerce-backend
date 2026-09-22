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
jest.mock('../../scripts/sourcing-continuity-targeted-proof', () => ({
  run: jest.fn(),
}));
jest.mock('../../scripts/sourcing-continuity-allegro-isolated-proof', () => ({
  assertIsolatedContext: jest.fn((env, id) => {
    if (env.KOMERCE_ENV !== 'staging' || env.GITHUB_ACTIONS !== 'true' ||
        env.DATABASE_URL !== 'postgresql://komerce:komerce@127.0.0.1:5432/komerce_sourcing_proof') {
      throw new Error('PROOF_EPHEMERAL_DB_REQUIRED');
    }
    if (!/^[0-9]{1,30}$/.test(id)) throw new Error('PROOF_EXACT_ALLEGRO_ID_REQUIRED');
    return id;
  }),
  exactOne: jest.fn(res => res.products[0]),
  summarize: jest.fn((delta, id) => ({ exact_offer_id: id, comparison: delta.status,
    stock_three_to_one_proved: delta.offer.changes?.some(x =>
      x.field === 'stock_available' && x.before === 3 && x.after === 1) || false })),
}));
const { assertStockProofArgs, stockTransitionProved, safeStockProofDiagnostic, main } =
  require('../../scripts/sourcing-continuity-allegro-stock-delta-proof');

const env = {
  GITHUB_ACTIONS: 'true', KOMERCE_ENV: 'staging', NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://komerce:komerce@127.0.0.1:5432/komerce_sourcing_proof',
};
const offer = '1234567890';
const changes = [{ field: 'stock_available', before: 3, after: 1 }];
function result(status = 'CHANGED', offerFacts = changes, unitFacts = changes) {
  return {
    status, supplier_api_called: true, writes: false, catalog_mutated: false,
    purchasing_invoked: false, removal_confirmed: false,
    offer: { status, changes: offerFacts, unknown_fields: [] },
    units: [{ unit_ref: offer, status, changes: unitFacts, unknown_fields: [] }],
  };
}
function snapshot() {
  return { supplier_product_id: offer, product_name: 'TEST ONLY', purchase_price: 29.90,
    currency: 'PLN', stock_available: 3, sellable_units: [
      { supplier_unit_ref: offer, stock_available: 3, is_active: true },
    ] };
}

test('blocks purchasing Golden offer, missing human test-only acknowledgement, remote database', () => {
  expect(() => assertStockProofArgs(['--offer-id=7782182471', '--test-only-offer-confirmed'], env))
    .toThrow('STOCK_PROOF_PURCHASING_GOLDEN_OFFER_PROTECTED');
  expect(() => assertStockProofArgs(['--offer-id=' + offer], env))
    .toThrow('STOCK_PROOF_EXACT_TEST_OFFER_AND_ACK_REQUIRED');
  expect(() => assertStockProofArgs(['--offer-id=' + offer, '--test-only-offer-confirmed'],
    { ...env, DATABASE_URL: 'postgresql://railway/production' }))
    .toThrow('PROOF_EPHEMERAL_DB_REQUIRED');
});

test('requires the identical exact stock delta in offer and unit; no price drift or network ambiguity', () => {
  expect(stockTransitionProved(result(), offer)).toBe(true);
  // An actual zero-stock observation is NOT equivalent to this 3 -> 1 proof.
  expect(stockTransitionProved(result('CHANGED',
    [{ field: 'stock_available', before: 3, after: 0 }],
    [{ field: 'stock_available', before: 3, after: 0 }]), offer)).toBe(false);
  expect(stockTransitionProved(result('CHANGED',
    [{ field: 'stock_available', before: 3, after: 2 }],
    [{ field: 'stock_available', before: 3, after: 2 }]), offer)).toBe(false);
  expect(stockTransitionProved(result('UNCHANGED'), offer)).toBe(false);
  expect(stockTransitionProved(result('CHANGED', changes, []), offer)).toBe(false);
  expect(stockTransitionProved(result('CHANGED',
    [...changes, { field: 'purchase_price', before: 29.90, after: 31 }], changes), offer)).toBe(false);
  expect(stockTransitionProved({ ...result(), supplier_api_called: false }, offer)).toBe(false);
  expect(stockTransitionProved({ ...result(), removal_confirmed: true }, offer)).toBe(false);
  expect(stockTransitionProved({ ...result(), units: [{ ...result().units[0], unit_ref: 'other' }] }, offer))
    .toBe(false);
});

test('OFF prevents any provider read; ON sees an actual 3-to-1 change during bounded exact refresh', async () => {
  const query = jest.fn(async () => ({ rows: [] }));
  const dispatchToConnector = jest.fn(async () => ({ products: [snapshot()], invalid: [] }));
  const probe = jest.fn()
    .mockResolvedValueOnce({ status: 'SKIPPED', reason: 'SOURCING_SWITCH_OFF' })
    .mockResolvedValueOnce({
      ...result('UNCHANGED', [], []),
      offer: { status: 'UNCHANGED', changes: [], unknown_fields: [] },
      units: [{ unit_ref: offer, status: 'UNCHANGED', changes: [], unknown_fields: [] }],
    })
    .mockResolvedValueOnce(result());
  const delay = jest.fn(async () => {});
  const log = jest.fn();
  const r = await main({ argv: ['--offer-id=' + offer, '--test-only-offer-confirmed'],
    env, query, dispatchToConnector, probe, delay, log });
  expect(r).toMatchObject({ live_stock_delta_proved: true, comparison: 'CHANGED',
    stock_three_to_one_proved: true, stock_three_to_zero_proved: false,
    observed_after: 1, provider_exact_reads: 1 });
  expect(delay).toHaveBeenCalledTimes(2);
  expect(delay).toHaveBeenCalledWith(45000);
  expect(dispatchToConnector).toHaveBeenCalledTimes(1);
  expect(dispatchToConnector).toHaveBeenCalledWith({
    source_type: 'api', supplier_id: 'allegro', product_ids: [offer],
  });
  expect(probe).toHaveBeenCalledTimes(3);
  expect(query.mock.calls.filter(([sql]) => /^INSERT|^UPDATE/.test(String(sql).trim()))).toHaveLength(3);
  expect(log.mock.calls[0][0]).toContain('READY_FOR_MANUAL_SANDBOX_TEST_OFFER_STOCK_CHANGE');
  expect(log.mock.calls[0][0]).toContain('stock 1');
  expect(log.mock.calls[0][0]).not.toContain('stock 0');
});

test('aborts before invitation to modify the offer if observed baseline differs from three', async () => {
  const query = jest.fn(async () => ({ rows: [] }));
  const dispatchToConnector = jest.fn(async () => ({
    products: [{ ...snapshot(), stock_available: 2 }], invalid: [],
  }));
  const probe = jest.fn().mockResolvedValue({ status: 'SKIPPED', reason: 'SOURCING_SWITCH_OFF' });
  const delay = jest.fn(async () => {});
  const log = jest.fn();
  await expect(main({ argv: ['--offer-id=' + offer, '--test-only-offer-confirmed'],
    env, query, dispatchToConnector, probe, delay, log }))
    .rejects.toThrow('STOCK_PROOF_BASELINE_NOT_ACTIVE_THREE');
  expect(log).not.toHaveBeenCalled();
  expect(delay).not.toHaveBeenCalled();
});

test('never counts four unchanged reads as successful stock-change proof', async () => {
  const query = jest.fn(async () => ({ rows: [] }));
  const dispatchToConnector = jest.fn(async () => ({ products: [snapshot()], invalid: [] }));
  const unchanged = {
    ...result('UNCHANGED', [], []),
    offer: { status: 'UNCHANGED', changes: [], unknown_fields: [] },
    units: [{ unit_ref: offer, status: 'UNCHANGED', changes: [], unknown_fields: [] }],
  };
  const probe = jest.fn().mockResolvedValueOnce({
    status: 'SKIPPED', reason: 'SOURCING_SWITCH_OFF',
  }).mockResolvedValue(unchanged);
  const delay = jest.fn(async () => {});
  await expect(main({ argv: ['--offer-id=' + offer, '--test-only-offer-confirmed'],
    env, query, dispatchToConnector, probe, delay, log: jest.fn() }))
    .rejects.toThrow('STOCK_PROOF_CHANGE_NOT_OBSERVED');
  expect(delay).toHaveBeenCalledTimes(4);
});

test('logs only a stable phase and allowlisted HTTP code, never provider diagnostic or OAuth material', () => {
  const error = Object.assign(new Error('ALLEGRO_HTTP_400: invalid_grant secret=DO-NOT-LOG refresh_token=DO-NOT-LOG'),
    { stockProofStage: 'BASELINE_PROVIDER_READ' });
  const diagnostic = safeStockProofDiagnostic(error);
  expect(diagnostic).toBe('STOCK_PROOF_FAILURE_STAGE_BASELINE_PROVIDER_READ_REASON_ALLEGRO_HTTP_400');
  expect(diagnostic).not.toMatch(/DO-NOT-LOG|invalid_grant|refresh_token/i);
  expect(safeStockProofDiagnostic({ message: 'unexpected SQL error with secret', stockProofStage: 'SOURCE_FIXTURE' }))
    .toBe('STOCK_PROOF_FAILURE_STAGE_SOURCE_FIXTURE_REASON_PROVIDER_OR_RUNTIME_UNKNOWN');
  expect(safeStockProofDiagnostic({ message: 'ALLEGRO_HTTP_401', stockProofStage: 'BASELINE_PROVIDER_READ' }))
    .toBe('STOCK_PROOF_FAILURE_STAGE_BASELINE_PROVIDER_READ_REASON_ALLEGRO_HTTP_401');
  expect(safeStockProofDiagnostic({ message: 'ALLEGRO_REFRESH_TOKEN_REQUIRED', stockProofStage: 'BASELINE_PROVIDER_READ' }))
    .toBe('STOCK_PROOF_FAILURE_STAGE_BASELINE_PROVIDER_READ_REASON_ALLEGRO_REFRESH_TOKEN_REQUIRED');
  expect(safeStockProofDiagnostic({ message: 'oauth_failure', stockProofStage: 'DO-NOT-LOG' }))
    .toBe('STOCK_PROOF_FAILURE_STAGE_UNKNOWN_REASON_PROVIDER_OR_RUNTIME_UNKNOWN');
});

test('identifies the first supplier read as the failure stage without asking user to change stock', async () => {
  const query = jest.fn(async () => ({ rows: [] }));
  const dispatchToConnector = jest.fn(async () => {
    throw new Error('ALLEGRO_HTTP_400: invalid_grant secret=DO-NOT-LOG');
  });
  const probe = jest.fn().mockResolvedValueOnce({
    status: 'SKIPPED', reason: 'SOURCING_SWITCH_OFF',
  });
  const log = jest.fn();
  let caught;
  try {
    await main({
      argv: ['--offer-id=' + offer, '--test-only-offer-confirmed'],
      env, query, dispatchToConnector, probe, delay: jest.fn(), log,
    });
  } catch (e) { caught = e; }
  expect(caught).toBeDefined();
  expect(safeStockProofDiagnostic(caught))
    .toBe('STOCK_PROOF_FAILURE_STAGE_BASELINE_PROVIDER_READ_REASON_ALLEGRO_HTTP_400');
  expect(log).not.toHaveBeenCalled();
  expect(dispatchToConnector).toHaveBeenCalledTimes(1);
});
