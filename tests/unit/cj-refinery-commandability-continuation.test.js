'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../../services/suppliers/connectors/cj-connector', () => ({
  getAccessToken: jest.fn(),
  fetchProductDetail: jest.fn(),
  normalizeCjProduct: jest.fn(),
}));
jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({
  importCatalog: jest.fn(),
}));
jest.mock('../../services/catalog-promotion', () => ({
  promoteCatalog: jest.fn(),
}));

const continuation = require('../../scripts/cj-refinery-commandability-continuation');

describe('CJ Raffinerie commandability continuation', () => {
  test('reste borné à 1000 et chunks de 20', () => {
    expect(continuation.parseArgs(['--limit=974', '--chunk=20']))
      .toMatchObject({ limit: 974, chunk: 20 });
    expect(() => continuation.parseArgs(['--limit=1001'])).toThrow(/1 et 1000/);
    expect(() => continuation.parseArgs(['--chunk=21'])).toThrow(/1 et 20/);
  });

  test('refuse toute DB non jetable ou runtime production', () => {
    const base = {
      KOMERCE_ALLOW_CJ_REFINERY_CONTINUATION: '1',
      CJ_ACCESS_TOKEN: 'test',
      DATABASE_URL: 'postgresql://komerce:komerce@127.0.0.1:5432/komerce_real_catalog_stress',
    };
    expect(() => continuation.assertDisposableRuntime({
      ...base,
      KOMERCE_ENV: 'production',
      NODE_ENV: 'test',
    })).toThrow(/staging/);

    expect(() => continuation.assertDisposableRuntime({
      ...base,
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://prod.example.com/prod',
    })).toThrow(/base jetable/);

    expect(() => continuation.assertDisposableRuntime({
      ...base,
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
    })).not.toThrow();
  });

  test('reconnaît les erreurs quota CJ sans masquer les autres erreurs', () => {
    expect(continuation.isQuotaError(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(continuation.isQuotaError(new Error('insufficient api points 16900500'))).toBe(true);
    expect(continuation.isQuotaError(new Error('product not found'))).toBe(false);
  });

  test('READY exige média, SKU fournisseur actif et Supplier Order Identity complète', () => {
    const base = {
      sourcing_decision: 'TEST',
      content_source: 'manual',
      source_locale: 'en',
      needs_review: false,
      active_media: 2,
      active_supplier_skus: 3,
      complete_soi_skus: 3,
      category: 'phones',
      name: 'Support téléphone',
      description: 'Description française suffisamment longue pour le produit.',
      price_kmf: 4990,
      stock: null,
    };

    expect(continuation.classifyReadiness(base)).toMatchObject({
      ready: true,
      publication_guard: 'PASS',
    });

    const missingSoi = continuation.classifyReadiness({
      ...base,
      complete_soi_skus: 0,
    });
    expect(missingSoi.ready).toBe(false);
    expect(missingSoi.reasons).toContain('supplier_order_identity_missing');

    const partialSoi = continuation.classifyReadiness({
      ...base,
      complete_soi_skus: 2,
    });
    expect(partialSoi.ready).toBe(false);
    expect(partialSoi.reasons).toContain('supplier_order_identity_partial');
  });

  test('WATCH ne devient jamais READY par simple hydratation technique', () => {
    const result = continuation.classifyReadiness({
      sourcing_decision: 'WATCH',
      content_source: 'manual',
      source_locale: 'en',
      needs_review: false,
      active_media: 2,
      active_supplier_skus: 1,
      complete_soi_skus: 1,
      category: 'phones',
      name: 'Support téléphone',
      description: 'Description française suffisamment longue pour le produit.',
      price_kmf: 4990,
      stock: null,
    });
    expect(result.ready).toBe(false);
    expect(result.reasons).toContain('decision:WATCH');
  });
});
