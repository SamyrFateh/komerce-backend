'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockMetricNames = [
  'getCmdsActives', 'getAlertesCritiques',
  'getTauxCompletudeCouts', 'getCoutReel', 'getCmdsCoutIncompletCount',
  'getCoutMoyParCmd', 'getCmdsAujourdhui', 'getColisEnTransit',
  'getDisponiblesRelais', 'getRetardsCritiques', 'getTauxCompletudeScans',
];

const mockMetricFunctions = Object.fromEntries(mockMetricNames.map(name => [
  name,
  jest.fn(async filters => ({ key: name, label: name, value: 1, unit: 'count', filters })),
]));

jest.mock('../../services/dashboard-metrics', () => mockMetricFunctions);
const mockPaidSales=jest.fn(async()=>({key:'ca_encaisse',label:'Ventes payées (avoir inclus)',value:42,unit:'XAF',data_quality:{metric_id:'commerce.paid_sales_wallet_included'}}));
jest.mock('../../services/dashboard-commerce',()=>({getPilotagePaidSales:(...args)=>mockPaidSales(...args)}));

const mockControlChain = jest.fn();
jest.mock('../../services/logistics-control-chain-projection', () => ({
  getControlChain: (...args) => mockControlChain(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() })),
}));

jest.mock('../../services/economic-cost-center-read-model',()=>({readMarketPeriodDecision:jest.fn()}));
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

  test('recette marché : chaîne et signaux réels non lus et non déterminés',async()=>{
    const result=await pilotage.buildMarketPilotage({market_id:market.id,simulation_scope:'RCT1'},market);
    expect(result.control_chain).toBeDefined();
    expect(result.system_alerts).toBeNull();
    expect(mockControlChain).toHaveBeenCalledWith({market,simulationScope:'RCT1'});
    expect(mockMetricFunctions.getAlertesCritiques).not.toHaveBeenCalled();
    expect(result.kpis_global).toContainEqual(expect.objectContaining({key:'alertes_critiques',value:null}));
  });

  test('refuse une période commerciale résolue pour un autre marché',async()=>{
    await expect(pilotage.buildMarketPilotage({market_id:market.id},market,null,{filters:{market_id:'other-market'}}))
      .rejects.toThrow('dashboard_market_flow_filter_not_server_bound');
    expect(mockPaidSales).not.toHaveBeenCalled();
  });

  test('refuse un agrégat dont le market_id ne correspond pas au marché résolu serveur', async () => {
    await expect(pilotage.buildMarketPilotage({ market_id: 'other-market' }, market))
      .rejects.toThrow('dashboard_market_filter_not_server_bound');
  });

  test('injecte le même scope marché et expose les destinations Canonical prouvées', async () => {
    const result = await pilotage.buildMarketPilotage(filters, market);

    for (const name of mockMetricNames) {
      expect(mockMetricFunctions[name]).toHaveBeenCalledTimes(1);
      expect(mockMetricFunctions[name]).toHaveBeenCalledWith(name==='getCmdsActives'?{market_id:market.id}:filters);
    }

    expect(result.scope).toEqual({
      mode: 'market',
      market: { code: 'CM', name: 'Cameroun', currency: 'XAF' },
    });
    expect(result.data_quality.scope_enforced).toBe(true);
    expect(result.data_quality.filters).toEqual({ from: '2026-08-01', status: 'confirmed' });
    expect(result.data_quality.filters.market_id).toBeUndefined();
    expect(mockPaidSales).toHaveBeenCalledTimes(1);
    expect(mockPaidSales).toHaveBeenCalledWith(filters,market);
    expect(result.kpis_global).toHaveLength(5);
    expect(result.kpis_global[0]).toMatchObject({key:'ca_encaisse',unit:'XAF',data_quality:{metric_id:'commerce.paid_sales_wallet_included'}});
    expect(result.decision_clocks.flow.metric_id).toBe('commerce.paid_sales_wallet_included');
    expect(result.decision_clocks).toMatchObject({stock:{basis:'current_active_orders',simulation_scope:null},flow:{basis:'orders.created_at',from:'2026-08-01',to:null},economic:{basis:'utc_calendar_month',metric_id:'eco.period_result'}});
    expect(JSON.stringify(result.decision_clocks)).not.toContain(market.id);
    expect(result.kpis_global).toContainEqual(expect.objectContaining({key:'economic_period_result',value:null,data_quality:expect.objectContaining({status:'MARKET_RESULT_NOT_RECONCILED'})}));
    expect(result.view_blocks).toHaveLength(3);
    expect(mockControlChain).toHaveBeenCalledWith({ market });
    expect(result.view_blocks.map(block => block.url)).toEqual([
      '/admin/pilotage',
      '/admin/finance',
      '/admin/operations',
    ]);
    expect(result.economic_flow.stages.map(stage => stage.url)).toEqual([
      '/admin/workspaces/pricing',
      '/admin/operations',
      '/admin/operations',
      '/admin/operations#operations-control-chain',
      '/admin/costing',
      '/admin/workspaces/pricing',
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


describe('lot 7 — signaux de commandes simulées exclus (services/dashboard-pilotage-market.js)', () => {
  test('le lecteur de signaux applique le prédicat réel/RCT1 canonique', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'services/dashboard-pilotage-market.js'), 'utf8');
    expect(src).toMatch(/require\('[^']*signal-simulation-scope'\)/);
    expect(src).toMatch(/\$\{EXCLUDE_SIMULATED_ORDER_SIGNALS_SQL\}/);
  });
});

test('market Pilotage consumes authorized scoped ECO result without fallback to legacy margin',async()=>{
  const market={id:'market-cm-id',code:'CM',currency:'XAF'};
  const actor={id:'member',role:'market_operator'};
  const read=require('../../services/economic-cost-center-read-model').readMarketPeriodDecision;
  read.mockResolvedValueOnce({status:'PROVISIONAL',reasons:[],display:{result:'12000',fxStatus:'GOVERNED_KMF_PROJECTION'}});
  const result=await pilotage.buildMarketPilotage({market_id:market.id},market,actor);
  expect(read).toHaveBeenCalledWith(actor,'CM',expect.stringMatching(/^\d{4}-\d{2}-01$/));
  expect(result.kpis_global).toContainEqual(expect.objectContaining({key:'economic_period_result',value:'12000',unit:'XAF'}));
  read.mockRejectedValueOnce(Object.assign(new Error('denied'),{status:403}));
  const denied=await pilotage.buildMarketPilotage({market_id:market.id},market,actor);
  expect(denied.kpis_global).toContainEqual(expect.objectContaining({key:'economic_period_result',value:null,data_quality:expect.objectContaining({status:'UNAVAILABLE'})}));
});
