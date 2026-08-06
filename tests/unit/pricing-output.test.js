'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  computePrices,
  computeHealthStatus,
  computeSourcingDecision,
  buildAlerts,
  buildRecommendationText,
  buildCostBreakdown,
  buildDataQuality,
  inferSubjectType,
} = require('../../services/pricing-output');

describe('pricing-output', () => {
  it('computePrices produit les quatre prix doctrinaux avec marge categorie prioritaire', () => {
    const prices = computePrices(
      { variable_cost_estimated_kmf: 1000, risk_provision_estimated_kmf: 100, cost_complete_estimated_kmf: 2000 },
      { default_margin_pct: 50 },
      { target_marge_brute_pct: 40, minimum_safety_margin_pct: 10 },
    );

    expect(prices).toEqual({
      survival_price_kmf: 900,
      minimum_safe_price_kmf: 1990,
      recommended_price_kmf: 3990,
      test_price_kmf: 3990,
      target_margin_pct: 50,
      safety_margin_pct: 10,
    });
  });

  it('computeHealthStatus distingue unknown, loss, danger, fragile, healthy et strong', () => {
    expect(computeHealthStatus(0, 1000, 20)).toBe('unknown');
    expect(computeHealthStatus(900, 1000, 30)).toBe('loss');
    expect(computeHealthStatus(1200, 1000, 10)).toBe('danger');
    expect(computeHealthStatus(1200, 1000, 20)).toBe('fragile');
    expect(computeHealthStatus(1200, 1000, 40)).toBe('healthy');
    expect(computeHealthStatus(1200, 1000, 45)).toBe('strong');
  });

  it('computeSourcingDecision applique poids, marche et sante economique', () => {
    expect(computeSourcingDecision({ health_status: 'loss', market_confidence: 'validated', weight_kg: 1 })).toBe('LOSS');
    expect(computeSourcingDecision({ health_status: 'healthy', market_confidence: 'unknown', weight_kg: 10 })).toBe('AVOID');
    expect(computeSourcingDecision({ health_status: 'strong', market_confidence: 'validated', weight_kg: 1 })).toBe('PRIORITY');
    expect(computeSourcingDecision({ health_status: 'fragile', market_confidence: 'validated', weight_kg: 1 })).toBe('WATCH');
    expect(computeSourcingDecision({ health_status: 'danger', market_confidence: 'testing', weight_kg: 1 })).toBe('AVOID');
    expect(computeSourcingDecision({ health_status: 'strong', market_confidence: 'rejected', weight_kg: 1 })).toBe('WATCH');
  });

  it('buildAlerts remonte les alertes critiques et warnings utiles', () => {
    const alerts = buildAlerts({
      current_price_kmf: 900,
      cost_complete_estimated_kmf: 1000,
      estimated_margin_pct: 10,
      estimated_contribution_kmf: 100,
      fixed_cost_allocation_kmf: 200,
      monthly_break_even_orders: 15,
      target_orders_per_month: 10,
    });

    expect(alerts.map(a => a.code)).toEqual([
      'price_below_cost',
      'margin_dangerous',
      'contribution_insufficient',
      'volume_target_too_low',
    ]);
  });

  it('buildRecommendationText formule une recommandation lisible', () => {
    const text = buildRecommendationText({
      health_status: 'loss', market_confidence: 'unknown', sourcing_decision: 'LOSS',
      recommended_price_kmf: 2000, cost_complete_estimated_kmf: 1500, target_margin_pct: 40,
      current_price_kmf: 1000, estimated_margin_pct: -50, weight_kg: 1,
    });

    expect(text).toContain('Ce produit coûte');
    expect(text).toContain('tout compris.');
    expect(text).toContain('Pour viser 40% de marge');
    expect(text).toContain('vendu à perte');
    expect(text).toContain('URGENCE');
    expect(text).toContain('Données marché insuffisantes');
  });

  it('buildCostBreakdown additionne landed relay et business complete', () => {
    const breakdown = buildCostBreakdown({
      product_cost: 1000, sourcing: 100, hub: 50, packaging: 20, freight: 300,
      customs: 200, port_transitaire: 80, distribution: 70, payment: 30, risks: 40, fixed_costs: 500,
    });

    expect(breakdown.landed_relay).toMatchObject({ local_distribution: 70, relay: 0 });
    expect(breakdown.landed_relay_cost_kmf).toBe(1820);
    expect(breakdown.business_complete_cost_kmf).toBe(2390);
  });

  it('buildDataQuality qualifie sources, manquants et confidence', () => {
    expect(buildDataQuality(
      { product_id: 'p1', weight_kg: 1, volume_m3: 0.1 },
      { hasProduct: true, hasCustomsCategory: true, hasFinanceConfig: true, warnings: [] },
    )).toMatchObject({ confidence: 'medium', missing_fields: [] });

    const low = buildDataQuality({}, { hasProduct: false, hasCustomsCategory: false, hasFinanceConfig: false, warnings: ['a', 'b', 'c'] });
    expect(low.confidence).toBe('low');
    expect(low.missing_fields).toEqual(expect.arrayContaining(['purchase_price', 'weight', 'volume', 'customs_category']));
  });

  it('inferSubjectType distingue catalogue, candidat fournisseur et simulation manuelle', () => {
    expect(inferSubjectType({ product_id: 'p1' }, { hasProduct: true })).toBe('catalog_product');
    expect(inferSubjectType({ candidate_id: 'c1' }, {})).toBe('supplier_candidate');
    expect(inferSubjectType({}, {})).toBe('manual_simulation');
  });
});
