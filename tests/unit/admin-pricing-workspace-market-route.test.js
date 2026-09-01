'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
let mockRole = 'market_operator';
let mockAuthorized = new Set(['market-cm']);
let mockCentralPricing = false;

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'partner-1', role: mockRole }; next(); },
  requireRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ code: 'role_forbidden' }),
}));

jest.mock('../../middleware/require-market-scope', () => ({
  attachAuthorizedMarkets: (req, res, next) => { req.authorizedMarkets = new Set(mockAuthorized); next(); },
  requireMarketScope: getter => (req, res, next) => req.authorizedMarkets.has(getter(req))
    ? next()
    : res.status(403).json({ code: 'market_scope_denied' }),
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
  mockAuthorized = new Set(['market-cm']);
  mockCentralPricing = false;
  db.query.mockImplementation(async (_sql, params) => ({ rows: [{ id: params[0] === 'CM' ? 'market-cm' : 'market-cg', code: params[0], name: params[0], currency: 'XAF' }] }));
});

test('opérateur CM lit et modifie uniquement le modèle CM', async () => {
  let res = await request(app()).get('/api/admin/workspaces/pricing/market/CM');
  expect(res.status).toBe(200);
  expect(mockWorkspace.buildMarketWorkspace).toHaveBeenCalledWith({ market: expect.objectContaining({ id: 'market-cm', code: 'CM' }) });

  res = await request(app()).post('/api/admin/workspaces/pricing/market/CM/cost-components/freight/update').send({ default_value: 1250 });
  expect(res.status).toBe(200);
  expect(mockWorkspace.updateMarketCostComponent).toHaveBeenCalledWith(expect.objectContaining({ id: 'market-cm' }), 'freight', { default_value: 1250 }, expect.objectContaining({ id: 'partner-1' }));
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
