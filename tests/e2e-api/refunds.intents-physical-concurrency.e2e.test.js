'use strict';
/** @test-kind e2e @test-runner jest @test-requires postgres
 * RC-5/RC-9 physical PG concurrency: separate backend sessions, no PSP calls.
 * The random schema exists ONLY in the e2eDbKit-approved TEST database.
 */
const crypto = require('crypto');
const { describeE2E } = require('../helpers/e2eDbKit');
const { reserveRefundIntent, claimRefundIntent } = require('../../services/refund-intent-ledger');

describeE2E('RC-9: concurrence de deux connexions PostgreSQL physiques', ({ db }) => {
  const schema = 'rc9_concurrency_' + crypto.randomBytes(8).toString('hex');
  const orderId = crypto.randomUUID();
  const marketId = crypto.randomUUID();
  let admin, workerA, workerB;

  // Dedicated schema rather than TEMP: TEMP tables belong to ONE connection
  // and cannot test cross-session row-level locking.
  beforeAll(async () => {
    admin = await db.connect();
    try {
      await admin.query('CREATE SCHEMA ' + schema);
      await admin.query('CREATE TABLE ' + schema + '.orders (' +
        'id uuid PRIMARY KEY, market_id uuid NOT NULL, total_eur numeric(12,2), ' +
        'payment_status text, payment_mode text, stripe_payment_id text, paypal_capture_id text)');
      await admin.query('CREATE TABLE ' + schema + '.refunds (' +
        'id uuid DEFAULT gen_random_uuid(), order_id uuid, refund_method text, status text)');
      await admin.query('CREATE TABLE ' + schema + '.refund_execution_intents ' +
        '(LIKE public.refund_execution_intents INCLUDING ALL)');
      workerA = await db.connect();
      workerB = await db.connect();
      for (const c of [admin, workerA, workerB]) {
        await c.query('SET search_path TO ' + schema + ', public');
      }
      const ids = await Promise.all([admin, workerA, workerB].map(async c =>
        (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));
      expect(new Set(ids).size).toBe(3);
    } catch (error) {
      for (const c of [workerB, workerA, admin]) {
        if (c) { await c.query('RESET search_path').catch(() => {}); c.release(); }
      }
      admin = workerA = workerB = null;
      await db.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE').catch(() => {});
      throw error;
    }
  });

  beforeEach(async () => {
    await admin.query('TRUNCATE refund_execution_intents, refunds, orders');
    await admin.query(
      "INSERT INTO orders (id,market_id,total_eur,payment_status,payment_mode,stripe_payment_id) " +
      "VALUES ($1,$2,100.00,'paid','stripe_eur','pi-physical-test')",
      [orderId, marketId]
    );
  });

  afterAll(async () => {
    for (const c of [workerB, workerA, admin]) {
      if (c) { await c.query('RESET search_path').catch(() => {}); c.release(); }
    }
    if (admin) await db.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
  });

  // Each worker is a distinct PostgreSQL backend/session, not a mock.
  function adapter(client) {
    return { connect: async () => ({ query: client.query.bind(client), release: () => {} }) };
  }
  function options(dbAdapter, key = 'event:concurrent') {
    return { db: dbAdapter, orderId, operationKey: key, provider: 'stripe',
      captureRef: 'pi-physical-test', amountEur: '25.00' };
  }

  test('deux réservations simultanées donnent une seule intention et la même clé', async () => {
    const [a, b] = await Promise.all([
      reserveRefundIntent(options(adapter(workerA))),
      reserveRefundIntent(options(adapter(workerB))),
    ]);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.intentId).toBe(b.intentId);
    expect(a.providerRequestKey).toBe(b.providerRequestKey);
    const count = await admin.query('SELECT COUNT(*)::int AS n FROM refund_execution_intents');
    expect(count.rows[0].n).toBe(1);
  });

  test('deux claims physiques: exactement un passage à processing', async () => {
    const created = await reserveRefundIntent(options(adapter(admin)));
    const outcomes = await Promise.allSettled([
      claimRefundIntent({ intentId: created.intentId, db: adapter(workerA) }),
      claimRefundIntent({ intentId: created.intentId, db: adapter(workerB) }),
    ]);
    const successful = outcomes.filter(x => x.status === 'fulfilled');
    const rejected = outcomes.filter(x => x.status === 'rejected');
    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe('REFUND_INTENT_NOT_CLAIMABLE');
    const rows = await admin.query(
      'SELECT status, processing_at FROM refund_execution_intents WHERE id=$1',
      [created.intentId]
    );
    expect(rows.rows[0].status).toBe('processing');
    expect(rows.rows[0].processing_at).toBeTruthy();
  });
});
