'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockCurrentUser = { id: 'admin-1', role: 'admin' };
let mockGrantedMarketCodes = new Set(['CM']);
let mockGlobalAllowed = false;

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = mockCurrentUser; next(); },
  requireAdmin: (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    next();
  },
  requireRole: roles => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

// LOT B (audit dashboard.market.read) : le guard réel n'est plus
// operator_market_scopes/requireMarketScope mais la capability exacte
// resolveAuthorization(..., requiredCapability: 'dashboard.market.read').
// mockGrantedMarketCodes simule l'ensemble des marchés où le membership
// courant détient effectivement cette capability déléguée (pas juste un
// scope). Codes d'erreur alignés sur les vrais codes de
// services/market-delegation-service.js (MARKET_MEMBERSHIP_REQUIRED,
// MARKET_CAPABILITY_REQUIRED), plus jamais market_scope_denied.
const mockResolveAuthorization = jest.fn();
const mockListAuthorizedMarketsForCapability = jest.fn();
jest.mock('../../services/market-delegation-service', () => ({
  resolveAuthorization: (...args) => mockResolveAuthorization(...args),
  listAuthorizedMarketsForCapability: (...args) => mockListAuthorizedMarketsForCapability(...args),
  audit: jest.fn(),
}));

jest.mock('../../middleware/require-dashboard-global-authority', () => ({
  hasDashboardGlobalAuthority: jest.fn(async () => mockGlobalAllowed),
  requireDashboardGlobalAuthority: (req, res, next) => {
    if (!mockGlobalAllowed) {
      return res.status(403).json({
        error: 'global denied',
        code: 'dashboard_global_access_denied',
      });
    }
    req.dashboardGlobalAuthority = true;
    next();
  },
}));

const mockResolveAdminContext = jest.fn();
class MockDashboardAccessDeniedError extends Error {
  constructor() {
    super('dashboard_access_denied');
    this.code = 'dashboard_access_denied';
  }
}
jest.mock('../../services/dashboard-admin-context', () => ({
  DashboardAccessDeniedError: MockDashboardAccessDeniedError,
  resolveDashboardAdminContext: (...args) => mockResolveAdminContext(...args),
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockBuildMarketPilotage = jest.fn();
jest.mock('../../services/dashboard-pilotage-market', () => ({
  buildMarketPilotage: (...args) => mockBuildMarketPilotage(...args),
}));

const mockResolveReference = jest.fn();
class MockCanonicalReferenceResolverError extends Error {}
jest.mock('../../services/canonical-reference-resolver', () => ({
  CanonicalReferenceResolverError: MockCanonicalReferenceResolverError,
  resolveReference: (...args) => mockResolveReference(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() })),
}));

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-dashboard-market');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/dashboard', router);
  // Simule le routeur global historique, monté juste après en production.
  app.get('/api/admin/dashboard/unified', (req, res) => res.json({ mode: 'global' }));
  app.get('/api/admin/dashboard/control-tower', (req, res) => res.json({ mode: 'global-control' }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { id: 'admin-1', role: 'admin' };
  mockGrantedMarketCodes = new Set(['CM']);
  mockGlobalAllowed = false;
  mockResolveAdminContext.mockImplementation(async user => ({
    actor: { id: user.id, role: user.role },
    access: {
      mode: 'market',
      allowedMarkets: ['CM'],
      defaultMarket: 'CM',
      capabilities: ['pilotage.read', 'dashboard.market.read'],
    },
  }));
  mockQuery.mockImplementation(async (sql, params) => {
    if (String(sql).includes('FROM markets') && params[0] === 'CM') {
      return { rows: [{ id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF' }] };
    }
    if (String(sql).includes('FROM markets') && params[0] === 'CG') {
      return { rows: [{ id: 'market-cg-id', code: 'CG', name: 'Congo', currency: 'XAF' }] };
    }
    return { rows: [] };
  });
  mockListAuthorizedMarketsForCapability.mockImplementation(async (_db, { requiredCapability }) => {
    if (requiredCapability !== 'operations.read') return [];
    return [{ market_id: 'market-cm-id', market_code: 'CM' }];
  });
  mockResolveReference.mockResolvedValue({
    query: 'KOM-RCV-1',
    found: true,
    ambiguous: false,
    matches: [{ entity_type: 'HUB_UNIT', customer_order_reference: 'K-1' }],
  });
  mockResolveAuthorization.mockImplementation(async (_db, { marketCode, requiredCapability }) => {
    if (requiredCapability === 'dashboard.market.read' && mockGrantedMarketCodes.has(marketCode)) {
      const marketId = marketCode === 'CM' ? 'market-cm-id' : marketCode === 'CG' ? 'market-cg-id' : `market-${marketCode}-id`;
      return { market_id: marketId, market_code: marketCode, assignment_id: 'assignment-1', membership_id: 'membership-1' };
    }
    const error = new Error('Aucune membership active sur ce Market ID.');
    error.code = 'MARKET_MEMBERSHIP_REQUIRED';
    error.status = 403;
    throw error;
  });
  mockBuildMarketPilotage.mockImplementation(async (filters, market) => ({
    scope: { mode: 'market', market: { code: market.code } },
    received_filters: filters,
  }));
});

describe('GET /api/admin/dashboard/context', () => {
  test('retourne uniquement la projection d’autorité serveur et no-store', async () => {
    const res = await request(makeApp()).get('/api/admin/dashboard/context');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('private');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(mockResolveAdminContext).toHaveBeenCalledWith(mockCurrentUser);
    expect(res.body.access).toEqual(expect.objectContaining({
      mode: 'market',
      allowedMarkets: ['CM'],
      defaultMarket: 'CM',
    }));
    expect(JSON.stringify(res.body)).not.toContain('market_id');
  });

  test.each(['agent_hub', 'agent_relais', 'finance'])('%s peut résoudre son AdminContext sans devenir admin dashboard', async role => {
    mockCurrentUser = { id: `${role}-1`, role };

    const contextRes = await request(makeApp()).get('/api/admin/dashboard/context');
    const dashboardRes = await request(makeApp()).get('/api/admin/dashboard/unified/market/CM');

    expect(contextRes.status).toBe(200);
    expect(contextRes.body.actor.role).toBe(role);
    expect(dashboardRes.status).toBe(403);
    expect(mockBuildMarketPilotage).not.toHaveBeenCalled();
  });

  test('zéro autorité dashboard renvoie 403, même pour role=admin', async () => {
    mockResolveAdminContext.mockRejectedValueOnce(new MockDashboardAccessDeniedError());
    const res = await request(makeApp()).get('/api/admin/dashboard/context');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('dashboard_access_denied');
  });
});

describe('GET /api/admin/dashboard/unified/market/:marketCode', () => {
  test('un non-admin est refusé avant toute résolution marché', async () => {
    mockCurrentUser = { id: 'client-1', role: 'client' };
    const res = await request(makeApp()).get('/api/admin/dashboard/unified/market/CM');
    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain('operator_market_scopes');
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('FROM markets'))).toBe(false);
  });

  test('market_operator CM lit son cockpit CM mais ne peut pas lire CG (capability exacte, pas juste le scope)', async () => {
    mockCurrentUser = { id: 'partner-cm-1', role: 'market_operator' };
    mockGrantedMarketCodes = new Set(['CM']);
    mockGlobalAllowed = false;

    const contextRes = await request(makeApp()).get('/api/admin/dashboard/context');
    const cmRes = await request(makeApp()).get('/api/admin/dashboard/unified/market/CM');
    const cgRes = await request(makeApp()).get('/api/admin/dashboard/unified/market/CG');

    expect(contextRes.status).toBe(200);
    expect(contextRes.body.actor.role).toBe('market_operator');
    expect(cmRes.status).toBe(200);
    expect(cgRes.status).toBe(403);
    expect(cgRes.body.code).toBe('MARKET_MEMBERSHIP_REQUIRED');
    expect(mockResolveAuthorization).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: 'partner-cm-1',
      marketCode: 'CG',
      requiredCapability: 'dashboard.market.read',
    }));
  });

  test('révocation de dashboard.market.read retire l’accès CM même si le membership et le marché restent actifs', async () => {
    mockCurrentUser = { id: 'partner-cm-1', role: 'market_operator' };
    mockGlobalAllowed = false;
    // Simule une capability retirée du ceiling actif alors que le membership
    // et l'assignment sur CM existent toujours — distinct d'une absence de
    // membership : preuve que c'est bien la capability, pas le scope marché,
    // qui fait autorité.
    mockResolveAuthorization.mockImplementationOnce(async () => {
      const error = new Error('Capability dashboard.market.read absente du ceiling actif.');
      error.code = 'MARKET_CAPABILITY_REQUIRED';
      error.status = 403;
      throw error;
    });

    const res = await request(makeApp()).get('/api/admin/dashboard/unified/market/CM');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
    expect(mockBuildMarketPilotage).not.toHaveBeenCalled();
  });

  test('market_id en query est refusé avant toute résolution et ne peut jamais autoriser', async () => {
    const res = await request(makeApp())
      .get('/api/admin/dashboard/unified/market/CM?market_id=market-cg-id');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('client_market_id_forbidden');
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockBuildMarketPilotage).not.toHaveBeenCalled();
  });

  test('un marché inconnu ou inactif renvoie 404', async () => {
    const res = await request(makeApp()).get('/api/admin/dashboard/unified/market/ZZ');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('market_not_found');
  });

  test('un admin sans grant market ni global reçoit 403', async () => {
    mockGrantedMarketCodes = new Set();
    mockGlobalAllowed = false;
    const res = await request(makeApp()).get('/api/admin/dashboard/unified/market/CG');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MARKET_MEMBERSHIP_REQUIRED');
    expect(mockBuildMarketPilotage).not.toHaveBeenCalled();
  });

  test('un grant CM autorise l’agrégat CM même sans autorité globale (dashboard.market.read exact)', async () => {
    mockGlobalAllowed = false;
    mockGrantedMarketCodes = new Set(['CM']);
    const res = await request(makeApp())
      .get('/api/admin/dashboard/unified/market/cm?from=2026-08-01&status=confirmed');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('private');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(mockBuildMarketPilotage).toHaveBeenCalledTimes(1);
    expect(mockResolveAuthorization).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      marketCode: 'CM',
      requiredCapability: 'dashboard.market.read',
    }));

    const [filters, market] = mockBuildMarketPilotage.mock.calls[0];
    expect(market.id).toBe('market-cm-id');
    expect(filters).toMatchObject({
      from: '2026-08-01',
      status: 'confirmed',
      market_id: 'market-cm-id',
    });
  });

  test('un grant global explicite autorise le drill d’un marché actif sans grant capability, et court-circuite avant resolveAuthorization', async () => {
    mockGrantedMarketCodes = new Set();
    mockGlobalAllowed = true;
    const res = await request(makeApp()).get('/api/admin/dashboard/unified/market/CG');

    expect(res.status).toBe(200);
    expect(mockBuildMarketPilotage).toHaveBeenCalledTimes(1);
    expect(mockBuildMarketPilotage.mock.calls[0][1].code).toBe('CG');
    expect(mockResolveAuthorization).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/dashboard/reference/resolve', () => {
  test('market_operator résout une référence uniquement dans ses marchés operations.read', async () => {
    mockCurrentUser = { id: 'partner-cm-1', role: 'market_operator' };
    mockGlobalAllowed = false;

    const res = await request(makeApp()).get('/api/admin/dashboard/reference/resolve?reference=KOM-RCV-1');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(mockListAuthorizedMarketsForCapability).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: 'partner-cm-1',
      requiredCapability: 'operations.read',
    }));
    expect(mockResolveReference).toHaveBeenCalledWith('KOM-RCV-1', expect.objectContaining({
      role: 'market_operator',
      global: false,
      authorizedMarketIds: expect.any(Set),
    }));
  });

  test('autorité dashboard globale court-circuite la capability market', async () => {
    mockGlobalAllowed = true;

    const res = await request(makeApp()).get('/api/admin/dashboard/reference/resolve?reference=K-1');

    expect(res.status).toBe(200);
    expect(mockListAuthorizedMarketsForCapability).not.toHaveBeenCalled();
    expect(mockResolveReference).toHaveBeenCalledWith('K-1', expect.objectContaining({
      role: 'admin',
      global: true,
    }));
  });
});

describe('verrou des agrégats globaux montés après le routeur market', () => {
  test('role=admin ne suffit pas : /unified global est 403 sans grant explicite', async () => {
    mockGlobalAllowed = false;
    const res = await request(makeApp()).get('/api/admin/dashboard/unified');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('dashboard_global_access_denied');
  });

  test('le verrou couvre aussi les sous-agrégats globaux', async () => {
    mockGlobalAllowed = false;
    const res = await request(makeApp()).get('/api/admin/dashboard/control-tower');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('dashboard_global_access_denied');
  });

  test('un grant global explicite laisse atteindre le routeur historique', async () => {
    mockGlobalAllowed = true;
    const res = await request(makeApp()).get('/api/admin/dashboard/unified');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: 'global' });
  });
});

describe('D6 capability authority contract', () => {
  test('admin-dashboard-market ne consomme plus require-market-scope et mappe chaque projection à sa capability exacte', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'admin-dashboard-market.js'), 'utf8');
    expect(source).not.toMatch(/require\(['"][^'"]*require-market-scope/);
    expect(source).not.toMatch(/attachAuthorizedMarkets|requireMarketScope|operator_market_scopes/);
    expect(source).toContain("requireDashboardMarketCapability('dashboard.market.read')");
    expect(source).toContain("requireDashboardMarketCapability('operations.read')");
    expect(source).toContain("requireDashboardMarketCapability('finance.read')");
    expect(source).toContain('requireDashboardGlobalAuthority');
  });
});

describe('devise du marché sur les vues de marché', () => {
  test('unified/market/CM : KPI KMF projetés en XAF, source non mutée', async () => {
    const base = mockQuery.getMockImplementation();
    mockQuery.mockImplementation(async (sql, params) => {
      if (String(sql).includes('currency_parities')) {
        return { rows: [{ eur_rate: { KMF: 491.96775, XAF: 655.957 }[params[0]] }] };
      }
      return base(sql, params);
    });
    require('../../utils/currency').invalidateCurrencyParityCache();
    const source = { kpis: [{ key: 'ca', value: 491.96775 * 10, unit: 'KMF', delta: null }] };
    mockBuildMarketPilotage.mockResolvedValue(source);

    const res = await request(makeApp()).get('/api/admin/dashboard/unified/market/CM');
    expect(res.status).toBe(200);
    expect(res.body.kpis[0]).toMatchObject({ unit: 'XAF', base_currency: 'KMF', value: Math.round(10 * 655.957) });
    expect(source.kpis[0].unit).toBe('KMF');
  });
});
