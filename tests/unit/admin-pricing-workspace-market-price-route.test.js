'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
let mockRole = 'market_operator';
let mockAuthorized = new Set(['market-cm']);
let mockCentralPricing = false;
let mockScopeRole = 'manager';

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'manager-1', role: mockRole }; next(); },
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
    if (!target || !req.authorizedMarkets.has(target)) return res.status(403).json({ code: 'market_scope_denied' });
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

const mockWorkspace = {
  buildMarketWorkspace: jest.fn(async () => ({ summary: {}, cost_components: [], capabilities: {} })),
  buildWorkspace: jest.fn(), simulate: jest.fn(), simulateImpact: jest.fn(), flow: jest.fn(), applyPrice: jest.fn(),
  getStrategy: jest.fn(), applyStrategy: jest.fn(), addCompetitor: jest.fn(), deactivateCompetitor: jest.fn(),
  createCostComponent: jest.fn(), updateCostComponent: jest.fn(), toggleCostComponent: jest.fn(),
  updateMarketCostComponent: jest.fn(), toggleMarketCostComponent: jest.fn(), resetMarketCostComponent: jest.fn(),
};
jest.mock('../../services/pricing-workspace', () => mockWorkspace);

jest.mock('../../services/pricing-market-decision-policy', () => ({
  evaluateMarketDecision: jest.fn(), listMarketDecisionPolicyHistory: jest.fn(), recordMarketDecisionPolicy: jest.fn(),
}));

const mockMarketPrices = {
  listMarketProductPrices: jest.fn(async market => ({ market_code: market.code, currency: 'XAF', products: [] })),
  listMarketProductPriceHistory: jest.fn(async (market, ref) => ({ market_code: market.code, product_ref: ref, decisions: [] })),
  setMarketProductPrice: jest.fn(async (market, ref) => ({ market_code: market.code, product_ref: ref, decision: { decision_type: 'SET' } })),
  resetMarketProductPrice: jest.fn(async (market, ref) => ({ market_code: market.code, product_ref: ref, changed: true })),
};
jest.mock('../../services/pricing-market-price-service', () => mockMarketPrices);

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
  db.query.mockImplementation(async (_sql, params) => ({
    rows: [{ id: params[0] === 'CM' ? 'market-cm' : 'market-cg', code: params[0], name: params[0], currency: 'XAF' }],
  }));
});

test('viewer peut lire les prix marché et leur historique mais pas décider', async () => {
  mockScopeRole = 'viewer';

  let res = await request(app()).get('/api/admin/workspaces/pricing/market/CM/product-prices');
  expect(res.status).toBe(200);
  expect(mockMarketPrices.listMarketProductPrices).toHaveBeenCalledWith(expect.objectContaining({ id: 'market-cm', code: 'CM' }));

  res = await request(app()).get('/api/admin/workspaces/pricing/market/CM/product-prices/KPR-001/history');
  expect(res.status).toBe(200);
  expect(mockMarketPrices.listMarketProductPriceHistory).toHaveBeenCalledWith(expect.objectContaining({ id: 'market-cm' }), 'KPR-001');

  res = await request(app())
    .post('/api/admin/workspaces/pricing/market/CM/product-prices/KPR-001')
    .send({ price: 3500, rationale: 'Décision prix locale documentée et explicite.' });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('market_scope_role_insufficient');
  expect(mockMarketPrices.setMarketProductPrice).not.toHaveBeenCalled();
});

test('manager décide un prix local par product_ref sans transmettre market_id', async () => {
  const body = { price: 3500, rationale: 'Décision prix locale documentée et explicite.' };
  const res = await request(app())
    .post('/api/admin/workspaces/pricing/market/CM/product-prices/KPR-001')
    .send(body);

  expect(res.status).toBe(201);
  expect(res.body.action).toBe('set_market_product_price');
  expect(mockMarketPrices.setMarketProductPrice).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'market-cm', code: 'CM', currency: 'XAF' }),
    'KPR-001', body, 'manager-1'
  );
});

test('manager peut revenir au prix global par un événement RESET append-only', async () => {
  const body = { rationale: 'Retour explicite au prix global après le test marché.' };
  const res = await request(app())
    .post('/api/admin/workspaces/pricing/market/CM/product-prices/KPR-001/reset')
    .send(body);

  expect(res.status).toBe(200);
  expect(res.body.action).toBe('reset_market_product_price');
  expect(mockMarketPrices.resetMarketProductPrice).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'market-cm' }), 'KPR-001', body, 'manager-1'
  );
});

test('market_id forgé dans le payload est rejeté avant le service', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/pricing/market/CM/product-prices/KPR-001')
    .send({
      market_id: 'market-cg',
      price: 3500,
      rationale: 'Tentative de forger le scope marché depuis le navigateur.',
    });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe('pricing_internal_authority_forbidden');
  expect(mockMarketPrices.setMarketProductPrice).not.toHaveBeenCalled();
});

test('opérateur CM ne peut pas lire ni modifier les prix CG', async () => {
  let res = await request(app()).get('/api/admin/workspaces/pricing/market/CG/product-prices');
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('market_scope_denied');

  res = await request(app())
    .post('/api/admin/workspaces/pricing/market/CG/product-prices/KPR-001')
    .send({ price: 3500, rationale: 'Décision qui ne doit jamais franchir le scope CM.' });
  expect(res.status).toBe(403);
  expect(mockMarketPrices.setMarketProductPrice).not.toHaveBeenCalled();
});

test('la projection workspace expose la capacité mais réutilise le droit manager existant', async () => {
  let res = await request(app()).get('/api/admin/workspaces/pricing/market/CM');
  expect(res.status).toBe(200);
  expect(res.body.capabilities).toEqual(expect.objectContaining({
    market_product_prices: true,
    manage_market_product_prices: true,
  }));

  mockScopeRole = 'viewer';
  res = await request(app()).get('/api/admin/workspaces/pricing/market/CM');
  expect(res.status).toBe(200);
  expect(res.body.capabilities.manage_market_product_prices).toBe(false);
});
