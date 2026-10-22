'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/catalog-product-detail', () => ({ getProductDetail: jest.fn() }));
jest.mock('../../services/market-local-price-resolution-service', () => ({
  applyActiveMarketPricesToCatalogRows: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const db = require('../../db');
const { getProductDetail } = require('../../services/catalog-product-detail');
const { applyActiveMarketPricesToCatalogRows } = require('../../services/market-local-price-resolution-service');
const router = require('../../routes/catalog-product-detail');

const ID = '11111111-1111-4111-8111-111111111111';
const app = express();
app.use('/', router);

function mockDetail() {
  getProductDetail.mockResolvedValue({
    product: { reference: 'REF-1' },
    media: [{ url: 'https://cdn.example.com/a.jpg' }],
    pricing: { price_kmf: 1000, old_price_kmf: null, promo_pct: null },
    sellable_units: [],
    delivery_options: [
      { code: 'SEA_STANDARD', label: 'Mer', available: true, price_kmf: 4200, eta_label: null, unavailable_reason: null },
    ],
  });
  applyActiveMarketPricesToCatalogRows.mockResolvedValue([
    { purchasable: true, market_price_source: 'LOCAL_ACTIVE', price_kmf: 1000 },
  ]);
}

function mockDb(currency) {
  db.query.mockImplementation(async (sql) => {
    if (/FROM markets/.test(sql)) return { rows: [{ currency }] };
    return { rows: [{ id: ID, price_kmf: 1000, promo_pct: null, is_promo: false, promo_until: null }] };
  });
}

describe('fiche produit — tarif transport par marché', () => {
  beforeEach(() => { jest.clearAllMocks(); mockDetail(); });

  test('marché KMF : tarif transport conservé', async () => {
    mockDb('KMF');
    const res = await request(app).get(`/${ID}/detail?market=KM`);
    expect(res.status).toBe(200);
    expect(res.body.delivery_options[0]).toMatchObject({ available: true, price_kmf: 4200 });
  });

  test('marché XAF : aucun prix de transport, option indisponible (comme le refus checkout)', async () => {
    mockDb('XAF');
    const res = await request(app).get(`/${ID}/detail?market=CM`);
    expect(res.status).toBe(200);
    expect(res.body.delivery_options[0]).toMatchObject({
      available: false,
      price_kmf: null,
      unavailable_reason: 'Livraison non tarifée sur ce marché',
    });
  });

  test('sans marché : contrat historique inchangé', async () => {
    mockDb('XAF');
    const res = await request(app).get(`/${ID}/detail`);
    expect(res.body.delivery_options[0]).toMatchObject({ available: true, price_kmf: 4200 });
  });
});
