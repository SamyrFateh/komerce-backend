'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn(), pool: { end: jest.fn(async () => {}) } }));
const shadow = require('../../services/sourcing-observation-shadow-service');
const {
  DATABASE_URL, assertIsolated, snapshot, assertResolved, assertStockDelta, main,
} = require('../../scripts/sourcing-shadow-stock-replay-proof');

const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_RUN_ID: '35746258763',
  NODE_ENV: 'test',
  KOMERCE_ENV: 'staging',
  KOMERCE_ALLOW_SHADOW_REPLAY_PROOF: '1',
  KOMERCE_DISABLE_CRONS: 'true',
  DATABASE_URL,
};
const sourceId = shadow.buildSourceDescriptor({
  sourceType: 'api', supplierName: 'Allegro Shadow Replay TEST ONLY',
  supplierId: 'allegro', sourceInstanceKey: 'golden-offline-replay-' + env.GITHUB_RUN_ID,
}).sourceId;

const fact = (before, after) => ({ field: 'stock_available', before, after });
const projection = (grain, stock = 1, changes = [fact(3, 1)]) => ({
  authority: 'shadow_read_only', observation_count: 2,
  current_state: { stock_available: stock },
  last_observation_delta: { status: 'CHANGED', changes, unknown_fields: [] },
  ...(grain === 'unit' ? { canonical_offer_id: 'canonical-offer', commandability: { ready_now: false } } : {}),
});

test('disposable GitHub main/local database only; production, Railway and cron-on forbidden', () => {
  expect(() => assertIsolated(env)).not.toThrow();
  for (const invalid of [
    { GITHUB_ACTIONS: 'false' }, { GITHUB_REF: 'refs/pull/12/merge' },
    { GITHUB_RUN_ID: 'not-number' }, { NODE_ENV: 'production' },
    { KOMERCE_ENV: 'production' }, { DATABASE_URL: 'postgresql://example/prod' },
    { KOMERCE_ALLOW_SHADOW_REPLAY_PROOF: '0' }, { KOMERCE_DISABLE_CRONS: 'false' },
  ]) {
    expect(() => assertIsolated({ ...env, ...invalid }))
      .toThrow('SHADOW_REPLAY_EPHEMERAL_CI_ONLY');
  }
});

test('synthetic fixtures carry stable Offer and Unit identity and no buyer or seller raw data', () => {
  const before = snapshot(3);
  const after = snapshot(1);
  expect(before.supplier_product_id).toBe(after.supplier_product_id);
  expect(before.sellable_units[0].supplier_unit_ref).toBe(after.sellable_units[0].supplier_unit_ref);
  expect(before.stock_available).toBe(3);
  expect(after.stock_available).toBe(1);
  expect(before.raw_payload).toEqual({ synthetic_offline_replay: true });
  expect(() => snapshot(0)).toThrow('SHADOW_REPLAY_STOCK_INVALID');
});

test('fail closed on incomplete canonical bindings, unknown stock, price drift or purchase readiness', () => {
  expect(() => assertResolved({
    status: 'recorded', source_id: sourceId, capture_id: 'a',
    observations: 3, products: 1, offers: 1, units: 1,
    resolution: { status: 'resolved', review_required: 0, deferred_parent: 0 },
  }, sourceId)).not.toThrow();
  expect(() => assertResolved({ status: 'recorded', source_id: sourceId }, sourceId))
    .toThrow('SHADOW_REPLAY_CAPTURE_NOT_FULLY_RESOLVED');
  expect(() => assertStockDelta(projection('offer'), 'offer')).not.toThrow();
  expect(() => assertStockDelta(projection('unit'), 'unit')).not.toThrow();
  for (const modified of [
    projection('unit', 0),
    projection('unit', 1, [fact(3, 0)]),
    projection('unit', 1, [fact(3, 1), { field: 'purchase_price', before: 39.9, after: 40 }]),
    { ...projection('unit'), last_observation_delta: {
      ...projection('unit').last_observation_delta, unknown_fields: ['stock_available'],
    } },
    { ...projection('unit'), commandability: { ready_now: true } },
  ]) {
    expect(() => assertStockDelta(modified, 'unit'))
      .toThrow('SHADOW_REPLAY_UNIT_DELTA_NOT_PROVED');
  }
});

test('two captures write via shadow owner only, retain same canonical IDs, leave source OFF', async () => {
  const captureId = ['capture-a', 'capture-b'];
  const record = jest.fn(async context => {
    const stock = context.products[0].stock_available;
    return {
      status: 'recorded', source_id: sourceId,
      capture_id: captureId[stock === 3 ? 0 : 1],
      observations: 3, products: 1, offers: 1, units: 1,
      resolution: { status: 'resolved', review_required: 0, deferred_parent: 0 },
    };
  });
  const query = jest.fn(async (sql, params) => {
    if (sql.includes('SELECT autopilot_enabled')) {
      return { rows: [{ autopilot_enabled: false, status: 'active' }] };
    }
    const grain = params[1];
    const stock = params[0] === 'capture-a' ? 3 : 1;
    return { rows: [{
      canonical_entity_id: grain === 'offer' ? 'canonical-offer' : 'canonical-unit',
      normalized: { stock_available: stock },
    }] };
  });
  const collectOffer = jest.fn(async () => projection('offer'));
  const collectUnit = jest.fn(async () => projection('unit'));
  const delay = jest.fn(async () => {});
  const result = await main({ env, record, query, collectOffer, collectUnit, delay });
  expect(record).toHaveBeenCalledTimes(2);
  expect(record.mock.calls.map(([ctx]) => ctx.products[0].stock_available)).toEqual([3, 1]);
  expect(record.mock.calls.every(([ctx]) =>
    ctx.sourceInstanceKey === 'golden-offline-replay-' + env.GITHUB_RUN_ID)).toBe(true);
  expect(result).toMatchObject({
    proof: 'SYNTHETIC_OFFLINE_SHADOW_3_TO_1_PERSISTED',
    observed_before: 3, observed_after: 1,
    offer_identity_stable: true, unit_identity_stable: true,
    source_autopilot_enabled: false, authority: 'shadow_read_only',
    provider_live_called: false, catalog_promoted: false, purchasing_invoked: false,
    production_proved: false,
  });
  expect(delay).toHaveBeenCalledWith(50);
  expect(collectOffer).toHaveBeenCalledWith('canonical-offer', query);
  expect(collectUnit).toHaveBeenCalledWith('canonical-unit', query);
});

test('refuses source ON, binding split and other unexpected inventory deltas', async () => {
  const records = ['capture-a', 'capture-b'];
  const record = jest.fn(async ctx => ({
    status: 'recorded', source_id: sourceId,
    capture_id: records[ctx.products[0].stock_available === 3 ? 0 : 1],
    observations: 3, products: 1, offers: 1, units: 1,
    resolution: { status: 'resolved', review_required: 0, deferred_parent: 0 },
  }));
  const query = jest.fn(async (sql, params) => {
    if (sql.includes('SELECT autopilot_enabled')) return {
      rows: [{ autopilot_enabled: true, status: 'active' }],
    };
    return { rows: [{
      canonical_entity_id: params[0] === 'capture-a' ? 'before' : 'after',
      normalized: { stock_available: params[0] === 'capture-a' ? 3 : 1 },
    }] };
  });
  await expect(main({ env, record, query, delay: async () => {} }))
    .rejects.toThrow('SHADOW_REPLAY_IDENTITY_OR_SOURCE_SWITCH_FAILED');
});
