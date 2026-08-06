/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/pricing (Lot B2)
 *
 * Façade mince (REFACTO-R1) : auth + validation + appel service + réponse.
 * Les services (pricing-engine, pricing-recommend, pricing-dashboard,
 * pricing-rates, pricing-apply) sont déjà couverts individuellement — ici on
 * ne teste que le comportement HTTP de la route (guards, statuts, dispatch).
 *
 * Run : npx jest tests/unit/pricing-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

let mockUser = { id: 'user-1', role: 'client' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Token manquant' });
    req.user = mockUser;
    next();
  },
  requireRole: (roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès réservé' });
    }
    next();
  },
}));

jest.mock('../../services/pricing-engine', () => ({ recommend: jest.fn() }));
jest.mock('../../services/pricing-recommend', () => ({
  computeRecommend: jest.fn(),
  computeRecommendBatch: jest.fn(),
}));
jest.mock('../../services/pricing-dashboard', () => ({
  listBenchmarks: jest.fn(),
  computeBenchmarksGap: jest.fn(),
  computeDashboard: jest.fn(),
}));
jest.mock('../../services/pricing-rates', () => ({
  getCurrentRates: jest.fn(),
  updateRates: jest.fn(),
}));
jest.mock('../../services/pricing-apply', () => ({
  applyPrice: jest.fn(),
  applyAll: jest.fn(),
}));

const pricingEngine = require('../../services/pricing-engine');
const pricingRecommend = require('../../services/pricing-recommend');
const pricingDashboard = require('../../services/pricing-dashboard');
const pricingRates = require('../../services/pricing-rates');
const pricingApply = require('../../services/pricing-apply');

const router = require('../../routes/pricing');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/pricing', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/pricing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: 'user-1', role: 'client' };
  });

  describe('POST /calculate', () => {
    test('exige product_id', async () => {
      const res = await request(buildApp()).post('/api/pricing/calculate').send({});
      expect(res.status).toBe(400);
      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    test('404 si produit introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp()).post('/api/pricing/calculate').send({ product_id: 'p1' });
      expect(res.status).toBe(404);
    });

    test('calcule le prix pour un produit existant (cash_relais par défaut)', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] });
      pricingEngine.recommend.mockResolvedValueOnce({ price_kmf: 5000 });

      const res = await request(buildApp()).post('/api/pricing/calculate').send({ product_id: 'p1', qty: 2 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ price_kmf: 5000 });
      expect(pricingEngine.recommend).toHaveBeenCalledWith({
        product_id: 'p1', qty: 2, channel: 'cash_relais', relais_type: 'standard',
      });
    });

    test('utilise le channel diaspora si is_diaspora=true', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] });
      pricingEngine.recommend.mockResolvedValueOnce({ price_kmf: 5000 });

      await request(buildApp()).post('/api/pricing/calculate').send({ product_id: 'p1', is_diaspora: true });

      expect(pricingEngine.recommend).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'diaspora' })
      );
    });
  });

  describe('POST /flow', () => {
    test('refuse un non-admin', async () => {
      const res = await request(buildApp()).post('/api/pricing/flow').send({});
      expect(res.status).toBe(403);
      expect(pricingEngine.recommend).not.toHaveBeenCalled();
    });

    test('renvoie la sortie brute de recommend() pour un admin', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      pricingEngine.recommend.mockResolvedValueOnce({ n1: {}, n2: {}, n3: {} });

      const res = await request(buildApp()).post('/api/pricing/flow').send({ cost_kmf: 1000 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ n1: {}, n2: {}, n3: {} });
    });

    test('applique le statut HTTP porté par une erreur de service', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      pricingEngine.recommend.mockRejectedValueOnce(Object.assign(new Error('bad'), { status: 422, body: { error: 'bad' } }));

      const res = await request(buildApp()).post('/api/pricing/flow').send({});

      expect(res.status).toBe(422);
      expect(res.body).toEqual({ error: 'bad' });
    });
  });

  describe('GET /benchmarks (cost_benchmarks)', () => {
    // NOTE gouvernance (résolu 2026-07-06) : la route déclarait deux fois
    // GET /benchmarks (L106 cost_benchmarks, L250 pricing_benchmarks via
    // pricingDashboard.listBenchmarks — jamais atteint). Le second handler,
    // mort, a été supprimé de routes/pricing.js. Cette assertion reste en
    // place pour verrouiller le comportement : listBenchmarks ne doit jamais
    // être appelé depuis GET /benchmarks.
    test('accessible à un client authentifié, lit cost_benchmarks', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ category: 'all', cost_family: 'transport' }] });

      const res = await request(buildApp()).get('/api/pricing/benchmarks');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [{ category: 'all', cost_family: 'transport' }] });
      expect(pricingDashboard.listBenchmarks).not.toHaveBeenCalled();
    });

    test('refuse sans authentification', async () => {
      mockUser = null;
      const res = await request(buildApp()).get('/api/pricing/benchmarks');
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /benchmarks', () => {
    test('refuse un non-admin', async () => {
      const res = await request(buildApp()).put('/api/pricing/benchmarks').send({});
      expect(res.status).toBe(403);
    });

    test('valide cost_family/expected_share_pct manquants (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const res = await request(buildApp()).put('/api/pricing/benchmarks').send({});
      expect(res.status).toBe(400);
      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    test('upsert un benchmark valide (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      mockDbQuery.mockResolvedValueOnce({
        rows: [{ category: 'all', cost_family: 'transport', expected_share_pct: 12 }],
      });

      const res = await request(buildApp())
        .put('/api/pricing/benchmarks')
        .send({ cost_family: 'transport', expected_share_pct: 12 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ category: 'all', cost_family: 'transport', expected_share_pct: 12 });
    });
  });

  describe('DELETE /benchmarks/:category/:cost_family', () => {
    test('refuse un non-admin', async () => {
      const res = await request(buildApp()).delete('/api/pricing/benchmarks/all/transport');
      expect(res.status).toBe(403);
    });

    test('supprime un benchmark (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      mockDbQuery.mockResolvedValueOnce({});

      const res = await request(buildApp()).delete('/api/pricing/benchmarks/all/transport');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: true });
    });
  });

  describe('POST /couture', () => {
    test('exige fabric_id et model_id', async () => {
      const res = await request(buildApp()).post('/api/pricing/couture').send({});
      expect(res.status).toBe(400);
    });

    test('404 si tissu ou modèle introuvable', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'm1' }] });

      const res = await request(buildApp())
        .post('/api/pricing/couture')
        .send({ fabric_id: 'f1', model_id: 'm1' });

      expect(res.status).toBe(404);
    });

    test('calcule le prix couture à partir du tissu et du modèle', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'f1', name: 'Soie', price_per_meter_aed: '10' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'm1', name: 'Robe', fabric_meters: '3', making_cost_aed: '20' }] });
      pricingEngine.recommend.mockResolvedValueOnce({ price_kmf: 8000 });

      const res = await request(buildApp())
        .post('/api/pricing/couture')
        .send({ fabric_id: 'f1', model_id: 'm1', qty: 1 });

      expect(res.status).toBe(200);
      expect(res.body.price_kmf).toBe(8000);
      expect(res.body.fabric).toBe('Soie');
      expect(res.body.model).toBe('Robe');
      expect(res.body.detail.prix_achat_aed).toBe(50); // 10*3 + 20
      expect(pricingEngine.recommend).toHaveBeenCalledWith(expect.objectContaining({
        virtual: true, price_aed: 50, category: 'couture', channel: 'cash_relais',
      }));
    });
  });

  describe('GET /rates', () => {
    test('refuse sans authentification', async () => {
      mockUser = null;
      const res = await request(buildApp()).get('/api/pricing/rates');
      expect(res.status).toBe(401);
    });

    test('renvoie les taux courants', async () => {
      pricingRates.getCurrentRates.mockResolvedValueOnce({ eur_kmf: 490, aed_kmf: 133 });
      const res = await request(buildApp()).get('/api/pricing/rates');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ eur_kmf: 490, aed_kmf: 133 });
    });
  });

  describe('PUT /rates', () => {
    test('refuse un non-admin', async () => {
      const res = await request(buildApp()).put('/api/pricing/rates').send({ eur_kmf: 490, aed_kmf: 133 });
      expect(res.status).toBe(403);
    });

    test('exige eur_kmf et aed_kmf (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const res = await request(buildApp()).put('/api/pricing/rates').send({ eur_kmf: 490 });
      expect(res.status).toBe(400);
      expect(pricingRates.updateRates).not.toHaveBeenCalled();
    });

    test('met à jour les taux (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      pricingRates.updateRates.mockResolvedValueOnce({ eur_kmf: 500, aed_kmf: 135 });

      const res = await request(buildApp())
        .put('/api/pricing/rates')
        .send({ eur_kmf: 500, aed_kmf: 135 });

      expect(res.status).toBe(200);
      expect(pricingRates.updateRates).toHaveBeenCalledWith({ eur_kmf: 500, aed_kmf: 135 }, 'admin-1');
    });
  });

  describe('POST /recommend', () => {
    test('refuse sans authentification', async () => {
      mockUser = null;
      const res = await request(buildApp()).post('/api/pricing/recommend').send({});
      expect(res.status).toBe(401);
    });

    test('renvoie la recommandation calculée', async () => {
      pricingRecommend.computeRecommend.mockResolvedValueOnce({ niveau1: {}, niveau2: {}, niveau3: {} });
      const res = await request(buildApp()).post('/api/pricing/recommend').send({ product_id: 'p1' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ niveau1: {}, niveau2: {}, niveau3: {} });
    });

    test('applique le statut porté par une erreur de service', async () => {
      pricingRecommend.computeRecommend.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 400, body: { error: 'nope' } }));
      const res = await request(buildApp()).post('/api/pricing/recommend').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /recommend-batch', () => {
    test('renvoie le résultat batch', async () => {
      pricingRecommend.computeRecommendBatch.mockResolvedValueOnce({ count: 2, items: [] });
      const res = await request(buildApp()).post('/api/pricing/recommend-batch').send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ count: 2, items: [] });
    });
  });

  describe('PUT /apply-price/:product_id', () => {
    test('refuse un non-admin', async () => {
      const res = await request(buildApp()).put('/api/pricing/apply-price/p1').send({ price_kmf: 1000 });
      expect(res.status).toBe(403);
      expect(pricingApply.applyPrice).not.toHaveBeenCalled();
    });

    test('applique le prix et relaie le statut du service (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      pricingApply.applyPrice.mockResolvedValueOnce({ status: 200, body: { ok: true } });

      const res = await request(buildApp())
        .put('/api/pricing/apply-price/p1')
        .send({ price_kmf: 1000 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(pricingApply.applyPrice).toHaveBeenCalledWith('p1', { price_kmf: 1000 }, 'admin-1');
    });

    test('relaie un statut d\'erreur métier (ex: below_survival)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      pricingApply.applyPrice.mockResolvedValueOnce({ status: 400, body: { error: 'below_survival' } });

      const res = await request(buildApp())
        .put('/api/pricing/apply-price/p1')
        .send({ price_kmf: 1 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'below_survival' });
    });
  });

  describe('PUT /apply-all', () => {
    test('refuse un non-admin', async () => {
      const res = await request(buildApp()).put('/api/pricing/apply-all').send({ items: [] });
      expect(res.status).toBe(403);
    });

    test('applique un batch et relaie le résultat (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      pricingApply.applyAll.mockResolvedValueOnce({ status: 200, body: { applied: 3 } });

      const res = await request(buildApp())
        .put('/api/pricing/apply-all')
        .send({ items: [{ product_id: 'p1', price_kmf: 1000 }] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ applied: 3 });
      expect(pricingApply.applyAll).toHaveBeenCalledWith([{ product_id: 'p1', price_kmf: 1000 }]);
    });

    test('utilise un tableau vide si items absent (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      pricingApply.applyAll.mockResolvedValueOnce({ status: 400, body: { error: 'items array requis' } });

      const res = await request(buildApp()).put('/api/pricing/apply-all').send({});

      expect(res.status).toBe(400);
      expect(pricingApply.applyAll).toHaveBeenCalledWith([]);
    });
  });

  describe('GET /benchmarks-gap', () => {
    test('renvoie le gap benchmark', async () => {
      pricingDashboard.computeBenchmarksGap.mockResolvedValueOnce({ gaps: [] });
      const res = await request(buildApp()).get('/api/pricing/benchmarks-gap');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ gaps: [] });
    });

    test('refuse sans authentification', async () => {
      mockUser = null;
      const res = await request(buildApp()).get('/api/pricing/benchmarks-gap');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /dashboard', () => {
    test('renvoie le dashboard pricing', async () => {
      pricingDashboard.computeDashboard.mockResolvedValueOnce({ kpis: {} });
      const res = await request(buildApp()).get('/api/pricing/dashboard');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ kpis: {} });
    });

    test('refuse sans authentification', async () => {
      mockUser = null;
      const res = await request(buildApp()).get('/api/pricing/dashboard');
      expect(res.status).toBe(401);
    });
  });
});
