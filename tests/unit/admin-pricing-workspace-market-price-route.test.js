'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

let mockRole = 'market_operator';
let mockAuthorized = new Set(['market-cm']);
let mockCentralPricing = false;
let mockScopeRole = 'manager';

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'manager-1', role: mockRole }; next(); },
  requireRole: roles => (req, res, next) => roles.includes(req.user.role)
    ? next()
    : res.status(403).json({ code: 'role_forbidden' }),
}));

jest.mock('../../middleware/require-market-scope', () => ({
  attachAuthorizedMarkets: (req, res, next) => { req.authorizedMarkets = new Set(mockAuthorized); next(); },
  requireMarketScope: getter => (req, res, next) => req.authorizedMarkets.has(getter(req))
    ? next()
    : res.status(403).json({ code: 'market_scope_denied' }),
  resolveMarketScopeRole: jest.fn(async () => mockScopeRole),
  requireMarketScopeRole: requiredRole => getter => (req, res, next) => {
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
  requirePricingGlobalAuthority: (req, res, next) => mockCentralPricing
    ? next()
    : res.status(403).json({ code: 'pricing_global_access_denied' }),
}));

jest.mock('../../db', () => ({ query: jest.fn() }));
const db = require('../../db');

const mockWorkspace = {
  buildMarketWorkspace: jest.fn(async () => ({
    scope: { mode: 'market_pricing', market_code: 'CM', market_currency: 'XAF' },
    summary: {},
    cost_components: [],
    capabilities: {},
  })),
  simulateImpact: jest.fn(),
  updateMarketCostComponent: jest.fn(),
  toggleMarketCostComponent: jest.fn(),
  resetMarketCostComponent: jest.fn(),
  buildWorkspace: jest.fn(), simulate: jest.fn(), flow: jest.fn(), applyPrice: jest.fn(), getStrategy: jest.fn(),
  applyStrategy: jest.fn(), addCompetitor: jest.fn(), deactivateCompetitor: jest.fn(), createCostComponent: jest.fn(),
  updateCostComponent: jest.fn(), toggleCostComponent: jest.fn(),
};
jest.mock('../../services/pricing-workspace', () => mockWorkspace);

const mockDecisionPolicy = {
  evaluateMarketDecision: jest.fn(),
  listMarketDecisionPolicyHistory: jest.fn(async () => []),
  recordMarketDecisionPolicy: jest.fn(),
};
jest.mock('../../services/pricing-market-decision-policy', () => mockDecisionPolicy);

const mockMarketPrices = {
  listEffectivePrices: jest.fn(async () => [{
    product_ref: 'KPR-1',
    global_price_kmf: 18000,
    market_price: { amount: 25000, currency: 'XAF' },
  }]),
  decidePrice: jest.fn(async args => ({ product_ref: args.productRef, market_code: args.market.code })),
  resetPrice: jest.fn(async args => ({ product_ref: args.productRef, inherited_global: true })),
};
jest.mock('../../services/pricing-market-price-service', () => mockMarketPrices);

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-pricing-workspace');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/admin/workspaces/pricing', router);
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'market_operator';
  mockAuthorized = new Set(['market-cm']);
  mockCentralPricing = false;
  mockScopeRole = 'manager';
  db.query.mockImplementation(async (_sql, params) => ({
    rows: [{
      id: params[0] === 'CM' ? 'market-cm' : 'market-cg',
      code: params[0],
      name: params[0],
      currency: 'XAF',
      minor_unit: 0,
    }],
  }));
});

test('GET marché expose les overlays sans changer le catalogue maître', async () => {
  const res = await request(app()).get('/api/admin/workspaces/pricing/market/CM');
  expect(res.status).toBe(200);
  expect(res.body.market_prices).toHaveLength(1);
  expect(res.body.scope.market_minor_unit).toBe(0);
  expect(res.body.capabilities.market_price_decision).toBe(true);
  expect(res.body.capabilities.reset_market_price).toBe(true);
  expect(mockMarketPrices.listEffectivePrices).toHaveBeenCalledWith(expect.objectContaining({
    id: 'market-cm', code: 'CM', currency: 'XAF', minor_unit: 0,
  }));
});

test('manager décide un prix local avec justification et durée optionnelle', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/pricing/market/CM/products/KPR-1/price-decision')
    .send({ price_amount: 24500, rationale: 'Positionnement marché', duration_days: 7 });

  expect(res.status).toBe(200);
  expect(mockMarketPrices.decidePrice).toHaveBeenCalledWith({
    market: expect.objectContaining({ id: 'market-cm', code: 'CM' }),
    productRef: 'KPR-1',
    priceAmount: 24500,
    rationale: 'Positionnement marché',
    durationDays: 7,
    actorId: 'manager-1',
  });
});

test('viewer lit les prix mais ne peut ni décider ni reset', async () => {
  mockScopeRole = 'viewer';
  const read = await request(app()).get('/api/admin/workspaces/pricing/market/CM');
  expect(read.status).toBe(200);
  expect(read.body.capabilities.market_price_decision).toBe(false);

  let res = await request(app())
    .post('/api/admin/workspaces/pricing/market/CM/products/KPR-1/price-decision')
    .send({ price_amount: 24500, rationale: 'Essai' });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('market_scope_role_insufficient');

  res = await request(app())
    .post('/api/admin/workspaces/pricing/market/CM/products/KPR-1/price-decision/reset')
    .send({});
  expect(res.status).toBe(403);
  expect(mockMarketPrices.decidePrice).not.toHaveBeenCalled();
  expect(mockMarketPrices.resetPrice).not.toHaveBeenCalled();
});

test('market_id fourni par le navigateur est rejeté avant toute décision', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/pricing/market/CM/products/KPR-1/price-decision')
    .send({ market_id: 'market-cg', price_amount: 24500, rationale: 'Forge' });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe('pricing_internal_authority_forbidden');
  expect(mockMarketPrices.decidePrice).not.toHaveBeenCalled();
});

test('manager CM ne peut pas décider un prix CG', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/pricing/market/CG/products/KPR-1/price-decision')
    .send({ price_amount: 24500, rationale: 'Hors périmètre' });

  expect(res.status).toBe(403);
  expect(res.body.code).toBe('market_scope_denied');
  expect(mockMarketPrices.decidePrice).not.toHaveBeenCalled();
});

test('reset révoque uniquement l’overlay marché', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/pricing/market/CM/products/KPR-1/price-decision/reset')
    .send({ reason: 'Retour prix global' });

  expect(res.status).toBe(200);
  expect(mockMarketPrices.resetPrice).toHaveBeenCalledWith({
    market: expect.objectContaining({ id: 'market-cm', code: 'CM' }),
    productRef: 'KPR-1',
    actorId: 'manager-1',
    reason: 'Retour prix global',
  });
});
