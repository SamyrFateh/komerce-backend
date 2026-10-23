'use strict';

/**
 * @test-kind e2e @test-runner jest @test-requires postgres
 * Durable refund ledger test. Uses only PostgreSQL TEMP tables in an
 * explicitly isolated E2E database (e2eDbKit fail-closed). No PSP calls.
 */
const { describeE2E } = require('../helpers/e2eDbKit');
const { reserveRefundIntent, claimRefundIntent } =
  require('../../services/refund-intent-ledger');

const O = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const M = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
describeE2E('RC-5/RC-9 — intentions persistées PostgreSQL (sans PSP)', ({ db }) => {
  let client;
  let testDb;

  beforeAll(async () => {
    client = await db.connect();
    testDb = { connect: async () => ({ query: client.query.bind(client), release: () => {} }) };
    await client.query(
      'CREATE TEMP TABLE orders (id uuid PRIMARY KEY, market_id uuid NOT NULL, ' +
      'total_eur numeric(12,2), payment_status text, payment_mode text, ' +
      'stripe_payment_id text, paypal_capture_id text)'
    );
    await client.query(
      'CREATE TEMP TABLE refunds (id uuid DEFAULT gen_random_uuid(), ' +
      'order_id uuid, refund_method text, status text)'
    );
    // Reuses the migrated CHECK and UNIQUE indexes from production DDL,
    // but the rows and subsequent writes exist ONLY in this TEMP table.
    await client.query(
      'CREATE TEMP TABLE refund_execution_intents ' +
      '(LIKE public.refund_execution_intents INCLUDING ALL)'
    );
  });
  beforeEach(async () => {
    await client.query('TRUNCATE refund_execution_intents, refunds, orders');
    await client.query(
      "INSERT INTO orders (id,market_id,total_eur,payment_status,payment_mode,stripe_payment_id,paypal_capture_id) " +
      "VALUES ($1,$2,100.00,'paid','stripe_eur','pi-mock','cap-mock')",
      [O, M]
    );
  });
  afterAll(async () => {
    if (!client) return;
    for (const table of ['refund_execution_intents', 'refunds', 'orders']) {
      await client.query('DROP TABLE IF EXISTS pg_temp.' + table).catch(() => {});
    }
    client.release();
  });

  function opts(event = 'event:one', amount = '25.00') {
    return { db: testDb, orderId: O, provider: 'stripe',
      captureRef: 'pi-mock', operationKey: event, amountEur: amount };
  }
  test('réservation COMMIT puis rejeu renvoie un seul UUID et une clé stable', async () => {
    const first = await reserveRefundIntent(opts());
    const retry = await reserveRefundIntent(opts());
    expect(first.replayed).toBe(false);
    expect(retry).toMatchObject({ replayed: true, intentId: first.intentId,
      providerRequestKey: first.providerRequestKey, executable: false });
    const count = await client.query('SELECT COUNT(*)::int AS n FROM refund_execution_intents');
    expect(count.rows[0].n).toBe(1);
  });

  test('un second event est refusé tant que le premier est inconnu', async () => {
    const first = await reserveRefundIntent(opts());
    await claimRefundIntent({ db: testDb, intentId: first.intentId });
    await client.query(
      "UPDATE refund_execution_intents SET status='unknown' WHERE id=$1", [first.intentId]
    );
    await expect(reserveRefundIntent(opts('event:two'))).rejects.toMatchObject({
      code: 'REFUND_UNRESOLVED_INTENT',
    });
    await expect(claimRefundIntent({ db: testDb, intentId: first.intentId }))
      .rejects.toMatchObject({ code: 'REFUND_INTENT_NOT_CLAIMABLE' });
  });

  test('refund partiel suivant : plafonnement cumulatif sur le capturé', async () => {
    const first = await reserveRefundIntent(opts('event:first', '60.00'));
    await client.query(
      "UPDATE refund_execution_intents SET status='confirmed', provider_ref='re-mock' WHERE id=$1",
      [first.intentId]
    );
    await expect(reserveRefundIntent(opts('event:too-much', '50.00')))
      .rejects.toMatchObject({ code: 'REFUND_EXCEEDS_CAPTURE' });
    const next = await reserveRefundIntent(opts('event:remainder', '40.00'));
    expect(next.status).toBe('reserved');
  });

  test('une trace Stripe historique interdit toute nouvelle sortie automatique', async () => {
    await client.query(
      "INSERT INTO refunds (order_id,refund_method,status) VALUES ($1,'stripe','completed')",
      [O]
    );
    await expect(reserveRefundIntent(opts())).rejects.toMatchObject({
      code: 'REFUND_LEGACY_RECONCILIATION_REQUIRED',
    });
  });

  test('l index SQL unique empêche deux intentions non résolues pour une commande', async () => {
    await reserveRefundIntent(opts('event:1'));
    await expect(client.query(
      "INSERT INTO refund_execution_intents " +
      "(order_id, market_id, provider, capture_ref, operation_key, amount_eur) " +
      "VALUES ($1,$2,'stripe','pi-mock','event:2',10.00)", [O, M]
    )).rejects.toMatchObject({ code: '23505' });
  });
});
