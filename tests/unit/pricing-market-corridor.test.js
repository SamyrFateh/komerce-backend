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
});
