'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/local-stock-routes.test.js
 *
 * Tests du router routes/local-stock.js (Vague 2 D4 — GET read-only shadow,
 * corrigé lors de D6 : market est un CODE (KM/YT/CM/CG), jamais un UUID brut
 * confié au client — window.KomerceMarket.get().code côté frontend,
 * KOMERCE_MARKET_LAYER_FREEZE.md §3 : "navigation... NON autorisant".
 * resolveMarketId() traduit le code en UUID réel côté serveur avant tout
 * appel à isStockExposable/getAvailability.
 *
 * Couverture :
 *   ✓ GET /availability : 400 si product_id ou market manquant
 *   ✓ GET /availability : 400 si le code marché est inconnu/inactif
 *   ✓ GET /availability : renvoie { availability, exposable }, jamais le pourquoi
 *   ✓ GET /availability : résout le code en UUID réel avant d'appeler le service
 *     (jamais le code brut transmis à isStockExposable/getAvailability)
 */

const mockGetAvailability = jest.fn();
const mockIsStockExposable = jest.fn();
const mockDbQuery = jest.fn();
jest.mock('../../services/local-stock-service', () => ({
  getAvailability: (...a) => mockGetAvailability(...a),
  isStockExposable: (...a) => mockIsStockExposable(...a),
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
const MARKET_ID  = '22222222-2222-2222-2222-222222222222';

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
    mockDbQuery.mockResolvedValue({ rows: [] }); // aucun marché actif pour ce code
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
    expect(Object.keys(res.body)).toEqual(['availability', 'exposable']); // rien de plus
  });

  it('appelle le service avec l\'UUID RÉSOLU, jamais le code brut du client', async () => {
    mockDbQuery.mockResolvedValue({ rows: [{ id: MARKET_ID }] });
    mockGetAvailability.mockResolvedValue('UNAVAILABLE');
    mockIsStockExposable.mockResolvedValue(false);

    await request(app).get('/api/local-stock/availability')
      .query({ product_id: PRODUCT_ID, market: 'KM' });

    expect(mockGetAvailability).toHaveBeenCalledWith(PRODUCT_ID, MARKET_ID);
    expect(mockIsStockExposable).toHaveBeenCalledWith(PRODUCT_ID, MARKET_ID);
    // jamais 'KM' (le code brut) transmis au service — uniquement l'UUID résolu
    expect(mockGetAvailability).not.toHaveBeenCalledWith(PRODUCT_ID, 'KM');
  });

  it('la résolution de code ne fait confiance qu\'à markets.is_active — jamais un marché désactivé', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] }); // is_active=false filtré côté SQL
    const res = await request(app).get('/api/local-stock/availability')
      .query({ product_id: PRODUCT_ID, market: 'KM' });
    expect(res.status).toBe(400);
    const [sql] = mockDbQuery.mock.calls[0];
    expect(sql).toMatch(/is_active\s*=\s*true/);
  });

  it('propage une erreur de service via next(err) — pas de crash non géré', async () => {
    mockDbQuery.mockResolvedValue({ rows: [{ id: MARKET_ID }] });
    mockGetAvailability.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/local-stock/availability')
      .query({ product_id: PRODUCT_ID, market: 'KM' });
    expect(res.status).toBe(500);
  });
});
