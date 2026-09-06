'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
let mockRole = 'market_operator';
let mockAuthorized = new Set(['market-cm']);
let mockCentralPricing = false;
let mockScopeRole = 'manager';

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'partner-1', role: mockRole }; next(); },
  requireRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ code: 'role_forbidden' }),
}));

jest.mock('../../middleware/require-market-scope', () => ({
  attachAuthorizedMarkets: (req, res, next) => { req.authorizedMarkets = new Set(mockAuthorized); next(); },
  requireMarketScope: getter => (req, res, next) => req.authorizedMarkets.has(getter(req))
    ? next()
    : res.status(403).json({ code: 'market_scope_denied' }),
  resolveMarketScopeRole: jest.fn(async () => mockScopeRole),
  requireMarketScopeRole: requiredRole => getter => (req, res, next) => {
    if (req.user.role !== 'market_operator') return next();
    const target = getter(req);
    if (!target || !req.authorizedMarkets.has(target)) {
      return res.status(403).json({ code: 'market_scope_denied' });
    }
    if (requiredRole === 'manager' && mockScopeRole !== 'manager') {
      return res.status(403).json({ code: 'market_scope_role_insufficient' });
    }
    return next();
  },
}));

jest.mock('../../middleware/require-pricing-global-authority', () => ({
  hasPricingGlobalAuthority: jest.fn(async () => mockCentralPricing),
  requirePricingGlobalAuthority: (req, res, next) => mockCentralPricing ? next() : res.status(403).json({ code: 'pricing_global_access_denied' }),
}));

jest.mock('../../db', () => ({ query: jest.fn() }));
const db = require('../../db');

const marketProjection = {
  scope: { mode: 'market_pricing', market_code: 'CM' },
  summary: {},
  cost_components: [],
  capabilities: {
    cost_overrides: true,
    reset_to_global: true,
    create_components: false,
    product_price_mutation: false,
    strategy_mutation: false,
  },
};
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
  mockAuthorized = new Set(['market-cm']);
  mockCentralPricing = false;
  mockScopeRole = 'manager';
  db.query.mockImplementation(async (_sql, params) => ({ rows: [{ id: params[0] === 'CM' ? 'market-cm' : 'market-cg', code: params[0], name: params[0], currency: 'XAF' }] }));
});

test('manager CM lit et modifie uniquement le modèle CM', async () => {
  let res = await request(app()).get('/api/admin/workspaces/pricing/market/CM');
  expect(res.status).toBe(200);
  expect(res.body.access).toEqual({ role: 'manager', read_only: false, can_manage_costs: true });
  expect(res.body.capabilities).toEqual(expect.objectContaining({ cost_overrides: true, reset_to_global: true }));
  expect(mockWorkspace.buildMarketWorkspace).toHaveBeenCalledWith({ market: expect.objectContaining({ id: 'market-cm', code: 'CM' }) });

  res = await request(app()).post('/api/admin/workspaces/pricing/market/CM/cost-components/freight/update').send({ default_value: 1250 });
  expect(res.status).toBe(200);
  expect(mockWorkspace.updateMarketCostComponent).toHaveBeenCalledWith(expect.objectContaining({ id: 'market-cm' }), 'freight', { default_value: 1250 }, expect.objectContaining({ id: 'partner-1' }));
});

test('viewer CM consulte l’Atelier mais les mutations sont refusées', async () => {
  mockScopeRole = 'viewer';

  const read = await request(app()).get('/api/admin/workspaces/pricing/market/CM');
  expect(read.status).toBe(200);
  expect(read.body.access).toEqual({ role: 'viewer', read_only: true, can_manage_costs: false });
  expect(read.body.capabilities).toEqual(expect.objectContaining({ cost_overrides: false, reset_to_global: false }));

  for (const suffix of ['update', 'toggle', 'reset']) {
    const res = await request(app())
      .post(`/api/admin/workspaces/pricing/market/CM/cost-components/freight/${suffix}`)
      .send(suffix === 'update' ? { default_value: 1250 } : {});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('market_scope_role_insufficient');
  }
  expect(mockWorkspace.updateMarketCostComponent).not.toHaveBeenCalled();
  expect(mockWorkspace.toggleMarketCostComponent).not.toHaveBeenCalled();
  expect(mockWorkspace.resetMarketCostComponent).not.toHaveBeenCalled();
});

test('autorité Pricing globale peut gérer un override pays sans grant local', async () => {
  mockRole = 'admin';
  mockAuthorized = new Set();
  mockCentralPricing = true;
  mockScopeRole = 'viewer';

  const read = await request(app()).get('/api/admin/workspaces/pricing/market/CM');
  expect(read.status).toBe(200);
  expect(read.body.access).toEqual({ role: 'global_admin', read_only: false, can_manage_costs: true });

  const write = await request(app())
    .post('/api/admin/workspaces/pricing/market/CM/cost-components/freight/update')
    .send({ default_value: 1400 });
  expect(write.status).toBe(200);
});

test('opérateur CM reçoit 403 sur le modèle CG', async () => {
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