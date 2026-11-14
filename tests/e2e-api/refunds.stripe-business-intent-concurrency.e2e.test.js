'use strict';
/** @test-kind e2e @test-runner jest @test-requires postgres
 * Finance FA-04/08: two independent PG backends competing for the same
 * Stripe intent, inside a committed business transaction. NO PSP I/O.
 */
const crypto = require('crypto');
const { describeE2E } = require('../helpers/e2eDbKit');
const { reserveStripeBusinessRefund } = require('../../services/stripe-refund-authority');
const { providerKey } = require('../../services/refund-intent-ledger');

describeE2E('FA-08: Stripe business reservation under real PG concurrency', ({ db }) => {
  const schema = 'fa08_stripe_' + crypto.randomBytes(8).toString('hex');
  const orderId = crypto.randomUUID();
  const marketId = crypto.randomUUID();
  const actorId = crypto.randomUUID();
  let admin, workerA, workerB;
  const input = () => ({
    order: {
      id: orderId, market_id: marketId,
      payment_mode: 'stripe_eur', payment_status: 'paid',
      stripe_payment_id: 'pi_test_pg_concurrent', total_eur: '100.00',
    },
    amountEur: '25.00', operationKey: 'cancel:order:' + orderId,
    initiatedBy: actorId,
  });

  beforeAll(async () => {
    admin = await db.connect();
    try {
      await admin.query('CREATE SCHEMA ' + schema);
      await admin.query('CREATE TABLE ' + schema + '.orders (' +
        'id uuid PRIMARY KEY, market_id uuid NOT NULL, total_eur numeric(12,2),' +
        ' payment_status text, payment_mode text, stripe_payment_id text, paypal_capture_id text,' +
        ' status text NOT NULL DEFAULT \'ordered\')');
      await admin.query('CREATE TABLE ' + schema + '.refunds (' +
        'id uuid DEFAULT gen_random_uuid(), order_id uuid, refund_method text, status text)');
      await admin.query('CREATE TABLE ' + schema +
        '.refund_execution_intents (LIKE public.refund_execution_intents INCLUDING ALL)');
      workerA = await db.connect();
      workerB = await db.connect();
      for (const c of [admin, workerA, workerB]) {
        await c.query('SET search_path TO ' + schema + ',public');
      }
      const pids = await Promise.all([admin, workerA, workerB].map(async c =>
        (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));
      expect(new Set(pids).size).toBe(3);
    } catch (error) {
      for (const c of [workerB, workerA, admin]) {
        if (c) { await c.query('RESET search_path').catch(() => {}); c.release(); }
      }
      workerA = workerB = admin = null;
      await db.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE').catch(() => {});
      throw error;
    }
  });

  beforeEach(async () => {
    await admin.query('TRUNCATE refund_execution_intents, refunds, orders');
    await admin.query(
      "INSERT INTO orders (id,market_id,total_eur,payment_status,payment_mode,stripe_payment_id)" +
      " VALUES ($1,$2,100.00,'paid','stripe_eur','pi_test_pg_concurrent')",
      [orderId, marketId]
    );
  });

  afterAll(async () => {
    for (const c of [workerB, workerA, admin]) {
      if (c) { await c.query('RESET search_path').catch(() => {}); c.release(); }
    }
    if (admin) await db.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
  });

  test('two business transactions share one intent, no double reserved refund', async () => {
    await workerA.query('BEGIN');
    await workerB.query('BEGIN');
    let committedA = false;
    let committedB = false;
    try {
      const a = await reserveStripeBusinessRefund(workerA, input());
      await workerA.query("UPDATE orders SET status='cancelled' WHERE id=$1", [orderId]);
      const attemptB = reserveStripeBusinessRefund(workerB, input());
      await workerA.query('COMMIT');
      committedA = true;
      const b = await attemptB;
      await workerB.query('COMMIT');
      committedB = true;
      expect(a.replayed).toBe(false);
      expect(b.replayed).toBe(true);
      expect(b.intentId).toBe(a.intentId);
      expect(providerKey(a.intentId)).toBe(providerKey(b.intentId));
      const { rows: [count] } = await admin.query(
        'SELECT COUNT(*)::int AS n FROM refund_execution_intents WHERE order_id=$1', [orderId]);
      expect(count.n).toBe(1);
      const { rows: [persisted] } = await admin.query(
        'SELECT status FROM orders WHERE id=$1', [orderId]);
      expect(persisted.status).toBe('cancelled');
    } finally {
      if (!committedB) await workerB.query('ROLLBACK').catch(() => {});
      if (!committedA) await workerA.query('ROLLBACK').catch(() => {});
    }
  });

  test('rollback before business COMMIT leaves no PSP intent; later action may reserve', async () => {
    await workerA.query('BEGIN');
    try {
      await reserveStripeBusinessRefund(workerA, input());
      await workerA.query("UPDATE orders SET status='cancelled' WHERE id=$1", [orderId]);
    } finally {
      await workerA.query('ROLLBACK');
    }
    const { rows: [noIntent] } = await admin.query(
      'SELECT COUNT(*)::int AS n FROM refund_execution_intents WHERE order_id=$1', [orderId]);
    expect(noIntent.n).toBe(0);
    const { rows: [notCancelled] } = await admin.query(
      'SELECT status FROM orders WHERE id=$1', [orderId]);
    expect(notCancelled.status).toBe('ordered');
    await workerB.query('BEGIN');
    let committed = false;
    try {
      const created = await reserveStripeBusinessRefund(workerB, input());
      expect(created.replayed).toBe(false);
      await workerB.query('COMMIT');
      committed = true;
      const { rows: [n] } = await admin.query(
        'SELECT COUNT(*)::int AS n FROM refund_execution_intents WHERE order_id=$1', [orderId]);
      expect(n.n).toBe(1);
    } finally {
      if (!committed) await workerB.query('ROLLBACK').catch(() => {});
    }
  });
});
