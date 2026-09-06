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

function mockClient() {
  const client = {
    query: jest.fn(),
    release: jest.fn(),
  };
  db.getClient.mockResolvedValue(client);
  return client;
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
});

describe('pricing-period-structure — enregistrement append-only', () => {
  beforeEach(() => jest.clearAllMocks());

  test('enregistre un accrual GROUP sans promouvoir charges.amount_kmf en réel', async () => {
    const client = mockClient();
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: baseInput().charge_id, is_active: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'event-1', ...baseInput(), recorded_by: 'actor-1' }] })
      .mockResolvedValueOnce({}); // COMMIT

    const result = await recordStructureCostEvent(baseInput(), 'actor-1');

    expect(result.id).toBe('event-1');
    expect(client.query.mock.calls[1][0]).toContain('FROM charges WHERE id = $1 FOR SHARE');
    expect(client.query.mock.calls[2][0]).toContain('INSERT INTO economic_structure_cost_events');
    expect(client.query.mock.calls[2][0]).not.toContain('charges.amount_kmf');
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
      .mockResolvedValueOnce({ rows: [{ id: input.charge_id, is_active: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});

    await expect(recordStructureCostEvent(input, 'actor-1'))
      .rejects.toThrow('market not found or inactive');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('une correction conserve charge et scope de l événement original', async () => {
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
      .mockResolvedValueOnce({ rows: [{ id: input.charge_id, is_active: true }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'event-old',
        charge_id: input.charge_id,
        scope_kind: 'GROUP',
        market_id: null,
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'event-new' }] })
      .mockResolvedValueOnce({});

    const result = await recordStructureCostEvent(input, 'actor-1');
    expect(result.id).toBe('event-new');
  });
});

describe('pricing-period-structure — lecture de période', () => {
  beforeEach(() => jest.clearAllMocks());

  test('prorate mécaniquement un événement sur le chevauchement exact de la fenêtre', () => {
    const result = _aggregateRows([{
      id: 'e1',
      charge_id: 'c1',
      charge_name: 'Railway',
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
    expect(result.evidence[0].overlap_ratio).toBe(0.5);
    expect(result.shared_allocation_applied).toBe(false);
  });

  test('un marché avec pool GROUP reste NOT_DECISIONAL jusqu à la mutualisation', () => {
    const result = _aggregateRows([
      {
        id: 'g1', charge_id: 'c1', scope_kind: 'GROUP', market_id: null,
        event_kind: 'ACCRUAL', source_kind: 'INVOICE', evidence_ref: 'proof-g',
        economic_from: '2026-09-01T00:00:00Z', economic_to: '2026-10-01T00:00:00Z', amount_kmf: 60000,
      },
      {
        id: 'm1', charge_id: 'c2', scope_kind: 'MARKET_DIRECT', market_id: 'market-cm',
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
    expect(params[2]).toBe('22222222-2222-2222-2222-222222222222');
  });
});
