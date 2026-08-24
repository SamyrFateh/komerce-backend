'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockMetricNames = [
  'getCAEncaisse', 'getCmdsActives', 'getMargeConsolidee', 'getAlertesCritiques',
  'getTauxCompletudeCouts', 'getCoutReel', 'getCmdsCoutIncompletCount',
  'getCoutMoyParCmd', 'getCmdsAujourdhui', 'getColisEnTransit',
  'getDisponiblesRelais', 'getRetardsCritiques', 'getTauxCompletudeScans',
];

const mockMetricFunctions = Object.fromEntries(mockMetricNames.map(name => [
  name,
  jest.fn(async filters => ({ key: name, label: name, value: 1, unit: 'count', filters })),
]));

jest.mock('../../services/dashboard-metrics', () => mockMetricFunctions);

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() })),
}));

const pilotage = require('../../services/dashboard-pilotage-market');

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('dashboard-pilotage-market', () => {
  const market = { id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF' };
  const filters = {
    from: '2026-08-01',
    status: 'confirmed',
    market_id: market.id,
  };

  test('refuse un agrégat dont le market_id ne correspond pas au marché résolu serveur', async () => {
    await expect(pilotage.buildMarketPilotage({ market_id: 'other-market' }, market))
      .rejects.toThrow('dashboard_market_filter_not_server_bound');
  });

  test('injecte le même scope marché dans toutes les métriques', async () => {
    const result = await pilotage.buildMarketPilotage(filters, market);

    for (const name of mockMetricNames) {
      expect(mockMetricFunctions[name]).toHaveBeenCalledTimes(1);
      expect(mockMetricFunctions[name]).toHaveBeenCalledWith(filters);
    }

    expect(result.scope).toEqual({
      mode: 'market',
      market: { code: 'CM', name: 'Cameroun', currency: 'XAF' },
    });
    expect(result.data_quality.scope_enforced).toBe(true);
    expect(result.data_quality.filters).toEqual({ from: '2026-08-01', status: 'confirmed' });
    expect(result.data_quality.filters.market_id).toBeUndefined();
    expect(result.kpis_global).toHaveLength(5);
    expect(result.view_blocks).toHaveLength(3);
  });

  test('les top alerts utilisent une preuve de rattachement marché paramétrée', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: 'sig-1', level: 'critical', source: 'signal-service', message: 'Incident', created_at: '2026-08-24T08:00:00Z',
    }] });

    const alerts = await pilotage.fetchTopAlerts(filters, 7);
    expect(alerts).toHaveLength(1);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("s.entity_type = 'order'");
    expect(sql).toContain('scope_o.market_id = $1');
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual([market.id, 7]);
  });

  test('publicFilters ne laisse jamais fuiter l’UUID d’autorité interne', () => {
    expect(pilotage.publicFilters({ market_id: 'secret-scope', from: '2026-08-01' }))
      .toEqual({ from: '2026-08-01' });
  });
});
