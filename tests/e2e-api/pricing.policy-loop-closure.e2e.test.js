'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * LOOP CLOSURE — politique de décision marché (Congo).
 *
 * Absente → décision humaine enregistrée par son propriétaire canonique
 * (recordMarketDecisionPolicy) → relue depuis la base par le gate, l'historique
 * et la politique courante → aucun marché ni prix modifié → rejeu refusé →
 * antidatage refusé.
 */

const { describeE2E, createCleanup, RUN_TAG, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(60000);

describeE2E('E2E-LOOP — politique de décision Congo', ({ db }) => {
  const policyService = require('../../services/pricing-market-decision-policy');
  const q = (sql, params) => db.query(sql, params);
  const userId = uuid();
  const VERSION = `LOOP-CG-${RUN_TAG}`.toUpperCase();
  let cleanup;
  let marketId;

  const INPUT = () => ({
    version: VERSION, window_days: 30, maturity_threshold: 0.9, coverage_threshold: 1, max_disposition_ratio: 0.05,
    source: 'e2e-loop-closure', evidence_ref: 'decision://e2e/loop', rationale: 'Politique initiale du marché Congo (E2E jetable).',
  });

  async function worldState() {
    const m = (await q(`SELECT is_active, lifecycle_status FROM markets WHERE id=$1`, [marketId])).rows[0];
    const drafts = (await q(`SELECT COUNT(*)::int AS n FROM product_market_price_drafts WHERE market_id=$1`, [marketId])).rows[0].n;
    const expo = (await q(`SELECT COUNT(*)::int AS n FROM product_market_exposure WHERE market_id=$1`, [marketId])).rows[0].n;
    return { ...m, drafts, expo };
  }

  beforeAll(async () => {
    cleanup = createCleanup(db);
    marketId = (await q(`SELECT id FROM markets WHERE code='CG' LIMIT 1`)).rows[0].id;
    cleanup.trackSql(`
      SET session_replication_role = replica;
      DELETE FROM pricing_market_decision_policy_events WHERE recorded_by = '${userId}';
      DELETE FROM users WHERE id = '${userId}';
      SET session_replication_role = origin;
    `);
    await q(`INSERT INTO users (id, full_name, email, phone, role) VALUES ($1,'E2E Loop Policy',$2,$3,'admin')`,
      [userId, `${tag('policy')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]);
  });

  afterAll(async () => { if (cleanup) await cleanup.run(); });

  test('absente → enregistrée → relue par le gate, la politique courante et l’historique', async () => {
    const world = await worldState();
    const before = await policyService.evaluateMarketDecision(marketId);
    expect(before).toMatchObject({ decision_status: 'NOT_DECISIONAL', reason: 'MARKET_DECISION_POLICY_REQUIRED', policy: null });

    const saved = await policyService.recordMarketDecisionPolicy(marketId, INPUT(), userId);
    expect(saved.version).toBe(VERSION);

    const current = await policyService.getCurrentMarketDecisionPolicy(marketId);
    expect(current).toMatchObject({ version: VERSION, window_days: 30, coverage_threshold: 1 });
    const history = await policyService.listMarketDecisionPolicyHistory(marketId);
    expect(history.map(p => p.version)).toContain(VERSION);

    const after = await policyService.evaluateMarketDecision(marketId);
    expect(after).toMatchObject({
      decision_status: 'NOT_DECISIONAL',
      authorization: 'DENY_NEW_UNDER_CDR_POSITION',
      reason: 'POLICY_DOES_NOT_COVER_CANONICAL_PERIOD',
    });
    expect(after.policy.version).toBe(VERSION);
    const expectedFrom = new Date(new Date(saved.effective_from).getTime() + 30 * 86400000).toISOString();
    expect(after.decisional_from).toBe(expectedFrom);

    // Aucune conséquence automatique : marché, prix et exposition inchangés.
    expect(await worldState()).toEqual(world);
  });

  test('rejeu de la même version refusé ; antidatage refusé ; l’état relu ne change pas', async () => {
    const before = await policyService.listMarketDecisionPolicyHistory(marketId);
    await expect(policyService.recordMarketDecisionPolicy(marketId, INPUT(), userId)).rejects.toMatchObject({ code: '23505' });
    await expect(policyService.recordMarketDecisionPolicy(marketId, {
      ...INPUT(), version: `${VERSION}-B`, effective_from: new Date(Date.now() - 86400000).toISOString(),
    }, userId)).rejects.toThrow('cannot be backdated');
    expect(await policyService.listMarketDecisionPolicyHistory(marketId)).toEqual(before);
  });

  test('append-only : la base refuse la modification d’une version enregistrée', async () => {
    await expect(q(`UPDATE pricing_market_decision_policy_events SET rationale='x' WHERE recorded_by=$1`, [userId]))
      .rejects.toThrow(/append-only/);
  });
});
