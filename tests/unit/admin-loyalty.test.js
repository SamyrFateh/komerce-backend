'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/admin-loyalty.test.js
 * Couvre routes/admin-loyalty.js
 */

const express = require('express');
const request = require('supertest');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

let mockUser = { id: 'admin-1', role: 'admin' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Token manquant — connectez-vous' });
    req.user = mockUser;
    next();
  },
  requireAdmin: (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé admin' });
    }
    next();
  },
}));

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const adminLoyaltyRouter = require('../../routes/admin-loyalty');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/loyalty', adminLoyaltyRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'admin-1', role: 'admin' };
});

function rewardRow(overrides = {}) {
  return {
    id: 'r1',
    user_id: 'u1',
    basket_count_at_trigger: 5,
    created_at: '2026-06-01T00:00:00.000Z',
    triggered_by_order_id: 'o1',
    full_name: 'Ali Said',
    phone: '+269300000',
    phone_payer: '+269300001',
    email: 'ali@example.com',
    current_count: 5,
    triggering_order_ref: 'CMD-1',
    triggering_order_total: 18000,
    total_lifetime_kmf: 50000,
    total_lifetime_orders: 4,
    ...overrides,
  };
}

describe('GET /api/admin/loyalty/pending', () => {
  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/admin/loyalty/pending');
    expect(res.status).toBe(401);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/admin/loyalty/pending');
    expect(res.status).toBe(403);
  });

  it('nominal → 200 + count et pending structurés', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [rewardRow()] });
    const res = await request(buildApp()).get('/api/admin/loyalty/pending');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      count: 1,
      pending: [{
        reward_id: 'r1',
        user: { id: 'u1', full_name: 'Ali Said', phone: '+269300000', email: 'ali@example.com', current_big_basket_count: 5 },
        trigger: { basket_count: 5, order_ref: 'CMD-1', order_total: 18000, detected_at: '2026-06-01T00:00:00.000Z' },
        stats: { lifetime_orders: 4, lifetime_kmf: 50000 },
      }],
    });
  });

  it('phone absent → fallback phone_payer', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [rewardRow({ phone: null })] });
    const res = await request(buildApp()).get('/api/admin/loyalty/pending');
    expect(res.body.pending[0].user.phone).toBe('+269300001');
  });

  it('triggering_order_total null → 0', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [rewardRow({ triggering_order_total: null })] });
    const res = await request(buildApp()).get('/api/admin/loyalty/pending');
    expect(res.body.pending[0].trigger.order_total).toBe(0);
  });

  it('total_lifetime_kmf/orders null → 0', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [rewardRow({ total_lifetime_kmf: null, total_lifetime_orders: null })] });
    const res = await request(buildApp()).get('/api/admin/loyalty/pending');
    expect(res.body.pending[0].stats).toEqual({ lifetime_orders: 0, lifetime_kmf: 0 });
  });

  it('liste vide → count:0, pending:[]', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/admin/loyalty/pending');
    expect(res.body).toEqual({ count: 0, pending: [] });
  });

  it('filtre status=pending et limite à 100 dans la requête', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/loyalty/pending');
    const [sql] = mockDbQuery.mock.calls[0];
    expect(sql).toContain("WHERE lr.status = 'pending'");
    expect(sql).toContain('LIMIT 100');
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).get('/api/admin/loyalty/pending');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/admin/loyalty/reward/:id', () => {
  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).post('/api/admin/loyalty/reward/r1').send({ gift_description: 'Tasse' });
    expect(res.status).toBe(401);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).post('/api/admin/loyalty/reward/r1').send({ gift_description: 'Tasse' });
    expect(res.status).toBe(403);
  });

  it('gift_description absent → 400', async () => {
    const res = await request(buildApp()).post('/api/admin/loyalty/reward/r1').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'gift_description requis (minimum 2 caractères)' });
  });

  it('gift_description trop court (1 caractère) → 400', async () => {
    const res = await request(buildApp()).post('/api/admin/loyalty/reward/r1').send({ gift_description: 'X' });
    expect(res.status).toBe(400);
  });

  it('gift_description ne contenant que des espaces → 400 (trim appliqué)', async () => {
    const res = await request(buildApp()).post('/api/admin/loyalty/reward/r1').send({ gift_description: '   ' });
    expect(res.status).toBe(400);
  });

  it('récompense introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).post('/api/admin/loyalty/reward/r1').send({ gift_description: 'Tasse Komerce' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Récompense introuvable' });
  });

  it('déjà traitée (status != pending) → 409 + current_status', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'granted', user_id: 'u1' }] });
    const res = await request(buildApp()).post('/api/admin/loyalty/reward/r1').send({ gift_description: 'Tasse' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Récompense déjà traitée', current_status: 'granted' });
  });

  it('nominal → 200, UPDATE avec gift_description trim, notes et granted_by', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'pending', user_id: 'u1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'granted', gift_description: 'Tasse Komerce' }] });

    const res = await request(buildApp()).post('/api/admin/loyalty/reward/r1').send({ gift_description: '  Tasse Komerce  ', notes: 'Remise en main propre' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, reward: { id: 'r1', status: 'granted', gift_description: 'Tasse Komerce' } });
    const [, params] = mockDbQuery.mock.calls[1];
    expect(params).toEqual(['Tasse Komerce', 'Remise en main propre', 'admin-1', 'r1']);
  });

  it('notes absentes → null', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'pending', user_id: 'u1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'r1' }] });
    await request(buildApp()).post('/api/admin/loyalty/reward/r1').send({ gift_description: 'Tasse' });
    const [, params] = mockDbQuery.mock.calls[1];
    expect(params[1]).toBeNull();
  });

  it('body absent (undefined) → 400, pas de crash', async () => {
    const res = await request(buildApp()).post('/api/admin/loyalty/reward/r1');
    expect(res.status).toBe(400);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).post('/api/admin/loyalty/reward/r1').send({ gift_description: 'Tasse' });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/admin/loyalty/skip/:id', () => {
  it('introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).post('/api/admin/loyalty/skip/r1');
    expect(res.status).toBe(404);
  });

  it('déjà traitée → 409', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'skipped' }] });
    const res = await request(buildApp()).post('/api/admin/loyalty/skip/r1');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Récompense déjà traitée' });
  });

  it('nominal avec reason → 200, reason transmise', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'skipped' }] });
    const res = await request(buildApp()).post('/api/admin/loyalty/skip/r1').send({ reason: 'Client injoignable' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, reward: { id: 'r1', status: 'skipped' } });
    const [, params] = mockDbQuery.mock.calls[1];
    expect(params).toEqual(['Client injoignable', 'admin-1', 'r1']);
  });

  it('reason absente → fallback "Skipped by admin"', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'r1' }] });
    await request(buildApp()).post('/api/admin/loyalty/skip/r1').send({});
    const [, params] = mockDbQuery.mock.calls[1];
    expect(params[0]).toBe('Skipped by admin');
  });

  it('body absent → fallback reason, pas de crash', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'r1' }] });
    const res = await request(buildApp()).post('/api/admin/loyalty/skip/r1');
    expect(res.status).toBe(200);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).post('/api/admin/loyalty/skip/r1');
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).post('/api/admin/loyalty/skip/r1');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/loyalty/history', () => {
  it('nominal → 200 + count et history', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'granted' }] });
    const res = await request(buildApp()).get('/api/admin/loyalty/history');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 1, history: [{ id: 'r1', status: 'granted' }] });
  });

  it('filtre status IN (granted, skipped)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/loyalty/history');
    const [sql] = mockDbQuery.mock.calls[0];
    expect(sql).toContain("WHERE lr.status IN ('granted', 'skipped')");
  });

  it('limit par défaut = 50', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/loyalty/history');
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual([50]);
  });

  it('limit fourni (≤200) → respecté', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/loyalty/history?limit=30');
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual([30]);
  });

  it('limit > 200 → plafonné à 200', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/loyalty/history?limit=9999');
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual([200]);
  });

  it('limit invalide (non-numérique) → fallback 50', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/loyalty/history?limit=abc');
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual([50]);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).get('/api/admin/loyalty/history');
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/admin/loyalty/history');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/loyalty/stats', () => {
  it('nominal → 200 + structure rewards/users avec conversions Number()', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ pending: '3', granted: '10', skipped: '2' }] })
      .mockResolvedValueOnce({ rows: [{ users_with_baskets: '5', total_baskets: '20', max_baskets: '4' }] });

    const res = await request(buildApp()).get('/api/admin/loyalty/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      rewards: { pending: 3, granted: 10, skipped: 2 },
      users: { with_big_baskets: 5, total_big_baskets: 20, max_baskets_single_user: 4 },
    });
  });

  it('erreur sur la première requête → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).get('/api/admin/loyalty/stats');
    expect(res.status).toBe(500);
  });

  it('erreur sur la seconde requête → 500', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ pending: '0', granted: '0', skipped: '0' }] })
      .mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).get('/api/admin/loyalty/stats');
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/admin/loyalty/stats');
    expect(res.status).toBe(403);
  });

  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/admin/loyalty/stats');
    expect(res.status).toBe(401);
  });
});
