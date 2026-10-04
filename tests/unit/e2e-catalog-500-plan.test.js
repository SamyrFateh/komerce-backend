'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const {
  SEGMENTS,
  ALIEXPRESS_500_PLAN,
  BALANCED_E2E_500_PLAN,
  buildPlan,
  planTotal,
  planByUniverse,
} = require('../../services/suppliers/e2e-catalog-500-plan');

describe('e2e-catalog-500-plan', () => {
  test('both canonical 500 plans are complete and provider-independent', () => {
    expect(planTotal(ALIEXPRESS_500_PLAN)).toBe(500);
    expect(planTotal(BALANCED_E2E_500_PLAN)).toBe(500);
    expect(ALIEXPRESS_500_PLAN).toHaveLength(SEGMENTS.length);
    expect(BALANCED_E2E_500_PLAN).toHaveLength(SEGMENTS.length);
  });

  test('balanced plan preserves the six boutique universes around the same weight', () => {
    const totals = Object.values(planByUniverse(BALANCED_E2E_500_PLAN));
    expect(totals).toHaveLength(6);
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1);
  });

  test('buildPlan fails closed when a segment target is absent or invalid', () => {
    expect(() => buildPlan({})).toThrow(/Cible de segment invalide/);
  });
});
