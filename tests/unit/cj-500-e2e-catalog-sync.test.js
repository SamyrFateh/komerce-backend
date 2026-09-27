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

  test('la découverte exige média, prix et stock réels ; la commandabilité est hydratée ensuite', () => {
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
    expect(sync.basicCleanProduct({ ...clean, sellable_units: null })).toBe(true);
    expect(sync.basicCleanProduct({ ...clean, sellable_units: [] })).toBe(true);
  });

  test('rejette un résultat fournisseur techniquement propre mais hors requête', () => {
    const result = sync.semanticRelevance({
      product_name: 'Motorcycle Handlebar Rear View Mirror',
      supplier_category: 'Motorcycle Parts',
      image_url: 'https://example.test/mirror.jpg',
      purchase_price: 8,
      stock_available: 9,
      media: [{ url: 'https://example.test/mirror.jpg' }],
      schema_version: '2',
    }, 'women dress');
    expect(result.relevant).toBe(false);
  });

  test('accepte une variation morphologique pertinente de la requête', () => {
    const result = sync.semanticRelevance({
      product_name: "Women's Summer Dresses Casual Beach",
      supplier_category: 'Apparel',
    }, 'women dress');
    expect(result.relevant).toBe(true);
    expect(result.gate_version).toMatch(/supplier-discovery-semantic/);
  });

  test('la provenance discovery porte la preuve sémantique et la taxonomie boutique sans toucher la catégorie douanière', () => {
    const segment = BALANCED_E2E_500_PLAN.find((row) => row.id === 'tech-audio');
    const product = {
      supplier_product_id: 'cj-p-2',
      product_name: 'Wireless Bluetooth Headphones',
      supplier_category: 'Consumer Electronics',
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
      semantic_relevance: expect.objectContaining({ relevant: true }),
    });
    expect(out).not.toHaveProperty('komerce_category');
  });

  test('le segment homme dispose de requêtes de repli sans relâcher sa cible', () => {
    const segment = BALANCED_E2E_500_PLAN.find((row) => row.id === 'mode-homme');
    expect(segment.target).toBe(21);
    expect(segment.queries).toEqual(expect.arrayContaining([
      'men shirt',
      'men clothing',
      'men t-shirt',
      'men pants',
      'men shoes',
    ]));
    expect(segment.queries.length).toBeGreaterThanOrEqual(5);
  });

  test('le segment enfant dispose de requêtes de repli sans relâcher sa cible', () => {
    const segment = BALANCED_E2E_500_PLAN.find((row) => row.id === 'mode-enfant');
    expect(segment.target).toBe(21);
    expect(segment.queries).toEqual(expect.arrayContaining([
      'kids clothing',
      'kids shoes',
      'children clothing',
      'boys clothing',
      'girls clothing',
      'kids sneakers',
    ]));
    expect(segment.queries.length).toBeGreaterThanOrEqual(6);
  });

  test('tous les segments disposent d une couverture de recherche robuste sans changer les cibles', () => {
    expect(BALANCED_E2E_500_PLAN.every((segment) => segment.queries.length >= 5)).toBe(true);
    expect(planTotal(BALANCED_E2E_500_PLAN)).toBe(500);
  });

  test('les deux derniers segments courts disposent d une réserve de requêtes suffisante', () => {
    const audio = BALANCED_E2E_500_PLAN.find((row) => row.id === 'tech-audio');
    const braking = BALANCED_E2E_500_PLAN.find((row) => row.id === 'auto-freinage');

    expect(audio.target).toBe(28);
    expect(braking.target).toBe(21);
    expect(audio.queries.length).toBeGreaterThanOrEqual(10);
    expect(braking.queries.length).toBeGreaterThanOrEqual(10);
  });

  test('la découverte garde une profondeur de rattrapage suffisante avant de déclarer un shortfall', () => {
    expect(sync.MAX_SEARCH_PAGES_PER_QUERY).toBeGreaterThanOrEqual(12);
  });

  test('alterne les mots-clés d’un segment pour diversifier les résultats CJ', () => {
    const segment = BALANCED_E2E_500_PLAN.find((row) => row.id === 'tech-phones');
    expect(sync.logicalSearchPage(segment, 1)).toEqual({ keyword: 'android smartphone', queryPage: 1 });
    expect(sync.logicalSearchPage(segment, 2)).toEqual({ keyword: 'mobile phone', queryPage: 1 });
    expect(sync.logicalSearchPage(segment, segment.queries.length)).toEqual({ keyword: 'usb c cable', queryPage: 1 });
    expect(sync.logicalSearchPage(segment, segment.queries.length + 1)).toEqual({ keyword: 'android smartphone', queryPage: 2 });
  });
});
