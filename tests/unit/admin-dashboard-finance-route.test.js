'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockAllowedMarkets = new Set(['market-cm-id']);
let mockGlobalAllowed = false;

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); },
  requireAdmin: (req, res, next) => next(),
}));

jest.mock('../../middleware/require-market-scope', () => ({
  attachAuthorizedMarkets: (req, res, next) => {
    req.authorizedMarkets = new Set(mockAllowedMarkets);
    next();
  },
  requireMarketScope: getTargetMarketId => (req, res, next) => {
    const target = getTargetMarketId(req);
    if (!req.authorizedMarkets.has(target)) return res.status(403).json({ code: 'market_scope_denied' });
    next();
  },
}));

jest.mock('../../middleware/require-dashboard-global-authority', () => ({
  hasDashboardGlobalAuthority: jest.fn(async () => mockGlobalAllowed),
  requireDashboardGlobalAuthority: (req, res, next) => {
    if (!mockGlobalAllowed) return res.status(403).json({ code: 'dashboard_global_access_denied' });
    next();
  },
}));

jest.mock('../../services/dashboard-admin-context', () => ({
  DashboardAccessDeniedError: class extends Error {},
  resolveDashboardAdminContext: jest.fn(),
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../services/dashboard-pilotage-market', () => ({ buildMarketPilotage: jest.fn() }));
jest.mock('../../services/dashboard-commerce', () => ({ buildCommerce: jest.fn() }));
jest.mock('../../services/dashboard-operations', () => ({ buildOperations: jest.fn() }));

const mockBuildFinance = jest.fn();
jest.mock('../../services/dashboard-finance-canonical', () => ({
  buildFinance: (...args) => mockBuildFinance(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-dashboard-market');

function app() {
  const instance = express();
  instance.use('/api/admin/dashboard', router);
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
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
  mockBuildFinance.mockImplementation(async (query = {}, options = {}) => ({
    scope: options.market ? { mode: 'market', market: { code: options.market.code } } : { mode: 'global', market: null },
    period: Number(query.period || 30),
  }));
});

describe('routes Finance Canonical', () => {
  test('opérateur CM lit Finance CM avec le marché résolu côté serveur', async () => {
    const res = await request(app()).get('/api/admin/dashboard/finance/market/cm?period=30');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(mockBuildFinance).toHaveBeenCalledWith(
      expect.objectContaining({ period: '30' }),
      { market: expect.objectContaining({ id: 'market-cm-id', code: 'CM' }) }
    );
    expect(JSON.stringify(res.body)).not.toContain('market-cm-id');
  });

  test('opérateur CM ne peut pas lire Finance CG', async () => {
    const res = await request(app()).get('/api/admin/dashboard/finance/market/CG');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('market_scope_denied');
    expect(mockBuildFinance).not.toHaveBeenCalled();
  });

  test('market_id client est refusé avant le calcul Finance', async () => {
    const res = await request(app()).get('/api/admin/dashboard/finance/market/CM?market_id=market-cg-id');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('client_market_id_forbidden');
    expect(mockBuildFinance).not.toHaveBeenCalled();
  });

  test('Finance globale exige le grant global explicite', async () => {
    let res = await request(app()).get('/api/admin/dashboard/finance?period=7');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('dashboard_global_access_denied');
    expect(mockBuildFinance).not.toHaveBeenCalled();

    mockGlobalAllowed = true;
    res = await request(app()).get('/api/admin/dashboard/finance?period=7');
    expect(res.status).toBe(200);
    expect(mockBuildFinance).toHaveBeenCalledWith(expect.objectContaining({ period: '7' }));
  });
});
