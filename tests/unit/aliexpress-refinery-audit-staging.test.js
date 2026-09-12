'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), pool: { end: jest.fn() } }));

const {
  EXPECTED_CLEAN,
  assertRuntime,
  cleanStockSql,
  stats,
  summarize,
} = require('../../scripts/aliexpress-refinery-audit-staging');

describe('aliexpress-refinery-audit-staging', () => {
  test('freezes the expected clean pool at 500', () => {
    expect(EXPECTED_CLEAN).toBe(500);
  });

  test('is staging-only and requires DATABASE_URL', () => {
    expect(() => assertRuntime({ KOMERCE_ENV: 'staging', DATABASE_URL: 'postgres://example' })).not.toThrow();
    expect(() => assertRuntime({ KOMERCE_ENV: 'production', DATABASE_URL: 'postgres://example' })).toThrow(/staging requis/i);
    expect(() => assertRuntime({ KOMERCE_ENV: 'staging' })).toThrow(/DATABASE_URL requis/i);
  });

  test('stock predicate validates SQL alias', () => {
    expect(cleanStockSql('sc')).toContain("normalized_source_contract ? 'stock_available'");
    expect(() => cleanStockSql('sc;drop')).toThrow(/Alias SQL invalide/);
  });

  test('stats ignores missing/non-positive values', () => {
    expect(stats([null, 0, -2, '5', 8])).toEqual({ count: 2, min: 5, max: 8 });
    expect(stats([])).toEqual({ count: 0, min: null, max: null });
  });

  test('summarize surfaces refinery reasons and price authority', () => {
    const rows = [
      {
        komerce_category: 'phones',
        purchase_price_kmf: 1000,
        scan_result: {
          sourcing_decision: 'WATCH',
          health_status: 'fragile',
          reason: 'Marge fragile',
          price_authority: 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION',
          test_price_kmf: 2000,
          minimum_safe_price_kmf: 1500,
        },
      },
      {
        komerce_category: 'phones',
        purchase_price_kmf: 1200,
        scan_result: {
          sourcing_decision: 'TEST',
          health_status: 'healthy',
          reason: 'Test faible quantité',
          price_authority: 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION',
          test_price_kmf: 2600,
          minimum_safe_price_kmf: 1700,
        },
      },
    ];

    expect(summarize(rows)).toMatchObject({
      clean_total: 2,
      decisions: { WATCH: 1, TEST: 1 },
      health_status: { fragile: 1, healthy: 1 },
      price_authority: { ECONOMIC_REFERENCE_NOT_MARKET_DECISION: 2 },
      purchase_price_kmf: { count: 2, min: 1000, max: 1200 },
      test_price_kmf: { count: 2, min: 2000, max: 2600 },
      minimum_safe_price_kmf: { count: 2, min: 1500, max: 1700 },
      categories: { phones: 2 },
    });
  });
});
