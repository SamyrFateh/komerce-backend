'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockRecommend = jest.fn();
const mockRecommendBatch = jest.fn();
jest.mock('../../services/pricing-recommend', () => ({
  computeRecommend: (...args) => mockRecommend(...args),
  computeRecommendBatch: (...args) => mockRecommendBatch(...args),
}));

const mockFlow = jest.fn();
const mockLoadGlobalConfig = jest.fn();
jest.mock('../../services/pricing-engine', () => ({
  recommend: (...args) => mockFlow(...args),
  loadGlobalConfig: (...args) => mockLoadGlobalConfig(...args),
}));

const mockRates = jest.fn();
jest.mock('../../services/pricing-rates', () => ({ getCurrentRates: (...args) => mockRates(...args) }));

const mockApplyPrice = jest.fn();
jest.mock('../../services/pricing-apply', () => ({ applyPrice: (...args) => mockApplyPrice(...args) }));

const mockGetStrategy = jest.fn();
const mockGetCompetitors = jest.fn();
const mockApplyStrategy = jest.fn();
const mockAddCompetitor = jest.fn();
const mockSoftDeleteCompetitor = jest.fn();
jest.mock('../../services/pricing-strategy-service', () => ({
  getStrategy: (...args) => mockGetStrategy(...args),
  getCompetitors: (...args) => mockGetCompetitors(...args),
  applyStrategy: (...args) => mockApplyStrategy(...args),
  addCompetitor: (...args) => mockAddCompetitor(...args),
  softDeleteCompetitor: (...args) => mockSoftDeleteCompetitor(...args),
}));

const mockListComponents = jest.fn();
const mockCreateComponent = jest.fn();
const mockUpdateComponent = jest.fn();
const mockToggleComponent = jest.fn();
jest.mock('../../services/cost-component-admin-service', () => ({
  META: { families: ['landed_relay'] },
  listComponents: (...args) => mockListComponents(...args),
  createComponent: (...args) => mockCreateComponent(...args),
  updateComponent: (...args) => mockUpdateComponent(...args),
  toggleComponent: (...args) => mockToggleComponent(...args),
}));

const mockEconomicExecutive = jest.fn();
const mockEconomicVariables = jest.fn();
const mockEconomicCharges = jest.fn();
jest.mock('../../services/economic-engine-queries', () => ({
  buildExecutiveSummary: (...args) => mockEconomicExecutive(...args),
  getVariables: (...args) => mockEconomicVariables(...args),
  getCharges: (...args) => mockEconomicCharges(...args),
}));

const workspace = require('../../services/pricing-workspace');

beforeEach(() => {
  jest.clearAllMocks();
  mockRates.mockResolvedValue({ eur_kmf: 492, aed_kmf: 138 });
  mockListComponents.mockResolvedValue({ components: [], grouped: {}, count: 0 });
  mockRecommendBatch.mockResolvedValue({ items: [] });
  mockEconomicExecutive.mockResolvedValue({ status: 'stable', kpis: [], internal_id: 'hidden-exec' });
  mockEconomicVariables.mockResolvedValue({ categories: {}, source_of_truth: 'finance_config' });
  mockEconomicCharges.mockResolvedValue({ families: {}, totals: {} });
});

test('product_ref est résolu côté serveur', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'internal-product', product_ref: 'KPR-000001' }] });
  await expect(workspace.resolveProductRef('KPR-000001')).resolves.toEqual(expect.objectContaining({ id: 'internal-product', product_ref: 'KPR-000001' }));
  expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('product_ref = $1'), ['KPR-000001']);
});

test('simulation convertit product_ref en id uniquement pour le moteur', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'internal-product', product_ref: 'KPR-000001' }] });
  mockRecommend.mockResolvedValueOnce({ product_id: 'internal-product', recommended_price_kmf: 5000 });
  const result = await workspace.simulate({ product_ref: 'KPR-000001', channel: 'cash_relais' });
  expect(mockRecommend).toHaveBeenCalledWith({ product_id: 'internal-product', channel: 'cash_relais' });
  expect(result).toEqual({ recommended_price_kmf: 5000 });
});

test('simulation impact utilise le même moteur avant/après sans persister', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'internal-product', product_ref: 'KPR-000001', name: 'Phone', category: 'phones',
    price_kmf: 8000, cost_kmf: 3000, weight_kg: 1, volume_m3: 0.01,
  }] });
  mockLoadGlobalConfig.mockResolvedValueOnce({
    finance: {}, categories: {}, provisions: [], charges: [], cost_benchmarks: [],
    components: [{ key: 'freight', label: 'Fret', family: 'landed_relay', category: 'freight', default_value: 1000, unit: 'kmf', source: 'default', confidence: 'medium' }],
  });
  mockFlow
    .mockResolvedValueOnce({ n1_landed_relay_cost_kmf: 5000, n2_business_variable_cost_kmf: 500, n3_fixed_overhead_allocation_kmf: 700, variable_cost_complete_kmf: 5500, cdr_complete_kmf: 6200, contribution_kmf: 2500, minimum_safe_price_kmf: 5500, recommended_price_kmf: 8000, final_price_kmf: 8000 })
    .mockResolvedValueOnce({ n1_landed_relay_cost_kmf: 5500, n2_business_variable_cost_kmf: 500, n3_fixed_overhead_allocation_kmf: 700, variable_cost_complete_kmf: 6000, cdr_complete_kmf: 6700, contribution_kmf: 2500, minimum_safe_price_kmf: 6000, recommended_price_kmf: 8500, final_price_kmf: 8500 });

  const result = await workspace.simulateImpact({
    product_ref: 'KPR-000001',
    overrides: [{ key: 'freight', default_value: 1500 }],
  });

  expect(mockFlow).toHaveBeenCalledTimes(2);
  expect(mockFlow.mock.calls[0][1].config.components[0].default_value).toBe(1000);
  expect(mockFlow.mock.calls[1][1].config.components[0].default_value).toBe(1500);
  expect(result.persisted).toBe(false);
  expect(result.source_of_truth).toBe('pricing-engine');
  expect(result.delta.n1_landed_relay_cost_kmf).toBe(500);
  expect(result.delta.recommended_price_kmf).toBe(500);
  expect(result.overrides[0]).toMatchObject({ key: 'freight', before: 1000, after: 1500, delta: 500 });
});

test('simulation impact marché charge le modèle effectif côté serveur', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'internal-product', product_ref: 'KPR-000001', category: 'phones', cost_kmf: 3000 }] });
  mockLoadGlobalConfig.mockResolvedValueOnce({ finance: {}, categories: {}, provisions: [], charges: [], cost_benchmarks: [], components: [] });
  mockFlow.mockResolvedValue({});

  await workspace.simulateImpact({ product_ref: 'KPR-000001', overrides: [] }, { id: 'market-cm', code: 'CM' });
  expect(mockLoadGlobalConfig).toHaveBeenCalledWith({ marketId: 'market-cm' });
});

test('simulation impact refuse lignes dupliquées, inconnues et valeurs négatives', async () => {
  expect(() => workspace.normalizeSimulationOverrides([{ key: 'freight', default_value: -1 }])).toThrow(expect.objectContaining({ code: 'pricing_simulation_override_value_invalid' }));
  expect(() => workspace.normalizeSimulationOverrides([{ key: 'freight', default_value: 1 }, { key: 'freight', default_value: 2 }])).toThrow(expect.objectContaining({ code: 'pricing_simulation_override_duplicate' }));
  expect(() => workspace.applySimulationOverrides({ components: [] }, [{ key: 'missing', default_value: 1 }])).toThrow(expect.objectContaining({ code: 'pricing_simulation_component_not_active' }));
});

test('apply price délègue à pricing-apply et n’expose pas id', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'internal-product', product_ref: 'KPR-000001' }] });
  mockApplyPrice.mockResolvedValueOnce({ status: 200, body: { old_price_kmf: 4000, new_price_kmf: 5000, product: { id: 'internal-product' } } });
  const result = await workspace.applyPrice('KPR-000001', { price_kmf: 5000 }, { id: 'admin-1' });
  expect(mockApplyPrice).toHaveBeenCalledWith('internal-product', { price_kmf: 5000 }, 'admin-1');
  expect(result).toEqual(expect.objectContaining({ product_ref: 'KPR-000001', old_price_kmf: 4000, new_price_kmf: 5000 }));
  expect(JSON.stringify(result)).not.toContain('internal-product');
});

test('competitor_ref est résolue avant désactivation', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'internal-comp', competitor_ref: 'KPC-000001' }] });
  await workspace.deactivateCompetitor('KPC-000001');
  expect(mockSoftDeleteCompetitor).toHaveBeenCalledWith(expect.anything(), 'internal-comp');
});

test('clé cost component reste la référence Canonical', async () => {
  mockUpdateComponent.mockResolvedValueOnce({ id: 'internal-cc', key: 'freight_air', default_value: 1200 });
  const result = await workspace.updateCostComponent('freight_air', { default_value: 1200 }, { id: 'admin-1' });
  expect(mockUpdateComponent).toHaveBeenCalledWith({ key: 'freight_air' }, { default_value: 1200 }, 'admin-1');
  expect(result).toEqual({ key: 'freight_air', default_value: 1200 });
});

test('stripInternalIds retire les identifiants internes récursivement', () => {
  expect(workspace.stripInternalIds({
    id: 'x', product_id: 'p', competitor_id: 'c', keep: 1,
    nested: { component_id: 'cc', label: 'ok' },
  })).toEqual({ keep: 1, nested: { label: 'ok' } });
});

test('workspace absorbe la vérité économique globale sans exposer les ids internes', async () => {
  mockQuery.mockImplementation(async sql => {
    const source = String(sql);
    if (source.includes('FROM products')) return { rows: [] };
    if (source.includes('FROM competitor_prices')) return { rows: [{ count: 0 }] };
    return { rows: [] };
  });
  mockEconomicExecutive.mockResolvedValueOnce({ status: 'surveiller', kpis: [{ key: 'seuil_rentabilite', value: 42000, unit: 'KMF' }], internal_id: 'exec-internal' });
  mockEconomicVariables.mockResolvedValueOnce({ categories: { pricing: { label: 'Pricing', variables: [{ id: 'var-internal', key: 'target_basket', value_used: 50000, unit: 'KMF' }] } } });
  mockEconomicCharges.mockResolvedValueOnce({ families: { operationnelle: { label: 'Opérationnelle', charges: [{ id: 'charge-internal', name: 'Hub Dubai', amount_kmf: 400, is_active: true }] } } });

  const result = await workspace.buildWorkspace();

  expect(mockEconomicExecutive).toHaveBeenCalledTimes(1);
  expect(mockEconomicVariables).toHaveBeenCalledTimes(1);
  expect(mockEconomicCharges).toHaveBeenCalledTimes(1);
  expect(result.economic).toMatchObject({ scope: 'global_pricing', source_of_truth: 'economic-engine', executive: { status: 'surveiller' } });
  expect(JSON.stringify(result.economic)).not.toMatch(/exec-internal|var-internal|charge-internal/);
});
