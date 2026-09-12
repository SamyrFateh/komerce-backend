'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-MA-03 — SAV, politique cash et settlement pays
 *
 * Feature propriétaire : market-delegation
 * Features traversées  : orders, payments, settlement, market, auth-identity
 *
 * Prouve :
 * - le workflow SAV est market-scoped et ne délègue jamais le remboursement ;
 * - la politique cash est pilotable par le manager, lisible mais non mutable
 *   par un viewer ;
 * - le settlement suit READY central -> REQUESTED pays -> PAID central ->
 *   RECEIVED pays, sans autorité pays sur montant/devise/paiement ;
 * - les ressources d'un autre marché restent hors périmètre.
 */

const request = require('supertest');
const { describeE2E } = require('../helpers/e2eDbKit');
const {
  createMarketDelegationFixture,
  makeApp,
  uuid,
  tag,
} = require('../helpers/marketDelegationE2EKit');

jest.setTimeout(30000);

describeE2E('E2E-MA-03 — market-delegation · SAV, cash, settlement', ({ db }) => {
  let fx;
  let app;
  let orderA;
  let orderB;
  let disputeA;
  let disputeB;
  const relayIds = [];

  async function createOrderFixture({ market, user, label }) {
    const relayId = uuid();
    relayIds.push(relayId);
    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address, market_id)
       VALUES ($1,$2,'E2E Agent','+269000020','E2E Address',$3)`,
      [relayId, `E2E Relais ${label}`, market.id]
    );

    const orderId = uuid();
    await db.query(
      `INSERT INTO orders (
         id, reference, user_id, relais_id, total_kmf, total_eur,
         payment_mode, payment_status, status, confection_type, qr_token, market_id
       ) VALUES ($1,$2,$3,$4,10000,20.33,'cash_relais','paid','confirmed','aucun',$5,$6)`,
      [orderId, `E2E-${tag(label)}`, user.id, relayId, uuid(), market.id]
    );
    return orderId;
  }

  async function createDisputeFixture({ orderId, creatorId, label, refundKmf }) {
    const id = uuid();
    await db.query(
      `INSERT INTO disputes
         (id, order_id, type, level, status, description, refund_kmf, refund_eur, created_by)
       VALUES ($1,$2,'delivery',1,'open',$3,$4,1.00,$5)`,
      [id, orderId, `E2E dispute ${label}`, refundKmf, creatorId]
    );
    return id;
  }

  beforeAll(async () => {
    fx = await createMarketDelegationFixture(db);
    app = makeApp([
      { modulePath: '../../routes/market-delegation-client-case' },
      { modulePath: '../../routes/market-delegation-cash-control' },
      { modulePath: '../../routes/market-delegation-settlement' },
      { mount: '/api/admin/market-settlements', modulePath: '../../routes/admin-market-settlement' },
    ]);

    orderA = await createOrderFixture({ market: fx.marketA, user: fx.managerA, label: 'A' });
    orderB = await createOrderFixture({ market: fx.marketB, user: fx.managerB, label: 'B' });
    disputeA = await createDisputeFixture({ orderId: orderA, creatorId: fx.managerA.id, label: 'A', refundKmf: 777 });
    disputeB = await createDisputeFixture({ orderId: orderB, creatorId: fx.managerB.id, label: 'B', refundKmf: 888 });
  });

  afterAll(async () => {
    if (!fx) return;

    // Settlement est non-destructif en runtime. La DB est explicitement
    // reconnue comme test par e2eDbKit ; pour nettoyer uniquement cette
    // fixture, on verrouille les tables, désactive les deux triggers de
    // non-destruction dans UNE transaction, efface nos lignes, puis réactive
    // les triggers avant COMMIT. Un ROLLBACK restaure aussi leur état.
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE market_settlement_events, market_settlements IN ACCESS EXCLUSIVE MODE');
      await client.query('ALTER TABLE market_settlement_events DISABLE TRIGGER trg_prevent_market_settlement_event_mutation');
      await client.query('ALTER TABLE market_settlements DISABLE TRIGGER trg_prevent_market_settlement_delete');
      await client.query(
        'DELETE FROM market_settlement_events WHERE settlement_id IN (SELECT id FROM market_settlements WHERE assignment_id IN ($1,$2))',
        [fx.assignmentA.id, fx.assignmentB.id]
      );
      await client.query(
        'DELETE FROM market_settlements WHERE assignment_id IN ($1,$2)',
        [fx.assignmentA.id, fx.assignmentB.id]
      );
      await client.query('ALTER TABLE market_settlements ENABLE TRIGGER trg_prevent_market_settlement_delete');
      await client.query('ALTER TABLE market_settlement_events ENABLE TRIGGER trg_prevent_market_settlement_event_mutation');
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* preserve original */ }
      throw error;
    } finally {
      client.release();
    }

    await db.query('DELETE FROM disputes WHERE id = ANY($1::uuid[])', [[disputeA, disputeB]]);
    await db.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [[orderA, orderB]]);
    await db.query('DELETE FROM relais WHERE id = ANY($1::uuid[])', [relayIds]);
    await fx.cleanup.run();
  });

  it('1 — la liste SAV de A ne contient jamais le litige B', async () => {
    const res = await request(app)
      .get(`/api/market-delegation/markets/${fx.marketA.code}/client-cases/disputes`)
      .set('Authorization', fx.managerA.token);

    expect(res.status).toBe(200);
    const ids = res.body.disputes.map((row) => row.id);
    expect(ids).toContain(disputeA);
    expect(ids).not.toContain(disputeB);
  });

  it('2 — le workflow refuse le saut open -> resolved et préserve les montants refund', async () => {
    const jump = await request(app)
      .put(`/api/market-delegation/markets/${fx.marketA.code}/client-cases/disputes/${disputeA}`)
      .set('Authorization', fx.managerA.token)
      .send({ status: 'resolved', resolution: 'Saut interdit' });
    expect(jump.status).toBe(409);
    expect(jump.body.code).toBe('DISPUTE_TRANSITION_INVALID');

    const forbiddenMoney = await request(app)
      .put(`/api/market-delegation/markets/${fx.marketA.code}/client-cases/disputes/${disputeA}`)
      .set('Authorization', fx.managerA.token)
      .send({ status: 'processing', refund_kmf: 999999 });
    expect(forbiddenMoney.status).toBe(400);
    expect(forbiddenMoney.body.code).toBe('REFUND_AUTHORITY_NOT_DELEGATED');

    const row = await db.query('SELECT status, refund_kmf, refund_eur FROM disputes WHERE id=$1', [disputeA]);
    expect(row.rows[0].status).toBe('open');
    expect(Number(row.rows[0].refund_kmf)).toBe(777);
    expect(Number(row.rows[0].refund_eur)).toBe(1);
  });

  it('3 — le manager peut résoudre A par la machine canonique, B reste caché', async () => {
    const processing = await request(app)
      .put(`/api/market-delegation/markets/${fx.marketA.code}/client-cases/disputes/${disputeA}`)
      .set('Authorization', fx.managerA.token)
      .send({ status: 'processing', resolution: 'Analyse en cours' });
    expect(processing.status).toBe(200);
    expect(processing.body.dispute.status).toBe('processing');

    const resolved = await request(app)
      .put(`/api/market-delegation/markets/${fx.marketA.code}/client-cases/disputes/${disputeA}`)
      .set('Authorization', fx.managerA.token)
      .set('x-correlation-id', 'e2e-ma-03-sav')
      .send({ status: 'resolved', resolution: 'Résolu sans décision monétaire' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.dispute.status).toBe('resolved');

    const hidden = await request(app)
      .put(`/api/market-delegation/markets/${fx.marketA.code}/client-cases/disputes/${disputeB}`)
      .set('Authorization', fx.managerA.token)
      .send({ status: 'processing' });
    expect(hidden.status).toBe(404);

    const money = await db.query('SELECT refund_kmf, refund_eur FROM disputes WHERE id=$1', [disputeA]);
    expect(Number(money.rows[0].refund_kmf)).toBe(777);
    expect(Number(money.rows[0].refund_eur)).toBe(1);
  });

  it('4 — cash policy : viewer lit, manager décide, viewer ne peut pas muter', async () => {
    const initial = await request(app)
      .get(`/api/market-delegation/markets/${fx.marketA.code}/cash-control-policy`)
      .set('Authorization', fx.viewerA.token);
    expect(initial.status).toBe(200);
    expect(initial.body.policy.source).toBe('DEFAULT');
    expect(initial.body.can_manage).toBe(false);

    const updated = await request(app)
      .put(`/api/market-delegation/markets/${fx.marketA.code}/cash-control-policy`)
      .set('Authorization', fx.managerA.token)
      .set('x-correlation-id', 'e2e-ma-03-cash')
      .send({ cash_enabled: true, confirmation_mode: 'DUAL_ALWAYS' });
    expect(updated.status).toBe(200);
    expect(updated.body.policy.confirmation_mode).toBe('DUAL_ALWAYS');

    const viewerWrite = await request(app)
      .put(`/api/market-delegation/markets/${fx.marketA.code}/cash-control-policy`)
      .set('Authorization', fx.viewerA.token)
      .send({ cash_enabled: false, confirmation_mode: 'SINGLE' });
    expect(viewerWrite.status).toBe(403);
    expect(viewerWrite.body.code).toBe('MARKET_CAPABILITY_REQUIRED');

    const injection = await request(app)
      .put(`/api/market-delegation/markets/${fx.marketA.code}/cash-control-policy`)
      .set('Authorization', fx.managerA.token)
      .send({ market_id: fx.marketB.id, cash_enabled: false, confirmation_mode: 'SINGLE' });
    expect(injection.status).toBe(400);
    expect(injection.body.code).toBe('MARKET_ID_FORBIDDEN');
  });

  it('5 — settlement exécute READY central -> REQUESTED pays -> PAID central -> RECEIVED pays', async () => {
    const ready = await request(app)
      .post(`/api/admin/market-settlements/markets/${fx.marketA.code}/settlements/ready`)
      .set('Authorization', fx.central.token)
      .set('x-correlation-id', 'e2e-ma-03-ready')
      .send({ amount: '125000', source_reference: 'E2E-ATTESTATION-A', attestation_note: 'Montant attesté centralement' });
    expect(ready.status).toBe(201);
    const settlementId = ready.body.settlement.id;
    expect(ready.body.settlement.status).toBe('READY');
    expect(Number(ready.body.settlement.amount)).toBe(125000);
    expect(ready.body.settlement.currency).toBe(fx.marketA.currency);

    const visible = await request(app)
      .get(`/api/market-delegation/markets/${fx.marketA.code}/settlements`)
      .set('Authorization', fx.managerA.token);
    expect(visible.status).toBe(200);
    expect(visible.body.settlements.some((row) => row.id === settlementId)).toBe(true);

    const moneyInjection = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/settlements/${settlementId}/request`)
      .set('Authorization', fx.managerA.token)
      .send({ amount: '1', currency: 'EUR' });
    expect(moneyInjection.status).toBe(400);
    expect(moneyInjection.body.code).toBe('SETTLEMENT_FINANCIAL_AUTHORITY_NOT_DELEGATED');

    const requested = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/settlements/${settlementId}/request`)
      .set('Authorization', fx.managerA.token)
      .set('x-correlation-id', 'e2e-ma-03-request')
      .send({});
    expect(requested.status).toBe(200);
    expect(requested.body.settlement.status).toBe('REQUESTED');

    const prematureReceipt = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/settlements/${settlementId}/receive`)
      .set('Authorization', fx.managerA.token)
      .send({ receipt_note: 'Trop tôt' });
    expect(prematureReceipt.status).toBe(409);

    const paid = await request(app)
      .post(`/api/admin/market-settlements/settlements/${settlementId}/paid`)
      .set('Authorization', fx.central.token)
      .send({ payment_reference: 'BANK-E2E-A-001' });
    expect(paid.status).toBe(200);
    expect(paid.body.settlement.status).toBe('PAID');

    const received = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/settlements/${settlementId}/receive`)
      .set('Authorization', fx.managerA.token)
      .set('x-correlation-id', 'e2e-ma-03-received')
      .send({ receipt_note: 'Reçu confirmé' });
    expect(received.status).toBe(200);
    expect(received.body.settlement.status).toBe('RECEIVED');
    expect(Number(received.body.settlement.amount)).toBe(125000);
    expect(received.body.settlement.currency).toBe(fx.marketA.currency);

    const persisted = await db.query(
      'SELECT status, amount::text, currency, payment_reference FROM market_settlements WHERE id=$1',
      [settlementId]
    );
    expect(persisted.rows[0]).toMatchObject({
      status: 'RECEIVED',
      currency: fx.marketA.currency,
      payment_reference: 'BANK-E2E-A-001',
    });
    expect(Number(persisted.rows[0].amount)).toBe(125000);

    const events = await db.query(
      'SELECT event_type FROM market_settlement_events WHERE settlement_id=$1 ORDER BY occurred_at',
      [settlementId]
    );
    expect(events.rows.map((row) => row.event_type)).toEqual(['READY_ATTESTED', 'REQUESTED', 'PAID', 'RECEIVED']);
  });
});
