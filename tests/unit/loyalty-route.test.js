/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/loyalty (P0 wallet-loyalty)
 *
 * Couvre les routes paliers/fidélité (tiers, me, users, stats, update, recalculate)
 * et les fonctions utilitaires exportées getLoyaltyDiscount / recalculateLoyalty,
 * utilisées par orders.js.
 *
 * Run : npx jest tests/unit/loyalty-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

let mockUser = { id: 'user-1', role: 'client' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = mockUser;
    next();
  },
  requireAdmin: (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé admin' });
    }
    return next();
  },
}));

const loyaltyRouter = require('../../routes/loyalty');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loyalty', loyaltyRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/loyalty', () => {
  beforeEach(() => {
    mockDbQuery.mockReset();
    mockUser = { id: 'user-1', role: 'client' };
  });

  test('GET /tiers est public et renvoie la liste des paliers', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 1, label: 'Bronze' }] });

    const res = await request(buildApp()).get('/api/loyalty/tiers');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 1, label: 'Bronze' }]);
  });

  test('GET /me renvoie un palier par défaut si aucune ligne trouvée', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/loyalty/me');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orders_count: 0, tier_label: null, discount_pct: 0 });
  });

  test('GET /me renvoie les données du palier du client connecté', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ tier_label: 'Silver', discount_pct: 5 }] });

    const res = await request(buildApp()).get('/api/loyalty/me');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tier_label: 'Silver', discount_pct: 5 });
    expect(mockDbQuery.mock.calls[0][1]).toEqual(['user-1']);
  });

  test('GET /users refuse l\'accès à un client non admin', async () => {
    const res = await request(buildApp()).get('/api/loyalty/users');
    expect(res.status).toBe(403);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('GET /users autorise un admin', async () => {
    mockUser = { id: 'admin-1', role: 'admin' };
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'u1' }] });

    const res = await request(buildApp()).get('/api/loyalty/users');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'u1' }]);
  });

  test('GET /stats calcule la distribution des paliers (admin)', async () => {
    mockUser = { id: 'admin-1', role: 'admin' };
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, label: 'Bronze' }] })
      .mockResolvedValueOnce({
        rows: [
          { tier_label: 'Bronze' },
          { tier_label: 'Bronze' },
          { tier_label: null },
        ],
      });

    const res = await request(buildApp()).get('/api/loyalty/stats');

    expect(res.status).toBe(200);
    expect(res.body.total_clients).toBe(3);
    expect(res.body.tier_distribution).toEqual({ Bronze: 2, Aucun: 1 });
  });

  test('GET /stats refuse un non-admin', async () => {
    const res = await request(buildApp()).get('/api/loyalty/stats');
    expect(res.status).toBe(403);
  });

  test('PUT /tiers/:id met à jour un palier existant (admin)', async () => {
    mockUser = { id: 'admin-1', role: 'admin' };
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: '1', label: 'Gold' }] });

    const res = await request(buildApp())
      .put('/api/loyalty/tiers/1')
      .send({ label: 'Gold' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: '1', label: 'Gold' });
  });

  test('PUT /tiers/:id renvoie 404 si le palier n\'existe pas', async () => {
    mockUser = { id: 'admin-1', role: 'admin' };
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .put('/api/loyalty/tiers/999')
      .send({ label: 'Inexistant' });

    expect(res.status).toBe(404);
  });

  test('PUT /tiers/:id refuse un non-admin', async () => {
    const res = await request(buildApp()).put('/api/loyalty/tiers/1').send({});
    expect(res.status).toBe(403);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('POST /recalculate/:user_id recalcule le palier d\'un client (admin)', async () => {
    mockUser = { id: 'admin-1', role: 'admin' };
    mockDbQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'user-9', tier_label: 'Silver' }] });

    const res = await request(buildApp()).post('/api/loyalty/recalculate/user-9');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'user-9', tier_label: 'Silver' });
  });

  test('POST /recalculate/:user_id renvoie un objet vide si aucun résultat', async () => {
    mockUser = { id: 'admin-1', role: 'admin' };
    mockDbQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).post('/api/loyalty/recalculate/user-x');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  test('POST /recalculate-all recalcule tous les clients (admin)', async () => {
    mockUser = { id: 'admin-1', role: 'admin' };
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'u1' }, { id: 'u2' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await request(buildApp()).post('/api/loyalty/recalculate-all');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recalculated: 2 });
    expect(mockDbQuery).toHaveBeenCalledTimes(3);
  });

  test('POST /recalculate-all refuse un non-admin', async () => {
    const res = await request(buildApp()).post('/api/loyalty/recalculate-all');
    expect(res.status).toBe(403);
  });

  // O7.3 (provider loyalty) : getLoyaltyDiscount / recalculateLoyalty ont été
  // retirées de cette route (elles vivent désormais dans services/loyalty-service.js).
  // Couverture déplacée vers tests/unit/loyalty-service.test.js. Voir
  // docs/O7_3_BOUNDARY_ANALYSIS.md.
});
