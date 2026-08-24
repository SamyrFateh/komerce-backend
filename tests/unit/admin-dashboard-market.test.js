'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockCurrentUser = { id: 'admin-1', role: 'admin' };
let mockAllowedMarkets = new Set(['market-cm-id']);
let mockGlobalAllowed = false;

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = mockCurrentUser; next(); },
  requireAdmin: (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

jest.mock('../../middleware/require-market-scope', () => ({
  attachAuthorizedMarkets: (req, res, next) => {
    req.authorizedMarkets = new Set(mockAllowedMarkets);
    next();
  },
  requireMarketScope: getTargetMarketId => (req, res, next) => {
    const target = getTargetMarketId(req);
    if (!req.authorizedMarkets.has(target)) {
      return res.status(403).json({ error: 'denied', code: 'market_scope_denied' });
    }
    next();
  },
}));

jest.mock('../../middleware/require-dashboard-global-authority', () => ({
  requireDashboardGlobalAuthority: (req, res, next) => {
    if (!mockGlobalAllowed) {
      return res.status(403).json({
        error: 'global denied',
        code: 'dashboard_global_access_denied',
      });
    }
    req.dashboardGlobalAuthority = true;
    next();
  },
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockBuildMarketPilotage = jest.fn();
jest.mock('../../services/dashboard-pilotage-market', () => ({
  buildMarketPilotage: (...args) => mockBuildMarketPilotage(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() })),
}));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-dashboard-market');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/dashboard', router);
  // Simule le routeur global historique, monté juste après en production.
  app.get('/api/admin/dashboard/unified', (req, res) => res.json({ mode: 'global' }));
  app.get('/api/admin/dashboard/control-tower', (req, res) => res.json({ mode: 'global-control' }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { id: 'admin-1', role: 'admin' };
  mockAllowedMarkets = new Set(['market-cm-id']);
  mockGlobalAllowed = false;
  mockQuery.mockImplementation(async (sql, params) => {
    if (String(sql).includes('FROM markets') && params[0] === 'CM') {
      return { rows: [{ id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF' }] };
    }
    if (String(sql).includes('FROM markets') && params[0] === 'CG') {
      return { rows: [{ id: 'market-cg-id', code: 'CG', name: 'Congo', currency: 'XAF' }] };
    }
    return { rows: [] };
  });
  mockBuildMarketPilotage.mockImplementation(async (filters, market) => ({
    scope: { mode: 'market', market: { code: market.code } },
    received_filters: filters,
  }));
});

describe('GET /api/admin/dashboard/unified/market/:marketCode', () => {
  test('un non-admin est refusé avant toute résolution marché', async () => {
    mockCurrentUser = { id: 'client-1', role: 'client' };
    const res = await request(makeApp()).get('/api/admin/dashboard/unified/market/CM');
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('market_id en query est refusé avant toute résolution et ne peut jamais autoriser', async () => {
    const res = await request(makeApp())
      .get('/api/admin/dashboard/unified/market/CM?market_id=market-cg-id');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('client_market_id_forbidden');
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockBuildMarketPilotage).not.toHaveBeenCalled();
  });

  test('un marché inconnu ou inactif renvoie 404', async () => {
    const res = await request(makeApp()).get('/api/admin/dashboard/unified/market/ZZ');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('market_not_found');
  });

  test('un admin sans grant sur le marché résolu reçoit 403', async () => {
    const res = await request(makeApp()).get('/api/admin/dashboard/unified/market/CG');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('market_scope_denied');
    expect(mockBuildMarketPilotage).not.toHaveBeenCalled();
  });

  test('un grant CM autorise l’agrégat CM même sans autorité globale', async () => {
    mockGlobalAllowed = false;
    const res = await request(makeApp())
      .get('/api/admin/dashboard/unified/market/cm?from=2026-08-01&status=confirmed');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('private');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(mockBuildMarketPilotage).toHaveBeenCalledTimes(1);

    const [filters, market] = mockBuildMarketPilotage.mock.calls[0];
    expect(market.id).toBe('market-cm-id');
    expect(filters).toMatchObject({
      from: '2026-08-01',
      status: 'confirmed',
      market_id: 'market-cm-id',
    });
  });
});

describe('verrou des agrégats globaux montés après le routeur market', () => {
  test('role=admin ne suffit pas : /unified global est 403 sans grant explicite', async () => {
    mockGlobalAllowed = false;
    const res = await request(makeApp()).get('/api/admin/dashboard/unified');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('dashboard_global_access_denied');
  });

  test('le verrou couvre aussi les sous-agrégats globaux', async () => {
    mockGlobalAllowed = false;
    const res = await request(makeApp()).get('/api/admin/dashboard/control-tower');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('dashboard_global_access_denied');
  });

  test('un grant global explicite laisse atteindre le routeur historique', async () => {
    mockGlobalAllowed = true;
    const res = await request(makeApp()).get('/api/admin/dashboard/unified');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: 'global' });
  });
});
