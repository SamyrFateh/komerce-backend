'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const mockLoadGlobalConfig = jest.fn();
const mockRecommend = jest.fn();
jest.mock('../../services/pricing-engine', () => ({
  loadGlobalConfig: (...args) => mockLoadGlobalConfig(...args),
  recommend: (...args) => mockRecommend(...args),
}));

const simulation = require('../../services/pricing-impact-simulation');

function config() {
  return {
    finance: {},
    categories: { phones: { key: 'phones' } },
    components: [
      { key: 'freight', label: 'Fret', family: 'landed_relay', category: 'freight', default_value: 1000, unit: 'kmf', source: 'default', confidence: 'medium' },
      { key: 'payment', label: 'Paiement', family: 'business', category: 'payment', default_value: 2, unit: 'pct', source: 'default', confidence: 'medium' },
    ],
    provisions: [], charges: [], cost_benchmarks: [],
  };
}

function engineResult(n1, n2, n3, recommended) {
  return {
    n1_landed_relay_cost_kmf: n1,
    n2_business_variable_cost_kmf: n2,
    variable_cost_complete_kmf: n1 + n2,
    contribution_kmf: recommended - (n1 + n2),
    n3_fixed_overhead_allocation_kmf: n3,
    cdr_complete_kmf: n1 + n2 + n3,
    minimum_safe_price_kmf: n1 + n2,
    recommended_price_kmf: recommended,
    final_price_kmf: recommended,
    estimated_margin_pct: 20,
    monthly_break_even_orders: 10,
    strategy_risk: 'covered',
    health_status: 'healthy',
    pricing_strategy: 'mechanical',
    data_quality: { confidence: 'medium' },
    warnings: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadGlobalConfig.mockResolvedValue(config());
  mockRecommend
    .mockResolvedValueOnce(engineResult(5000, 500, 700, 8000))
    .mockResolvedValueOnce(engineResult(5500, 500, 700, 8500));
});

test('simule avant/après avec le même moteur sans persistance', async () => {
  const result = await simulation.simulate({
    product: { product_ref: 'KPR-1', name: 'Phone', category: 'phones', cost_kmf: 3000, weight_kg: 1, volume_m3: 0.01, price_kmf: 8000 },
    body: { overrides: [{ key: 'freight', default_value: 1500 }] },
  });

  expect(mockRecommend).toHaveBeenCalledTimes(2);
  expect(mockRecommend.mock.calls[0][1].config.components[0].default_value).toBe(1000);
  expect(mockRecommend.mock.calls[1][1].config.components[0].default_value).toBe(1500);
  expect(result.persisted).toBe(false);
  expect(result.source_of_truth).toBe('pricing-engine');
  expect(result.delta.n1_landed_relay_cost_kmf).toBe(500);
  expect(result.delta.recommended_price_kmf).toBe(500);
  expect(result.overrides[0]).toMatchObject({ key: 'freight', before: 1000, after: 1500, delta: 500 });
  expect(result.overrides[0].explainability.impact.layer).toBe('N1');
});

test('charge le modèle effectif du marché côté serveur', async () => {
  await simulation.simulate({
    product: { product_ref: 'KPR-1', category: 'phones', cost_kmf: 3000, price_kmf: 8000 },
    market: { id: 'market-cm', code: 'CM' },
    body: { overrides: [] },
  });
  expect(mockLoadGlobalConfig).toHaveBeenCalledWith({ marketId: 'market-cm' });
});

test('refuse une ligne inconnue au lieu de l’ignorer', async () => {
  await expect(simulation.simulate({
    product: { product_ref: 'KPR-1', category: 'phones', cost_kmf: 3000 },
    body: { overrides: [{ key: 'inconnue', default_value: 5 }] },
  })).rejects.toMatchObject({ status: 400, code: 'pricing_simulation_component_not_active' });
  expect(mockRecommend).not.toHaveBeenCalled();
});

test('refuse valeur négative, doublon et volume excessif', () => {
  expect(() => simulation.normalizeOverrides([{ key: 'freight', default_value: -1 }]))
    .toThrow(expect.objectContaining({ code: 'pricing_simulation_override_value_invalid' }));
  expect(() => simulation.normalizeOverrides([{ key: 'freight', default_value: 1 }, { key: 'freight', default_value: 2 }]))
    .toThrow(expect.objectContaining({ code: 'pricing_simulation_override_duplicate' }));
  expect(() => simulation.normalizeOverrides(Array.from({ length: 21 }, (_, index) => ({ key: `k${index}`, default_value: 1 }))))
    .toThrow(expect.objectContaining({ code: 'pricing_simulation_too_many_overrides' }));
});

test('cloneConfig ne mute jamais la baseline partagée', () => {
  const base = config();
  const clone = simulation.cloneConfig(base);
  clone.components[0].default_value = 9999;
  clone.finance.objectif_commandes_mois = 50;
  expect(base.components[0].default_value).toBe(1000);
  expect(base.finance.objectif_commandes_mois).toBeUndefined();
});
