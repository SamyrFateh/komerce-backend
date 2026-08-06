'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));

const db = require('../../db');
const {
  loadGlobalConfig,
  computeFixedCostAllocation,
  computeCDR,
  _legacyFamilyFromCategory,
  _legacyCategoryToNew,
} = require('../../services/pricing-cdr');

describe('pricing-cdr', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mappe les categories legacy vers familles/cost types modernes', () => {
    expect(_legacyFamilyFromCategory('paiement')).toBe('business');
    expect(_legacyFamilyFromCategory('douane')).toBe('landed_relay');
    expect(_legacyCategoryToNew('sourcing')).toBe('sourcing');
    expect(_legacyCategoryToNew('transit')).toBe('freight');
    expect(_legacyCategoryToNew('douane', 'frais transitaire')).toBe('port_transitary');
    expect(_legacyCategoryToNew('douane', 'droit douane')).toBe('customs');
    expect(_legacyCategoryToNew('hub', 'packaging carton')).toBe('packaging');
    expect(_legacyCategoryToNew('distribution', 'commission relais')).toBe('relay');
    expect(_legacyCategoryToNew('distribution', 'transport local')).toBe('local_distribution');
    expect(_legacyCategoryToNew('paiement')).toBe('payment');
  });

  it('loadGlobalConfig charge cost_components puis finance/categories/provisions/charges/benchmarks', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ key: 'freight', category: 'freight', family: 'landed_relay' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, objectif_commandes_mois: 100 }] })
      .mockResolvedValueOnce({ rows: [{ key: 'food', douane_pct: 5 }] })
      .mockResolvedValueOnce({ rows: [{ rate_pct: 2 }] })
      .mockResolvedValueOnce({ rows: [{ amount_kmf: 1000, recurrence_period: 'monthly' }] })
      .mockResolvedValueOnce({ rows: [{ category: 'all', cost_family: 'freight' }] });

    const cfg = await loadGlobalConfig();

    expect(cfg.components_source).toBe('cost_components');
    expect(cfg.components).toEqual([{ key: 'freight', category: 'freight', family: 'landed_relay' }]);
    expect(cfg.categories.food).toEqual({ key: 'food', douane_pct: 5 });
    expect(cfg.provisions).toEqual([{ rate_pct: 2 }]);
    expect(cfg.cost_benchmarks).toEqual([{ category: 'all', cost_family: 'freight' }]);
  });

  it('loadGlobalConfig fallback sur pricing_components legacy si cost_components absent', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ key: 'stripe_fee', category: 'paiement', default_value: 2, is_active: true }] })
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('no benchmarks'));

    const cfg = await loadGlobalConfig();

    expect(cfg.components_source).toBe('pricing_components_legacy');
    expect(cfg.components[0]).toMatchObject({ key: 'stripe_fee', family: 'business', category: 'payment', scope: 'global', is_exceptional: false });
    expect(cfg.cost_benchmarks).toEqual([]);
  });

  it('computeFixedCostAllocation impute les charges fixes par article avec warning si objectif absent', () => {
    const result = computeFixedCostAllocation([
      { recurrence_period: 'monthly', amount_kmf: 10000 },
      { recurrence_period: 'weekly', amount_kmf: 1000 },
      { recurrence_period: 'yearly', amount_kmf: 12000 },
      { recurrence_period: 'per_order', amount_kmf: 500 },
    ], { avg_articles_per_order: 2 });

    expect(result.target_orders_per_month).toBe(100);
    expect(result.monthly_fixed_costs_kmf).toBe(15330);
    expect(result.fixed_cost_allocation_kmf).toBe(Math.round(((15330 / 100) + 500) / 2));
    expect(result.warnings[0]).toContain('objectif_commandes_mois absent');
  });

  it('computeCDR calcule CDR complet avec composants, douane categorie, risque et fixe', () => {
    const cfg = {
      finance: { taux_change_eur_kmf: 500, fret_eur_per_m3: 100, objectif_commandes_mois: 10, avg_articles_per_order: 2, allocation_confidence: 'high' },
      categories: { food: { douane_pct: 5, tva_pct: 10, taxe_add_pct: 0 } },
      components: [
        { key: 'sourcing_fee', category: 'sourcing', unit: 'kmf', default_value: 100, scope: 'global' },
        { key: 'hub_pct', category: 'hub', unit: 'pct', default_value: 10, scope: 'global' },
        { key: 'stripe_fee', category: 'payment', unit: 'pct', default_value: 5, scope: 'global', channel: 'diaspora' },
        { key: 'cash_fee', category: 'payment', unit: 'kmf', default_value: 50, scope: 'global', channel: 'cash_relais' },
        { key: 'order_fee', category: 'local_distribution', unit: 'kmf_per_order', default_value: 400, scope: 'global' },
      ],
      provisions: [{ rate_pct: 2 }],
      charges: [{ recurrence_period: 'monthly', amount_kmf: 10000 }],
    };

    const result = computeCDR({ category: 'food', cost_kmf: 1000, weight_kg: 1 }, { config: cfg, volume_m3: 0.1, channel: 'cash_relais' });

    expect(result.details.product_cost).toBe(1000);
    expect(result.details.freight).toBe(5000);
    expect(result.details.sourcing).toBe(100);
    expect(result.details.payment).toBe(50);
    expect(result.details.fixed_costs).toBe(500);
    expect(result.details.customs).toBe(900);
    expect(result.risk_provision_estimated_kmf).toBeGreaterThan(0);
    expect(result.cost_complete_estimated_kmf).toBe(result.variable_cost_estimated_kmf + result.fixed_cost_allocation_kmf);
    expect(result._meta).toMatchObject({ taxEUR: 500, fretEUR: 100, category: 'food', channel: 'cash_relais' });
  });

  it('computeCDR signale categorie inconnue, cout absent et allocation non calibree', () => {
    const cfg = {
      finance: { allocation_confidence: 'low' },
      categories: {},
      components: [{ key: 'parcel_fee', category: 'local_distribution', unit: 'kmf_per_parcel', default_value: 400, scope: 'global' }],
      provisions: [],
      charges: [],
    };

    const result = computeCDR({ category: 'unknown', cost_kmf: 0 }, { config: cfg });

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Catégorie "unknown" inconnue'),
      expect.stringContaining('cost_kmf absent'),
      expect.stringContaining('Moyennes d\'allocation non calibrées'),
    ]));
  });
});
