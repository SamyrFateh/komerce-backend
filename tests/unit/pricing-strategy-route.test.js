/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/pricing-strategy (Lot B2)
 *
 * Façade mince (ADR-013) : couvre auth/validation/dispatch vers
 * services/pricing-strategy-service.js (déjà testé isolément dans
 * pricing-strategy-service.test.js). Le service est mocké ici — on ne
 * teste que le comportement HTTP de la route.
 *
 * Run : npx jest tests/unit/pricing-strategy-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../db', () => ({ query: jest.fn() }));

let mockUser = { id: 'user-1', role: 'client' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Token manquant' });
    req.user = mockUser;
    next();
  },
}));

jest.mock('../../services/pricing-strategy-service', () => ({
  getCompetitors: jest.fn(),
  addCompetitor: jest.fn(),
  softDeleteCompetitor: jest.fn(),
  getStrategy: jest.fn(),
  applyStrategy: jest.fn(),
  getStrategyHistory: jest.fn(),
}));

const svc = require('../../services/pricing-strategy-service');
const router = require('../../routes/pricing-strategy');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/pricing/strategy', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/pricing-strategy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: 'user-1', role: 'client' };
  });

  describe('GET /competitors', () => {
    test('accessible à un client authentifié', async () => {
      svc.getCompetitors.mockResolvedValueOnce({ count: 1, competitors: [{ id: 'c1' }] });

      const res = await request(buildApp())
        .get('/api/pricing/strategy/competitors')
        .query({ product_id: 'p1' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ count: 1, competitors: [{ id: 'c1' }] });
      expect(svc.getCompetitors).toHaveBeenCalledWith(expect.anything(), { product_id: 'p1', category: undefined });
    });

    test('refuse sans authentification', async () => {
      mockUser = null;
      const res = await request(buildApp()).get('/api/pricing/strategy/competitors');
      expect(res.status).toBe(401);
      expect(svc.getCompetitors).not.toHaveBeenCalled();
    });

    test('propage une erreur inattendue au handler global', async () => {
      svc.getCompetitors.mockRejectedValueOnce(new Error('db down'));
      const res = await request(buildApp()).get('/api/pricing/strategy/competitors');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /competitors', () => {
    test('refuse un non-admin', async () => {
      const res = await request(buildApp())
        .post('/api/pricing/strategy/competitors')
        .send({ competitor_name: 'X', price_kmf: 1000, product_id: 'p1' });

      expect(res.status).toBe(403);
      expect(svc.addCompetitor).not.toHaveBeenCalled();
    });

    test('valide competitor_name manquant (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const res = await request(buildApp())
        .post('/api/pricing/strategy/competitors')
        .send({ price_kmf: 1000, product_id: 'p1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/competitor_name/);
    });

    test('valide price_kmf invalide (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const res = await request(buildApp())
        .post('/api/pricing/strategy/competitors')
        .send({ competitor_name: 'X', price_kmf: 0, product_id: 'p1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/price_kmf/);
    });

    test('valide product_id/category manquants (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const res = await request(buildApp())
        .post('/api/pricing/strategy/competitors')
        .send({ competitor_name: 'X', price_kmf: 1000 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/product_id or category/);
    });

    test('crée un prix concurrent valide (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      svc.addCompetitor.mockResolvedValueOnce({ id: 'c1', competitor_name: 'X' });

      const res = await request(buildApp())
        .post('/api/pricing/strategy/competitors')
        .send({ competitor_name: 'X', price_kmf: 1000, product_id: 'p1' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 'c1', competitor_name: 'X' });
    });
  });

  describe('DELETE /competitors/:id', () => {
    test('refuse un non-admin', async () => {
      const res = await request(buildApp()).delete('/api/pricing/strategy/competitors/c1');
      expect(res.status).toBe(403);
      expect(svc.softDeleteCompetitor).not.toHaveBeenCalled();
    });

    test('soft-delete un prix concurrent (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      svc.softDeleteCompetitor.mockResolvedValueOnce({ ok: true });

      const res = await request(buildApp()).delete('/api/pricing/strategy/competitors/c1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(svc.softDeleteCompetitor).toHaveBeenCalledWith(expect.anything(), 'c1');
    });
  });

  describe('GET /', () => {
    test('exige product_id ou category', async () => {
      const res = await request(buildApp()).get('/api/pricing/strategy');
      expect(res.status).toBe(400);
      expect(svc.getStrategy).not.toHaveBeenCalled();
    });

    test('renvoie la stratégie pour un product_id', async () => {
      svc.getStrategy.mockResolvedValueOnce({ target: { product_id: 'p1' } });

      const res = await request(buildApp()).get('/api/pricing/strategy').query({ product_id: 'p1' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ target: { product_id: 'p1' } });
    });

    test('renvoie 404 si le service lève une erreur status=404', async () => {
      svc.getStrategy.mockRejectedValueOnce(Object.assign(new Error('Product not found'), { status: 404 }));

      const res = await request(buildApp()).get('/api/pricing/strategy').query({ product_id: 'inconnu' });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Product not found' });
    });

    test('propage une erreur non-404 au handler global', async () => {
      svc.getStrategy.mockRejectedValueOnce(new Error('db down'));

      const res = await request(buildApp()).get('/api/pricing/strategy').query({ product_id: 'p1' });

      expect(res.status).toBe(500);
    });
  });

  describe('POST /apply', () => {
    test('refuse un non-admin', async () => {
      const res = await request(buildApp())
        .post('/api/pricing/strategy/apply')
        .send({ product_id: 'p1', strategy_type: 'match', final_price_kmf: 1000 });

      expect(res.status).toBe(403);
      expect(svc.applyStrategy).not.toHaveBeenCalled();
    });

    test('valide product_id/category manquants (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const res = await request(buildApp())
        .post('/api/pricing/strategy/apply')
        .send({ strategy_type: 'match', final_price_kmf: 1000 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/product_id or category/);
    });

    test('valide strategy_type manquant (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const res = await request(buildApp())
        .post('/api/pricing/strategy/apply')
        .send({ product_id: 'p1', final_price_kmf: 1000 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/strategy_type/);
    });

    test('valide final_price_kmf manquant ou <= 0 (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const res = await request(buildApp())
        .post('/api/pricing/strategy/apply')
        .send({ product_id: 'p1', strategy_type: 'match', final_price_kmf: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/final_price_kmf/);
    });

    test('applique une stratégie valide (admin) et transmet req.user.id', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      svc.applyStrategy.mockResolvedValueOnce({ applied: true, final_price_kmf: 1000 });

      const res = await request(buildApp())
        .post('/api/pricing/strategy/apply')
        .send({ product_id: 'p1', strategy_type: 'match', final_price_kmf: 1000 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ applied: true, final_price_kmf: 1000 });
      expect(svc.applyStrategy).toHaveBeenCalledWith(
        expect.anything(),
        { product_id: 'p1', strategy_type: 'match', final_price_kmf: 1000 },
        'admin-1'
      );
    });
  });

  describe('GET /history', () => {
    test('accessible à un client authentifié', async () => {
      svc.getStrategyHistory.mockResolvedValueOnce({ count: 0, history: [] });

      const res = await request(buildApp())
        .get('/api/pricing/strategy/history')
        .query({ category: 'robes' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ count: 0, history: [] });
      expect(svc.getStrategyHistory).toHaveBeenCalledWith(expect.anything(), { product_id: undefined, category: 'robes' });
    });

    test('refuse sans authentification', async () => {
      mockUser = null;
      const res = await request(buildApp()).get('/api/pricing/strategy/history');
      expect(res.status).toBe(401);
    });
  });
});
