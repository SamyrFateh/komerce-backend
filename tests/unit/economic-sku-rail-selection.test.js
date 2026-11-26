'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ withTransaction: jest.fn(), query: jest.fn() }));
jest.mock('../../services/pricing-market-decision-policy', () => ({ getCurrentMarketDecisionPolicy: jest.fn() }));
jest.mock('../../services/cost-allocation/product-margin-steering', () => ({ listProductMarginSteering: jest.fn() }));

const db = require('../../db');
const { getCurrentMarketDecisionPolicy } = require('../../services/pricing-market-decision-policy');
const { listProductMarginSteering } = require('../../services/cost-allocation/product-margin-steering');
const { findWithdrawnSkuRail, recordSkuRailSelection, sweepSkuRailWithdrawals } = require('../../services/economic-sku-rail-selection');

const decision = {
  marketId: 'market-a', productId: 'product-a', skuId: 'sku-a',
  rail: 'SEA_STANDARD', actorId: 'actor-a', action: 'WITHDRAW', reason: 'Marge réelle négative',
};

function mockEvidence(losses = ['shipment-a', 'shipment-b']) {
  listProductMarginSteering.mockResolvedValue({
    evaluated_at: '2026-11-26T18:00:00.000Z',
    products: [{
      product_id: 'product-a',
      after_sale_selection: {
        status: losses.length >= 2 ? 'WITHDRAWAL_THRESHOLD_REACHED' : 'WITHDRAWAL_THRESHOLD_NOT_REACHED',
        policy_version: 'market-v1', required_loss_observations: 2,
        comparable_cohorts: [{ sku_id: 'sku-a', rail: 'sea', reconciled_shipment_count: 2, loss_shipment_ids: losses }],
      },
    }],
  });
}

let client;
beforeEach(() => {
  jest.resetAllMocks();
  client = { query: jest.fn() };
  db.withTransaction.mockImplementation((work) => work(client));
  getCurrentMarketDecisionPolicy.mockResolvedValue({ version: 'market-v1' });
  mockEvidence();
});

test('records only the scoped loss evidence, attributed to the deciding actor', async () => {
  const event = { action: 'WITHDRAW' };
  client.query.mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'sku-a' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [event] });
  await expect(recordSkuRailSelection(decision)).resolves.toEqual({ outcome: 'recorded', event });
  const [sql, params] = client.query.mock.calls[3];
  expect(sql).toMatch(/INSERT INTO economic_sku_rail_selection_events/);
  expect(params.slice(0, 5)).toEqual(['market-a', 'sku-a', 'SEA_STANDARD', 'WITHDRAW', 'market-v1']);
  expect(JSON.parse(params[5]).loss_shipment_ids).toEqual(['shipment-a', 'shipment-b']);
  expect(params[7]).toBe('actor-a');
});

test.each([{ rail: 'AIR_EXPRESS' }, { skuId: 'sku-b' }, { action: 'RESTORE' }])(
  'refuses a decision for which the scoped evidence is insufficient (%j)', async (overrides) => {
    await expect(recordSkuRailSelection({ ...decision, ...overrides })).rejects.toMatchObject({
      code: 'ECONOMIC_SELECTION_EVIDENCE_INSUFFICIENT',
    });
    expect(db.withTransaction).not.toHaveBeenCalled();
  }
);

test('a withdrawal cannot use a policy that changed while the evidence was computed', async () => {
  getCurrentMarketDecisionPolicy.mockResolvedValue({ version: 'market-v2' });
  client.query.mockResolvedValue({ rows: [] });
  await expect(recordSkuRailSelection(decision)).rejects.toMatchObject({ code: 'ECONOMIC_SELECTION_POLICY_CHANGED' });
  expect(client.query).toHaveBeenCalledTimes(1);
});

test('replays an existing withdrawal without issuing another event', async () => {
  const event = { action: 'WITHDRAW' };
  client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'sku-a' }] })
    .mockResolvedValueOnce({ rows: [event] });
  await expect(recordSkuRailSelection(decision)).resolves.toEqual({ outcome: 'replayed', event });
  expect(client.query).toHaveBeenCalledTimes(3);
});

test('a fresh positive observation allows an explicit restore', async () => {
  mockEvidence([]);
  const event = { action: 'RESTORE' };
  client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'sku-a' }] })
    .mockResolvedValueOnce({ rows: [{ action: 'WITHDRAW' }] }).mockResolvedValueOnce({ rows: [event] });
  await expect(recordSkuRailSelection({ ...decision, action: 'RESTORE' })).resolves.toEqual({ outcome: 'recorded', event });
});

test('checkout asks PostgreSQL for the last event of each exact imported SKU and rail', async () => {
  const match = { sku_id: 'sku-a', rail: 'SEA_STANDARD' };
  client.query.mockResolvedValue({ rows: [match] });
  await expect(findWithdrawnSkuRail(client, 'market-a', [])).resolves.toBeNull();
  expect(client.query).not.toHaveBeenCalled();
  await expect(findWithdrawnSkuRail(client, 'market-a', [{ skuId: 'sku-a', rail: 'SEA_STANDARD' }])).resolves.toEqual(match);
  const [sql, params] = client.query.mock.calls[0];
  expect(sql).toMatch(/market_id=\$1 AND sku_id=demand.sku_id AND rail=demand.rail/);
  expect(sql).toMatch(/ORDER BY id DESC LIMIT 1/);
  expect(params).toEqual(['market-a', ['sku-a'], ['SEA_STANDARD']]);
});

test('automatically records a proven withdrawal without attributing it to a human actor', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ market_id: 'market-a', product_id: 'product-a' }] });
  client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'sku-a' }] })
    .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ action: 'WITHDRAW' }] });
  await expect(sweepSkuRailWithdrawals({ limit: 1 })).resolves.toEqual({
    recorded: 1, cursor: { marketId: 'market-a', productId: 'product-a' },
  });
  expect(db.query.mock.calls[0][1]).toEqual([null, null, 1]);
  expect(client.query.mock.calls[3][1].slice(-2)).toEqual([null, 'POLICY_AUTOMATION']);
});

test('a newer administrative restoration prevents writing an older automation observation', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ market_id: 'market-a', product_id: 'product-a' }] });
  client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'sku-a' }] })
    .mockResolvedValueOnce({ rows: [{ action: 'RESTORE', recorded_at: '2026-11-26T18:01:00.000Z' }] });
  await expect(sweepSkuRailWithdrawals()).resolves.toEqual({ recorded: 0, cursor: null });
  expect(client.query).toHaveBeenCalledTimes(3);
});

test('no selection is recorded if the current evidence is below threshold', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ market_id: 'market-a', product_id: 'product-a' }] });
  mockEvidence(['shipment-a']);
  await expect(sweepSkuRailWithdrawals()).resolves.toEqual({ recorded: 0, cursor: null });
  expect(db.withTransaction).not.toHaveBeenCalled();
});
