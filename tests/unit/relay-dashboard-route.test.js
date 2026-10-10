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

const fs = require('fs');
const path = require('path');
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

// Hors périmètre de ce test suite (couvert par ses propres tests dédiés) —
// la projection de rôle délégué marché ne doit pas interférer avec la
// vérification requireRole testée ici.
jest.mock('../../middleware/require-market-delegated-role', () => ({
  attachMarketDelegatedRoleFor: () => (req, res, next) => next(),
}));

let mockOperationsReadGranted = true;
let mockOperationsReadMarkets = new Set(['km-uuid']);
let mockHubSuperviseGrantedMarkets = new Set(['CM']);
const MARKET_ID_BY_CODE = { CM: 'km-uuid', YT: 'yt-uuid', CG: 'cg-uuid' };

jest.mock('../../middleware/require-market-delegated-capability', () => ({
  attachAuthorizedMarketsForCapability: (capability) => (req, res, next) => {
    if (!mockOperationsReadGranted) {
      return res.status(403).json({ error: `Capability ${capability} requise.`, code: 'MARKET_CAPABILITY_REQUIRED' });
    }
    req.authorizedMarkets = new Set(mockOperationsReadMarkets);
    return next();
  },
  requireMarketDelegatedCapability: (capability) => (req, res, next) => {
    const code = req.params.marketCode;
    if (!mockHubSuperviseGrantedMarkets.has(code)) {
      return res.status(403).json({ error: `Capability ${capability} requise.`, code: 'MARKET_CAPABILITY_REQUIRED' });
    }
    req.marketDelegatedCapability = {
      capability,
      market_code: code,
      market_id: MARKET_ID_BY_CODE[code],
    };
    return next();
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
    mockOperationsReadGranted = true;
    mockOperationsReadMarkets = new Set(['km-uuid']);
    mockHubSuperviseGrantedMarkets = new Set(['CM']);
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
      expect(queries.getDashboardKPIs).toHaveBeenCalledWith(mockUser, { authorizedMarkets: undefined });
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
      }, { authorizedMarkets: undefined });
    });
  });

  describe('projection Live sans contact (LIVE-07)', () => {
    test('/orders?projection=live retire téléphone, e-mail et code de retrait ; sans paramètre la réponse est complète', async () => {
      const row = { reference: 'CMD-1', client_nom: 'A', client_phone: '+2691', client_email: 'a@b.c', pickup_code: '••••AB12' };
      queries.getOrders.mockResolvedValueOnce({ total: 1, orders: [row] }).mockResolvedValueOnce({ total: 1, orders: [row] });
      const live = await request(buildApp()).get('/api/relay-dashboard/orders').query({ projection: 'live' });
      expect(live.body.orders[0]).toEqual({ reference: 'CMD-1', client_nom: 'A' });
      const full = await request(buildApp()).get('/api/relay-dashboard/orders');
      expect(full.body.orders[0]).toEqual(row);
    });

    test('/orders/:id?projection=live retire les contacts du détail', async () => {
      queries.getOrderDetail.mockResolvedValueOnce({ id: 'o1', order: { client_phone: '+2691', user_phone: '+2692', relais_nom: 'R' } });
      const res = await request(buildApp()).get('/api/relay-dashboard/orders/o1').query({ projection: 'live' });
      expect(res.body).toEqual({ id: 'o1', order: { relais_nom: 'R' } });
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
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
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
      const res2 = await request(buildApp()).post('/api/relay-dashboard/orders/o1/comment').send({ text: '   ' });
      expect(res2.status).toBe(400);
    });

    test('ajoute un commentaire (agent du bon relais)', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-1', status: 'available', relais_id: 'relais-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'c1', text: 'Bien reçu' }] });
      const res = await request(buildApp()).post('/api/relay-dashboard/orders/o1/comment').send({ text: 'Bien reçu' });
      expect(res.status).toBe(201);
      expect(res.body.comment).toEqual({ id: 'c1', text: 'Bien reçu' });
    });

    test('403 IDOR sur commentaire hors relais', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-1', status: 'available', relais_id: 'relais-AUTRE' }] });
      const res = await request(buildApp()).post('/api/relay-dashboard/orders/o1/comment').send({ text: 'x' });
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
      const res = await request(buildApp()).post('/api/relay-dashboard/orders/o1/escalate').send({ reason: 'stock manquant' });
      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Escalade envoyée au hub');
      expect(mockDbQuery).toHaveBeenCalledTimes(3);
    });

    test('403 IDOR sur escalade hors relais', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-1', status: 'available', relais_id: 'relais-AUTRE' }] });
      const res = await request(buildApp()).post('/api/relay-dashboard/orders/o1/escalate').send({ reason: 'x' });
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /orders/:id/client-absent', () => {
    test('422 si la commande n\'est pas "available"', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-1', status: 'collected', relais_id: 'relais-1' }] });
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

  describe('market_operator D5', () => {
    beforeEach(() => {
      mockUser = { id: 'op-1', role: 'market_operator', full_name: 'Op Un' };
    });

    test('GET /dashboard : operations.read injecte uniquement les Market IDs autorisés', async () => {
      queries.getDashboardKPIs.mockResolvedValueOnce({ pending: 1 });

      const res = await request(buildApp()).get('/api/relay-dashboard/dashboard');

      expect(res.status).toBe(200);
      const [, opts] = queries.getDashboardKPIs.mock.calls[0];
      expect(opts.authorizedMarkets).toEqual(new Set(['km-uuid']));
      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    test('GET /dashboard : révocation operations.read retire immédiatement la lecture', async () => {
      mockOperationsReadGranted = false;

      const res = await request(buildApp()).get('/api/relay-dashboard/dashboard');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
      expect(queries.getDashboardKPIs).not.toHaveBeenCalled();
    });

    test('POST /orders/:id/comment : hub.supervise autorise la mutation sur le marché exact', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-1', status: 'available', relais_id: 'relais-X', market_id: 'km-uuid', market_code: 'CM' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'c1', text: 'ok' }] });

      const res = await request(buildApp()).post('/api/relay-dashboard/orders/o1/comment').send({ text: 'ok' });

      expect(res.status).toBe(201);
      expect(res.body.comment).toEqual({ id: 'c1', text: 'ok' });
      expect(mockDbQuery).toHaveBeenCalledTimes(2);
    });

    test('POST /orders/:id/comment : sans hub.supervise la mutation est refusée', async () => {
      mockHubSuperviseGrantedMarkets = new Set();
      mockDbQuery.mockResolvedValueOnce({
        rows: [{ id: 'o1', reference: 'CMD-1', status: 'available', relais_id: 'relais-X', market_id: 'km-uuid', market_code: 'CM' }],
      });

      const res = await request(buildApp()).post('/api/relay-dashboard/orders/o1/comment').send({ text: 'ok' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
    });

    test('POST /orders/:id/comment : capability CM ne donne aucun droit sur YT', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{ id: 'o1', reference: 'CMD-1', status: 'available', relais_id: 'relais-X', market_id: 'yt-uuid', market_code: 'YT' }],
      });

      const res = await request(buildApp()).post('/api/relay-dashboard/orders/o1/comment').send({ text: 'ok' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
    });

    test('GET /orders/:id : operations.read suffit en lecture, hub.supervise n’est pas requis', async () => {
      mockHubSuperviseGrantedMarkets = new Set();
      queries.getOrderDetail.mockResolvedValueOnce({ id: 'o1', reference: 'CMD-1' });

      const res = await request(buildApp()).get('/api/relay-dashboard/orders/o1');

      expect(res.status).toBe(200);
      const [, , opts] = queries.getOrderDetail.mock.calls[0];
      expect(opts.authorizedMarkets).toEqual(new Set(['km-uuid']));
    });
  });

  test('D5 retire complètement require-market-scope du Relay Dashboard', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'relay-dashboard.js'), 'utf8');
    expect(source).not.toMatch(/require\(['"][^'"]*require-market-scope/);
    expect(source).not.toMatch(/attachAuthorizedMarketsForOperator|resolveMarketScopeRole|hasMarketScopeRole/);
    expect(source).toContain("attachAuthorizedMarketsForCapability('operations.read'");
    expect(source).toContain("requireMarketDelegatedCapability('hub.supervise'");
  });
});
