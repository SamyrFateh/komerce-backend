'use strict';

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

const db = require('../../db');
const { computePeriodStructureTruth } = require('../../services/pricing-period-structure');

const CM = '22222222-2222-4222-8222-222222222222';
const CG = '33333333-3333-4333-8333-333333333333';
const FROM = '2026-09-01T00:00:00Z';
const TO = '2026-10-01T00:00:00Z';

function groupEvent(overrides = {}) {
  return {
    id: 'g1',
    charge_id: 'charge-platform',
    charge_family_snapshot: 'platform',
    charge_name_snapshot: 'Railway',
    recurrence_period_snapshot: 'monthly',
    scope_kind: 'GROUP',
    market_id: null,
    event_kind: 'ACCRUAL',
    source_kind: 'INVOICE',
    evidence_ref: 'invoice://railway/2026-09',
    economic_from: FROM,
    economic_to: TO,
    amount_kmf: 60000,
    ...overrides,
  };
}

function directEvent(overrides = {}) {
  return groupEvent({
    id: 'm1',
    charge_id: 'charge-relay',
    scope_kind: 'MARKET_DIRECT',
    market_id: CM,
    amount_kmf: 20000,
    ...overrides,
  });
}

function attribution(eventId, marketId, amount) {
  return { source_event_id: eventId, market_id: marketId, amount_kmf: amount };
}

function policy(chargeId) {
  return {
    charge_id: chargeId,
    version: '2026-09-v1',
    source: 'board-approved allocation policy',
    evidence_ref: 'governance://pricing/group-allocation/2026-09-v1',
    policy_kind: 'PROPORTIONAL',
    basis_kind: 'PAID_ORDER_COUNT',
    eligibility_kind: 'POSITIVE_BASIS',
    confidence: 'high',
    base_pool_ratio: 0,
    effective_from: FROM,
    effective_to: TO,
  };
}

function run(extra = {}) {
  return computePeriodStructureTruth({ from: FROM, to: TO, marketId: CM, ...extra });
}

describe('pricing-period-structure — charges de structure mutualisées attribuées', () => {
  beforeEach(() => { db.query.mockReset(); });

  test('lit la table quand toutes les charges GROUP sont attribuées, sans politique ni assiette', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [groupEvent(), directEvent()] })
      .mockResolvedValueOnce({ rows: [
        attribution('g1', CM, '40000.00'),
        attribution('g1', CG, '20000.00'),
      ] });

    const result = await run();

    expect(result.status).toBe('MARKET_PERIOD_TRUTH_ALLOCATED');
    expect(result.market_n3_decisional).toBe(true);
    expect(result.shared_allocation_applied).toBe(true);
    expect(result.market_shared_n3_kmf).toBe(40000);
    expect(result.market_direct_kmf).toBe(20000);
    expect(result.market_n3_total_kmf).toBe(60000);
    expect(result.attribution).toEqual(expect.objectContaining({
      source: 'market_cost_attributions',
      attributed_event_count: 1,
      attributed_group_pool_kmf: 60000,
      market_attributed_kmf: 40000,
    }));
    expect(result.allocation.status).toBe('NO_GROUP_POOL');
    // événements + attributions : aucune requête d'assiette
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  test('la requête ne lit que les ATTRIBUTION non contre-passées (anti-jointure sur reverses_id)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [groupEvent()] })
      .mockResolvedValueOnce({ rows: [attribution('g1', CM, '60000.00')] });

    await run();

    const [sql, params] = db.query.mock.calls[1];
    expect(sql).toContain('FROM market_cost_attributions a');
    expect(sql).toContain("a.event_kind = 'ATTRIBUTION'");
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('r.reverses_id = a.id');
    expect(params).toEqual([['g1']]);
  });

  test('prorate une attribution au recouvrement de période', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [groupEvent({
        economic_from: '2026-09-01T00:00:00Z',
        economic_to: '2026-11-01T00:00:00Z',
        amount_kmf: 61000,
      })] })
      .mockResolvedValueOnce({ rows: [
        attribution('g1', CM, '30500.00'),
        attribution('g1', CG, '30500.00'),
      ] });

    const result = await run();

    // 30 jours sur 61 : 30500 × 30/61 = 15000
    expect(result.market_shared_n3_kmf).toBe(15000);
    expect(result.attribution.attributed_group_pool_kmf).toBe(30000);
  });

  test('un marché sans part attribuée reçoit 0, pas une valeur inconnue', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [groupEvent()] })
      .mockResolvedValueOnce({ rows: [attribution('g1', CG, '60000.00')] });

    const result = await run();

    expect(result.market_n3_decisional).toBe(true);
    expect(result.market_shared_n3_kmf).toBe(0);
    expect(result.market_n3_total_kmf).toBe(0);
  });

  test('mixte : événement attribué lu dans la table, autre événement ventilé à la volée, sans double comptage', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [
        groupEvent(),
        groupEvent({
          id: 'g2',
          charge_id: 'charge-hub-fixed',
          charge_family_snapshot: 'hub_fixed',
          charge_name_snapshot: 'Hub fixe',
          amount_kmf: 30000,
        }),
      ] })
      .mockResolvedValueOnce({ rows: [attribution('g1', CM, '60000.00')] })
      .mockResolvedValueOnce({ rows: [
        { market_id: CM, basis_value: '1' },
        { market_id: CG, basis_value: '1' },
      ] });

    const result = await run({ allocationPolicies: [policy('charge-hub-fixed')] });

    expect(result.status).toBe('MARKET_PERIOD_TRUTH_ALLOCATED');
    // 60000 attribués (table) + 15000 (moitié du hub à la volée)
    expect(result.market_shared_n3_kmf).toBe(75000);
    expect(result.market_n3_total_kmf).toBe(75000);
    expect(result.attribution.market_attributed_kmf).toBe(60000);
    // l'allocation à la volée ne contient QUE l'événement non attribué
    expect(result.allocation.group_pool_kmf).toBe(30000);
    expect(result.allocation.charges.map((charge) => charge.charge_id)).toEqual(['charge-hub-fixed']);
    expect(result.allocation.charges[0].evidence_event_ids).toEqual(['g2']);
  });

  test('reste à ventiler sans politique fournie : non décisionnel, l attribution reste visible', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [
        groupEvent(),
        groupEvent({ id: 'g2', charge_id: 'charge-hub-fixed', amount_kmf: 30000 }),
      ] })
      .mockResolvedValueOnce({ rows: [attribution('g1', CM, '60000.00')] });

    const result = await run();

    expect(result.status).toBe('NOT_DECISIONAL_SHARED_ALLOCATION_PENDING');
    expect(result.market_n3_decisional).toBe(false);
    expect(result.market_n3_total_kmf).toBeNull();
    expect(result.attribution.attributed_event_count).toBe(1);
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  test('reste à ventiler avec politique manquante : non décisionnel, aucune somme partielle décisionnelle', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [
        groupEvent(),
        groupEvent({ id: 'g2', charge_id: 'charge-hub-fixed', amount_kmf: 30000 }),
      ] })
      .mockResolvedValueOnce({ rows: [attribution('g1', CM, '60000.00')] });

    const result = await run({ allocationPolicies: [] });

    expect(result.status).toBe('NOT_DECISIONAL_SHARED_ALLOCATION_POLICY');
    expect(result.market_n3_decisional).toBe(false);
    expect(result.market_shared_n3_kmf).toBeNull();
    expect(result.market_n3_total_kmf).toBeNull();
    expect(result.attribution.market_attributed_kmf).toBe(60000);
    expect(result.allocation.unallocated_group_pool_kmf).toBe(30000);
  });

  test('attributions actives non conservées : non décisionnel, sans repli à la volée', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [groupEvent()] })
      .mockResolvedValueOnce({ rows: [attribution('g1', CM, '59999.99')] });

    const result = await run({ allocationPolicies: [policy('charge-platform')] });

    expect(result.status).toBe('NOT_DECISIONAL_ATTRIBUTION_NOT_CONSERVED');
    expect(result.market_n3_decisional).toBe(false);
    expect(result.market_shared_n3_kmf).toBeNull();
    expect(result.market_n3_total_kmf).toBeNull();
    expect(result.shared_allocation_applied).toBe(false);
    expect(result.attribution.non_conserved_events).toEqual([
      { event_id: 'g1', event_amount_kmf: 60000, active_total_kmf: 59999.99 },
    ]);
    // pas de requête d'assiette : l'événement n'est pas relu à la volée
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  test('un événement MARKET_DIRECT n est jamais lu dans la table d attribution', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [groupEvent(), directEvent()] })
      .mockResolvedValueOnce({ rows: [attribution('g1', CM, '60000.00')] });

    const result = await run();

    const [, params] = db.query.mock.calls[1];
    expect(params).toEqual([['g1']]);
    expect(result.market_direct_kmf).toBe(20000);
  });
});
