/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/relay-dashboard (Lot B3)
 *
 * Façade R9 : lectures déléguées à services/relay-dashboard-queries.js
 * (mocké — non retesté ici), mutations (incident/comment/escalate/
 * client-absent) faites en ligne dans la route. Couvre le guard IDOR
 * `assertOrderBelongsToRelais` et le guard de rôle (admin | agent_relais).
 *
 * Run : npx jest tests/unit/relay-dashboard-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

let mockUser = { id: 'agent-1', role: 'agent_relais', relais_id: 'relais-1', full_name: 'Agent Un' };
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

jest.mock('../../services/relay-dashboard-queries', () => ({
  getDashboardKPIs: jest.fn(),
  getOrders: jest.fn(),
  getOrderDetail: jest.fn(),
}));

const queries = require('../../services/relay-dashboard-queries');
const router = require('../../routes/relay-dashboard');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/relay-dashboard', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/relay-dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbQuery.mockReset();
    mockUser = { id: 'agent-1', role: 'agent_relais', relais_id: 'relais-1', full_name: 'Agent Un' };
  });

  test('refuse un rôle non autorisé (ex: client)', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/relay-dashboard/dashboard');
    expect(res.status).toBe(403);
    expect(queries.getDashboardKPIs).not.toHaveBeenCalled();
  });

  test('refuse sans authentification', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/relay-dashboard/dashboard');
    expect(res.status).toBe(401);
  });

  describe('GET /dashboard', () => {
    test('renvoie les KPIs pour un agent relais', async () => {
      queries.getDashboardKPIs.mockResolvedValueOnce({ pending: 3, delivered: 10 });
      const res = await request(buildApp()).get('/api/relay-dashboard/dashboard');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ pending: 3, delivered: 10 });
      expect(queries.getDashboardKPIs).toHaveBeenCalledWith(mockUser);
    });

    test('accessible à un admin', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      queries.getDashboardKPIs.mockResolvedValueOnce({ pending: 0 });
      const res = await request(buildApp()).get('/api/relay-dashboard/dashboard');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /orders', () => {
    test('transmet les filtres de requête avec défauts limit/offset', async () => {
      queries.getOrders.mockResolvedValueOnce({ count: 0, orders: [] });

      await request(buildApp()).get('/api/relay-dashboard/orders').query({ status: 'available' });

      expect(queries.getOrders).toHaveBeenCalledWith(mockUser, {
        status: 'available', search: undefined, limit: 50, offset: 0,
      });
    });
  });

  describe('GET /orders/:id', () => {
    test('404 si commande introuvable', async () => {
      queries.getOrderDetail.mockResolvedValueOnce(null);
      const res = await request(buildApp()).get('/api/relay-dashboard/orders/o1');
      expect(res.status).toBe(404);
    });

    test('403 si la commande appartient à un autre relais', async () => {
      queries.getOrderDetail.mockResolvedValueOnce({ forbidden: true });
      const res = await request(buildApp()).get('/api/relay-dashboard/orders/o1');
      expect(res.status).toBe(403);
    });

    test('renvoie le détail commande', async () => {
      queries.getOrderDetail.mockResolvedValueOnce({ id: 'o1', reference: 'CMD-1' });
      const res = await request(buildApp()).get('/api/relay-dashboard/orders/o1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: 'o1', reference: 'CMD-1' });
    });
  });

  describe('POST /orders/:id/incident', () => {
    test('exige un type', async () => {
      const res = await request(buildApp()).post('/api/relay-dashboard/orders/o1/incident').send({});
      expect(res.status).toBe(400);
      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    test('rejette un type invalide', async () => {
      const res = await request(buildApp())
        .post('/api/relay-dashboard/orders/o1/incident')
        .send({ type: 'invalide' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Type invalide/);
    });

    test('404 si commande introuvable (guard IDOR)', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp())
        .post('/api/relay-dashboard/orders/o1/incident')
        .send({ type: 'retard' });
      expect(res.status).toBe(404);
    });

    test('403 si la commande appartient à un autre relais (agent non-admin)', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{ id: 'o1', reference: 'CMD-1', status: 'available', relais_id: 'relais-AUTRE' }],
      });
      const res = await request(buildApp())
        .post('/api/relay-dashboard/orders/o1/incident')
        .send({ type: 'retard' });
      expect(res.status).toBe(403);
      expect(mockDbQuery).toHaveBeenCalledTimes(1); // pas d'INSERT après le guard
    });

    test('un admin peut créer un incident sur n\'importe quel relais', async () => {
      mockUser = { id: 'admin-1', role: 'admin', full_name: 'Admin' };
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-1', status: 'available', relais_id: 'relais-AUTRE' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'inc1', type: 'retard' }] });

      const res = await request(buildApp())
        .post('/api/relay-dashboard/orders/o1/incident')
        .send({ type: 'retard', description: 'colis en retard', priority: 'high' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, incident: { id: 'inc1', type: 'retard' } });
    });

    test('crée un incident (agent du bon relais)', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-1', status: 'available', relais_id: 'relais-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'inc1', type: 'stock' }] });

      const res = await request(buildApp())
        .post('/api/relay-dashboard/orders/o1/incident')
        .send({ type: 'stock' });

      expect(res.status).toBe(201);
      expect(res.body.incident).toEqual({ id: 'inc1', type: 'stock' });
    });
  });

  describe('POST /orders/:id/comment', () => {
    test('exige un texte non vide', async () => {
      const res1 = await request(buildApp()).post('/api/relay-dashboard/orders/o1/comment').send({});
      expect(res1.status).toBe(400);

      const res2 = await request(buildApp())
        .post('/api/relay-dashboard/orders/o1/comment')
        .send({ text: '   ' });
      expect(res2.status).toBe(400);
    });

    test('ajoute un commentaire (agent du bon relais)', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-1', status: 'available', relais_id: 'relais-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'c1', text: 'Bien reçu' }] });

      const res = await request(buildApp())
        .post('/api/relay-dashboard/orders/o1/comment')
        .send({ text: 'Bien reçu' });

      expect(res.status).toBe(201);
      expect(res.body.comment).toEqual({ id: 'c1', text: 'Bien reçu' });
    });

    test('403 IDOR sur commentaire hors relais', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{ id: 'o1', reference: 'CMD-1', status: 'available', relais_id: 'relais-AUTRE' }],
      });
      const res = await request(buildApp())
        .post('/api/relay-dashboard/orders/o1/comment')
        .send({ text: 'x' });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /orders/:id/escalate', () => {
    test('exige une raison non vide', async () => {
      const res = await request(buildApp()).post('/api/relay-dashboard/orders/o1/escalate').send({});
      expect(res.status).toBe(400);
    });

    test('escalade et journalise incident + commentaire', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-1', status: 'available', relais_id: 'relais-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'inc1' }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(buildApp())
        .post('/api/relay-dashboard/orders/o1/escalate')
        .send({ reason: 'stock manquant' });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Escalade envoyée au hub');
      expect(mockDbQuery).toHaveBeenCalledTimes(3);
    });

    test('403 IDOR sur escalade hors relais', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{ id: 'o1', reference: 'CMD-1', status: 'available', relais_id: 'relais-AUTRE' }],
      });
      const res = await request(buildApp())
        .post('/api/relay-dashboard/orders/o1/escalate')
        .send({ reason: 'x' });
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /orders/:id/client-absent', () => {
    test('422 si la commande n\'est pas "available"', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{ id: 'o1', reference: 'CMD-1', status: 'collected', relais_id: 'relais-1' }],
      });

      const res = await request(buildApp()).patch('/api/relay-dashboard/orders/o1/client-absent');

      expect(res.status).toBe(422);
    });

    test('marque le client absent et journalise incident + commentaire', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-1', status: 'available', relais_id: 'relais-1' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(buildApp()).patch('/api/relay-dashboard/orders/o1/client-absent');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, message: 'Client marqué absent, relance programmée' });
      expect(mockDbQuery).toHaveBeenCalledTimes(3);
    });

    test('404 si commande introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp()).patch('/api/relay-dashboard/orders/o1/client-absent');
      expect(res.status).toBe(404);
    });
  });
});
