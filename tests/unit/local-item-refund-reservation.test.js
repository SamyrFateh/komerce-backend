'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 * Fable #4114 : no local payout or wallet fallback, native capture and shortage.
 */
jest.mock('../../db', () => ({ getClient: jest.fn() }));
const { decimalMinor, localShare, reserveLocalShortage } =
  require('../../services/local-item-refund-reservation');

const ORDER = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const INCIDENT = '33333333-3333-4333-8333-333333333333';
const KEY = '44444444-4444-4444-8444-444444444444';
const MARKET = '55555555-5555-4555-8555-555555555555';
const RELAY = '66666666-6666-4666-8666-666666666666';
const ACTOR = '77777777-7777-4777-8777-777777777777';
const RESERVATION = '88888888-8888-4888-8888-888888888888';
const TX = '99999999-9999-4999-8999-999999999999';

const admin = { id: ACTOR, role: 'admin' };
const basePayload = {
  orderId: ORDER, orderItemId: ITEM, incidentId: INCIDENT,
  operationKey: KEY, quantity: 2, reason: 'Rupture fournisseur prouvée', actor: admin
};

function fixture({
  rail = 'cash_relais', missing = 3, collected = 0, refunded = 0,
  active = 0, activeAmount = '0', previousPsp = false,
  cashProof = true, mobileProof = true, replay = null,
} = {}) {
  const release = jest.fn();
  const queries = [];
  const client = {
    release,
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM orders WHERE id=$1 FOR UPDATE')) return { rows: [{
        id: ORDER, market_id: MARKET, relais_id: RELAY,
        payment_mode: rail, payment_status: 'paid',
        total_kmf: '10000.00',
        fx_snapshot: { market: { market_id: MARKET, currency: 'XAF',
          amount_text: '250000', minor_unit: 0 } }
      }] };
      if (sql.includes('FROM order_items WHERE id=$1')) return { rows: [{
        id: ITEM, quantity: 6, qty_collected: collected, qty_refunded: refunded,
        price_kmf: '1000.00'
      }] };
      if (sql.includes('SELECT id, order_item_id, source_incident_id')) return { rows: replay ? [replay] : [] };
      if (sql.includes('FROM international_shipment_relay_receipts')) return { rows: [{ missing }] };
      if (sql.includes('FROM incidents WHERE')) return { rows: [{ missing: 0 }] };
      if (sql.includes('COALESCE(SUM(quantity),0)::int AS qty,'))
        return { rows: [{ qty: active, amount_minor: activeAmount, amount_kmf: active ? '2000' : '0' }] };
      if (sql.includes('FROM local_item_refund_reservations WHERE order_item_id'))
        return { rows: [{ qty: active }] };
      if (sql.includes('FROM refunds WHERE')) return { rows: [] };
      if (sql.includes('FROM refund_execution_intents WHERE')) return { rows: previousPsp ? [{ id: TX }] : [] };
      if (sql.includes('FROM order_item_refund_reservations WHERE')) return { rows: [] };
      if (sql.includes('FROM cash_collections')) return { rows: cashProof ? [{
        id: TX, relais_id: RELAY, amount_kmf: '10000.00'
      }] : [] };
      if (sql.includes('FROM markets WHERE')) return { rows: [{ currency: 'KMF' }] };
      if (sql.includes('FROM mobile_money_transactions')) return { rows: mobileProof ? [{
        id: TX, market_id: MARKET, provider: 'orange_money', currency: 'XAF',
        minor_unit: 0, amount_minor: '250000',
        external_transaction_id: 'OPER-TRANSACTION-1'
      }] : [] };
      if (sql.includes('INSERT INTO local_item_refund_reservations')) return { rows: [{ id: RESERVATION }] };
      throw new Error('Unexpected SQL in test: ' + sql);
    })
  };
  return { db: { getClient: jest.fn(async () => client) }, client, queries, release };
}

describe('F1/F2 — money snapshots without current FX', () => {
  test('BigInt exact cents, minor unit and fractions', () => {
    expect(decimalMinor('10000.00', 0)).toBe(10000n);
    expect(decimalMinor('20.15', 2)).toBe(2015n);
    expect(() => decimalMinor('20.15', 0)).toThrow(/non représentable/);
    expect(() => decimalMinor('-10', 0)).toThrow(/non fiable/);
    expect(() => decimalMinor('100foo', 0)).toThrow(/non fiable/);
    expect(localShare({ unitKmf: '1000', totalKmf: '10000', quantity: 2,
      capturedMinor: '250000' })).toMatchObject({ amountKmf: '2000.00', amountMinor: 50000n });
  });
  test('zero payout / over capture prohibited before any network', () => {
    expect(() => localShare({ unitKmf: '0.01', totalKmf: '100000', quantity: 1,
      capturedMinor: '1' })).toThrow(/non représentable/);
    expect(() => localShare({ unitKmf: '20000', totalKmf: '10000', quantity: 1,
      capturedMinor: '250000' })).toThrow(/incompatible/);
  });
});

describe('F1/F2 — reserve one verified local debt, not a payout', () => {
  test('cash KM: one reserved liability, no wallet, no refunds row', async () => {
    const f = fixture();
    const out = await reserveLocalShortage({ ...basePayload, db: f.db });
    expect(out).toEqual({
      reservationId: RESERVATION, status: 'reserved', paid: false,
      amountMinor: '2000', currency: 'KMF', replayed: false
    });
    expect(f.queries.filter(x => x.sql.includes('INSERT INTO'))).toHaveLength(1);
    const [ins] = f.queries.filter(x => x.sql.includes('INSERT INTO'));
    expect(ins.sql).toContain('local_item_refund_reservations');
    expect(ins.params).toContain('2000');
    expect(f.queries.map(x => x.sql)).toContain('COMMIT');
    expect(f.release).toHaveBeenCalledTimes(1);
  });
  test('mobile money: exactly original succeeded capture and market currency', async () => {
    const f = fixture({ rail: 'mobile_money' });
    const out = await reserveLocalShortage({ ...basePayload, db: f.db });
    expect(out).toMatchObject({ status: 'reserved', paid: false,
      amountMinor: '50000', currency: 'XAF' });
    expect(f.queries.some(x => x.sql.includes('FROM mobile_money_transactions'))).toBe(true);
    expect(f.queries.some(x => /stripe|paypal|walletService\.credit|refunds\.create/.test(x.sql))).toBe(false);
  });
  test('no genuine cash collection = rollback, no claim', async () => {
    const f = fixture({ cashProof: false });
    await expect(reserveLocalShortage({ ...basePayload, db: f.db }))
      .rejects.toMatchObject({ code: 'LOCAL_REFUND_CASH_COLLECTION_UNVERIFIED' });
    expect(f.queries.map(x => x.sql)).toContain('ROLLBACK');
    expect(f.queries.some(x => x.sql.includes('INSERT INTO'))).toBe(false);
  });
  test('no succeeded provider capture = rollback', async () => {
    const f = fixture({ rail: 'mobile_money', mobileProof: false });
    await expect(reserveLocalShortage({ ...basePayload, db: f.db }))
      .rejects.toMatchObject({ code: 'LOCAL_REFUND_MOBILE_COLLECTION_UNVERIFIED' });
    expect(f.queries.map(x => x.sql)).toContain('ROLLBACK');
  });
  test('incident cannot justify more refunded pieces than physically absent', async () => {
    const f = fixture({ missing: 1 });
    await expect(reserveLocalShortage({ ...basePayload, db: f.db }))
      .rejects.toMatchObject({ code: 'LOCAL_REFUND_SHORTAGE_EXCEEDED' });
    expect(f.queries.some(x => x.sql.includes('INSERT INTO'))).toBe(false);
  });
  test('physical collection quantity blocks a reserved shortage', async () => {
    const f = fixture({ collected: 5 });
    await expect(reserveLocalShortage({ ...basePayload, db: f.db }))
      .rejects.toMatchObject({ code: 'LOCAL_REFUND_SHORTAGE_EXCEEDED' });
  });
  test('existing PSP claim refuses a local cash double-rail', async () => {
    const f = fixture({ previousPsp: true });
    await expect(reserveLocalShortage({ ...basePayload, db: f.db }))
      .rejects.toMatchObject({ code: 'LOCAL_REFUND_CROSS_RAIL_RECONCILIATION' });
  });
  test('identical key is replayed without writing a new liability', async () => {
    const f = fixture({ replay: {
      id: RESERVATION, order_item_id: ITEM, source_incident_id: INCIDENT,
      quantity: 2, reason: basePayload.reason, status: 'reserved',
      amount_minor: '2000', currency: 'KMF'
    } });
    const out = await reserveLocalShortage({ ...basePayload, db: f.db });
    expect(out).toMatchObject({ replayed: true, paid: false, reservationId: RESERVATION });
    expect(f.queries.some(x => x.sql.includes('INSERT INTO'))).toBe(false);
  });
  test('same key with different quantity returns conflict and ROLLBACK', async () => {
    const f = fixture({ replay: {
      id: RESERVATION, order_item_id: ITEM, source_incident_id: INCIDENT,
      quantity: 3, reason: basePayload.reason, status: 'reserved'
    } });
    await expect(reserveLocalShortage({ ...basePayload, db: f.db }))
      .rejects.toMatchObject({ code: 'LOCAL_REFUND_REPLAY_CONFLICT' });
    expect(f.queries.map(x => x.sql)).toContain('ROLLBACK');
  });
  test('role, UUID and reason are rejected before opening a transaction', async () => {
    const f = fixture();
    await expect(reserveLocalShortage({ ...basePayload, actor: { id: ACTOR, role: 'agent_relais' }, db: f.db }))
      .rejects.toMatchObject({ code: 'LOCAL_REFUND_ADMIN_REQUIRED' });
    await expect(reserveLocalShortage({ ...basePayload, incidentId: 'bad', db: f.db }))
      .rejects.toMatchObject({ code: 'LOCAL_REFUND_IDENTIFIER_INVALID' });
    await expect(reserveLocalShortage({ ...basePayload, reason: 'bad', db: f.db }))
      .rejects.toMatchObject({ code: 'LOCAL_REFUND_REASON_REQUIRED' });
    expect(f.db.getClient).not.toHaveBeenCalled();
  });
});
