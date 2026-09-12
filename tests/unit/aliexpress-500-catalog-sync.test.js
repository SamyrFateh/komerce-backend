'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/suppliers/connectors/aliexpress-connected-connector', () => ({
  invokeTop: jest.fn(),
  fetchProducts: jest.fn(),
}));
jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({ importCatalog: jest.fn() }));
jest.mock('../../services/suppliers/catalog-sync-checkpoint', () => ({
  getCheckpoint: jest.fn(),
  ensureCheckpoint: jest.fn(),
  markComplete: jest.fn(),
  recordPageSuccess: jest.fn(),
  recordError: jest.fn(),
  summarize: jest.fn(),
}));

const {
  runtimeEnvironment,
  runtimeConfig,
  normalizeCountryCode,
  positiveStock,
  basicCleanProduct,
  searchPlanTotal,
  logicalSearchPage,
  flattenTextSearchProducts,
  textSearchProductIds,
  checkpointCategoryId,
  importSourceFilename,
  stockSqlPredicate,
  withDiscoveryProvenance,
  SEARCH_PLAN,
  DEFAULT_PAGE_SIZE,
  DEFAULT_COUNTRY_CODE,
  DEFAULT_MAX_SEARCH_PAGES_PER_QUERY,
  ABSOLUTE_MAX_CLEAN_PRODUCTS,
} = require('../../scripts/aliexpress-500-catalog-sync');

describe('aliexpress-500-catalog-sync', () => {
  test('est staging-guardé et plafonné dur à 500 produits propres', () => {
    expect(ABSOLUTE_MAX_CLEAN_PRODUCTS).toBe(500);

    expect(() => runtimeConfig({
      DATABASE_URL: 'postgres://db',
      ALIEXPRESS_APP_KEY: 'app',
      ALIEXPRESS_APP_SECRET: 'secret',
      ALIEXPRESS_SESSION: 'session',
    })).toThrow(/KOMERCE_ALLOW_ALIEXPRESS_POOL_SYNC=1/);

    expect(() => runtimeConfig({
      NODE_ENV: 'production',
      KOMERCE_ALLOW_ALIEXPRESS_POOL_SYNC: '1',
      DATABASE_URL: 'postgres://db',
      ALIEXPRESS_APP_KEY: 'app',
      ALIEXPRESS_APP_SECRET: 'secret',
      ALIEXPRESS_SESSION: 'session',
    })).toThrow(/interdit en production/);

    expect(runtimeConfig({
      KOMERCE_ALLOW_ALIEXPRESS_POOL_SYNC: '1',
      DATABASE_URL: 'postgres://db',
      ALIEXPRESS_APP_KEY: 'app',
      ALIEXPRESS_APP_SECRET: 'secret',
      ALIEXPRESS_TOKEN_ENCRYPTION_KEY: '01234567890123456789012345678901',
    })).toMatchObject({
      pageSize: DEFAULT_PAGE_SIZE,
      maxSearchPagesPerQuery: DEFAULT_MAX_SEARCH_PAGES_PER_QUERY,
      countryCode: DEFAULT_COUNTRY_CODE,
      maxCleanProducts: 500,
      syncKey: 'aliexpress-instock-500-text-v1',
    });

    expect(() => runtimeConfig({
      KOMERCE_ALLOW_ALIEXPRESS_POOL_SYNC: '1',
      DATABASE_URL: 'postgres://db',
      ALIEXPRESS_APP_KEY: 'app',
      ALIEXPRESS_APP_SECRET: 'secret',
      ALIEXPRESS_SESSION: 'session',
      KOMERCE_ALIEXPRESS_MAX_CLEAN_PRODUCTS: '501',
    })).toThrow(/entre 1 et 500/);
  });

  test('KOMERCE_ENV est l’autorité runtime et staging prime NODE_ENV=production', () => {
    expect(runtimeEnvironment({ KOMERCE_ENV: 'staging', NODE_ENV: 'production' })).toBe('staging');
    expect(runtimeEnvironment({ NODE_ENV: 'production' })).toBe('production');

    expect(runtimeConfig({
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'production',
      KOMERCE_ALLOW_ALIEXPRESS_POOL_SYNC: '1',
      DATABASE_URL: 'postgres://db',
      ALIEXPRESS_APP_KEY: 'app',
      ALIEXPRESS_APP_SECRET: 'secret',
      ALIEXPRESS_SESSION: 'session',
    })).toMatchObject({ runtime: 'staging', countryCode: 'AE', maxCleanProducts: 500 });

    expect(() => runtimeConfig({
      KOMERCE_ENV: 'production',
      NODE_ENV: 'development',
      KOMERCE_ALLOW_ALIEXPRESS_POOL_SYNC: '1',
      DATABASE_URL: 'postgres://db',
      ALIEXPRESS_APP_KEY: 'app',
      ALIEXPRESS_APP_SECRET: 'secret',
      ALIEXPRESS_SESSION: 'session',
    })).toThrow(/interdit en production/);
  });

  test('accepte une session statique ou une session OAuth chiffrée, jamais aucune session', () => {
    expect(() => runtimeConfig({
      KOMERCE_ALLOW_ALIEXPRESS_POOL_SYNC: '1',
      DATABASE_URL: 'postgres://db',
      ALIEXPRESS_APP_KEY: 'app',
      ALIEXPRESS_APP_SECRET: 'secret',
    })).toThrow(/ALIEXPRESS_SESSION ou ALIEXPRESS_TOKEN_ENCRYPTION_KEY requis/);

    expect(runtimeConfig({
      KOMERCE_ALLOW_ALIEXPRESS_POOL_SYNC: '1',
      DATABASE_URL: 'postgres://db',
      ALIEXPRESS_APP_KEY: 'app',
      ALIEXPRESS_APP_SECRET: 'secret',
      ALIEXPRESS_SESSION: 'session',
    }).maxCleanProducts).toBe(500);
  });

  test('impose UAE comme destination fournisseur par défaut et valide les codes pays', () => {
    expect(normalizeCountryCode()).toBe('AE');
    expect(normalizeCountryCode('ae')).toBe('AE');
    expect(normalizeCountryCode('KM')).toBe('KM');
    expect(() => normalizeCountryCode('UAE')).toThrow(/ISO alpha-2/);
  });

  test('le plan de recherche couvre exactement 500 slots diversifiés', () => {
    expect(searchPlanTotal()).toBe(500);
    expect(SEARCH_PLAN.length).toBe(21);
    expect(new Set(SEARCH_PLAN.map((segment) => segment.id)).size).toBe(SEARCH_PLAN.length);
    expect(SEARCH_PLAN.every((segment) => segment.target > 0 && segment.queries.length >= 2)).toBe(true);
    expect(new Set(SEARCH_PLAN.map((segment) => segment.category)).size).toBeGreaterThanOrEqual(6);
  });

  test('alterne les requêtes d’un segment tout en avançant leurs pages', () => {
    const segment = { id: 'x', queries: ['smartwatch', 'wrist watch'] };
    expect(logicalSearchPage(segment, 1)).toEqual({ keyword: 'smartwatch', queryIndex: 0, queryPage: 1 });
    expect(logicalSearchPage(segment, 2)).toEqual({ keyword: 'wrist watch', queryIndex: 1, queryPage: 1 });
    expect(logicalSearchPage(segment, 3)).toEqual({ keyword: 'smartwatch', queryIndex: 0, queryPage: 2 });
    expect(logicalSearchPage(segment, 4)).toEqual({ keyword: 'wrist watch', queryIndex: 1, queryPage: 2 });
  });

  test('parse la forme live ds.text.search sans dépendre de totalCount', () => {
    const payload = {
      code: '00',
      data: {
        pageIndex: 1,
        pageSize: 20,
        totalCount: null,
        products: {
          selection_search_product: [
            { itemId: '1005005902775553', title: 'Phone A' },
            { itemId: '1005010643835400', title: 'Phone B' },
            { itemId: '1005005902775553', title: 'Phone A duplicate' },
          ],
        },
      },
    };

    expect(flattenTextSearchProducts(payload)).toHaveLength(3);
    expect(textSearchProductIds(payload)).toEqual(['1005005902775553', '1005010643835400']);
  });

  test('ne compte comme propre qu’un produit réellement achetable et en stock', () => {
    const base = {
      supplier_product_id: '4000102715995',
      product_name: 'USB-C charger',
      image_url: 'https://ae01.alicdn.com/kf/example.jpg',
      purchase_price: 8.5,
      stock_available: 23,
      sellable_units: [
        { supplier_sku: 'sku-1', is_active: true, stock_available: 10 },
        { supplier_sku: 'sku-2', is_active: true, stock_available: 13 },
      ],
    };

    expect(basicCleanProduct(base)).toBe(true);
    expect(basicCleanProduct({ ...base, image_url: 'http://example.com/p.jpg' })).toBe(false);
    expect(basicCleanProduct({ ...base, purchase_price: 0 })).toBe(false);
    expect(basicCleanProduct({ ...base, stock_available: 0 })).toBe(false);
    expect(basicCleanProduct({
      ...base,
      sellable_units: [{ supplier_sku: 'sku-1', is_active: true, stock_available: 0 }],
    })).toBe(false);
  });

  test('positiveStock refuse null, zéro, négatif et texte non numérique', () => {
    expect(positiveStock(1)).toBe(true);
    expect(positiveStock('2')).toBe(true);
    expect(positiveStock(0)).toBe(false);
    expect(positiveStock(-1)).toBe(false);
    expect(positiveStock(null)).toBe(false);
    expect(positiveStock('n/a')).toBe(false);
  });

  test('génère des checkpoints et sources déterministes par segment', () => {
    expect(checkpointCategoryId({ id: 'tech-audio' })).toBe('text:tech-audio');
    expect(importSourceFilename('epoch-1', 'tech-audio', 7))
      .toBe('aliexpress-pool/epoch-1/tech-audio/page-0007.json');
    expect(stockSqlPredicate('x')).toContain("x.normalized_source_contract ? 'stock_available'");
    expect(stockSqlPredicate('x')).toContain("::numeric > 0");
  });

  test('préserve la provenance de découverte sans remplacer l’autorité détail fournisseur', () => {
    const product = {
      supplier_product_id: '1005005902775553',
      raw_payload: { source: 'aliexpress_ds_api', aliexpress: { detail: { result: true } } },
    };
    const segment = SEARCH_PLAN.find((row) => row.id === 'tech-phones');
    const decorated = withDiscoveryProvenance(product, {
      segment,
      keyword: 'android smartphone',
      queryPage: 2,
    });

    expect(decorated.raw_payload.source).toBe('aliexpress_ds_api');
    expect(decorated.raw_payload.aliexpress).toEqual({ detail: { result: true } });
    expect(decorated.raw_payload.discovery).toMatchObject({
      source: 'aliexpress.ds.text.search',
      segment_id: 'tech-phones',
      target_category: 'Tech',
      target_subcategory: 'Phones',
      keyword: 'android smartphone',
      query_page: 2,
      supplier_destination_country: 'AE',
    });
  });
});