'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockAllowedMarkets = new Set(['market-cm-id']);
let mockGlobalAllowed = false;
let mockActorRole = 'market_operator';

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'actor-1', role: mockActorRole }; next(); },
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
    if (req.user.role !== 'admin' && !mockGlobalAllowed) return res.status(403).json({ code: 'dashboard_global_access_denied' });
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
const mockBuildBuyerDrill = jest.fn();
jest.mock('../../services/dashboard-commerce', () => ({
  buildCommerce: (...args) => mockBuildCommerce(...args),
  buildBuyerDrill: (...args) => mockBuildBuyerDrill(...args),
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
  mockActorRole = 'market_operator';
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
        return { rows: rates[params[0]] ? [{ rate: String(rates[params[0]]), updated_at: "2026-01-01T00:00:00.000Z" }] : [] };
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

  test('drill acheteurs reprend exactement les gardes Commerce marché et global', async () => {
    mockBuildBuyerDrill.mockResolvedValue({kind:'paid_buyers',pagination:{total:1},accounts:[{paid_orders:2,latest_order_reference:'K-TEST'}]});
    const query='?period=7&buyer_drill=paid_buyers&as_of=2026-10-20T12%3A00%3A00.000Z&page=1';
    let res=await request(app()).get('/api/admin/dashboard/commerce/market/CM'+query);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(mockBuildBuyerDrill).toHaveBeenCalledWith(expect.objectContaining({buyer_drill:'paid_buyers',period:'7',page:'1'}),
      {market:expect.objectContaining({id:'market-cm-id',code:'CM'})});
    expect(mockBuildCommerce).not.toHaveBeenCalled();
    mockBuildBuyerDrill.mockClear();
    res=await request(app()).get('/api/admin/dashboard/commerce/market/CG'+query);
    expect(res.status).toBe(403);
    res=await request(app()).get('/api/admin/dashboard/commerce/market/CM'+query+'&market_id=market-cg-id');
    expect(res.status).toBe(400);
    res=await request(app()).get('/api/admin/dashboard/commerce'+query);
    expect(res.status).toBe(403);
    expect(mockBuildBuyerDrill).not.toHaveBeenCalled();
    mockActorRole='admin';
    res=await request(app()).get('/api/admin/dashboard/commerce'+query);
    expect(res.status).toBe(200);
    expect(mockBuildBuyerDrill).toHaveBeenCalledTimes(1);
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

  test('A1 : opérateur sans grant refusé, admin sans grant autorisé', async () => {
    let res = await request(app()).get('/api/admin/dashboard/commerce?period=7');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('dashboard_global_access_denied');
    expect(mockBuildCommerce).not.toHaveBeenCalled();

    mockActorRole = 'admin';
    res = await request(app()).get('/api/admin/dashboard/commerce?period=7');
    expect(res.status).toBe(200);
    expect(mockBuildCommerce).toHaveBeenCalledWith(expect.objectContaining({ period: '7' }));
  });
});
