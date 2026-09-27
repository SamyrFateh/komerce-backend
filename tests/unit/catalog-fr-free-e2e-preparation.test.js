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

  test('can scope free FR preparation to one discovery wave', () => {
    expect(prep.parseArgs([
      '--limit=200',
      '--supplier=AliExpress',
      '--discovery-wave=incremental-e2e-200-v1',
    ])).toMatchObject({
      limit: 200,
      suppliers: ['AliExpress'],
      discoveryWave: 'incremental-e2e-200-v1',
    });
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


  test('scrubs source-noise patterns rejected by the publication guard', () => {
    const urlNoise = prep.compactTitle('Wireless Speaker https://supplier.example/image.webp NEW 2026');
    expect(urlNoise).not.toMatch(/https?:\/\/|\.webp|\bnew\b|2026/i);

    const acronymNoise = prep.compactTitle('USB RGB TWS ANC Wireless Headset');
    const acronymTokens = acronymNoise.match(/\b[A-Z][A-Z0-9]{1,8}\b/g) || [];
    expect(acronymTokens.length).toBeLessThan(4);
    expect(acronymNoise.length).toBeLessThanOrEqual(80);
  });
});
