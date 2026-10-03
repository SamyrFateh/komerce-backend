'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/market-cost-attributions-conservation-real-db.test.js
 *
 * Feature propriétaire : economic-engine
 *
 * Prouve sur une vraie base ce qu'un mock ne peut pas prouver : la contrainte
 * différée de la migration 269 refuse tout état non conservé AU COMMIT (y
 * compris un INSERT manuel hors service), tout en laissant passer la
 * correction atomique REVERSAL + nouvelle ATTRIBUTION, et l'annulation totale.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('MARKET COST ATTRIBUTIONS CONSERVATION — REAL_DB — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const { createUser } = require('./test-harness/seed-helpers');
  const {
    OUTCOMES,
    attributeGroupEvent,
    correctGroupEventAttribution,
    reverseAttributions,
    auditAttributionConservation,
  } = require('../../services/market-cost-attribution-service');

  jest.setTimeout(30000);

  const AMOUNT = '60000.00';
  const ids = { charge: null, groupEvent: null, directEvent: null };
  const attributionEventIds = [];
  let actor;
  let marketA;
  let marketB;

  function policy(marketIds, version) {
    return {
      charge_id: ids.charge,
      version,
      source: 'integration test governed policy',
      evidence_ref: `governance://itest/${version}`,
      policy_kind: 'PROPORTIONAL',
      basis_kind: 'EQUAL_ELIGIBLE',
      eligibility_kind: 'EXPLICIT_MARKETS',
      confidence: 'low',
      base_pool_ratio: 0,
      effective_from: '2026-01-01T00:00:00Z',
      effective_to: null,
      eligible_market_ids: marketIds,
    };
  }

  async function insertEvent({ scope, marketId }) {
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO economic_structure_cost_events
         (id, charge_id, charge_family_snapshot, charge_name_snapshot, scope_kind, market_id,
          event_kind, economic_from, economic_to, amount_original, currency, fx_rate_to_kmf,
          fx_source, amount_kmf, source_kind, evidence_ref, recorded_by)
       VALUES ($1,$2,'itest-overhead','ITest attributions',$3,$4,'ACCRUAL',
               '2026-09-01T00:00:00Z','2026-10-01T00:00:00Z',$5,'KMF',1,'itest',$5,
               'INVOICE','invoice://itest/attributions',$6)`,
      [id, ids.charge, scope, marketId, AMOUNT, actor.id]
    );
    attributionEventIds.push(id);
    return id;
  }

  function rawAttribution(client, eventId, marketId, amount) {
    return client.query(
      `INSERT INTO market_cost_attributions
         (source_event_id, market_id, event_kind, amount_kmf, allocation_key,
          allocation_basis, policy_version, recorded_by)
       VALUES ($1,$2,'ATTRIBUTION',$3,'itest','{}'::jsonb,'raw',$4)`,
      [eventId, marketId, amount, actor.id]
    );
  }

  async function activeTotal(eventId) {
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(a.amount_kmf), 0)::text AS total
         FROM market_cost_attributions a
        WHERE a.source_event_id = $1 AND a.event_kind = 'ATTRIBUTION'
          AND NOT EXISTS (SELECT 1 FROM market_cost_attributions r WHERE r.reverses_id = a.id)`,
      [eventId]
    );
    return rows[0].total;
  }

  async function commitRaw(fn) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await fn(client);
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* conserver l'erreur d'origine */ }
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    actor = await createUser({ role: 'admin' });
    const { rows: markets } = await db.query(
      `SELECT id FROM markets WHERE is_active = TRUE ORDER BY code LIMIT 2`
    );
    if (markets.length < 2) throw new Error('integration fixture requires two active markets');
    [marketA, marketB] = markets.map((row) => row.id);

    ids.charge = crypto.randomUUID();
    await db.query(
      `INSERT INTO charges (id, family, name, amount_kmf, is_recurring, recurrence_period, is_active)
       VALUES ($1,'itest-overhead',$2,10000,TRUE,'monthly',TRUE)`,
      [ids.charge, `ITest attributions ${ids.charge.slice(0, 8)}`]
    );
    ids.groupEvent = await insertEvent({ scope: 'GROUP', marketId: null });
    ids.directEvent = await insertEvent({ scope: 'MARKET_DIRECT', marketId: marketA });
  });

  afterAll(async () => {
    // Tables append-only : on désactive leurs gardes UNIQUEMENT pour nos lignes,
    // dans une transaction (un rollback restaure l'état des triggers).
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE market_cost_attributions DISABLE TRIGGER trg_mca_guard_immutable');
      await client.query('ALTER TABLE economic_structure_cost_events DISABLE TRIGGER trg_prevent_economic_structure_cost_event_mutation');
      await client.query('DELETE FROM market_cost_attributions WHERE source_event_id = ANY($1::uuid[])', [attributionEventIds]);
      await client.query('DELETE FROM economic_structure_cost_events WHERE id = ANY($1::uuid[])', [attributionEventIds]);
      await client.query('ALTER TABLE market_cost_attributions ENABLE TRIGGER trg_mca_guard_immutable');
      await client.query('ALTER TABLE economic_structure_cost_events ENABLE TRIGGER trg_prevent_economic_structure_cost_event_mutation');
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* conserver l'erreur d'origine */ }
      throw error;
    } finally {
      client.release();
    }
    if (ids.charge) await db.query('DELETE FROM charges WHERE id = $1', [ids.charge]);
    if (actor) await db.query('DELETE FROM users WHERE id = $1', [actor.id]);
    await db.pool.end();
  });

  it('1 — le service attribue en conservant le montant du fait, et l audit confirme', async () => {
    const result = await attributeGroupEvent({
      eventId: ids.groupEvent,
      actorId: actor.id,
      policies: [policy([marketA, marketB], 'itest-v1')],
    });

    expect(result.outcome).toBe(OUTCOMES.ATTRIBUTED);
    expect(await activeTotal(ids.groupEvent)).toBe(AMOUNT);
    const audit = await auditAttributionConservation({ eventIds: [ids.groupEvent] });
    expect(audit).toEqual({ checked_events: 1, violations: [], conserved: true });
  });

  it('2 — un INSERT manuel qui casse la conservation est refusé au commit', async () => {
    await expect(commitRaw((client) => rawAttribution(client, ids.groupEvent, marketA, '1.00')))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('market_cost_attribution_not_conserved') });
    expect(await activeTotal(ids.groupEvent)).toBe(AMOUNT);
  });

  it('3 — une attribution sur un fait MARKET_DIRECT est refusée', async () => {
    await expect(commitRaw((client) => rawAttribution(client, ids.directEvent, marketA, AMOUNT)))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('market_cost_attribution_event_not_attributable') });
    expect(await activeTotal(ids.directEvent)).toBe('0');
  });

  it('4 — la correction atomique (REVERSAL + ATTRIBUTION) passe et reste conservée', async () => {
    const result = await correctGroupEventAttribution({
      eventId: ids.groupEvent,
      actorId: actor.id,
      reason: 'itest correction vers un seul marché',
      policies: [policy([marketA], 'itest-v2')],
    });

    expect(result.outcome).toBe(OUTCOMES.CORRECTED);
    expect(await activeTotal(ids.groupEvent)).toBe(AMOUNT);
    expect((await auditAttributionConservation({ eventIds: [ids.groupEvent] })).conserved).toBe(true);
  });

  it('5 — l annulation totale laisse une somme active nulle, acceptée', async () => {
    const result = await reverseAttributions({
      eventId: ids.groupEvent,
      actorId: actor.id,
      reason: 'itest annulation totale',
    });

    expect(result.outcome).toBe(OUTCOMES.REVERSED);
    expect(await activeTotal(ids.groupEvent)).toBe('0');
    expect(await auditAttributionConservation({ eventIds: [ids.groupEvent] }))
      .toEqual({ checked_events: 0, violations: [], conserved: true });
  });
}
