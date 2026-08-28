'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/local-stock-routes.test.js
 *
 * Tests du router routes/local-stock.js (Vague 2 D4 — GET read-only shadow)
 *
 * Couverture :
 *   ✓ GET /availability : 400 si product_id ou market_id manquant
 *   ✓ GET /availability : renvoie { availability, exposable }, jamais le pourquoi
 *   ✓ GET /availability : appelle le service avec les bons paramètres
 */

const mockGetAvailability = jest.fn();
const mockIsStockExposable = jest.fn();
jest.mock('../../services/local-stock-service', () => ({
  getAvailability: (...a) => mockGetAvailability(...a),
  isStockExposable: (...a) => mockIsStockExposable(...a),
}));

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
const MARKET_ID  = '22222222-2222-2222-2222-222222222222';

describe('GET /api/local-stock/availability', () => {
  it('400 si product_id manquant', async () => {
    const res = await request(app).get('/api/local-stock/availability').query({ market_id: MARKET_ID });
    expect(res.status).toBe(400);
    expect(mockGetAvailability).not.toHaveBeenCalled();
  });

  it('400 si market_id manquant', async () => {
    const res = await request(app).get('/api/local-stock/availability').query({ product_id: PRODUCT_ID });
    expect(res.status).toBe(400);
  });

  it('nominal : renvoie availability et exposable, jamais le détail (allocations, exposure brut)', async () => {
    mockGetAvailability.mockResolvedValue('AVAILABLE_NOW');
    mockIsStockExposable.mockResolvedValue(true);

    const res = await request(app).get('/api/local-stock/availability')
      .query({ product_id: PRODUCT_ID, market_id: MARKET_ID });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ availability: 'AVAILABLE_NOW', exposable: true });
    expect(Object.keys(res.body)).toEqual(['availability', 'exposable']); // rien de plus
  });

  it('appelle le service avec product_id/market_id transmis tels quels', async () => {
    mockGetAvailability.mockResolvedValue('UNAVAILABLE');
    mockIsStockExposable.mockResolvedValue(false);

    await request(app).get('/api/local-stock/availability')
      .query({ product_id: PRODUCT_ID, market_id: MARKET_ID });

    expect(mockGetAvailability).toHaveBeenCalledWith(PRODUCT_ID, MARKET_ID);
    expect(mockIsStockExposable).toHaveBeenCalledWith(PRODUCT_ID, MARKET_ID);
  });

  it('propage une erreur de service via next(err) — pas de crash non géré', async () => {
    mockGetAvailability.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/local-stock/availability')
      .query({ product_id: PRODUCT_ID, market_id: MARKET_ID });
    expect(res.status).toBe(500);
  });
});
