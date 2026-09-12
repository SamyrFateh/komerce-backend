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
jest.mock('../../services/pricing-engine', () => ({ loadGlobalConfig: jest.fn() }));
jest.mock('../../services/supplier-catalog-scanner', () => ({
  normalizeCandidate: jest.fn(),
  scanCandidate: jest.fn(),
}));
jest.mock('../../services/catalog-eligibility', () => ({
  loadActiveExclusions: jest.fn(),
  checkEligibility: jest.fn(),
}));
jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({
  importCatalog: jest.fn(),
}));

const {
  FLAG,
  parseArgs,
  assertRuntime,
  reconstructProduct,
} = require('../../scripts/aliexpress-refinery-rescan-staging');

describe('aliexpress-refinery-rescan-staging', () => {
  it('reste dry-run par défaut et borne le lot à 500', () => {
    expect(parseArgs([])).toEqual({ mode: 'dry-run', limit: 500 });
    expect(parseArgs(['--execute', '--limit=100'])).toEqual({ mode: 'execute', limit: 100 });
    expect(() => parseArgs(['--limit=501'])).toThrow(/entre 1 et 500/);
  });

  it('refuse hors staging et exige le flag explicite en execute', () => {
    expect(() => assertRuntime({ mode: 'dry-run' }, { KOMERCE_ENV: 'production', DATABASE_URL: 'x' }))
      .toThrow(/staging requis/);
    expect(() => assertRuntime({ mode: 'execute' }, { KOMERCE_ENV: 'staging', DATABASE_URL: 'x' }))
      .toThrow(new RegExp(FLAG));
    expect(() => assertRuntime(
      { mode: 'execute' },
      { KOMERCE_ENV: 'staging', DATABASE_URL: 'x', [FLAG]: '1' }
    )).not.toThrow();
  });

  it('reconstruit fidèlement le produit V2 à partir du snapshot + raw_payload', () => {
    const raw = {
      discovery: { segment_id: 'mode-femme', keyword: 'women dress' },
      source: { untouched: true },
    };
    const product = reconstructProduct({
      supplier_product_id: 'ALI-1',
      normalized_source_contract: {
        schema_version: '2',
        supplier_name: 'AliExpress',
        supplier_product_id: 'ALI-1',
        product_name: 'Summer Dress',
        purchase_price: 4.5,
        currency: 'USD',
        media: [{ role: 'hero', url: 'https://example.test/a.jpg' }],
        option_axes: [],
        sellable_units: [],
      },
      raw_payload: raw,
    });

    expect(product.schema_version).toBe('2');
    expect(product.raw_payload).toEqual(raw);
    expect(product.raw_payload).not.toBe(raw);
    expect(product.media).toHaveLength(1);
  });

  it('refuse un candidat qui ne peut pas être rejoué en Normalized V2', () => {
    expect(() => reconstructProduct({
      supplier_product_id: 'ALI-LEGACY',
      normalized_source_contract: { schema_version: '1' },
      raw_payload: {},
    })).toThrow(/sans Normalized V2 replayable/);
  });
});