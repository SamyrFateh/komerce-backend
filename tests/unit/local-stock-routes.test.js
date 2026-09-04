'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * routes/local-stock.js
 *
 * Couverture des projections publiques read-only :
 * - /availability : Discovery, market CODE résolu serveur ;
 * - /checkout-preview : quantité + relais, market_id résolu depuis le relais
 *   côté serveur, jamais une réservation ni une autorité transactionnelle.
 */

const mockGetAvailability = jest.fn();
const mockIsStockExposable = jest.fn();
const mockPreviewCheckoutFulfillmentSources = jest.fn();
const mockDbQuery = jest.fn();

jest.mock('../../services/local-stock-service', () => ({
  getAvailability: (...a) => mockGetAvailability(...a),
  isStockExposable: (...a) => mockIsStockExposable(...a),
}));
jest.mock('../../services/local-stock-checkout-preview', () => ({
  previewCheckoutFulfillmentSources: (...a) => mockPreviewCheckoutFulfillmentSources(...a),
}));
jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/local-stock');
    app.use('/api/local-stock', router);
  });
});

const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';
const PRODUCT_ID_2 = '99999999-9999-9999-9999-999999999999';
const MARKET_ID  = '22222222-2222-2222-2222-222222222222';
const RELAIS_ID  = '33333333-3333-3333-3333-333333333333';

describe('GET /api/local-stock/availability', () => {
  it('400 si product_id manquant', async () => {
    const res = await request(app).get('/api/local-stock/availability').query({ market: 'KM' });
    expect(res.status).toBe(400);
    expect(mockGetAvailability).not.toHaveBeenCalled();
  });

  it('400 si market manquant', async () => {
    const res = await request(app).get('/api/local-stock/availability').query({ product_id: PRODUCT_ID });
    expect(res.status).toBe(400);
  });

  it('400 si le code marché est inconnu ou inactif — jamais un appel au service', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/local-stock/availability')
      .query({ product_id: PRODUCT_ID, market: 'ZZ' });
    expect(res.status).toBe(400);
    expect(mockGetAvailability).not.toHaveBeenCalled();
  });

  it('nominal : résout le code en UUID réel, renvoie availability et exposable, jamais le détail', async () => {
    mockDbQuery.mockResolvedValue({ rows: [{ id: MARKET_ID }] });
    mockGetAvailability.mockResolvedValue('AVAILABLE_NOW');
    mockIsStockExposable.mockResolvedValue(true);

    const res = await request(app).get('/api/local-stock/availability')
      .query({ product_id: PRODUCT_ID, market: 'KM' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ availability: 'AVAILABLE_NOW', exposable: true });
    expect(Object.keys(res.body)).toEqual(['availability', 'exposable']);
  });

  it('appelle le service avec l\'UUID RÉSOLU, jamais le code brut du client', async () => {
    mockDbQuery.mockResolvedValue({ rows: [{ id: MARKET_ID }] });
    mockGetAvailability.mockResolvedValue('UNAVAILABLE');
    mockIsStockExposable.mockResolvedValue(false);

    await request(app).get('/api/local-stock/availability')
      .query({ product_id: PRODUCT_ID, market: 'KM' });

    expect(mockGetAvailability).toHaveBeenCalledWith(PRODUCT_ID, MARKET_ID);
    expect(mockIsStockExposable).toHaveBeenCalledWith(PRODUCT_ID, MARKET_ID);
    expect(mockGetAvailability).not.toHaveBeenCalledWith(PRODUCT_ID, 'KM');
  });

  it('la résolution de code ne fait confiance qu\'à markets.is_active', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/local-stock/availability')
      .query({ product_id: PRODUCT_ID, market: 'KM' });
    expect(res.status).toBe(400);
    const [sql] = mockDbQuery.mock.calls[0];
    expect(sql).toMatch(/is_active\s*=\s*true/);
  });

  it('propage une erreur de service via next(err)', async () => {
    mockDbQuery.mockResolvedValue({ rows: [{ id: MARKET_ID }] });
    mockGetAvailability.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/local-stock/availability')
      .query({ product_id: PRODUCT_ID, market: 'KM' });
    expect(res.status).toBe(500);
  });
});

describe('GET /api/local-stock/checkout-preview', () => {
  it('400 sans relais_id ou sans produit', async () => {
    expect((await request(app).get('/api/local-stock/checkout-preview')
      .query({ product_id: PRODUCT_ID, quantity: 1 })).status).toBe(400);
    expect((await request(app).get('/api/local-stock/checkout-preview')
      .query({ relais_id: RELAIS_ID })).status).toBe(400);
    expect(mockPreviewCheckoutFulfillmentSources).not.toHaveBeenCalled();
  });

  it('400 si les quantités ne correspondent pas aux product_id', async () => {
    const res = await request(app).get('/api/local-stock/checkout-preview')
      .query({
        relais_id: RELAIS_ID,
        product_id: [PRODUCT_ID, PRODUCT_ID_2],
        quantity: [1],
      });
    expect(res.status).toBe(400);
  });

  it('400 si le relais est inconnu/inactif/sans marché', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/local-stock/checkout-preview')
      .query({ relais_id: RELAIS_ID, product_id: PRODUCT_ID, quantity: 2 });

    expect(res.status).toBe(400);
    expect(mockPreviewCheckoutFulfillmentSources).not.toHaveBeenCalled();
    expect(mockDbQuery.mock.calls[0][0]).toMatch(/FROM relais/);
    expect(mockDbQuery.mock.calls[0][0]).toMatch(/is_active\s*=\s*TRUE/);
  });

  it('résout le marché depuis le relais et renvoie uniquement la projection minimale', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ market_id: MARKET_ID }] });
    mockPreviewCheckoutFulfillmentSources.mockResolvedValueOnce({
      [PRODUCT_ID]: 'LOCAL_STOCK',
      [PRODUCT_ID_2]: 'IMPORT',
    });

    const res = await request(app).get('/api/local-stock/checkout-preview')
      .query({
        relais_id: RELAIS_ID,
        product_id: [PRODUCT_ID, PRODUCT_ID_2],
        quantity: [2, 1],
      });

    expect(res.status).toBe(200);
    expect(mockPreviewCheckoutFulfillmentSources).toHaveBeenCalledWith({
      marketId: MARKET_ID,
      demands: [
        { productId: PRODUCT_ID, quantity: 2 },
        { productId: PRODUCT_ID_2, quantity: 1 },
      ],
    });
    expect(res.body).toEqual({
      preview: true,
      relais_id: RELAIS_ID,
      items: [
        { product_id: PRODUCT_ID, state: 'LOCAL_STOCK' },
        { product_id: PRODUCT_ID_2, state: 'IMPORT' },
      ],
    });
  });

  it('ne renvoie jamais les quantités physiques ni les allocations', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ market_id: MARKET_ID }] });
    mockPreviewCheckoutFulfillmentSources.mockResolvedValueOnce({
      [PRODUCT_ID]: 'REVIEW_REQUIRED',
    });

    const res = await request(app).get('/api/local-stock/checkout-preview')
      .query({ relais_id: RELAIS_ID, product_id: PRODUCT_ID, quantity: 4 });

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/qty_physical|active_allocated|available/);
    expect(res.body.items[0]).toEqual({ product_id: PRODUCT_ID, state: 'REVIEW_REQUIRED' });
  });
});