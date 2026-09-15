'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/catalog-product-detail', () => ({ getProductDetail: jest.fn() }));
jest.mock('../../services/catalog-market-exposure-service', () => ({ isProductExposedForMarketCode: jest.fn() }));
jest.mock('../../services/market-local-price-resolution-service', () => ({
  applyActiveMarketPricesToCatalogRows: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const db = require('../../db');
const { getProductDetail } = require('../../services/catalog-product-detail');
const { isProductExposedForMarketCode } = require('../../services/catalog-market-exposure-service');
const { applyActiveMarketPricesToCatalogRows } = require('../../services/market-local-price-resolution-service');
const { publicCatalogVisibilitySql } = require('../../services/catalog-public-view');
const productDetailRouter = require('../../routes/catalog-product-detail');

function baseDetail() {
  return {
    contract_version: '1',
    product: { id: PRODUCT_ID, reference: 'L1-BOUNDARY', name: 'Produit test' },
    media: [{ id: 'm1', url: 'https://cdn.example.com/p.jpg' }],
    pricing: { price_kmf: 5000, old_price_kmf: null, promo_pct: null },
    sellable_units: [{ sku_id: 'sku-1', price_kmf: 5000 }],
  };
}

function app() {
  const instance = express();
  instance.use('/api/products', productDetailRouter);
  instance.use((err, _req, res, _next) => res.status(500).json({ error: err.message, code: err.code || null }));
  return instance;
}

describe('L1 only_LOCAL_ACTIVE_is_buyer_effective', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('le prédicat catalogue marché exige LOCAL_ACTIVE avant pagination', () => {
    const sql = publicCatalogVisibilitySql('p', { marketCodeParamIndex: 1 });
    expect(sql).toContain('product_market_exposure');
    expect(sql).toContain("pme.commercial_exposure = 'ENABLED'");
    expect(sql).toContain('product_market_price_drafts');
    expect(sql).toContain("pmpd.status = 'LOCAL_ACTIVE'");
    expect(sql).toContain('pmpd_mkt.code = $1');
  });

  test('sans contexte marché, le catalogue ne requiert pas LOCAL_ACTIVE', () => {
    const sql = publicCatalogVisibilitySql('p');
    expect(sql).not.toContain('product_market_price_drafts');
  });

  test('GET /:id/detail refuse un produit exposé sans LOCAL_ACTIVE au lieu de rendre le prix global', async () => {
    getProductDetail.mockResolvedValue(baseDetail());
    isProductExposedForMarketCode.mockResolvedValue(true);
    db.query.mockResolvedValue({
      rows: [{ id: PRODUCT_ID, price_kmf: 5000, promo_pct: 0, is_promo: false, promo_until: null }],
    });
    applyActiveMarketPricesToCatalogRows.mockResolvedValue([{
      id: PRODUCT_ID,
      price_kmf: 5000,
      purchasable: false,
      market_price_source: 'NOT_DECISIONAL',
    }]);

    const response = await request(app())
      .get(`/api/products/${PRODUCT_ID}/detail?market=CM`)
      .expect(404);

    expect(response.body).toEqual({ error: 'Produit non disponible sur ce marché' });
  });

  test('GET /:id/detail remplace le prix global par LOCAL_ACTIVE quand la décision existe', async () => {
    getProductDetail.mockResolvedValue(baseDetail());
    isProductExposedForMarketCode.mockResolvedValue(true);
    db.query.mockResolvedValue({
      rows: [{ id: PRODUCT_ID, price_kmf: 5000, promo_pct: 0, is_promo: false, promo_until: null }],
    });
    applyActiveMarketPricesToCatalogRows.mockResolvedValue([{
      id: PRODUCT_ID,
      price_kmf: 9000,
      purchasable: true,
      market_price_source: 'LOCAL_ACTIVE',
      market_price_promo_applied: false,
      market_price_base_kmf: 9000,
    }]);

    const response = await request(app())
      .get(`/api/products/${PRODUCT_ID}/detail?market=CM`)
      .expect(200);

    expect(response.body.pricing.price_kmf).toBe(9000);
    expect(response.body.sellable_units[0].price_kmf).toBe(9000);
  });
});
