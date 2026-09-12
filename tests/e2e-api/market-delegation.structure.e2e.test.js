'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-MA-04 — Vérité Structure déléguée
 *
 * Feature propriétaire : market-delegation
 * Features traversées  : economic-engine, market, auth-identity
 *
 * Prouve :
 * - l'opérateur pays peut constater un fait réel MARKET_DIRECT ;
 * - market_id et scope GROUP ne sont jamais des autorités client ;
 * - un viewer pricing.read peut lire mais pas enregistrer ;
 * - le writer canonique economic-engine persiste preuve, période, FX et auteur ;
 * - la table réelle est append-only jusque dans PostgreSQL.
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

describeE2E('E2E-MA-04 — market-delegation · structure MARKET_DIRECT', ({ db }) => {
  let fx;
  let app;
  let chargeId;
  const eventIds = [];

  function accrual(overrides = {}) {
    return {
      charge_id: chargeId,
      economic_from: '2026-09-01T00:00:00.000Z',
      economic_to: '2026-10-01T00:00:00.000Z',
      amount_original: 10000,
      currency: 'KMF',
      fx_rate_to_kmf: 1,
      fx_source: 'native-KMF',
      amount_kmf: 10000,
      event_kind: 'ACCRUAL',
      source_kind: 'INVOICE',
      evidence_ref: `E2E-${tag('structure-proof')}`,
      notes: 'Charge structurelle E2E attestée',
      ...overrides,
    };
  }

  beforeAll(async () => {
    fx = await createMarketDelegationFixture(db);
    app = makeApp([{ modulePath: '../../routes/market-delegation-structure-event' }]);

    chargeId = uuid();
    await db.query(
      `INSERT INTO charges (id, family, name, amount_kmf, is_recurring, recurrence_period, is_active)
       VALUES ($1,'e2e-overhead',$2,10000,TRUE,'monthly',TRUE)`,
      [chargeId, `E2E Structure ${tag('charge')}`]
    );
  });

  afterAll(async () => {
    // La table est volontairement append-only. Le runner E2E travaille sur
    // une DB explicitement reconnue comme test (garde e2eDbKit) ; pour rendre
    // la fixture nettoyable sans affaiblir le contrat runtime, on prend un
    // verrou exclusif, désactive le trigger USER dans une transaction, efface
    // uniquement NOS événements, puis réactive avant COMMIT. Un rollback
    // restaure aussi l'état du trigger si le nettoyage échoue.
    if (eventIds.length) {
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        await client.query('LOCK TABLE economic_structure_cost_events IN ACCESS EXCLUSIVE MODE');
        await client.query('ALTER TABLE economic_structure_cost_events DISABLE TRIGGER trg_prevent_economic_structure_cost_event_mutation');
        await client.query('DELETE FROM economic_structure_cost_events WHERE id = ANY($1::uuid[])', [eventIds]);
        await client.query('ALTER TABLE economic_structure_cost_events ENABLE TRIGGER trg_prevent_economic_structure_cost_event_mutation');
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) { /* preserve original */ }
        throw error;
      } finally {
        client.release();
      }
    }
    if (chargeId) await db.query('DELETE FROM charges WHERE id=$1', [chargeId]);
    if (fx) await fx.cleanup.run();
  });

  it('1 — manager A enregistre un fait réel forcé MARKET_DIRECT sur A', async () => {
    const res = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/structure-events`)
      .set('Authorization', fx.managerA.token)
      .set('x-correlation-id', 'e2e-ma-04-record')
      .send(accrual());

    expect(res.status).toBe(201);
    eventIds.push(res.body.event.id);
    expect(res.body.event.scope_kind).toBe('MARKET_DIRECT');
    expect(res.body.event.market_id).toBe(fx.marketA.id);
    expect(res.body.event.recorded_by).toBe(fx.managerA.id);

    const row = await db.query(
      `SELECT market_id, scope_kind, event_kind, amount_kmf::text, currency,
              evidence_ref, recorded_by
         FROM economic_structure_cost_events WHERE id=$1`,
      [res.body.event.id]
    );
    expect(row.rows[0]).toMatchObject({
      market_id: fx.marketA.id,
      scope_kind: 'MARKET_DIRECT',
      event_kind: 'ACCRUAL',
      amount_kmf: '10000.00',
      currency: 'KMF',
      recorded_by: fx.managerA.id,
    });
    expect(row.rows[0].evidence_ref).toContain('E2E-');
  });

  it('2 — pricing.read permet la lecture mais ne confère jamais le droit d’écrire', async () => {
    const list = await request(app)
      .get(`/api/market-delegation/markets/${fx.marketA.code}/structure-events`)
      .set('Authorization', fx.viewerA.token);
    expect(list.status).toBe(200);
    expect(list.body.events.some((row) => row.id === eventIds[0])).toBe(true);

    const write = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/structure-events`)
      .set('Authorization', fx.viewerA.token)
      .send(accrual({ evidence_ref: 'E2E-VIEWER-FORBIDDEN' }));
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  });

  it('3 — GROUP et market_id client sont refusés avant toute nouvelle vérité économique', async () => {
    const before = await db.query('SELECT COUNT(*)::int AS n FROM economic_structure_cost_events WHERE charge_id=$1', [chargeId]);

    const group = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/structure-events`)
      .set('Authorization', fx.managerA.token)
      .send(accrual({ scope_kind: 'GROUP', evidence_ref: 'E2E-GROUP-FORBIDDEN' }));
    expect(group.status).toBe(403);
    expect(group.body.code).toBe('STRUCTURE_EVENT_SCOPE_FORBIDDEN');

    const injection = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/structure-events`)
      .set('Authorization', fx.managerA.token)
      .send(accrual({ market_id: fx.marketB.id, evidence_ref: 'E2E-MARKET-ID-FORBIDDEN' }));
    expect(injection.status).toBe(400);
    expect(injection.body.code).toBe('MARKET_ID_FORBIDDEN');

    const after = await db.query('SELECT COUNT(*)::int AS n FROM economic_structure_cost_events WHERE charge_id=$1', [chargeId]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('4 — la séparation A/B est réelle jusque dans la lecture', async () => {
    const createdB = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketB.code}/structure-events`)
      .set('Authorization', fx.managerB.token)
      .send(accrual({ amount_original: 20000, amount_kmf: 20000, evidence_ref: 'E2E-STRUCTURE-B' }));
    expect(createdB.status).toBe(201);
    eventIds.push(createdB.body.event.id);

    const listA = await request(app)
      .get(`/api/market-delegation/markets/${fx.marketA.code}/structure-events`)
      .set('Authorization', fx.managerA.token);
    expect(listA.status).toBe(200);
    expect(listA.body.events.some((row) => row.id === createdB.body.event.id)).toBe(false);

    const listBAsA = await request(app)
      .get(`/api/market-delegation/markets/${fx.marketB.code}/structure-events`)
      .set('Authorization', fx.managerA.token);
    expect(listBAsA.status).toBe(403);
    expect(listBAsA.body.code).toBe('MARKET_MEMBERSHIP_REQUIRED');
  });

  it('5 — si l’audit échoue, le fait économique est rollbacké dans la même transaction', async () => {
    const correlation = 'e2e-ma-04-force-audit-fail';
    const evidence = 'E2E-ATOMIC-ROLLBACK';
    const constraintName = `e2e_audit_fail_${uuid().replace(/-/g, '')}`;

    await db.query(
      `ALTER TABLE market_delegation_audit
         ADD CONSTRAINT "${constraintName}"
         CHECK (correlation_id IS DISTINCT FROM '${correlation}') NOT VALID`
    );
    try {
      const res = await request(app)
        .post(`/api/market-delegation/markets/${fx.marketA.code}/structure-events`)
        .set('Authorization', fx.managerA.token)
        .set('x-correlation-id', correlation)
        .send(accrual({ evidence_ref: evidence }));

      expect(res.status).toBe(500);
      const persisted = await db.query(
        `SELECT COUNT(*)::int AS n
           FROM economic_structure_cost_events
          WHERE charge_id=$1 AND evidence_ref=$2`,
        [chargeId, evidence]
      );
      expect(persisted.rows[0].n).toBe(0);
    } finally {
      await db.query(`ALTER TABLE market_delegation_audit DROP CONSTRAINT IF EXISTS "${constraintName}"`);
    }
  });

  it('6 — même un SQL direct ordinaire ne peut réécrire ni supprimer l’historique', async () => {
    await expect(db.query(
      'UPDATE economic_structure_cost_events SET notes=$2 WHERE id=$1',
      [eventIds[0], 'Mutation interdite']
    )).rejects.toThrow(/append-only/i);

    await expect(db.query(
      'DELETE FROM economic_structure_cost_events WHERE id=$1',
      [eventIds[0]]
    )).rejects.toThrow(/append-only/i);

    const row = await db.query('SELECT id, notes FROM economic_structure_cost_events WHERE id=$1', [eventIds[0]]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].notes).toBe('Charge structurelle E2E attestée');
  });
});
