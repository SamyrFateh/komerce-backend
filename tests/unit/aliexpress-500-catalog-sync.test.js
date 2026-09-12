'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/suppliers/connectors/aliexpress-connected-connector', () => ({ fetchProducts: jest.fn() }));
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
  runtimeConfig,
  positiveStock,
  basicCleanProduct,
  totalPagesFor,
  importSourceFilename,
  stockSqlPredicate,
  DEFAULT_PAGE_SIZE,
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

    expect(runtimeConfig({
      KOMERCE_ALLOW_ALIEXPRESS_POOL_SYNC: '1',
      DATABASE_URL: 'postgres://db',
      ALIEXPRESS_APP_KEY: 'app',
      ALIEXPRESS_APP_SECRET: 'secret',
      ALIEXPRESS_TOKEN_ENCRYPTION_KEY: '01234567890123456789012345678901',
    })).toMatchObject({
      pageSize: DEFAULT_PAGE_SIZE,
      maxCleanProducts: 500,
      feedName: 'DS bestseller',
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

  test('respecte la pagination AliExpress et le budget de pages', () => {
    expect(totalPagesFor(0, 50, 40)).toBe(0);
    expect(totalPagesFor(1, 50, 40)).toBe(1);
    expect(totalPagesFor(500, 50, 40)).toBe(10);
    expect(totalPagesFor(5000, 50, 40)).toBe(40);
  });

  test('génère une référence de page déterministe et un prédicat stock borné', () => {
    expect(importSourceFilename('epoch-1', 7))
      .toBe('aliexpress-pool/epoch-1/page-0007.json');
    expect(stockSqlPredicate('x')).toContain("x.normalized_source_contract ? 'stock_available'");
    expect(stockSqlPredicate('x')).toContain("::numeric > 0");
  });
});
