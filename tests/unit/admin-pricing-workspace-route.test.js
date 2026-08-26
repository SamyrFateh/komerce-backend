'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

let mockPricingAllowed = true;
const mockCalls = {
  buildWorkspace: jest.fn(), simulate: jest.fn(), flow: jest.fn(), applyPrice: jest.fn(),
  getStrategy: jest.fn(), applyStrategy: jest.fn(), addCompetitor: jest.fn(), deactivateCompetitor: jest.fn(),
  createCostComponent: jest.fn(), updateCostComponent: jest.fn(), toggleCostComponent: jest.fn(),
};

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); },
  requireRole: roles => (req, res, next) => roles.includes(req.user?.role) ? next() : res.status(403).json({ code: 'role_forbidden' }),
}));

jest.mock('../../middleware/require-pricing-global-authority', () => ({
  requirePricingGlobalAuthority: (req, res, next) => {
    if (!mockPricingAllowed) return res.status(403).json({ code: 'pricing_global_access_denied' });
    req.pricingGlobalAuthority = true;
    next();
  },
}));

jest.mock('../../services/pricing-workspace', () => ({
  PricingWorkspaceError: class PricingWorkspaceError extends Error {},
  buildWorkspace: (...args) => mockCalls.buildWorkspace(...args),
  simulate: (...args) => mockCalls.simulate(...args),
  flow: (...args) => mockCalls.flow(...args),
  applyPrice: (...args) => mockCalls.applyPrice(...args),
  getStrategy: (...args) => mockCalls.getStrategy(...args),
  applyStrategy: (...args) => mockCalls.applyStrategy(...args),
  addCompetitor: (...args) => mockCalls.addCompetitor(...args),
  deactivateCompetitor: (...args) => mockCalls.deactivateCompetitor(...args),
  createCostComponent: (...args) => mockCalls.createCostComponent(...args),
  updateCostComponent: (...args) => mockCalls.updateCostComponent(...args),
  toggleCostComponent: (...args) => mockCalls.toggleCostComponent(...args),
}));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-pricing-workspace');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/admin/workspaces/pricing', router);
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPricingAllowed = true;
  mockCalls.buildWorkspace.mockResolvedValue({ scope: { mode: 'global_pricing' }, summary: {}, products: [], recommendations: [], cost_components: [] });
  mockCalls.simulate.mockResolvedValue({ recommended_price_kmf: 5000 });
  mockCalls.applyPrice.mockResolvedValue({ product_ref: 'KPR-000001', new_price_kmf: 5000 });
  mockCalls.getStrategy.mockResolvedValue({ strategy: {}, competitors: [] });
});

test('grant pricing ouvre projection globale sans marché', async () => {
  const res = await request(app()).get('/api/admin/workspaces/pricing');
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toContain('no-store');
  expect(mockCalls.buildWorkspace).toHaveBeenCalledTimes(1);
});

test('rôle admin seul ne suffit pas sans grant pricing', async () => {
  mockPricingAllowed = false;
  const res = await request(app()).get('/api/admin/workspaces/pricing');
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('pricing_global_access_denied');
  expect(mockCalls.buildWorkspace).not.toHaveBeenCalled();
});

test.each([
  ['/api/admin/workspaces/pricing?market_id=cm', 'get', null],
  ['/api/admin/workspaces/pricing/simulate', 'post', { product_id: 'internal' }],
  ['/api/admin/workspaces/pricing/strategy/apply', 'post', { marketCode: 'CM', category: 'mode' }],
])('refuse UUID internes et dimensions marché du navigateur', async (url, method, body) => {
  const call = request(app())[method](url);
  const res = body ? await call.send(body) : await call;
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('pricing_internal_authority_forbidden');
});

test('simulation délègue product_ref et aucun UUID', async () => {
  const body = { product_ref: 'KPR-000001', channel: 'cash_relais' };
  const res = await request(app()).post('/api/admin/workspaces/pricing/simulate').send(body);
  expect(res.status).toBe(200);
  expect(mockCalls.simulate).toHaveBeenCalledWith(body);
});

test('application prix délègue product_ref et acteur authentifié', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/pricing/products/KPR-000001/apply-price')
    .send({ price_kmf: 5000, survival_price_kmf: 4000 });
  expect(res.status).toBe(200);
  expect(mockCalls.applyPrice).toHaveBeenCalledWith(
    'KPR-000001',
    { price_kmf: 5000, survival_price_kmf: 4000 },
    expect.objectContaining({ id: 'admin-1', role: 'admin' })
  );
});

test('strategy query ne reçoit que product_ref/category', async () => {
  const res = await request(app()).get('/api/admin/workspaces/pricing/strategy?product_ref=KPR-000001');
  expect(res.status).toBe(200);
  expect(mockCalls.getStrategy).toHaveBeenCalledWith({ product_ref: 'KPR-000001', category: undefined });
});

test('cost component utilise la clé métier', async () => {
  mockCalls.updateCostComponent.mockResolvedValue({ key: 'freight_air', default_value: 1200 });
  const res = await request(app())
    .post('/api/admin/workspaces/pricing/cost-components/freight_air/update')
    .send({ default_value: 1200 });
  expect(res.status).toBe(200);
  expect(mockCalls.updateCostComponent).toHaveBeenCalledWith('freight_air', { default_value: 1200 }, expect.objectContaining({ id: 'admin-1' }));
});
