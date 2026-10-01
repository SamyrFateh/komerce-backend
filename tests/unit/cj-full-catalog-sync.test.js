'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/suppliers/connectors/cj-connector', () => ({ fetchProducts: jest.fn() }));
jest.mock('../../services/suppliers/cj-catalog-index', () => ({ fetchCategories: jest.fn() }));
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
  isQuotaError,
  totalPagesFor,
  importSourceFilename,
  basicCleanProduct,
  CJ_RESULT_CAP,
  ABSOLUTE_MAX_CLEAN_PRODUCTS,
  runSync,
} = require('../../scripts/cj-full-catalog-sync');

describe('cj-full-catalog-sync clean pool', () => {
  test('est gardé et plafonné dur à 1000 produits propres', () => {
    expect(ABSOLUTE_MAX_CLEAN_PRODUCTS).toBe(1000);

    expect(() => runtimeConfig({
      DATABASE_URL: 'postgres://db',
      CJ_API_KEY: 'secret',
    })).toThrow(/KOMERCE_ALLOW_CJ_FULL_SYNC=1/);

    expect(runtimeConfig({
      KOMERCE_ALLOW_CJ_FULL_SYNC: '1',
      DATABASE_URL: 'postgres://db',
      CJ_API_KEY: 'secret',
      KOMERCE_CJ_SYNC_MAX_CLEAN_PRODUCTS: '1000',
      KOMERCE_CJ_SYNC_MAX_API_CALLS: '400',
    })).toMatchObject({
      maxCleanProducts: 1000,
      maxApiCalls: 400,
      pageSize: 100,
    });

    expect(() => runtimeConfig({
      KOMERCE_ALLOW_CJ_FULL_SYNC: '1',
      DATABASE_URL: 'postgres://db',
      CJ_API_KEY: 'secret',
      KOMERCE_CJ_SYNC_MAX_CLEAN_PRODUCTS: '1001',
    })).toThrow(/entre 1 et 1000/);
  });

  test('considère propre uniquement une référence exploitable avec image HTTPS et prix', () => {
    expect(basicCleanProduct({
      supplier_product_id: 'cj-1',
      product_name: 'Produit',
      image_url: 'https://cf.cjdropshipping.com/p.jpg',
      purchase_price: 3.5,
    })).toBe(true);

    expect(basicCleanProduct({
      supplier_product_id: 'cj-2',
      product_name: 'Produit',
      image_url: 'http://example.com/p.jpg',
      purchase_price: 3.5,
    })).toBe(false);

    expect(basicCleanProduct({
      supplier_product_id: 'cj-3',
      product_name: 'Produit',
      image_url: 'https://example.com/p.jpg',
      purchase_price: null,
    })).toBe(false);
  });

  test('respecte les bornes de pagination CJ listV2', () => {
    expect(totalPagesFor(0, 100)).toBe(0);
    expect(totalPagesFor(1, 100)).toBe(1);
    expect(totalPagesFor(101, 100)).toBe(2);
    expect(totalPagesFor(CJ_RESULT_CAP, 100)).toBe(60);
  });

  test('génère une référence de page déterministe pour reprise', () => {
    expect(importSourceFilename('epoch-1', 'cat-42', 7))
      .toBe('cj-pool/epoch-1/cat-42/page-0007.json');
  });


  test('runSync peut auditer le pool initial sans ReferenceError et s’arrête si la cible est déjà atteinte', async () => {
    const db = require('../../db');
    const checkpoints = require('../../services/suppliers/catalog-sync-checkpoint');
    const previous = {
      allow: process.env.KOMERCE_ALLOW_CJ_FULL_SYNC,
      database: process.env.DATABASE_URL,
      token: process.env.CJ_ACCESS_TOKEN,
      target: process.env.KOMERCE_CJ_SYNC_MAX_CLEAN_PRODUCTS,
    };
    process.env.KOMERCE_ALLOW_CJ_FULL_SYNC = '1';
    process.env.DATABASE_URL = 'postgres://db';
    process.env.CJ_ACCESS_TOKEN = 'test-token';
    process.env.KOMERCE_CJ_SYNC_MAX_CLEAN_PRODUCTS = '21';
    db.query.mockResolvedValueOnce({ rows: [{ count: 21 }] });
    checkpoints.summarize.mockResolvedValueOnce({});

    try {
      await expect(runSync()).resolves.toMatchObject({
        starting_clean: 21,
        final_clean: 21,
        target: 21,
        paused_reason: 'target-already-reached',
      });
    } finally {
      if (previous.allow === undefined) delete process.env.KOMERCE_ALLOW_CJ_FULL_SYNC; else process.env.KOMERCE_ALLOW_CJ_FULL_SYNC = previous.allow;
      if (previous.database === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.database;
      if (previous.token === undefined) delete process.env.CJ_ACCESS_TOKEN; else process.env.CJ_ACCESS_TOKEN = previous.token;
      if (previous.target === undefined) delete process.env.KOMERCE_CJ_SYNC_MAX_CLEAN_PRODUCTS; else process.env.KOMERCE_CJ_SYNC_MAX_CLEAN_PRODUCTS = previous.target;
    }
  });

  test('reconnaît les arrêts quota comme pauses reprenables', () => {
    expect(isQuotaError(new Error('429 Too Many Requests'))).toBe(true);
    expect(isQuotaError(new Error('Insufficient API points'))).toBe(true);
    expect(isQuotaError(new Error('network reset'))).toBe(false);
  });
});
