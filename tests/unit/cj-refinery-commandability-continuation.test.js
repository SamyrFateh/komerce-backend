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
      .toMatchObject({ limit: 974, chunk: 20, auditOnly: false });
    expect(continuation.parseArgs(['--audit-only']))
      .toMatchObject({ auditOnly: true });
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
    })).toThrow(/base E2E isolée/);

    expect(() => continuation.assertDisposableRuntime({
      ...base,
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
    })).not.toThrow();

    expect(() => continuation.assertDisposableRuntime({
      KOMERCE_ALLOW_CJ_REFINERY_CONTINUATION: '1',
      CJ_ACCESS_TOKEN: 'test',
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
      KOMERCE_DISABLE_CRONS: 'true',
      KOMERCE_ALLOW_RAILWAY_ISOLATED_E2E: '1',
      KOMERCE_E2E_DATASET_ID: 'catalog-e2e-700-v1',
      DATABASE_URL: 'postgresql://u:p@catalog700.railway.internal:5432/railway',
    })).not.toThrow();

    const noCj = { ...base };
    delete noCj.CJ_ACCESS_TOKEN;
    expect(() => continuation.assertDisposableRuntime({
      ...noCj,
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
    }, { requireCj: false })).not.toThrow();
  });

  test('reconnaît quota et auth sans masquer les autres erreurs', () => {
    expect(continuation.isQuotaError(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(continuation.isQuotaError(new Error('insufficient api points 16900500'))).toBe(true);
    expect(continuation.isQuotaError(new Error('product not found'))).toBe(false);
    expect(continuation.isAuthError(Object.assign(new Error('expired token'), { status: 401 }))).toBe(true);
    expect(continuation.isAuthError(new Error('product not found'))).toBe(false);
  });


  test('préserve la provenance discovery lors du rechargement exact CJ', () => {
    const normalized = {
      supplier_product_id: 'cj-1',
      raw_payload: { source: 'cj_api_v2', cj: { pid: 'cj-1' } },
    };
    const candidate = {
      raw_payload: {
        discovery: {
          campaign: 'cj-balanced-e2e-500-v1',
          segment_id: 'tech-audio',
          target_category: 'Tech',
          target_subcategory: 'Audio',
        },
      },
    };

    const out = continuation.preserveDiscoveryProvenance(normalized, candidate);
    expect(out.raw_payload.cj).toEqual({ pid: 'cj-1' });
    expect(out.raw_payload.discovery).toEqual(candidate.raw_payload.discovery);
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
