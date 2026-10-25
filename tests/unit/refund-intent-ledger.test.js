'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ connect: jest.fn() }));
const { reserveRefundIntent, claimRefundIntent, euroCents } = require('../../services/refund-intent-ledger');
const ID = '11111111-2222-4333-8444-555555555555';
const ORDER = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const MARKET = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function fixture(overrides = {}) {
  const calls = [];
  const order = { id: ORDER, market_id: MARKET, total_eur: '100.00', payment_status: 'paid',
    payment_mode: 'stripe_eur', stripe_payment_id: 'pi-test', ...overrides.order };
  const query = jest.fn(async (sql) => {
    calls.push(sql);
    if (sql.includes('FROM orders WHERE')) return { rows: [order] };
    if (sql.includes('operation_key = $2')) return { rows: overrides.existing ? [overrides.existing] : [] };
    if (sql.includes('FROM refunds WHERE')) return { rows: overrides.legacy ? [{ id: 'old' }] : [] };
    if (sql.includes('AND status IN') && sql.includes('refund_execution_intents')) return { rows: [] };
    if (sql.includes('AS confirmed_eur')) return { rows: [{ confirmed_eur: overrides.confirmed || '0' }] };
    if (sql.includes('INSERT INTO refund_execution_intents')) return { rows: [{ id: ID, status: 'reserved' }] };
    if (sql.includes('WHERE id = $1 FOR UPDATE')) return { rows: [{ id: ID,
      status: overrides.claim || 'reserved', provider: 'stripe', capture_ref: 'pi-test', amount_eur: '25.00' }] };
    if (sql.includes('UPDATE refund_execution_intents')) return { rows: [{ id: ID }] };
    return { rows: [] };
  });
  const client = { query, release: jest.fn() };
  const db = { connect: jest.fn().mockResolvedValue(client) };
  return { db, client, calls, opts: { db, orderId: ORDER, provider: 'stripe',
    operationKey: 'event:cancel:1', captureRef: 'pi-test', amountEur: '25.00' } };
}

test('réserve durablement et COMMIT avant d exposer une clé PSP stable', async () => {
  const f = fixture();
  const r = await reserveRefundIntent(f.opts);
  expect(r).toMatchObject({ intentId: ID, providerRequestKey: 'kmr-ref-' + ID,
    replayed: false, executable: false });
  expect(f.calls[0]).toBe('BEGIN');
  expect(f.calls.at(-1)).toBe('COMMIT');
  expect(f.calls.some(x => x.includes('FOR UPDATE'))).toBe(true);
  expect(f.client.release).toHaveBeenCalledTimes(1);
});
test('rejeu même événement sans seconde insertion', async () => {
  const f = fixture({ existing: { id: ID, order_id: ORDER, market_id: MARKET,
    capture_ref: 'pi-test', amount_eur: '25.00', status: 'processing' } });
  const r = await reserveRefundIntent(f.opts);
  expect(r).toMatchObject({ replayed: true, executable: false, status: 'processing' });
  expect(f.calls.some(x => x.includes('INSERT INTO refund_execution_intents'))).toBe(false);
});
test.each([[{ legacy: true }, 'REFUND_LEGACY_RECONCILIATION_REQUIRED'],
  [{ confirmed: '90' }, 'REFUND_EXCEEDS_CAPTURE'],
  [{ order: { payment_status: 'pending' } }, 'REFUND_PAYMENT_NOT_CONFIRMED']])(
  'refuse les cas à risque avant mutation', async (extra, errorCode) => {
    const f = fixture(extra);
    await expect(reserveRefundIntent(f.opts)).rejects.toMatchObject({ code: errorCode });
    expect(f.calls.at(-1)).toBe('ROLLBACK');
  }
);
test('montants décimaux sans arrondi implicite', () => {
  expect(euroCents('25.08')).toBe(2508n);
  expect(() => euroCents('25.089')).toThrow();
  expect(() => euroCents('0')).toThrow();
});
test('claim une seule fois ; retry processing refusé', async () => {
  const f = fixture();
  expect((await claimRefundIntent({ intentId: ID, db: f.db })).providerRequestKey).toBe('kmr-ref-' + ID);
  expect(f.calls.at(-1)).toBe('COMMIT');
  const g = fixture({ claim: 'processing' });
  await expect(claimRefundIntent({ intentId: ID, db: g.db })).rejects.toMatchObject({
    code: 'REFUND_INTENT_NOT_CLAIMABLE',
  });
  expect(g.calls.at(-1)).toBe('ROLLBACK');
});
