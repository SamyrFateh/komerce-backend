'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockQuery(...args),
  pool: { end: jest.fn() },
}));
const mockRuntime = jest.fn(() => ({ mode: 'railway-isolated', dataset_id: 'catalog-e2e-700-v1' }));
jest.mock('../../services/suppliers/e2e-isolated-runtime', () => ({
  assertIsolatedE2eRuntime: (...args) => mockRuntime(...args),
}));

const bootstrap = require('../../scripts/catalog-e2e-taxonomy-bootstrap');

describe('catalog E2E taxonomy bootstrap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('derives exactly the 21 canonical boutique pairs from the provider-independent balanced plan', () => {
    const pairs = bootstrap.expectedPairs();
    expect(pairs).toHaveLength(21);
    expect(pairs).toContainEqual({ category: 'Mode & Beauté', subcategory: 'Femme' });
    expect(pairs).toContainEqual({ category: 'Tech', subcategory: 'Audio' });
    expect(pairs).toContainEqual({ category: 'Auto', subcategory: 'Moto' });
    expect(new Set(pairs.map(p => `${p.category}\u0000${p.subcategory}`)).size).toBe(21);
  });

  test('is isolated-runtime and explicit-flag guarded', () => {
    expect(() => bootstrap.assertRuntime({
      KOMERCE_ALLOW_CATALOG_E2E_TAXONOMY_BOOTSTRAP: '0',
    })).toThrow(/requis/);

    expect(bootstrap.assertRuntime({
      KOMERCE_ALLOW_CATALOG_E2E_TAXONOMY_BOOTSTRAP: '1',
    })).toMatchObject({ mode: 'railway-isolated' });
  });

  test('audit reports missing active canonical pairs without mutating', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { category: 'Mode & Beauté', subcategory: 'Femme' },
        { category: 'Tech', subcategory: 'Audio' },
      ],
    });
    const out = await bootstrap.audit();
    expect(out.expected_pairs).toBe(21);
    expect(out.active_pairs_found).toBe(2);
    expect(out.missing).toHaveLength(19);
    expect(out.ready).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('audit passes when all canonical pairs are active', async () => {
    const pairs = bootstrap.expectedPairs();
    mockQuery.mockResolvedValueOnce({
      rows: pairs.map(p => ({ category: p.category, subcategory: p.subcategory })),
    });
    const out = await bootstrap.audit();
    expect(out).toMatchObject({
      expected_pairs: 21,
      active_pairs_found: 21,
      missing: [],
      ready: true,
    });
  });
});
