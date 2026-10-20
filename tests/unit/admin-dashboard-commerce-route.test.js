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
  requireRole: () => (req, res, next) => next(),
}));

let mockMarketCapabilityGranted = true;
let mockGrantedMarketCodes = new Set(['CM']);
jest.mock('../../middleware/require-market-delegated-capability', () => ({
  requireMarketDelegatedCapability: required => (req, res, next) => {
    if (!mockMarketCapabilityGranted || required !== 'dashboard.market.read' || !mockGrantedMarketCodes.has(req.params.marketCode)) {
      return res.status(403).json({ code: 'MARKET_CAPABILITY_REQUIRED' });
    }
    req.marketDelegatedCapability = {
      capability: required,
      market_id: req.dashboardMarket && req.dashboardMarket.id,
      market_code: req.params.marketCode,
    };
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
const mockBuildCommerce = jest.fn();
jest.mock('../../services/dashboard-commerce', () => ({
  buildCommerce: (...args) => mockBuildCommerce(...args),
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
  mockMarketCapabilityGranted = true;
  mockGrantedMarketCodes = new Set(['CM']);
  mockQuery.mockImplementation(async (sql, params) => {
    if (String(sql).includes('FROM markets') && params[0] === 'CM') {
      return { rows: [{ id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF' }] };
    }
    if (String(sql).includes('FROM markets') && params[0] === 'CG') {
      return { rows: [{ id: 'market-cg-id', code: 'CG', name: 'Congo', currency: 'XAF' }] };
    }
    return { rows: [] };
  });
  mockBuildCommerce.mockImplementation(async (query, options = {}) => ({
    scope: options.market ? { mode: 'market', market: { code: options.market.code } } : { mode: 'global', market: null },
    period: Number(query.period || 30),
  }));
});

describe('routes Commerce Canonical', () => {
  test('opérateur CM lit Commerce CM et le market est résolu côté serveur', async () => {
    const res = await request(app()).get('/api/admin/dashboard/commerce/market/cm?period=30');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(mockBuildCommerce).toHaveBeenCalledWith(
      expect.objectContaining({ period: '30' }),
      { market: expect.objectContaining({ id: 'market-cm-id', code: 'CM' }) }
    );
    expect(JSON.stringify(res.body)).not.toContain('market-cm-id');
  });

  test('commerce CM projette les KPI et les produits en XAF sans muter le KMF source ni RCT1', async () => {
    const { invalidateCurrencyParityCache } = require('../../utils/currency');
    invalidateCurrencyParityCache();
    const originalQuery = mockQuery.getMockImplementation();
    mockQuery.mockImplementation(async (sql, params) => {
      if (String(sql).includes('currency_parities')) {
        const rates = { KMF: 491.96775, XAF: 655.957 };
        return { rows: rates[params[0]] ? [{ eur_rate: rates[params[0]] }] : [] };
      }
      return originalQuery(sql, params);
    });
    const source = {
      simulation: { scope: 'RCT1', label: 'Faits simulés' },
      kpis: [{ key: 'ca_encaisse', label: 'Ventes payées', value: 4919.6775, unit: 'KMF' }],
      top_products: [{ product_ref: 'PRD-1', revenue_kmf: 4919.6775, quantity: 2 }],
      categories: [{ category: 'Maison', revenue_kmf: 4919.6775 }],
    };
    mockBuildCommerce.mockResolvedValue(source);
    const res = await request(app()).get('/api/admin/dashboard/commerce/market/CM?simulation_scope=RCT1');
    expect(res.status).toBe(200);
    expect(res.body.kpis[0]).toMatchObject({ unit: 'XAF', base_currency: 'KMF', value: Math.round(6559.57) });
    expect(res.body.top_products[0]).toMatchObject({
      revenue_kmf: 4919.6775,
      revenue_display: { value: Math.round(6559.57), unit: 'XAF', base_currency: 'KMF' },
    });
    expect(res.body.categories[0].revenue_display.unit).toBe('XAF');
    expect(res.body.simulation.scope).toBe('RCT1');
    expect(mockBuildCommerce).toHaveBeenCalledWith(expect.objectContaining({ simulation_scope: 'RCT1' }),
      { market: expect.objectContaining({ code: 'CM' }) });
    expect(source.kpis[0].unit).toBe('KMF');
    expect(source.top_products[0].revenue_display).toBeUndefined();
  });

  test('opérateur CM ne peut pas lire Commerce CG', async () => {
    const res = await request(app()).get('/api/admin/dashboard/commerce/market/CG');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
    expect(mockBuildCommerce).not.toHaveBeenCalled();
  });

  test('market_id client est refusé avant le calcul Commerce', async () => {
    const res = await request(app()).get('/api/admin/dashboard/commerce/market/CM?market_id=market-cg-id');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('client_market_id_forbidden');
    expect(mockBuildCommerce).not.toHaveBeenCalled();
  });

  test('Commerce global exige le grant global explicite', async () => {
    let res = await request(app()).get('/api/admin/dashboard/commerce?period=7');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('dashboard_global_access_denied');
    expect(mockBuildCommerce).not.toHaveBeenCalled();

    mockGlobalAllowed = true;
    res = await request(app()).get('/api/admin/dashboard/commerce?period=7');
    expect(res.status).toBe(200);
    expect(mockBuildCommerce).toHaveBeenCalledWith(expect.objectContaining({ period: '7' }));
  });
});
