'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

const db = require('../../db');
const {
  recordStructureCostEvent,
  computePeriodStructureTruth,
  _aggregateRows,
  _validateMoney,
  _validateScope,
  _snapshotFromCharge,
  _normalizeAllocationPolicy,
  _allocateConserving,
  _allocateChargePool,
} = require('../../services/pricing-period-structure');

function baseInput(overrides = {}) {
  return {
    charge_id: '11111111-1111-1111-1111-111111111111',
    scope_kind: 'GROUP',
    market_id: null,
    event_kind: 'ACCRUAL',
    economic_from: '2026-09-01T00:00:00.000Z',
    economic_to: '2026-10-01T00:00:00.000Z',
    amount_original: 100000,
    currency: 'KMF',
    fx_rate_to_kmf: 1,
    fx_source: 'native KMF',
    amount_kmf: 100000,
    source_kind: 'INVOICE',
    evidence_ref: 'invoice://railway/2026-09',
    ...overrides,
  };
}

function chargeRow(overrides = {}) {
  return {
    id: baseInput().charge_id,
    family: 'platform',
    name: 'Railway',
    recurrence_period: 'monthly',
    is_active: true,
    ...overrides,
  };
}

function mockClient() {
  const client = {
    query: jest.fn(),
    release: jest.fn(),
  };
  db.getClient.mockResolvedValue(client);
  return client;
}

function structureEvent(overrides = {}) {
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
    economic_from: '2026-09-01T00:00:00Z',
    economic_to: '2026-10-01T00:00:00Z',
    amount_kmf: 60000,
    ...overrides,
  };
}

function allocationPolicy(overrides = {}) {
  return {
    charge_id: 'charge-platform',
    version: '2026-09-v1',
    source: 'board-approved allocation policy',
    evidence_ref: 'governance://pricing/group-allocation/2026-09-v1',
    policy_kind: 'PROPORTIONAL',
    basis_kind: 'PAID_ORDER_COUNT',
    eligibility_kind: 'POSITIVE_BASIS',
    confidence: 'high',
    base_pool_ratio: 0,
    effective_from: '2026-09-01T00:00:00Z',
    effective_to: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

describe('pricing-period-structure — validation fail-closed', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GROUP refuse un market_id et MARKET_DIRECT l exige', () => {
    expect(() => _validateScope({ scope_kind: 'GROUP', market_id: 'market-1' }))
      .toThrow('GROUP events cannot carry market_id');
    expect(() => _validateScope({ scope_kind: 'MARKET_DIRECT' }))
      .toThrow('MARKET_DIRECT events require market_id');
  });

  test('un événement KMF exige un FX à 1 et une conversion cohérente', () => {
    expect(() => _validateMoney({
      amount_original: 100,
      currency: 'KMF',
      fx_rate_to_kmf: 2,
      amount_kmf: 200,
    })).toThrow('KMF events require fx_rate_to_kmf = 1');

    expect(() => _validateMoney({
      amount_original: 10,
      currency: 'EUR',
      fx_rate_to_kmf: 490,
      amount_kmf: 100,
    })).toThrow('amount_kmf is inconsistent');
  });

  test('la famille N3 reste ouverte et snapshotée, sans enum métier fermé', () => {
    expect(_snapshotFromCharge({
      family: 'relay_network_fixed',
      name: 'Forfait fixe relais Mutsamudu',
      recurrence_period: 'monthly',
    })).toEqual({
      family: 'relay_network_fixed',
      name: 'Forfait fixe relais Mutsamudu',
      recurrencePeriod: 'monthly',
    });
  });
});

describe('pricing-period-structure — enregistrement append-only', () => {
  beforeEach(() => jest.clearAllMocks());

  test('enregistre un accrual GROUP sans promouvoir charges.amount_kmf en réel', async () => {
    const client = mockClient();
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [chargeRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 'event-1', ...baseInput(), recorded_by: 'actor-1' }] })
      .mockResolvedValueOnce({}); // COMMIT

    const result = await recordStructureCostEvent(baseInput(), 'actor-1');

    expect(result.id).toBe('event-1');
    expect(client.query.mock.calls[1][0]).toContain('FROM charges');
    expect(client.query.mock.calls[2][0]).toContain('INSERT INTO economic_structure_cost_events');
    expect(client.query.mock.calls[2][0]).not.toContain('charges.amount_kmf');
    expect(client.query.mock.calls[2][1]).toEqual(expect.arrayContaining(['platform', 'Railway', 'monthly']));
    expect(client.release).toHaveBeenCalled();
  });

  test('MARKET_DIRECT vérifie que le marché existe et est actif', async () => {
    const client = mockClient();
    const input = baseInput({
      scope_kind: 'MARKET_DIRECT',
      market_id: '22222222-2222-2222-2222-222222222222',
    });
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [chargeRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});

    await expect(recordStructureCostEvent(input, 'actor-1'))
      .rejects.toThrow('market not found or inactive');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('une correction conserve charge, scope et identité historique du fait original', async () => {
    const client = mockClient();
    const input = baseInput({
      event_kind: 'ADJUSTMENT',
      adjusts_event_id: 'event-old',
      amount_original: -1000,
      amount_kmf: -1000,
      source_kind: 'ADJUSTMENT',
    });
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [chargeRow({ family: 'renamed-current', name: 'Nom courant' })] })
      .mockResolvedValueOnce({ rows: [{
        id: 'event-old',
        charge_id: input.charge_id,
        scope_kind: 'GROUP',
        market_id: null,
        charge_family_snapshot: 'relay_network_fixed',
        charge_name_snapshot: 'Forfait relais historique',
        recurrence_period_snapshot: 'monthly',
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'event-new' }] })
      .mockResolvedValueOnce({});

    const result = await recordStructureCostEvent(input, 'actor-1');
    expect(result.id).toBe('event-new');
    const insertParams = client.query.mock.calls[3][1];
    expect(insertParams.slice(1, 4)).toEqual([
      'relay_network_fixed',
      'Forfait relais historique',
      'monthly',
    ]);
  });
});

describe('pricing-period-structure — lecture de période', () => {
  beforeEach(() => jest.clearAllMocks());

  test('prorate mécaniquement un événement sur le chevauchement exact de la fenêtre', () => {
    const result = _aggregateRows([{
      id: 'e1',
      charge_id: 'c1',
      charge_family_snapshot: 'platform',
      charge_name_snapshot: 'Railway',
      recurrence_period_snapshot: 'monthly',
      scope_kind: 'GROUP',
      market_id: null,
      event_kind: 'ACCRUAL',
      source_kind: 'INVOICE',
      evidence_ref: 'invoice://1',
      economic_from: '2026-09-01T00:00:00.000Z',
      economic_to: '2026-09-11T00:00:00.000Z',
      amount_kmf: 10000,
    }], {
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-09-06T00:00:00.000Z'),
    }, null);

    expect(result.group_pool_kmf).toBe(5000);
    expect(result.by_family_kmf.platform).toBe(5000);
    expect(result.evidence[0].overlap_ratio).toBe(0.5);
    expect(result.shared_allocation_applied).toBe(false);
  });

  test('un forfait relais périodique MARKET_DIRECT alimente N3 du marché et se prorate par période', () => {
    const result = _aggregateRows([{
      id: 'relay-1',
      charge_id: 'charge-relay',
      charge_family_snapshot: 'relay_network_fixed',
      charge_name_snapshot: 'Forfait fixe relais Mutsamudu',
      recurrence_period_snapshot: 'monthly',
      scope_kind: 'MARKET_DIRECT',
      market_id: 'market-km',
      event_kind: 'ACCRUAL',
      source_kind: 'CONTRACT',
      evidence_ref: 'contract://relay/mutsamudu/2026',
      economic_from: '2026-09-01T00:00:00Z',
      economic_to: '2026-10-01T00:00:00Z',
      amount_kmf: 30000,
    }], {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-16T00:00:00Z'),
    }, 'market-km');

    expect(result.market_direct_kmf).toBe(15000);
    expect(result.by_family_kmf.relay_network_fixed).toBe(15000);
    expect(result.evidence[0].configured_recurrence).toBe('monthly');
    expect(result.status).toBe('DIRECT_MARKET_TRUTH_ONLY');
    expect(result.market_n3_total_kmf).toBe(15000);
  });

  test('un marché avec pool GROUP reste NOT_DECISIONAL jusqu à la mutualisation', () => {
    const result = _aggregateRows([
      {
        id: 'g1', charge_id: 'c1', charge_family_snapshot: 'platform', charge_name_snapshot: 'Railway',
        scope_kind: 'GROUP', market_id: null,
        event_kind: 'ACCRUAL', source_kind: 'INVOICE', evidence_ref: 'proof-g',
        economic_from: '2026-09-01T00:00:00Z', economic_to: '2026-10-01T00:00:00Z', amount_kmf: 60000,
      },
      {
        id: 'm1', charge_id: 'c2', charge_family_snapshot: 'relay_network_fixed', charge_name_snapshot: 'Relais fixe',
        scope_kind: 'MARKET_DIRECT', market_id: 'market-cm',
        event_kind: 'ACCRUAL', source_kind: 'CONTRACT', evidence_ref: 'proof-m',
        economic_from: '2026-09-01T00:00:00Z', economic_to: '2026-10-01T00:00:00Z', amount_kmf: 20000,
      },
    ], {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-10-01T00:00:00Z'),
    }, 'market-cm');

    expect(result.group_pool_kmf).toBe(60000);
    expect(result.market_direct_kmf).toBe(20000);
    expect(result.status).toBe('NOT_DECISIONAL_SHARED_ALLOCATION_PENDING');
    expect(result.market_n3_decisional).toBe(false);
    expect(result.market_n3_total_kmf).toBeNull();
  });

  test('absence de faits de période ne devient jamais zéro décisionnel', () => {
    const result = _aggregateRows([], {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-10-01T00:00:00Z'),
    }, 'market-cm');

    expect(result.status).toBe('NOT_DECISIONAL_NO_PERIOD_TRUTH');
    expect(result.truth_level).toBe('NONE');
    expect(result.market_n3_decisional).toBe(false);
  });

  test('computePeriodStructureTruth filtre serveur par fenêtre et marché', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const result = await computePeriodStructureTruth({
      from: '2026-09-01T00:00:00Z',
      to: '2026-10-01T00:00:00Z',
      marketId: '22222222-2222-2222-2222-222222222222',
    });

    expect(result.status).toBe('NOT_DECISIONAL_NO_PERIOD_TRUTH');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("e.scope_kind = 'GROUP' OR e.market_id = $3::uuid");
    expect(sql).toContain('charge_family_snapshot');
    expect(params[2]).toBe('22222222-2222-2222-2222-222222222222');
  });
});

describe('pricing-period-structure — mutualisation GROUP gouvernée', () => {
  const CM = '22222222-2222-4222-8222-222222222222';
  const CG = '33333333-3333-4333-8333-333333333333';
  const KM = '44444444-4444-4444-8444-444444444444';
  const period = {
    from: new Date('2026-09-01T00:00:00Z'),
    to: new Date('2026-10-01T00:00:00Z'),
  };

  beforeEach(() => jest.clearAllMocks());

  test('le fallback égalitaire exige EXPLICIT_MARKETS et reste confidence low', () => {
    expect(() => _normalizeAllocationPolicy(allocationPolicy({
      basis_kind: 'EQUAL_ELIGIBLE',
      eligibility_kind: 'EXPLICIT_MARKETS',
      eligible_market_ids: [CM, CG],
      confidence: 'high',
    }), period)).toThrow('EQUAL_ELIGIBLE must remain low confidence');

    const normalized = _normalizeAllocationPolicy(allocationPolicy({
      basis_kind: 'EQUAL_ELIGIBLE',
      eligibility_kind: 'EXPLICIT_MARKETS',
      eligible_market_ids: [CM, CG],
      confidence: 'low',
    }), period);
    expect(normalized.confidence).toBe('low');
    expect(normalized.eligible_market_ids).toEqual([CM, CG]);
  });

  test('l arrondi conserve le pool au centime sans créer ni détruire N3', () => {
    const shares = _allocateConserving(100, [
      { market_id: CM, basis_value: 1, ratio: 1 / 3 },
      { market_id: CG, basis_value: 1, ratio: 1 / 3 },
      { market_id: KM, basis_value: 1, ratio: 1 / 3 },
    ]);
    expect(shares.reduce((sum, row) => sum + row.allocated_kmf, 0)).toBe(100);
    expect(shares.map((row) => row.allocated_kmf).sort()).toEqual([33.33, 33.33, 33.34]);
  });

  test('socle + marginal reste une politique explicite et conserve le pool', () => {
    const result = _allocateChargePool(100000, {
      policy_kind: 'BASE_PLUS_MARGINAL',
      base_pool_ratio: 0.3,
    }, [
      { market_id: CM, basis_value: 6 },
      { market_id: CG, basis_value: 3 },
      { market_id: KM, basis_value: 1 },
    ]);

    expect(result.decisional).toBe(true);
    expect(result.conservation_ok).toBe(true);
    expect(result.shares).toEqual([
      expect.objectContaining({ market_id: CM, allocated_kmf: 52000 }),
      expect.objectContaining({ market_id: CG, allocated_kmf: 31000 }),
      expect.objectContaining({ market_id: KM, allocated_kmf: 17000 }),
    ]);
  });

  test('PAID_ORDER_COUNT alloue le pool GROUP à partir d une assiette indépendante et rend le N3 marché décisionnel', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [
        structureEvent(),
        structureEvent({
          id: 'm1',
          charge_id: 'charge-relay',
          charge_family_snapshot: 'relay_network_fixed',
          charge_name_snapshot: 'Relais fixe CM',
          scope_kind: 'MARKET_DIRECT',
          market_id: CM,
          source_kind: 'CONTRACT',
          evidence_ref: 'contract://relay/cm',
          amount_kmf: 20000,
        }),
      ] })
      .mockResolvedValueOnce({ rows: [
        { market_id: CM, basis_value: '2' },
        { market_id: CG, basis_value: '1' },
      ] });

    const result = await computePeriodStructureTruth({
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      marketId: CM,
      allocationPolicies: [allocationPolicy()],
    });

    expect(result.status).toBe('MARKET_PERIOD_TRUTH_ALLOCATED');
    expect(result.shared_allocation_applied).toBe(true);
    expect(result.market_shared_n3_kmf).toBe(40000);
    expect(result.market_direct_kmf).toBe(20000);
    expect(result.market_n3_total_kmf).toBe(60000);
    expect(result.market_n3_decisional).toBe(true);
    expect(result.allocation.conservation_ok).toBe(true);
    expect(result.allocation.allocated_group_pool_kmf).toBe(60000);
    expect(result.allocation.charges[0].market_share_kmf).toBe(40000);
    expect(result.allocation.charges[0].market_allocation_ratio).toBeCloseTo(2 / 3, 6);

    const [basisSql] = db.query.mock.calls[1];
    expect(basisSql).toContain("o.payment_status = 'paid'");
    expect(basisSql).toContain("COALESCE(o.status, '') NOT IN ('cancelled', 'refunded')");
    expect(basisSql).toContain('o.created_at >= $1');
  });

  test('une politique manquante laisse tout le total N3 marché fail-closed', async () => {
    db.query.mockResolvedValueOnce({ rows: [structureEvent()] });

    const result = await computePeriodStructureTruth({
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      marketId: CM,
      allocationPolicies: [],
    });

    expect(result.status).toBe('NOT_DECISIONAL_SHARED_ALLOCATION_POLICY');
    expect(result.market_n3_decisional).toBe(false);
    expect(result.market_shared_n3_kmf).toBeNull();
    expect(result.market_n3_total_kmf).toBeNull();
    expect(result.allocation.unallocated_group_pool_kmf).toBe(60000);
    expect(result.allocation.charges[0].status).toBe('NOT_DECISIONAL_POLICY_MISSING');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('si une charge GROUP sur deux n a pas de politique, aucune somme partielle ne devient décisionnelle', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [
        structureEvent({ amount_kmf: 60000 }),
        structureEvent({
          id: 'g2',
          charge_id: 'charge-hub-fixed',
          charge_family_snapshot: 'hub_fixed',
          charge_name_snapshot: 'Hub fixe',
          amount_kmf: 30000,
        }),
      ] })
      .mockResolvedValueOnce({ rows: [
        { market_id: CM, basis_value: '1' },
        { market_id: CG, basis_value: '1' },
      ] });

    const result = await computePeriodStructureTruth({
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      marketId: CM,
      allocationPolicies: [allocationPolicy()],
    });

    expect(result.market_n3_decisional).toBe(false);
    expect(result.market_n3_total_kmf).toBeNull();
    expect(result.allocation.group_pool_kmf).toBe(90000);
    expect(result.allocation.allocated_group_pool_kmf).toBe(60000);
    expect(result.allocation.unallocated_group_pool_kmf).toBe(30000);
    expect(result.allocation.market_shared_partial_kmf).toBe(30000);
  });
});