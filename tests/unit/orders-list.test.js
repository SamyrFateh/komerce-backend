'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const request = require('supertest');
const express = require('express');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
}));

const mockState = { user: { id: 'u1', role: 'client' } };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = mockState.user;
    next();
  },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

const mockGetRule = jest.fn();
const mockGetRuleNumber = jest.fn();
jest.mock('../../utils/rules', () => ({
  getRule: (...args) => mockGetRule(...args),
  getRuleNumber: (...args) => mockGetRuleNumber(...args),
}));

const mockGetBalance = jest.fn();
const mockGetWalletDetail = jest.fn();
jest.mock('../../services/wallet-service', () => ({
  getBalance: (...args) => mockGetBalance(...args),
  getWalletDetail: (...args) => mockGetWalletDetail(...args),
}));

const router = require('../../routes/orders/list');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('GET /api/orders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.user = { id: 'u1', role: 'client' };
  });

  it('filtre toujours par o.user_id = req.user.id (jamais par un autre user)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/orders');
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('o.user_id = $1');
    expect(params[0]).toBe('u1');
  });

  it('ajoute le filtre status si fourni en query', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/orders?status=shipped');
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('o.status = $2');
    expect(params).toContain('shipped');
  });

  it('utilise limit/offset par defaut (20/0) si non fournis', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/orders');
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual(expect.arrayContaining([20, 0]));
  });
});

describe('GET /api/orders/relais', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('403 pour un role non autorise (client)', async () => {
    mockState.user = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/orders/relais');
    expect(res.status).toBe(403);
  });

  it("400 si l'agent_relais n'a pas de relais_id associe", async () => {
    mockState.user = { id: 'agent1', role: 'agent_relais' };
    mockDbQuery.mockResolvedValueOnce({ rows: [{ relais_id: null }] }); // getAgentRelaisId: users
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // fallback phone match

    const res = await request(buildApp()).get('/api/orders/relais');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Aucun relais associé à cet agent');
  });

  it('agent_relais avec relais_id : filtre par relais_id, calcule summary et alertes', async () => {
    mockState.user = { id: 'agent1', role: 'agent_relais' };
    mockDbQuery.mockResolvedValueOnce({ rows: [{ relais_id: 'relais-1' }] }); // getAgentRelaisId
    mockGetRule.mockResolvedValue(48);
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        { id: 'o1', status: 'available', available_at: new Date(Date.now() - 50 * 3600 * 1000).toISOString(), payment_mode: null },
        { id: 'o2', status: 'shipped', available_at: null, payment_mode: null },
      ],
    });

    const res = await request(buildApp()).get('/api/orders/relais');
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({
      en_attente: 1,
      en_transit: 1,
      alertes_48h: 1,
      cash_pending: 0,
    });
    expect(res.body.orders[0].alert_48h).toBe(true);

    const filterCall = mockDbQuery.mock.calls[1];
    expect(filterCall[0]).toContain('o.relais_id = $1');
    expect(filterCall[1]).toEqual(['relais-1']);
  });

  it('admin voit toutes les commandes sans filtre relais_id', async () => {
    mockState.user = { id: 'adm1', role: 'admin' };
    mockGetRule.mockResolvedValue(48);
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/orders/relais');
    expect(res.status).toBe(200);
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('1=1');
    expect(params).toEqual([]);
  });
});

describe('GET /api/orders/problems', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRuleNumber.mockImplementation((_key, def) => Promise.resolve(def));
  });

  it('403 pour un client', async () => {
    mockState.user = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/orders/problems');
    expect(res.status).toBe(403);
  });

  it('agent_relais : filtre parametre par relais_id (pas d\'injection SQL directe)', async () => {
    mockState.user = { id: 'agent1', role: 'agent_relais' };
    mockDbQuery.mockResolvedValueOnce({ rows: [{ relais_id: 'relais-9' }] }); // getAgentRelaisId
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // main query

    const res = await request(buildApp()).get('/api/orders/problems');
    expect(res.status).toBe(200);

    const [sql, params] = mockDbQuery.mock.calls[1];
    expect(sql).toContain('AND o.relais_id = $1');
    expect(params[0]).toBe('relais-9');
  });

  it('admin : pas de filtre relais (params commence par les seuils)', async () => {
    mockState.user = { id: 'adm1', role: 'admin' };
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/orders/problems');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ health_score: 100, total: 0 });
  });

  it('calcule un health_score decroissant avec le nombre de problemes (100 - 5*n, min 0)', async () => {
    mockState.user = { id: 'adm1', role: 'admin' };
    const problems = Array.from({ length: 25 }, (_, i) => ({
      id: `o${i}`, problem_type: 'other', hours_since_last_event: 1,
    }));
    mockDbQuery.mockResolvedValueOnce({ rows: problems });

    const res = await request(buildApp()).get('/api/orders/problems');
    expect(res.body.health_score).toBe(0); // clamp a 0, jamais negatif
    expect(res.body.total).toBe(25);
  });
});

describe('GET /api/orders/credits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('utilise req.user.id par defaut, ignore user_id en query pour un client', async () => {
    mockState.user = { id: 'u1', role: 'client' };
    mockGetBalance.mockResolvedValue(5000);
    mockGetWalletDetail.mockResolvedValue({ lots: [] });

    await request(buildApp()).get('/api/orders/credits?user_id=other-user');

    expect(mockGetBalance).toHaveBeenCalledWith('u1');
  });

  it("honore user_id en query uniquement pour un admin", async () => {
    mockState.user = { id: 'adm1', role: 'admin' };
    mockGetBalance.mockResolvedValue(0);
    mockGetWalletDetail.mockResolvedValue({ lots: [] });

    await request(buildApp()).get('/api/orders/credits?user_id=target-user');

    expect(mockGetBalance).toHaveBeenCalledWith('target-user');
  });

  it('ne renvoie que les lots actifs avec solde positif', async () => {
    mockState.user = { id: 'u1', role: 'client' };
    mockGetBalance.mockResolvedValue(1000);
    mockGetWalletDetail.mockResolvedValue({
      lots: [
        { id: 'l1', status: 'active', remaining_kmf: 500, original_amount_kmf: 1000, reason: 'refund', source_order_id: 'o1', expires_at: null, created_at: 't1' },
        { id: 'l2', status: 'active', remaining_kmf: 0, original_amount_kmf: 1000, reason: 'refund', source_order_id: 'o2', expires_at: null, created_at: 't2' },
        { id: 'l3', status: 'expired', remaining_kmf: 200, original_amount_kmf: 1000, reason: 'refund', source_order_id: 'o3', expires_at: null, created_at: 't3' },
      ],
    });

    const res = await request(buildApp()).get('/api/orders/credits');
    expect(res.body.total_kmf).toBe(1000);
    expect(res.body.credits).toHaveLength(1);
    expect(res.body.credits[0].id).toBe('l1');
  });
});
