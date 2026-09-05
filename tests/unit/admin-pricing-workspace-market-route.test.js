'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
let mockRole = 'market_operator';
let mockScopes = new Map([['market-cm', 'manager']]);
let mockCentralPricing = false;

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'partner-1', role: mockRole }; next(); },
  requireRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ code: 'role_forbidden' }),
}));

jest.mock('../../middleware/require-market-scope', () => ({
  attachAuthorizedMarkets: (req, res, next) => {
    req.authorizedMarketScopes = new Map(mockScopes);
    req.authorizedMarkets = new Set(mockScopes.keys());
    next();
  },
  requireMarketScope: getter => (req, res, next) => {
    const target = getter(req);
    const role = req.authorizedMarketScopes.get(target);
    if (!role) return res.status(403).json({ code: 'market_scope_denied' });
    req.marketScopeRole = role;
    return next();
  },
  requireMarketScopeRole: (getter, allowedRoles) => (req, res, next) => {
    const target = getter(req);
    const role = req.authorizedMarketScopes.get(target);
    if (!role) return res.status(403).json({ code: 'market_scope_denied' });
    if (!allowedRoles.includes(role)) return res.status(403).json({ code: 'market_scope_role_denied', market_role: role });
    req.marketScopeRole = role;
    return next();
  },
}));

jest.mock('../../middleware/require-pricing-global-authority', () => ({
  hasPricingGlobalAuthority: jest.fn(async () => mockCentralPricing),
  requirePricingGlobalAuthority: (req, res, next) => mockCentralPricing ? next() : res.status(403).json({ code: 'pricing_global_access_denied' }),
}));

jest.mock('../../db', () => ({ query: jest.fn() }));
const db = require('../../db');

const marketProjection = { scope: { mode: 'market_pricing', market_code: 'CM' }, summary: {}, cost_components: [] };
const mockWorkspace = {
  PricingWorkspaceError: class PricingWorkspaceError extends Error {},
  buildMarketWorkspace: jest.fn(async () => marketProjection),
  updateMarketCostComponent: jest.fn(async () => ({ key: 'freight', default_value: 1250 })),
  toggleMarketCostComponent: jest.fn(async () => ({ key: 'freight', is_active: false })),
  resetMarketCostComponent: jest.fn(async () => ({ key: 'freight', inherited: true })),
  buildWorkspace: jest.fn(), simulate: jest.fn(), flow: jest.fn(), applyPrice: jest.fn(), getStrategy: jest.fn(),
  applyStrategy: jest.fn(), addCompetitor: jest.fn(), deactivateCompetitor: jest.fn(), createCostComponent: jest.fn(),
  updateCostComponent: jest.fn(), toggleCostComponent: jest.fn(),
};
jest.mock('../../services/pricing-workspace', () => mockWorkspace);

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-pricing-workspace');
function app() { const a = express(); a.use(express.json()); a.use('/api/admin/workspaces/pricing', router); return a; }

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'market_operator';
  mockScopes = new Map([['market-cm', 'manager']]);
  mockCentralPricing = false;
  db.query.mockImplementation(async (_sql, params) => ({ rows: [{ id: params[0] === 'CM' ? 'market-cm' : 'market-cg', code: params[0], name: params[0], currency: 'XAF' }] }));
});

test('manager CM lit et modifie uniquement le modèle CM', async () => {
  let res = await request(app()).get('/api/admin/workspaces/pricing/market/CM');
  expect(res.status).toBe(200);
  expect(mockWorkspace.buildMarketWorkspace).toHaveBeenCalledWith({ market: expect.objectContaining({ id: 'market-cm', code: 'CM' }) });

  res = await request(app()).post('/api/admin/workspaces/pricing/market/CM/cost-components/freight/update').send({ default_value: 1250 });
  expect(res.status).toBe(200);
  expect(mockWorkspace.updateMarketCostComponent).toHaveBeenCalledWith(expect.objectContaining({ id: 'market-cm' }), 'freight', { default_value: 1250 }, expect.objectContaining({ id: 'partner-1' }));
});

test('viewer CM lit le modèle mais ne peut pas le modifier', async () => {
  mockScopes = new Map([['market-cm', 'viewer']]);
  let res = await request(app()).get('/api/admin/workspaces/pricing/market/CM');
  expect(res.status).toBe(200);

  res = await request(app()).post('/api/admin/workspaces/pricing/market/CM/cost-components/freight/update').send({ default_value: 1250 });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('market_scope_role_denied');
  expect(res.body.market_role).toBe('viewer');
  expect(mockWorkspace.updateMarketCostComponent).not.toHaveBeenCalled();

  res = await request(app()).post('/api/admin/workspaces/pricing/market/CM/cost-components/freight/toggle');
  expect(res.status).toBe(403);
  res = await request(app()).post('/api/admin/workspaces/pricing/market/CM/cost-components/freight/reset');
  expect(res.status).toBe(403);
});

test('manager CM reçoit 403 sur le modèle CG', async () => {
  const res = await request(app()).get('/api/admin/workspaces/pricing/market/CG');
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('market_scope_denied');
  expect(mockWorkspace.buildMarketWorkspace).not.toHaveBeenCalled();
});

test('market_operator ne peut jamais atteindre le pricing global', async () => {
  const res = await request(app()).get('/api/admin/workspaces/pricing');
  expect(res.status).toBe(403);
  expect(mockWorkspace.buildWorkspace).not.toHaveBeenCalled();
});

test('admin avec autorité Pricing globale peut modifier un override marché sans grant local manager', async () => {
  mockRole = 'admin';
  mockScopes = new Map();
  mockCentralPricing = true;
  const res = await request(app()).post('/api/admin/workspaces/pricing/market/CM/cost-components/freight/update').send({ default_value: 1300 });
  expect(res.status).toBe(200);
  expect(mockWorkspace.updateMarketCostComponent).toHaveBeenCalled();
});
