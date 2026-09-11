'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  purchaseCeilings,
  projectSkuViability,
} = require('../../services/pricing-sku-viability');

describe('pricing-sku-viability', () => {
  const economics = {
    purchase_cost_kmf: 700,
    variable_cost_outside_purchase_kmf: 300,
    variable_cost_complete_kmf: 1000,
    minimum_safe_price_kmf: 1100,
    safety_margin_pct: 10,
    target_margin_pct: 40,
  };

  test('ne conclut pas à la non-viabilité sans preuve marché locale', () => {
    const result = projectSkuViability({
      sample_count: 0,
      confidence: 'none',
      low: null,
      target: null,
      high: null,
    }, economics);

    expect(result.status).toBe('MARKET_EVIDENCE_INSUFFICIENT');
    expect(result.sourcing_action).toBe('COLLECT_MARKET_EVIDENCE');
    expect(result.strategic_exception_auto_assigned).toBe(false);
  });

  test('déclare structurellement non viable si même la borne haute ne contribue pas', () => {
    const result = projectSkuViability({
      sample_count: 5,
      confidence: 'medium',
      low: { price_kmf: 800 },
      target: { price_kmf: 900 },
      high: { price_kmf: 1000 },
    }, economics);

    expect(result.status).toBe('NON_VIABLE_STRUCTURAL');
    expect(result.contribution_scenarios_kmf.high_kmf).toBe(0);
    expect(result.sourcing_action).toBe('AVOID_OR_RESOURCE');
  });

  test('reste conditionnel lorsque seule la borne haute devient contributive', () => {
    const result = projectSkuViability({
      sample_count: 5,
      confidence: 'medium',
      low: { price_kmf: 850 },
      target: { price_kmf: 950 },
      high: { price_kmf: 1300 },
    }, economics);

    expect(result.status).toBe('VIABLE_UNDER_CONDITIONS');
    expect(result.contribution_scenarios_kmf.target_kmf).toBe(-50);
    expect(result.contribution_scenarios_kmf.high_kmf).toBe(300);
  });

  test('déclare viable à la cible mais conserve la sensibilité de borne basse', () => {
    const result = projectSkuViability({
      sample_count: 8,
      confidence: 'high',
      low: { price_kmf: 950 },
      target: { price_kmf: 1400 },
      high: { price_kmf: 1700 },
    }, economics);

    expect(result.status).toBe('VIABLE');
    expect(result.resilience).toBe('TARGET_DEPENDENT');
    expect(result.contribution_scenarios_kmf.target_kmf).toBe(400);
    expect(result.purchase_cost_ceiling_at_target_kmf.safe_kmf).toBe(973);
    expect(result.purchase_cost_gap_to_safe_ceiling_kmf).toBe(273);
  });

  test('calcule séparément seuil nul, seuil sécurité et seuil de marge cible', () => {
    expect(purchaseCeilings(1400, economics)).toEqual({
      break_even_kmf: 1100,
      safe_kmf: 973,
      target_margin_kmf: 540,
    });
  });
});