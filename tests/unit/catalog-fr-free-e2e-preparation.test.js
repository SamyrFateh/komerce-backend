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
jest.mock('../../services/catalog-overrides', () => ({
  upsertOverrides: jest.fn(),
}));
jest.mock('../../scripts/showcase-curate-staging-500', () => ({
  polishName: (value) => String(value || '')
    .replace(/\bwireless\b/gi, 'sans fil')
    .replace(/\bphone\b/gi, 'téléphone')
    .replace(/\bcharger\b/gi, 'chargeur')
    .trim(),
}));

const prep = require('../../scripts/catalog-fr-free-e2e-preparation');

describe('catalog-fr-free-e2e-preparation', () => {
  test('is bounded to 1000 rows and staging/test only', () => {
    expect(prep.parseArgs(['--limit=1000'])).toMatchObject({ limit: 1000 });
    expect(() => prep.parseArgs(['--limit=1001'])).toThrow(/1\.\.1000/);
    expect(() => prep.assertRuntime({
      KOMERCE_ENV: 'production',
      NODE_ENV: 'test',
      DATABASE_URL: 'x',
    })).toThrow(/staging\/test/);
    expect(() => prep.assertRuntime({
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
      DATABASE_URL: 'x',
    })).not.toThrow();
  });

  test('prepares French-facing E2E fields without provider credentials', () => {
    const out = prep.prepareFrenchFields({
      name_source: 'Wireless Phone Charger 2026 Best Seller',
      category: 'phones',
    });

    expect(out.name).toContain('sans fil');
    expect(out.name).toContain('téléphone');
    expect(out.name).toContain('chargeur');
    expect(out.name).not.toMatch(/best seller|2026/i);
    expect(out.name.length).toBeLessThanOrEqual(80);
    expect(out.description).toMatch(/parcours de test Komerce/i);
    expect(out.preparation_version).toBe(prep.PREPARATION_VERSION);
  });
});
