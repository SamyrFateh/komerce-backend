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
    if (!mockMarketCapabilityGranted || required !== 'operations.read' || !mockGrantedMarketCodes.has(req.params.marketCode)) {
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
jest.mock('../../services/dashboard-commerce', () => ({ buildCommerce: jest.fn() }));

const mockBuildOperations = jest.fn();
const mockBuildControlChainDrill = jest.fn();
jest.mock('../../services/dashboard-operations', () => ({
  buildOperations: (...args) => mockBuildOperations(...args),
  buildControlChainDrill: (...args) => mockBuildControlChainDrill(...args),
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
  mockBuildOperations.mockImplementation(async (options = {}) => ({
    scope: options.market ? { mode: 'market', market: { code: options.market.code } } : { mode: 'global', market: null },
  }));
});

describe('routes Operations Canonical', () => {
  test('opérateur CM lit Operations CM avec un marché résolu côté serveur', async () => {
    const res = await request(app()).get('/api/admin/dashboard/operations/market/cm');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(mockBuildOperations).toHaveBeenCalledWith({ market: expect.objectContaining({ id: 'market-cm-id', code: 'CM' }) });
    expect(JSON.stringify(res.body)).not.toContain('market-cm-id');
  });

  test('opérateur CM ne peut pas lire Operations CG', async () => {
    const res = await request(app()).get('/api/admin/dashboard/operations/market/CG');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
    expect(mockBuildOperations).not.toHaveBeenCalled();
  });

  test('market_id client est refusé avant le calcul Operations', async () => {
    const res = await request(app()).get('/api/admin/dashboard/operations/market/CM?market_id=market-cg-id');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('client_market_id_forbidden');
    expect(mockBuildOperations).not.toHaveBeenCalled();
  });

  test('drill et simulation conservent les gardes de lecture et le scope serveur',async()=>{
    mockBuildControlChainDrill.mockResolvedValue({orders:[]});
    const query='?chain_drill=ORDER&page=1&token='+'a'.repeat(32)+'&simulation_scope=RCT1';
    const root='/api/admin/dashboard/operations';
    let response=await request(app()).get(root+'/market/CM'+query);
    expect(response.status).toBe(200);
    expect(mockBuildControlChainDrill).toHaveBeenCalledWith(expect.objectContaining({chain_drill:'ORDER',simulation_scope:'RCT1'}),{market:expect.objectContaining({id:'market-cm-id'})});
    mockBuildControlChainDrill.mockClear();
    for(const [path,status] of [[root+'/market/CG'+query,403],[root+query,403],[root+'/market/CM'+query+'&market_id=market-cg-id',400],[root+'/market/CM'+query+'&simulation_scope=RCT2',400]]){
      response=await request(app()).get(path);
      expect(response.status).toBe(status);
    }
    expect(mockBuildControlChainDrill).not.toHaveBeenCalled();
    expect(mockBuildOperations).not.toHaveBeenCalled();
    mockBuildControlChainDrill.mockRejectedValueOnce(Object.assign(new Error('changed'),{status:409,code:'control_chain_population_changed'}));
    response=await request(app()).get(root+'/market/CM'+query);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('control_chain_population_changed');
  });

  test('A1 : opérateur sans grant refusé, admin sans grant autorisé', async () => {
    let res = await request(app()).get('/api/admin/dashboard/operations');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('dashboard_global_access_denied');
    expect(mockBuildOperations).not.toHaveBeenCalled();

    mockActorRole = 'admin';
    res = await request(app()).get('/api/admin/dashboard/operations');
    expect(res.status).toBe(200);
    expect(mockBuildOperations).toHaveBeenCalledWith();
  });
});
