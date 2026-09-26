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
  SUPPLIER_NAME: 'CJdropshipping',
  PROVIDER_ID: 'cj',
  fetchProducts: jest.fn(),
}));
jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({
  importCatalog: jest.fn(),
}));

const {
  BALANCED_E2E_500_PLAN,
  planTotal,
  planByUniverse,
} = require('../../services/suppliers/e2e-catalog-500-plan');
const sync = require('../../scripts/cj-500-e2e-catalog-sync');

describe('CJ balanced E2E 500', () => {
  test('le plan couvre exactement 500 vrais slots sur les 6 univers et 21 sous-catégories', () => {
    expect(planTotal(BALANCED_E2E_500_PLAN)).toBe(500);
    expect(BALANCED_E2E_500_PLAN).toHaveLength(21);
    expect(new Set(BALANCED_E2E_500_PLAN.map((row) => row.id)).size).toBe(21);
    expect(planByUniverse(BALANCED_E2E_500_PLAN)).toEqual({
      'Mode & Beauté': 84,
      Maison: 84,
      Tech: 83,
      Bricolage: 83,
      'Créations personnelles': 83,
      Auto: 83,
    });
  });

  test('refuse production et toute DB autre que le checkpoint jetable localhost', () => {
    expect(() => sync.assertRuntime({
      KOMERCE_ENV: 'production',
      NODE_ENV: 'test',
      KOMERCE_ALLOW_CJ_BALANCED_E2E_500: '1',
      CJ_ACCESS_TOKEN: 'x',
      DATABASE_URL: 'postgresql://x:x@127.0.0.1:5432/komerce_real_catalog_stress',
    })).toThrow(/staging\/test/);

    expect(() => sync.assertRuntime({
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
      KOMERCE_ALLOW_CJ_BALANCED_E2E_500: '1',
      CJ_ACCESS_TOKEN: 'x',
      DATABASE_URL: 'postgresql://x:x@railway.internal:5432/production',
    })).toThrow(/base jetable localhost/);

    expect(() => sync.assertRuntime({
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
      CJ_ACCESS_TOKEN: 'x',
      DATABASE_URL: 'postgresql://x:x@127.0.0.1:5432/komerce_real_catalog_stress',
    })).toThrow(/KOMERCE_ALLOW_CJ_BALANCED_E2E_500=1/);
  });

  test('un produit E2E doit avoir média, stock réel et unité fournisseur commandable', () => {
    const clean = {
      schema_version: '2',
      supplier_product_id: 'cj-p-1',
      product_name: 'Wireless earbuds',
      image_url: 'https://example.test/hero.jpg',
      purchase_price: 12.5,
      stock_available: 31,
      media: [{ url: 'https://example.test/hero.jpg' }],
      sellable_units: [{
        supplier_sku: 'SKU-1',
        supplier_unit_ref: 'VID-1',
        supplier_order_identity: {
          provider: 'cj',
          version: 1,
          payload: { pid: 'cj-p-1', vid: 'VID-1' },
        },
        stock_available: 31,
        purchase_price: 12.5,
        is_active: true,
      }],
    };

    expect(sync.basicCleanProduct(clean)).toBe(true);
    expect(sync.basicCleanProduct({ ...clean, stock_available: 0 })).toBe(false);
    expect(sync.basicCleanProduct({ ...clean, media: [] })).toBe(false);
    expect(sync.basicCleanProduct({
      ...clean,
      sellable_units: [{ ...clean.sellable_units[0], supplier_order_identity: null }],
    })).toBe(false);
    expect(sync.basicCleanProduct({
      ...clean,
      sellable_units: [{ ...clean.sellable_units[0], stock_available: 0 }],
    })).toBe(false);
  });

  test('la provenance discovery porte la taxonomie boutique sans toucher la catégorie douanière', () => {
    const segment = BALANCED_E2E_500_PLAN.find((row) => row.id === 'tech-audio');
    const product = {
      supplier_product_id: 'cj-p-2',
      raw_payload: { source: 'cj_api_v2', cj: { pid: 'cj-p-2' } },
    };
    const out = sync.withDiscoveryProvenance(product, {
      segment,
      keyword: 'wireless headphones',
      queryPage: 2,
    });

    expect(out.raw_payload.cj).toEqual({ pid: 'cj-p-2' });
    expect(out.raw_payload.discovery).toMatchObject({
      campaign: 'cj-balanced-e2e-500-v1',
      segment_id: 'tech-audio',
      target_category: 'Tech',
      target_subcategory: 'Audio',
      keyword: 'wireless headphones',
      query_page: 2,
    });
    expect(out).not.toHaveProperty('komerce_category');
  });

  test('alterne les mots-clés d’un segment pour diversifier les résultats CJ', () => {
    const segment = BALANCED_E2E_500_PLAN.find((row) => row.id === 'tech-phones');
    expect(sync.logicalSearchPage(segment, 1)).toEqual({ keyword: 'android smartphone', queryPage: 1 });
    expect(sync.logicalSearchPage(segment, 2)).toEqual({ keyword: 'mobile phone', queryPage: 1 });
    expect(sync.logicalSearchPage(segment, 3)).toEqual({ keyword: 'android smartphone', queryPage: 2 });
  });
});
