'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const express = require('express');
const request = require('supertest');
const id = '11111111-1111-1111-1111-111111111111';
const legacy = { id, name: 'Public', description: 'Public desc', name_source: 'Legacy source', description_source: 'Legacy source desc', source_locale: 'en', price_kmf: 5000, stock: 7, is_active: true, lifecycle_status: 'active', has_variants: false };

function loadRoute({ visible = true, throwCanary = false } = {}) {
  jest.resetModules();
  const query = jest.fn(async () => ({ rows: visible ? [legacy] : [] }));
  jest.doMock('../../db', () => ({ query }));
  jest.doMock('../../services/sourcing-catalog-product-linkage', () => ({
    findCanonicalProductIdsForCatalogProduct: jest.fn(async () => {
      if (throwCanary) throw new Error('canary db');
      return ['canon-1'];
    }),
  }));
  jest.doMock('../../services/sourcing-canonical-product-projection', () => ({
    collectCanonicalProductProjectionById: jest.fn(async () => ({
      canonical_product_id: 'canon-1',
      fields: {
        product_name: { status: 'CONSENSUS', value: 'Canonical source' },
        description: { status: 'ABSENT', value: null },
        source_locale: { status: 'CONSENSUS', value: 'fr' },
      },
    })),
  }));
  const pricing = jest.fn(async (_db, { products }) => products);
  jest.doMock('../../services/market-local-price-resolution-service', () => ({ applyActiveMarketPricesToCatalogRows: pricing }));
  jest.doMock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));
  const router = require('../../routes/products');
  const app = express();
  app.use('/api/products', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return { app, query, pricing };
}

beforeEach(() => {
  process.env.CATALOG_PRODUCT_READ_MODE = 'CANARY';
  process.env.CATALOG_PRODUCT_ROUTE_CANARY_ENABLED = 'true';
  process.env.CATALOG_PRODUCT_ROUTE_CANARY_PRODUCT_IDS = id;
});
afterEach(() => {
  delete process.env.CATALOG_PRODUCT_READ_MODE;
  delete process.env.CATALOG_PRODUCT_ROUTE_CANARY_ENABLED;
  delete process.env.CATALOG_PRODUCT_ROUTE_CANARY_PRODUCT_IDS;
  jest.resetModules();
});

test('route réelle traverse canary, seam, pricing et public view sans changer le JSON public', async () => {
  const { app, pricing } = loadRoute();
  const res = await request(app).get('/api/products/' + id).set('x-komerce-catalog-canary', 'v1');
  expect(res.status).toBe(200);
  expect(pricing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    products: [expect.objectContaining({ name_source: 'Canonical source', description_source: 'Legacy source desc', source_locale: 'fr', price_kmf: 5000, stock: 7 })],
  }));
  expect(res.body).toMatchObject({ id, name: 'Public', description: 'Public desc', price_kmf: 5000, stock: 7 });
  expect(res.body).not.toHaveProperty('diagnostic');
});

test('invisible retourne 404 avant tout canary lookup', async () => {
  const { app, query } = loadRoute({ visible: false });
  const linkage = require('../../services/sourcing-catalog-product-linkage');
  const res = await request(app).get('/api/products/' + id).set('x-komerce-catalog-canary', 'v1');
  expect(res.status).toBe(404);
  expect(query).toHaveBeenCalledTimes(1);
  expect(linkage.findCanonicalProductIdsForCatalogProduct).not.toHaveBeenCalled();
});

test('erreur canary retourne HTTP 200 legacy normal', async () => {
  const { app, pricing } = loadRoute({ throwCanary: true });
  const res = await request(app).get('/api/products/' + id).set('x-komerce-catalog-canary', 'v1');
  expect(res.status).toBe(200);
  expect(pricing.mock.calls[0][1].products[0]).toBe(legacy);
  expect(res.body).not.toHaveProperty('diagnostic');
});
