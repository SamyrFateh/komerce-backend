'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/pricing-engine', () => ({ recommend: jest.fn() }));
jest.mock('../../services/pricing-cdr', () => ({ loadGlobalConfig: jest.fn() }));
jest.mock('../../utils/currency', () => ({ projectAmount: jest.fn() }));
jest.mock('../../services/market-local-price-resolution-service', () => ({ resolveActiveProductMarketPricing: jest.fn() }));

const corridor = require('../../services/pricing-market-corridor');

describe('pricing-market-corridor', () => {
  test('absence de preuve locale reste explicitement sans corridor pays', () => {
    expect(corridor.projectObservedCorridor([], { currency: 'XAF', scope: 'market' })).toEqual({
      status: 'LOCAL_EVIDENCE_MISSING',
      scope: 'market',
      sample_count: 0,
      confidence: 'none',
      authority: 'OBSERVED_REFERENCE_NOT_GATE',
      low: null,
      target: null,
      high: null,
      observations: [],
    });
  });

  test('le corridor utilise des observations réelles comme bornes sans inventer de moyenne', () => {
    const result = corridor.projectObservedCorridor([
      { observation_ref: 'KMO-1', competitor_name: 'A', observed_amount: 100, currency: 'XAF', price_kmf: 100, observed_at: '2026-09-01T00:00:00Z' },
      { observation_ref: 'KMO-2', competitor_name: 'B', observed_amount: 200, currency: 'XAF', price_kmf: 200, observed_at: '2026-09-02T00:00:00Z' },
      { observation_ref: 'KMO-3', competitor_name: 'C', observed_amount: 300, currency: 'XAF', price_kmf: 300, observed_at: '2026-09-03T00:00:00Z' },
      { observation_ref: 'KMO-4', competitor_name: 'D', observed_amount: 400, currency: 'XAF', price_kmf: 400, observed_at: '2026-09-04T00:00:00Z' },
      { observation_ref: 'KMO-5', competitor_name: 'E', observed_amount: 500, currency: 'XAF', price_kmf: 500, observed_at: '2026-09-05T00:00:00Z' },
    ], { currency: 'XAF', scope: 'market' });

    expect(result).toMatchObject({
      status: 'READY',
      scope: 'market',
      sample_count: 5,
      confidence: 'medium',
      authority: 'OBSERVED_REFERENCE_NOT_GATE',
    });
    expect(result.low.price_kmf).toBe(200);
    expect(result.target.price_kmf).toBe(300);
    expect(result.high.price_kmf).toBe(400);
    expect(result.observations[0].observation_ref).toBe('KMO-5');
  });

  test('un petit échantillon reste émergent au lieu de devenir une vérité forte', () => {
    const result = corridor.projectObservedCorridor([
      { observation_ref: 'KMO-1', observed_amount: 1250, currency: 'XAF', price_kmf: 920 },
    ], { currency: 'XAF', scope: 'market' });

    expect(result.status).toBe('EMERGING');
    expect(result.confidence).toBe('low');
    expect(result.low.price_kmf).toBe(920);
    expect(result.target.price_kmf).toBe(920);
    expect(result.high.price_kmf).toBe(920);
  });

  test('la référence globale reste une autre portée et jamais une autorité pays', () => {
    const result = corridor.projectObservedCorridor([
      { competitor_ref: 'KPC-1', competitor_name: 'Global', price_kmf: 1700, observed_at: '2026-09-05T00:00:00Z' },
    ], { currency: 'KMF', scope: 'global_reference' });

    expect(result.scope).toBe('global_reference');
    expect(result.authority).toBe('OBSERVED_REFERENCE_NOT_GATE');
    expect(result.status).toBe('EMERGING');
  });

  describe('viabilité SKU', () => {
    const economics = {
      purchase_cost_kmf: 700,
      variable_cost_outside_purchase_kmf: 300,
      variable_cost_complete_kmf: 1000,
      minimum_safe_price_kmf: 1100,
      safety_margin_pct: 10,
      target_margin_pct: 40,
    };

    test('ne conclut jamais à la non-viabilité sans preuve marché locale', () => {
      const result = corridor.projectSkuViability({
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
      const result = corridor.projectSkuViability({
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
      const result = corridor.projectSkuViability({
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
      const result = corridor.projectSkuViability({
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

    test('calcule séparément break-even, sécurité et marge cible', () => {
      expect(corridor.purchaseCeilings(1400, economics)).toEqual({
        break_even_kmf: 1100,
        safe_kmf: 973,
        target_margin_kmf: 540,
      });
    });
  });
});
