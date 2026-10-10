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

const mockControlChain = jest.fn();
jest.mock('../../services/logistics-control-chain-projection', () => ({
  getControlChain: (...args) => mockControlChain(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() })),
}));

const pilotage = require('../../services/dashboard-pilotage-market');

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
  mockControlChain.mockResolvedValue({ structural_alerts: [] });
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

  test('injecte le même scope marché et expose les destinations Canonical prouvées', async () => {
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
    expect(mockControlChain).toHaveBeenCalledWith({ market });
    expect(result.view_blocks.map(block => block.url)).toEqual([
      '/admin/pilotage',
      '/admin/costing',
      '/admin/operations',
    ]);
    expect(result.economic_flow.stages.map(stage => stage.url)).toEqual([
      '/admin/workspaces/pricing',
      '/admin/operations',
      '/admin/operations',
      '/admin/operations#operations-control-chain',
      '/admin/costing',
      '/admin/finance',
      '/admin/workspaces/pricing',
    ]);
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

  test('agrège une cause structurelle et retire ses symptômes du top alerts', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 's1', level: 'critical', source: 'purchasing', message: 'B1', signal_type: 'supplier_payment_blocked', order_reference: 'K-1' },
      { id: 's2', level: 'critical', source: 'purchasing', message: 'B2', signal_type: 'supplier_payment_blocked', order_reference: 'K-2' },
      { id: 's3', level: 'critical', source: 'purchasing', message: 'B3', signal_type: 'supplier_payment_blocked', order_reference: 'K-3' },
      { id: 's4', level: 'critical', source: 'hub', message: 'Hub', signal_type: 'hub_non_compliant', order_reference: 'K-4' },
    ] });
    mockControlChain.mockResolvedValueOnce({
      structural_alerts: [{
        stage: 'PURCHASING',
        health: 'RED',
        reason_code: 'supplier_payment_blocked',
        summary: 'Paiement fournisseur bloqué',
        owner_role: 'finance',
        order_count: 3,
        order_references: ['K-1', 'K-2', 'K-3'],
      }],
    });

    const result = await pilotage.buildMarketPilotage(filters, market);

    expect(result.control_chain).toEqual(expect.objectContaining({
      stages: expect.any(Array),
      structural_alerts: expect.any(Array),
    }));
    expect(result.system_alerts).toHaveLength(2);
    expect(result.system_alerts[0]).toEqual(expect.objectContaining({
      structural: true,
      title: 'Paiement fournisseur bloqué',
      order_count: 3,
    }));
    expect(result.system_alerts[1]).toEqual(expect.objectContaining({ id: 's4' }));
  });

  test('publicFilters ne laisse jamais fuiter l’UUID d’autorité interne', () => {
    expect(pilotage.publicFilters({ market_id: 'secret-scope', from: '2026-08-01' }))
      .toEqual({ from: '2026-08-01' });
  });
});
