'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../../services/suppliers/connectors/cj-connector', () => ({
  fetchProducts: jest.fn(),
}));
jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({
  importCatalog: jest.fn(),
}));

const fill = require('../../scripts/cj-broad-catalog-stress-fill');

describe('cj-broad-catalog-stress-fill', () => {
  test('is hard-bounded to the disposable 1000-product campaign', () => {
    expect(fill.TARGET).toBe(1000);
    expect(fill.PAGE_SIZE).toBe(100);
    expect(fill.MAX_PAGES).toBeGreaterThanOrEqual(10);
    expect(fill.MAX_PAGES).toBeLessThanOrEqual(30);
  });

  test('refuses anything except the exact disposable localhost DB', () => {
    const base = {
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
      KOMERCE_ALLOW_CJ_BROAD_STRESS_FILL: '1',
      CJ_ACCESS_TOKEN: 'token',
    };

    expect(() => fill.assertDisposableRuntime({
      ...base,
      DATABASE_URL: 'postgresql://komerce:komerce@127.0.0.1:5432/komerce_real_catalog_stress',
    })).not.toThrow();

    expect(() => fill.assertDisposableRuntime({
      ...base,
      DATABASE_URL: 'postgresql://prod.example.com:5432/komerce',
    })).toThrow(/base jetable localhost/);

    expect(() => fill.assertDisposableRuntime({
      ...base,
      KOMERCE_ENV: 'production',
      DATABASE_URL: 'postgresql://komerce:komerce@127.0.0.1:5432/komerce_real_catalog_stress',
    })).toThrow(/staging/);
  });

  test('recognizes both CJ points exhaustion and generic 429 as retryable quota stops', () => {
    expect(fill.isQuotaError(new Error('Insufficient API points. Remaining: 0'))).toBe(true);
    expect(fill.isQuotaError(new Error('16900500 Insufficient points'))).toBe(true);
    expect(fill.isQuotaError(new Error('HTTP 429 Too Many Requests'))).toBe(true);
    expect(fill.isQuotaError(new Error('network reset'))).toBe(false);
  });

  test('quota wait defaults are compatible with CJ minute replenishment', () => {
    expect(fill.DEFAULT_QUOTA_WAIT_MS).toBeGreaterThanOrEqual(90000);
    expect(fill.MAX_QUOTA_WAITS).toBeGreaterThanOrEqual(10);
  });
});
