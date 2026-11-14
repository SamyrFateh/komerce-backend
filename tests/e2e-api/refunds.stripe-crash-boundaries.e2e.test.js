'use strict';
/** @test-kind e2e @test-runner jest @test-requires postgres
 * Finance FA-04/08 (certification F3 Stripe, #4025): the four crash boundaries
 * of the durable Stripe refund, on REAL PostgreSQL (public schema, isolated
 * rows) with the REAL stripe SDK whose HTTP transport is replaced by an
 * in-memory fake Stripe API (idempotency-key aware). NO network I/O.
 *
 *   B1 crash before reservation (business tx rolled back)
 *   B2 crash after reservation, before the PSP call (reserved / processing)
 *   B3 crash after the PSP call, before the DB commit (unknown / unsettled)
 *   B4 crash after the settlement COMMIT, before the final marker (receipt)
 *
 * Expected at every boundary: one intent, no double refund, resume with the
 * same provider idempotency key, invariants I4 (refunded <= captured, one
 * wallet credit max) and I8 (no PSP double collection) hold.
 */
const crypto = require('crypto');
const Stripe = require('stripe');
const { describeE2E } = require('../helpers/e2eDbKit');
const {
  reserveStripeBusinessRefund, executeReservedStripeRefund, reconcileUncertainStripeRefund,
} = require('../../services/stripe-refund-authority');
const { providerKey } = require('../../services/refund-intent-ledger');
const receiptService = require('../../services/documents/refund-receipt');

// ── Fake Stripe transport (HTTP-client level) ───────────────────────────────
class FakeResponse extends Stripe.HttpClientResponse {
  constructor(status, body) { super(status, { 'content-type': 'application/json' }); this.body = body; }
  getRawResponse() { return this.body; }
  toStream(cb) { cb(); return this.body; }
  toJSON() { return Promise.resolve(this.body); }
}
function fakeStripeTransport() {
  const state = {
    posts: [], gets: [], byIdem: new Map(), refunds: new Map(),
    dropResponseOnce: false, throwBeforeSendOnce: false, status: 'succeeded',
  };
  class Http extends Stripe.HttpClient {
    getClientName() { return 'fake-transport'; }
    async makeRequest(host, port, path, method, headers, requestData) {
      if (method === 'POST' && path === '/v1/refunds') {
        if (state.throwBeforeSendOnce) { state.throwBeforeSendOnce = false; throw new Error('ECONNRESET_BEFORE_SEND'); }
        const idem = headers['Idempotency-Key'];
        const form = new URLSearchParams(requestData);
        state.posts.push({ idem, payment_intent: form.get('payment_intent'), amount: Number(form.get('amount')) });
        let refund = state.byIdem.get(idem);
        if (!refund) {
          refund = { id: 're_' + crypto.randomBytes(6).toString('hex'), object: 'refund',
            payment_intent: form.get('payment_intent'), amount: Number(form.get('amount')),
            currency: 'eur', status: state.status };
          state.byIdem.set(idem, refund); state.refunds.set(refund.id, refund);
        }
        if (state.dropResponseOnce) { state.dropResponseOnce = false; throw new Error('ECONNRESET_AFTER_PSP_PROCESSED'); }
        return new FakeResponse(200, refund);
      }
      const m = /^\/v1\/refunds\/([^/?]+)$/.exec(path);
      if (method === 'GET' && m) {
        state.gets.push(m[1]);
        const refund = state.refunds.get(m[1]);
        return refund ? new FakeResponse(200, refund)
          : new FakeResponse(404, { error: { type: 'invalid_request_error', message: 'No such refund' } });
      }
      throw new Error('UNEXPECTED_STRIPE_CALL ' + method + ' ' + path);
    }
  }
  const stripe = new Stripe('sk_test_fake_transport', { httpClient: new Http(), maxNetworkRetries: 0 });
  return { state, stripe };
}

const ENV = { KOMERCE_ENV: 'staging', FINANCE_DURABLE_REFUNDS_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_test_fake_transport' };

describeE2E('F3 Stripe: crash boundaries B1-B4 on real PostgreSQL', ({ db }) => {
  const tag = crypto.randomBytes(6).toString('hex');
  let marketId;
  const relaisId = crypto.randomUUID();
  const actorId = crypto.randomUUID();
  const orderIds = [];
  let fake;

  async function newOrder() {
    const id = crypto.randomUUID();
    orderIds.push(id);
    await db.query(
      "INSERT INTO orders (id, reference, relais_id, total_kmf, total_eur, payment_mode, payment_status, status, market_id, stripe_payment_id)" +
      " VALUES ($1,$2,$3,65000,100.00,'stripe_eur','paid','ordered',$4,$5)",
      [id, 'F3CERT-' + tag + '-' + orderIds.length, relaisId, marketId, 'pi_test_' + tag + orderIds.length]);
    const { rows: [o] } = await db.query('SELECT * FROM orders WHERE id=$1', [id]);
    return o;
  }
  // Business transaction: reserve + cancel, then COMMIT (or crash = ROLLBACK).
  async function cancelBusiness(order, { crashBeforeCommit = false } = {}) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const r = await reserveStripeBusinessRefund(client, {
        order, amountEur: '100.00', operationKey: 'cancel:order:' + order.id, initiatedBy: null });
      await client.query("UPDATE orders SET status='cancelled' WHERE id=$1", [order.id]);
      if (crashBeforeCommit) { await client.query('ROLLBACK'); return null; }
      await client.query('COMMIT');
      return r;
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }
  const run = (order, intentId, extra = {}) => executeReservedStripeRefund({
    db, orderId: order.id, intentId, actorId: null, env: ENV, stripe: fake.stripe, ...extra });
  const count = async (sql, p) => (await db.query(sql, [p])).rows[0].n;
  const intents = (id) => count('SELECT COUNT(*)::int n FROM refund_execution_intents WHERE order_id=$1', id);
  const refundRows = (id) => count("SELECT COUNT(*)::int n FROM refunds WHERE order_id=$1 AND status='completed'", id);
  // I4 (restitué <= encaissé, <=1 crédit wallet) and I8 (no PSP double collection), scoped to the order.
  async function assertI4I8(id) {
    const i4 = await db.query(
      `SELECT o.id FROM orders o
         LEFT JOIN (SELECT order_id, SUM(amount_kmf) kmf FROM refunds WHERE status IN ('completed','pending') GROUP BY 1) r ON r.order_id=o.id
         LEFT JOIN (SELECT reference_id, COUNT(*) n FROM wallet_transactions WHERE type='credit' AND reason IN ('order_cancel','sav_compensation') GROUP BY 1) wc ON wc.reference_id=o.id
        WHERE o.id=$1 AND (COALESCE(r.kmf,0) > o.total_kmf + 0.01 OR COALESCE(wc.n,0) > 1)`, [id]);
    expect(i4.rows).toHaveLength(0);
    const i8 = await db.query(
      "SELECT order_id FROM mobile_money_transactions WHERE order_id=$1 AND status='succeeded' GROUP BY 1 HAVING COUNT(*)>1", [id]);
    expect(i8.rows).toHaveLength(0);
  }

  beforeAll(async () => {
    marketId = (await db.query("SELECT id FROM markets WHERE code='KM'")).rows[0].id; // reference-data market, never mutated
    await db.query("INSERT INTO users (id, full_name) VALUES ($1,'F3 cert actor')", [actorId]);
    await db.query("INSERT INTO relais (id, name, phone, address, market_id) VALUES ($1,'f3','0','f3',$2)", [relaisId, marketId]);
  });
  beforeEach(() => { fake = fakeStripeTransport(); });
  afterAll(async () => {
    if (orderIds.length) {
      await db.query('DELETE FROM refunds WHERE order_id = ANY($1)', [orderIds]);
      await db.query('DELETE FROM refund_execution_intents WHERE order_id = ANY($1)', [orderIds]);
      await db.query("DELETE FROM alerts WHERE entity_id = ANY($1::text[])", [orderIds]).catch(() => {});
      await db.query('DELETE FROM order_status_history WHERE order_id = ANY($1)', [orderIds]).catch(() => {});
      await db.query('DELETE FROM orders WHERE id = ANY($1)', [orderIds]);
    }
    await db.query('DELETE FROM relais WHERE id=$1', [relaisId]).catch(() => {});
    await db.query('DELETE FROM users WHERE id=$1', [actorId]).catch(() => {});
  });

  test('B1 crash before reservation commit: no intent, no PSP call, order untouched; retry reserves once', async () => {
    const order = await newOrder();
    await cancelBusiness(order, { crashBeforeCommit: true });
    expect(await intents(order.id)).toBe(0);
    expect((await db.query('SELECT status FROM orders WHERE id=$1', [order.id])).rows[0].status).toBe('ordered');
    expect(fake.state.posts).toHaveLength(0);
    const r = await cancelBusiness(order);
    expect(r.replayed).toBe(false);
    const again = await cancelBusiness(order); // replay of the committed business action
    expect(again.replayed).toBe(true);
    expect(again.intentId).toBe(r.intentId);
    expect(await intents(order.id)).toBe(1);
    expect(fake.state.posts).toHaveLength(0);
    await assertI4I8(order.id);
  });

  test('B2a crash after reservation, before claim: resume posts once with the stable provider key', async () => {
    const order = await newOrder();
    const r = await cancelBusiness(order); // process dies here: intent is reserved, nothing sent
    expect((await db.query('SELECT status FROM refund_execution_intents WHERE id=$1', [r.intentId])).rows[0].status).toBe('reserved');
    expect(fake.state.posts).toHaveLength(0);
    const out = await run(order, r.intentId);
    expect(out.status).toBe(200);
    expect(fake.state.posts).toHaveLength(1);
    expect(fake.state.posts[0].idem).toBe(providerKey(r.intentId));
    expect(fake.state.posts[0].amount).toBe(10000);
    expect(await intents(order.id)).toBe(1);
    expect(await refundRows(order.id)).toBe(1);
    await assertI4I8(order.id);
  });

  test('B2b crash after claim, before PSP call: replay never re-POSTs; no refund row', async () => {
    const order = await newOrder();
    const r = await cancelBusiness(order);
    await db.query("UPDATE refund_execution_intents SET status='processing', processing_at=NOW() WHERE id=$1", [r.intentId]); // claim committed, process dies
    const out = await run(order, r.intentId);
    expect(out.status).toBe(202);
    expect(out.body.refund_status).toBe('processing');
    expect(fake.state.posts).toHaveLength(0);
    expect(await refundRows(order.id)).toBe(0);
    expect(await intents(order.id)).toBe(1);
    await assertI4I8(order.id);
  });

  test('B2c PSP unreachable before send: intent held unknown, no re-POST on replay', async () => {
    const order = await newOrder();
    const r = await cancelBusiness(order);
    fake.state.throwBeforeSendOnce = true;
    const out = await run(order, r.intentId);
    expect(out.status).toBe(202);
    expect(out.body.refund_status).toBe('unknown');
    const replay = await run(order, r.intentId);
    expect(replay.body.refund_status).toBe('unknown');
    expect(fake.state.posts).toHaveLength(0);
    expect(await refundRows(order.id)).toBe(0);
    await assertI4I8(order.id);
  });

  test('B3a crash after PSP processed, response lost: held unknown, no re-POST, GET-only reconcile settles once', async () => {
    const order = await newOrder();
    const r = await cancelBusiness(order);
    fake.state.dropResponseOnce = true; // Stripe refunded, our process lost the answer
    const out = await run(order, r.intentId);
    expect(out.status).toBe(202);
    expect(out.body.refund_status).toBe('unknown');
    expect(fake.state.posts).toHaveLength(1);
    expect(fake.state.posts[0].idem).toBe(providerKey(r.intentId));
    const replay = await run(order, r.intentId);
    expect(replay.body.refund_status).toBe('unknown');
    expect(fake.state.posts).toHaveLength(1); // still one POST
    expect(await refundRows(order.id)).toBe(0);
    const [refund] = [...fake.state.refunds.values()];
    const admin = { id: actorId, role: 'admin' };
    const rec = await reconcileUncertainStripeRefund({
      db, orderId: order.id, intentId: r.intentId, providerRefundId: refund.id,
      actor: admin, env: ENV, stripe: fake.stripe });
    expect(rec.status).toBe(200);
    expect(rec.body.replayed).toBe(false);
    const rec2 = await reconcileUncertainStripeRefund({
      db, orderId: order.id, intentId: r.intentId, providerRefundId: refund.id,
      actor: admin, env: ENV, stripe: fake.stripe });
    expect(rec2.body.replayed).toBe(true);
    expect(fake.state.posts).toHaveLength(1);
    expect(await refundRows(order.id)).toBe(1);
    expect(await intents(order.id)).toBe(1);
    const { rows: [o] } = await db.query('SELECT status, payment_status FROM orders WHERE id=$1', [order.id]);
    expect(o.payment_status).toBe('refunded');
    await assertI4I8(order.id);
  });

  test('B3b crash during settlement before COMMIT: intent confirmed, nothing booked; resume books exactly one refund', async () => {
    const order = await newOrder();
    const r = await cancelBusiness(order);
    let armed = true;
    const crashingDb = {
      query: (...a) => db.query(...a),
      connect: async () => {
        const c = await db.connect();
        const q = c.query.bind(c);
        let booked = false;
        c.query = async (sql, ...rest) => {
          if (typeof sql === 'string' && /INSERT INTO refunds/i.test(sql)) booked = true;
          if (armed && booked && typeof sql === 'string' && /^\s*COMMIT/i.test(sql)) {
            armed = false; await q('ROLLBACK'); throw new Error('CRASH_BEFORE_SETTLEMENT_COMMIT');
          }
          return q(sql, ...rest);
        };
        return c;
      },
    };
    const out = await run(order, r.intentId, { db: crashingDb });
    expect(out.status).toBe(202);
    expect(out.body.refund_status).toBe('confirmed_unsettled');
    expect(fake.state.posts).toHaveLength(1);
    expect((await db.query('SELECT status FROM refund_execution_intents WHERE id=$1', [r.intentId])).rows[0].status).toBe('confirmed');
    expect(await refundRows(order.id)).toBe(0);
    const resumed = await run(order, r.intentId);
    expect(resumed.status).toBe(200);
    expect(fake.state.posts).toHaveLength(1); // no second PSP POST
    expect(await refundRows(order.id)).toBe(1);
    expect(await intents(order.id)).toBe(1);
    await assertI4I8(order.id);
  });

  test('B4 crash after settlement COMMIT, before the receipt marker: replay is idempotent', async () => {
    const order = await newOrder();
    const r = await cancelBusiness(order);
    const spy = jest.spyOn(receiptService, 'issue').mockRejectedValueOnce(new Error('CRASH_AFTER_COMMIT'));
    try {
      const out = await run(order, r.intentId);
      expect(out.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
    expect(await refundRows(order.id)).toBe(1);
    const histBefore = await count('SELECT COUNT(*)::int n FROM order_status_history WHERE order_id=$1', order.id);
    const spy2 = jest.spyOn(receiptService, 'issue').mockResolvedValue(undefined);
    try {
      const replay = await run(order, r.intentId);
      expect(replay.status).toBe(200);
      expect(replay.body.replayed).toBe(true);
      expect(spy2).toHaveBeenCalledTimes(1); // receipt resumed
    } finally { spy2.mockRestore(); }
    expect(fake.state.posts).toHaveLength(1);
    expect(await refundRows(order.id)).toBe(1);
    expect(await intents(order.id)).toBe(1);
    expect(await count('SELECT COUNT(*)::int n FROM order_status_history WHERE order_id=$1', order.id)).toBe(histBefore);
    await assertI4I8(order.id);
  });
});
