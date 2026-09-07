'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const workspace = require('../../services/pricing-workspace');

beforeEach(() => {
  jest.clearAllMocks();
});

test('alias historique port_transitary reste explicitement relié au réel port_transitaire', () => {
  expect(workspace.realCostTypeForComponent({ category: 'port_transitary' })).toBe('port_transitaire');
  expect(workspace.REAL_COST_TYPE_BY_CATEGORY.port_transitary).toBe('port_transitaire');
});

test('projection marché compare une hypothèse KMF au réel normalisé et calcule tendance + maturité', () => {
  const component = {
    key: 'freight_sea',
    category: 'freight',
    family: 'landed_relay',
    default_value: 1500,
    unit: 'kmf',
    allocation_method: 'per_item',
    scope: 'global',
  };
  const rows = [
    {
      cost_type: 'freight', bucket: 'recent', total_kmf: 17200, quantity: 10,
      allocations_count: 10, orders_count: 8, items_count: 10, parcels_count: 4, shipments_count: 2,
      last_observed_at: '2026-09-04T10:00:00.000Z', confidence_rank: 3, sources: 'customs_shipments, parcel_delivery',
    },
    {
      cost_type: 'freight', bucket: 'previous', total_kmf: 15000, quantity: 10,
      allocations_count: 8, orders_count: 6, items_count: 10, parcels_count: 4, shipments_count: 2,
      last_observed_at: '2026-08-04T10:00:00.000Z', confidence_rank: 3, sources: 'customs_shipments',
    },
  ];

  const result = workspace.projectCostObservation(component, rows, {
    marketId: 'market-cm', marketCode: 'CM', now: new Date('2026-09-06T12:00:00.000Z'),
  });

  expect(result.source_of_truth).toBe('order_item_real_cost_allocations');
  expect(result.source_scope).toBe('market');
  expect(result.observed).toMatchObject({ value: 1720, unit: 'kmf', comparable: true, confidence: 'high' });
  expect(result.variance.value).toBe(220);
  expect(result.variance.pct).toBeCloseTo(14.67, 2);
  expect(result.trend).toMatchObject({ direction: 'up', pct: 14.67, recent_value: 1720, previous_value: 1500 });
  expect(result.maturity).toMatchObject({ state: 'mature', decisional: true });
  expect(result.simulation_candidate_value).toBe(1720);
  expect(result.automatic_application_allowed).toBe(false);
});

test('un taux configuré ne produit aucun faux delta face à des KMF réels', () => {
  const result = workspace.projectCostObservation({
    key: 'payment_rate', category: 'payment', family: 'business', default_value: 3.5, unit: 'pct', allocation_method: 'by_value',
  }, [{
    cost_type: 'payment', bucket: 'recent', total_kmf: 5000, quantity: 20,
    allocations_count: 7, orders_count: 7, items_count: 20, parcels_count: 0, shipments_count: 0,
    last_observed_at: '2026-09-05T10:00:00.000Z', confidence_rank: 3, sources: 'stripe_charge',
  }], { marketId: 'market-cm', marketCode: 'CM', now: new Date('2026-09-06T12:00:00.000Z') });

  expect(result.observed.comparable).toBe(false);
  expect(result.observed.comparison_reason).toBe('unit_requires_matching_real_denominator');
  expect(result.variance).toMatchObject({ value: null, pct: null, comparable: false });
  expect(result.simulation_candidate_value).toBeNull();
});

test('N3 et provision de risque restent des vérités de période, jamais des réels SKU automatiques', () => {
  for (const category of ['fixed_overhead', 'risk_provision']) {
    const normalized = workspace.normalizeObservedValue({ category, unit: 'kmf' }, {
      total_kmf: 10000, quantity: 10, orders_count: 5,
    });
    expect(normalized).toMatchObject({ comparable: false, reason: 'period_truth_required' });

    const maturity = workspace.observationMaturity({ category }, { allocations_count: 12 }, normalized, { marketScoped: true });
    expect(maturity).toMatchObject({ state: 'period_required', decisional: false });
  }
});

test('agrégat groupe reste informatif même quand le signal est mature', () => {
  const component = { category: 'freight', default_value: 1000, unit: 'kmf', allocation_method: 'per_item' };
  const rows = [{
    cost_type: 'freight', bucket: 'recent', total_kmf: 12000, quantity: 10,
    allocations_count: 12, orders_count: 10, items_count: 10, parcels_count: 4, shipments_count: 2,
    last_observed_at: '2026-09-05T10:00:00.000Z', confidence_rank: 3, sources: 'customs_shipments',
  }];
  const result = workspace.projectCostObservation(component, rows, { now: new Date('2026-09-06T12:00:00.000Z') });
  expect(result.maturity.state).toBe('mature');
  expect(result.maturity.decisional).toBe(false);
  expect(result.maturity.note).toMatch(/Agrégat groupe informatif/);
});

test('lecture terrain marché est scoppée par orders.market_id et exclut les fallbacks estimés', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  await workspace.loadObservedCostRows({ marketId: 'market-cm' });
  expect(mockQuery).toHaveBeenCalledTimes(1);
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain('a.is_actual = TRUE');
  expect(sql).toContain('o.market_id = $4');
  expect(params).toEqual([90, 30, 60, 'market-cm']);
});

test('UI expose le réel, la preuve et le bouton de simulation sans application automatique', () => {
  const root = path.join(__dirname, '..', '..');
  const canonical = path.join(root, 'public', 'dashboards', 'canonical');
  const index = fs.readFileSync(path.join(canonical, 'index.html'), 'utf8');
  const simulation = fs.readFileSync(path.join(canonical, 'js', 'pricing-workspace-simulation.js'), 'utf8');
  const css = fs.readFileSync(path.join(canonical, 'css', 'pricing-simulation.css'), 'utf8');

  expect(index).toContain('pricing-workspace-simulation.js?v=1217');
  expect(index).toContain('pricing-simulation.css?v=1217');
  expect(simulation).toContain('Réel terrain');
  expect(simulation).toContain('Dernière preuve');
  expect(simulation).toContain('Tester ce réel dans le scénario');
  expect(simulation).toContain('observed_real_never_auto_applies');
  expect(css).toContain('.kmc-observed-cost');
  expect(css).toContain('.kmc-observed-maturity');
});
