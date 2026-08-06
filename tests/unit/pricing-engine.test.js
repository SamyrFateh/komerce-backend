'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/pricing-cdr', () => ({
  loadGlobalConfig: jest.fn(),
  computeCDR: jest.fn(),
  computeFixedCostAllocation: jest.fn(),
}));
jest.mock('../../services/pricing-output', () => ({
  HEALTH_THRESHOLDS: { LOSS: 0 },
  MARKET_THRESHOLDS: { TESTING_MIN_SALES: 1, VALIDATED_MIN_SALES: 5, SCALING_MIN_SALES: 20, REJECTED_DAYS_NOSALE: 30 },
  computePrices: jest.fn(),
  computeScenarios: jest.fn(),
  computeStrategies: jest.fn(),
  buildProportions: jest.fn(),
  computeHealthStatus: jest.fn(),
  computeSourcingDecision: jest.fn(),
  buildAlerts: jest.fn(),
  buildRecommendationText: jest.fn(),
  buildCostBreakdown: jest.fn(),
  buildDataQuality: jest.fn(),
  inferSubjectType: jest.fn(),
}));

const db = require('../../db');
const cdr = require('../../services/pricing-cdr');
const out = require('../../services/pricing-output');
const engine = require('../../services/pricing-engine');

describe('pricing-engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cdr.loadGlobalConfig.mockResolvedValue(baseConfig());
    cdr.computeCDR.mockReturnValue(baseCdr());
    out.computePrices.mockReturnValue({
      survival_price_kmf: 1000,
      minimum_safe_price_kmf: 1800,
      recommended_price_kmf: 3000,
      test_price_kmf: 2500,
      target_margin_pct: 40,
      safety_margin_pct: 15,
    });
    out.computeScenarios.mockReturnValue([{ id: 'honest_baseline' }]);
    out.computeStrategies.mockReturnValue({ mechanical: { price_kmf: 3000 } });
    out.buildProportions.mockReturnValue({ families: [] });
    out.computeHealthStatus.mockReturnValue('healthy');
    out.computeSourcingDecision.mockReturnValue('PRIORITY');
    out.buildAlerts.mockReturnValue([{ code: 'ok' }]);
    out.buildRecommendationText.mockReturnValue('Bonne recommandation');
    out.buildCostBreakdown.mockReturnValue({
      landed_relay: { product_purchase: 1000, freight: 200, customs: 100, local_distribution: 50, relay: 0 },
      business: { payment: 30, risk_provision: 20, fixed_overhead: 100 },
      landed_relay_cost_kmf: 1350,
      business_complete_cost_kmf: 1500,
    });
    out.buildDataQuality.mockReturnValue({ confidence: 'high' });
    out.inferSubjectType.mockReturnValue('catalog_product');
  });

  function baseConfig() {
    return {
      finance: { avg_articles_per_order: 2.5, avg_articles_per_parcel: 4, avg_articles_per_shipment: 200, allocation_confidence: 'medium', target_marge_brute_pct: 40 },
      categories: { food: { target_marge_brute_pct: 40 }, phones: { target_marge_brute_pct: 35 } },
      charges: [],
      cost_benchmarks: [{ category: 'all', cost_family: 'freight', expected_share_pct: 10, warn_ratio: 1.3, alert_ratio: 1.6 }],
    };
  }

  function baseCdr() {
    return {
      cost_complete_estimated_kmf: 1500,
      variable_cost_estimated_kmf: 1400,
      fixed_cost_allocation_kmf: 100,
      risk_provision_estimated_kmf: 20,
      monthly_fixed_costs_kmf: 10000,
      target_orders_per_month: 100,
      warnings: [],
      details: { _allocations: [{ cost_type: 'freight' }], product_cost: 1000, freight: 200, customs: 100, local_distribution: 50, payment: 30, risks: 20, fixed_costs: 100 },
    };
  }

  it('computeMarketConfidence retourne unknown sans productId sans acces DB', async () => {
    const result = await engine.computeMarketConfidence(null);

    expect(result.market_confidence).toBe('unknown');
    expect(result.market_signals.paid_orders_count).toBe(0);
    expect(result.warnings[0]).toContain('Données marché insuffisantes');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('computeMarketConfidence classe testing/validated/scaling/rejected et signaux repeat', async () => {
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    db.query
      .mockResolvedValueOnce({ rows: [{ paid_orders: '2', unique_buyers: '1', first_sale_at: new Date(Date.now() - 35 * 86400000).toISOString() }] })
      .mockResolvedValueOnce({ rows: [{ created_at: old }] });

    const result = await engine.computeMarketConfidence('prod-001');

    expect(result.market_confidence).toBe('testing');
    expect(result.market_signals.repeat_purchase_signal).toBe(true);
    expect(result.market_signals.days_since_publication).toBeGreaterThanOrEqual(39);
    expect(result.market_signals.days_to_first_sale).toBeGreaterThanOrEqual(4);
  });

  it('computeMarketConfidence retourne unknown avec warning si DB echoue', async () => {
    db.query.mockRejectedValueOnce(new Error('db_down'));

    const result = await engine.computeMarketConfidence('prod-001');

    expect(result.market_confidence).toBe('unknown');
    expect(result.warnings[0]).toContain('db_down');
  });

  it('recommend orchestre produit DB, CDR, prix, santé, marché et sortie canonique', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'prod-001', category: 'food', cost_kmf: 900, weight_kg: 1.2, price_kmf: 2400 }] })
      .mockResolvedValueOnce({ rows: [{ paid_orders: '6', unique_buyers: '6', first_sale_at: new Date().toISOString() }] })
      .mockResolvedValueOnce({ rows: [{ created_at: new Date().toISOString() }] });

    const result = await engine.recommend({ product_id: 'prod-001' });

    expect(cdr.loadGlobalConfig).toHaveBeenCalledTimes(1);
    expect(cdr.computeCDR).toHaveBeenCalledWith(expect.objectContaining({ id: 'prod-001', category: 'food', cost_kmf: 900, weight_kg: 1.2, price_kmf: 2400 }), expect.objectContaining({ channel: 'cash_relais' }));
    expect(out.computePrices).toHaveBeenCalledWith(baseCdr(), { target_marge_brute_pct: 40 }, expect.objectContaining({ target_marge_brute_pct: 40 }));
    expect(out.computeHealthStatus).toHaveBeenCalledWith(2400, 1500, expect.any(Number));
    expect(out.computeSourcingDecision).toHaveBeenCalledWith({ health_status: 'healthy', market_confidence: 'validated', weight_kg: 1.2 });
    expect(result).toMatchObject({
      subject_type: 'catalog_product',
      product_id: 'prod-001',
      category: 'food',
      n1_landed_relay_cost_kmf: 1350,
      n2_business_variable_cost_kmf: 50,
      variable_cost_complete_kmf: 1400,
      n3_fixed_overhead_allocation_kmf: 100,
      cdr_complete_kmf: 1500,
      recommended_price_kmf: 3000,
      final_price_kmf: 3000,
      pricing_strategy: 'mechanical',
      strategy_risk: 'covered',
      market_confidence: 'validated',
      sourcing_decision: 'PRIORITY',
      data_quality: { confidence: 'high' },
    });
  });

  it('recommend applique les overrides finance sans muter la config passee', async () => {
    const config = baseConfig();

    await engine.recommend({
      category: 'food', cost_kmf: 1000, weight_kg: 1, current_price_kmf: 1800,
      finance_overrides: { target_orders_per_month: 50 },
      monthly_fixed_costs_kmf: 20000,
      pricing_strategy: 'manual',
      final_price_kmf: 1300,
    }, { config });

    expect(config.finance.target_orders_per_month).toBeUndefined();
    const ctx = cdr.computeCDR.mock.calls[0][1];
    expect(ctx.config.finance.target_orders_per_month).toBe(50);
    expect(ctx.config.charges).toEqual([{ recurrence_period: 'monthly', amount_kmf: 20000, is_active: true }]);
  });

  it('recommend classe strategy_risk destructive ou undercovered selon prix final', async () => {
    await expect(engine.recommend({ category: 'food', cost_kmf: 1000, current_price_kmf: 0, pricing_strategy: 'manual', final_price_kmf: 1300 }, { config: baseConfig() }))
      .resolves.toMatchObject({ strategy_risk: 'destructive' });
    await expect(engine.recommend({ category: 'food', cost_kmf: 1000, current_price_kmf: 0, pricing_strategy: 'manual', final_price_kmf: 1450 }, { config: baseConfig() }))
      .resolves.toMatchObject({ strategy_risk: 'undercovered' });
  });
});
