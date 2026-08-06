'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/admin-radar.test.js
 * Couvre routes/admin-radar.js
 *
 * Façade mince : auth admin + délégation à services/radar-queries.
 * La logique métier (cache, seuils, calcul status_detail) est testée
 * dans radar-queries.test.js — ici on vérifie le routage, les gardes
 * d'auth et la validation du paramètre :detail.
 */

const express = require('express');
const request = require('supertest');

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

jest.mock('../../services/radar-queries', () => ({
  ALLOWED_DETAILS: ['full_available', 'partial_available', 'awaiting_stock', 'no_parcels'],
  invalidateCache: jest.fn(),
  getRadarSummary: jest.fn(),
  getAlerts: jest.fn(),
  getMoneyCards: jest.fn(),
  getStatusDetails: jest.fn(),
  getOrdersByDetail: jest.fn(),
}));

const radar = require('../../services/radar-queries');
const adminRadarRouter = require('../../routes/admin-radar');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/radar', adminRadarRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'admin-1', role: 'admin' };
});

describe('GET /api/admin/radar/ — accès', () => {
  it('sans authentification → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/admin/radar/');
    expect(res.status).toBe(401);
  });

  it('authentifié non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/admin/radar/');
    expect(res.status).toBe(403);
  });

  it('admin → 200, renvoie la synthèse du service', async () => {
    radar.getRadarSummary.mockResolvedValue({ alert_count: 3 });
    const res = await request(buildApp()).get('/api/admin/radar/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ alert_count: 3 });
  });

  it('erreur du service → 500 (propagée via next)', async () => {
    radar.getRadarSummary.mockRejectedValue(new Error('db down'));
    const res = await request(buildApp()).get('/api/admin/radar/');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/admin/radar/alerts', () => {
  it('admin → 200 + structure du service', async () => {
    radar.getAlerts.mockResolvedValue([{ type: 'stuck_order', order_id: 'o1' }]);
    const res = await request(buildApp()).get('/api/admin/radar/alerts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ type: 'stuck_order', order_id: 'o1' }]);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/admin/radar/alerts');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/radar/money', () => {
  it('admin → 200 + money cards', async () => {
    radar.getMoneyCards.mockResolvedValue({ revenue_today: 50000 });
    const res = await request(buildApp()).get('/api/admin/radar/money');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revenue_today: 50000 });
  });

  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/admin/radar/money');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/radar/status-details', () => {
  it('admin → 200 + distribution', async () => {
    radar.getStatusDetails.mockResolvedValue({ full_available: 4, no_parcels: 1 });
    const res = await request(buildApp()).get('/api/admin/radar/status-details');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ full_available: 4, no_parcels: 1 });
  });
});

describe('GET /api/admin/radar/orders-by-detail/:detail', () => {
  it('detail invalide → 400, service jamais appelé', async () => {
    const res = await request(buildApp()).get('/api/admin/radar/orders-by-detail/bucket_inexistant');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'status_detail invalide' });
    expect(radar.getOrdersByDetail).not.toHaveBeenCalled();
  });

  it('detail valide → 200, délègue au service avec le bon paramètre', async () => {
    radar.getOrdersByDetail.mockResolvedValue({ detail: 'awaiting_stock', count: 2, orders: [] });
    const res = await request(buildApp()).get('/api/admin/radar/orders-by-detail/awaiting_stock');
    expect(res.status).toBe(200);
    expect(radar.getOrdersByDetail).toHaveBeenCalledWith('awaiting_stock');
  });

  it('non-admin → 403, avant même la validation du detail', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/admin/radar/orders-by-detail/no_parcels');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/radar/cache/invalidate', () => {
  it('admin → invalide le cache et renvoie success:true', async () => {
    const res = await request(buildApp()).post('/api/admin/radar/cache/invalidate');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Cache radar invalidé.' });
    expect(radar.invalidateCache).toHaveBeenCalledTimes(1);
  });

  it('non-admin → 403, cache non invalidé', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).post('/api/admin/radar/cache/invalidate');
    expect(res.status).toBe(403);
    expect(radar.invalidateCache).not.toHaveBeenCalled();
  });

  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).post('/api/admin/radar/cache/invalidate');
    expect(res.status).toBe(401);
  });
});
