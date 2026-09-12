'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  computePrices,
  computeStrategies,
  buildProportions,
  computeHealthStatus,
  computeSourcingDecision,
  buildAlerts,
  buildRecommendationText,
  buildCostBreakdown,
  buildDataQuality,
  inferSubjectType,
} = require('../../services/pricing-output');

describe('pricing-output', () => {
  it('computePrices produit des frontières économiques à partir du coût variable uniquement', () => {
    const prices = computePrices(
      { variable_cost_estimated_kmf: 1000, risk_provision_estimated_kmf: 100, cost_complete_estimated_kmf: 2000 },
      { default_margin_pct: 50 },
      { target_marge_brute_pct: 40, minimum_safety_margin_pct: 10 },
    );

    expect(prices).toEqual({
      survival_price_kmf: 900,
      minimum_safe_price_kmf: 1990,
      recommended_price_kmf: 1990,
      economic_reference_price_kmf: 1990,
      test_price_kmf: 1990,
      target_margin_pct: 50,
      safety_margin_pct: 10,
      price_authority: 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION',
      fixed_structure_in_price: false,
    });
  });

  it('une variation de charge fixe ne modifie jamais le repère de prix unitaire', () => {
    const base = { variable_cost_estimated_kmf: 1000, risk_provision_estimated_kmf: 100 };
    const cat = { default_margin_pct: 40 };
    const finance = { minimum_safety_margin_pct: 10 };

    const lowStructure = computePrices({ ...base, cost_complete_estimated_kmf: 1200 }, cat, finance);
    const highStructure = computePrices({ ...base, cost_complete_estimated_kmf: 9000 }, cat, finance);

    expect(highStructure.economic_reference_price_kmf).toBe(lowStructure.economic_reference_price_kmf);
    expect(highStructure.minimum_safe_price_kmf).toBe(lowStructure.minimum_safe_price_kmf);
    expect(highStructure.fixed_structure_in_price).toBe(false);
  });

  it('computeStrategies garde la structure comme besoin collectif, jamais comme dette du SKU', () => {
    const strategies = computeStrategies({
      variable_complete: 1000,
      minimum_safe: 1200,
      recommended: 1600,
      target_margin_pct: 40,
      monthly_fixed_costs: 10000,
    }, {}, { final_price_kmf: 1500 });

    const manual = strategies.find(row => row.id === 'manual');
    expect(manual).toMatchObject({
      final_price_kmf: 1500,
      contribution_kmf: 500,
      gap_to_cdr_kmf: null,
      uncovered_fixed_kmf: null,
      equivalent_articles_to_cover_structure: 20,
      fixed_structure_in_price: false,
      authority: 'HUMAN_DECISION',
    });
  });

  it('buildProportions expose variable flow, business variable et structure de portefeuille sans N-level', () => {
    const proportions = buildProportions({
      landed_relay: { product_purchase: 1000, freight: 200 },
      business: { payment: 30, risk_provision: 20, fixed_overhead: 500 },
    }, {
      variable_flow: 1200,
      business_variable: 50,
      variable_total: 1250,
      structure_reference: 500,
      analytical_total: 1750,
      price: 2000,
    });

    expect(proportions.families.map(row => row.family)).toEqual([
      'VARIABLE_FLOW',
      'BUSINESS_VARIABLE',
      'STRUCTURE_REFERENCE',
    ]);
    expect(proportions.families.find(row => row.family === 'STRUCTURE_REFERENCE')).toMatchObject({
      pricing_authority: 'NONE',
    });
    expect(JSON.stringify(proportions.families)).not.toMatch(/N1|N2|N3/);
  });

  it('computeHealthStatus distingue unknown, loss, danger, fragile, healthy et strong sur le coût variable', () => {
    expect(computeHealthStatus(0, 1000, 20)).toBe('unknown');
    expect(computeHealthStatus(900, 1000, 30)).toBe('loss');
    expect(computeHealthStatus(1200, 1000, 10)).toBe('danger');
    expect(computeHealthStatus(1200, 1000, 20)).toBe('fragile');
    expect(computeHealthStatus(1200, 1000, 40)).toBe('healthy');
    expect(computeHealthStatus(1200, 1000, 45)).toBe('strong');
  });

  it('computeSourcingDecision applique poids, marche et santé économique', () => {
    expect(computeSourcingDecision({ health_status: 'loss', market_confidence: 'validated', weight_kg: 1 })).toBe('LOSS');
    expect(computeSourcingDecision({ health_status: 'healthy', market_confidence: 'unknown', weight_kg: 10 })).toBe('AVOID');
    expect(computeSourcingDecision({ health_status: 'strong', market_confidence: 'validated', weight_kg: 1 })).toBe('PRIORITY');
    expect(computeSourcingDecision({ health_status: 'fragile', market_confidence: 'validated', weight_kg: 1 })).toBe('WATCH');
    expect(computeSourcingDecision({ health_status: 'danger', market_confidence: 'testing', weight_kg: 1 })).toBe('AVOID');
    expect(computeSourcingDecision({ health_status: 'strong', market_confidence: 'rejected', weight_kg: 1 })).toBe('WATCH');
  });

  it('buildAlerts remonte les alertes sans comparer la contribution à une quote-part fixe SKU', () => {
    const alerts = buildAlerts({
      current_price_kmf: 900,
      variable_cost_complete_kmf: 1000,
      estimated_margin_pct: 10,
      estimated_contribution_kmf: -100,
      monthly_break_even_orders: 15,
      target_orders_per_month: 10,
    });

    expect(alerts.map(a => a.code)).toEqual([
      'price_below_variable_cost',
      'margin_dangerous',
      'non_positive_contribution',
      'portfolio_volume_target_too_low',
    ]);
    expect(alerts.map(a => a.code)).not.toContain('contribution_insufficient');
  });

  it('buildRecommendationText distingue repère économique et vérité marché', () => {
    const text = buildRecommendationText({
      health_status: 'loss', market_confidence: 'unknown', sourcing_decision: 'LOSS',
      recommended_price_kmf: 2000, economic_reference_price_kmf: 2000,
      variable_cost_complete_kmf: 1500, target_margin_pct: 40,
      current_price_kmf: 1000, estimated_margin_pct: -50, weight_kg: 1,
    });

    expect(text).toContain('Coût variable complet');
    expect(text).toContain('Repère économique de contribution');
    expect(text).toContain('ce n’est pas une vérité marché ni un prix imposé');
    expect(text).toContain('chaque vente détruit de la valeur');
    expect(text).toContain('Données marché insuffisantes');
    expect(text).not.toContain('tout compris');
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
