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

const mockWorkspace = {
  PricingWorkspaceError: class PricingWorkspaceError extends Error {},
  buildMarketWorkspace: jest.fn(async () => ({ scope: {}, summary: {}, cost_components: [], capabilities: {} })),
  updateMarketCostComponent: jest.fn(), toggleMarketCostComponent: jest.fn(), resetMarketCostComponent: jest.fn(),
  buildWorkspace: jest.fn(), simulate: jest.fn(), simulateImpact: jest.fn(), flow: jest.fn(), applyPrice: jest.fn(), getStrategy: jest.fn(),
  applyStrategy: jest.fn(), addCompetitor: jest.fn(), deactivateCompetitor: jest.fn(), createCostComponent: jest.fn(),
  updateCostComponent: jest.fn(), toggleCostComponent: jest.fn(),
};
jest.mock('../../services/pricing-workspace', () => mockWorkspace);

jest.mock('../../services/pricing-market-decision-policy', () => ({
  evaluateMarketDecision: jest.fn(async () => ({})),
  isValidCalendarMonth: jest.fn(() => true),
  listMarketDecisionPolicyHistory: jest.fn(async () => []),
  recordMarketDecisionPolicy: jest.fn(async () => ({})),
}));
jest.mock('../../services/pricing-market-corridor', () => ({
  buildMarketCorridor: jest.fn(async () => ({})),
  recordMarketObservation: jest.fn(async () => ({})),
  deactivateMarketObservation: jest.fn(async () => ({})),
}));
jest.mock('../../services/market-commercial-price-service', () => ({
  listMarketPriceDrafts: jest.fn(async () => ({ products: [] })),
  setMarketPriceDraft: jest.fn(async () => ({})),
  resetMarketPriceDraft: jest.fn(async () => ({})),
}));
jest.mock('../../services/market-local-price-activation-service', () => ({
  previewLocalPriceActivation: jest.fn(async () => ({})),
  activateLocalPrice: jest.fn(async () => ({})),
}));

const mockStructure = {
  SCOPE_KINDS: { GROUP: 'GROUP', MARKET_DIRECT: 'MARKET_DIRECT' },
  listStructureCostEvents: jest.fn(async () => []),
  recordStructureCostEvent: jest.fn(async (input) => ({
    id: 'event-1',
    charge_id: input.charge_id,
    scope_kind: input.scope_kind,
    market_id: input.market_id,
    event_kind: input.event_kind,
    amount_kmf: input.amount_kmf,
    recorded_at: '2026-09-09T00:00:00.000Z',
  })),
};
jest.mock('../../services/pricing-period-structure', () => mockStructure);

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-pricing-workspace');
function app() { const a = express(); a.use(express.json()); a.use('/api/admin/workspaces/pricing', router); return a; }

function baseEventBody(overrides = {}) {
  return {
    charge_id: '11111111-1111-1111-1111-111111111111',
    event_kind: 'ACCRUAL',
    economic_from: '2026-09-01T00:00:00.000Z',
    economic_to: '2026-10-01T00:00:00.000Z',
    amount_original: 100000,
    currency: 'KMF',
    fx_rate_to_kmf: 1,
    fx_source: 'native KMF',
    amount_kmf: 100000,
    source_kind: 'INVOICE',
    evidence_ref: 'invoice://railway/2026-09',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'market_operator';
  mockAuthorized = new Set(['market-cm']);
  mockCentralPricing = false;
  mockScopeRole = 'manager';
  db.query.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM charges')) {
      return { rows: [{ id: 'charge-1', family: 'platform', name: 'Railway', is_active: true, recurrence_period: 'monthly' }] };
    }
    return { rows: [{ id: params && params[0] === 'CM' ? 'market-cm' : 'market-cg', code: params && params[0], name: params && params[0], currency: 'XAF' }] };
  });
});

describe('GET /market/:marketCode/charges', () => {
  test('manager du marché lit la liste des charges', async () => {
    const res = await request(app()).get('/api/admin/workspaces/pricing/market/CM/charges');
    expect(res.status).toBe(200);
    expect(res.body.charges).toEqual([
      { id: 'charge-1', family: 'platform', name: 'Railway', is_active: true, recurrence_period: 'monthly' },
    ]);
  });
});

describe('GET/POST /market/:marketCode/structure-events — MARKET_DIRECT', () => {
  test('manager CM lit l’historique scopé à son marché', async () => {
    const res = await request(app()).get('/api/admin/workspaces/pricing/market/CM/structure-events?charge_id=charge-1');
    expect(res.status).toBe(200);
    expect(mockStructure.listStructureCostEvents).toHaveBeenCalledWith({
      chargeId: 'charge-1',
      scopeKind: 'MARKET_DIRECT',
      marketId: 'market-cm',
      limit: undefined,
    });
  });

  test('manager CM enregistre un ajustement — scope_kind et market_id forcés serveur', async () => {
    const res = await request(app())
      .post('/api/admin/workspaces/pricing/market/CM/structure-events')
      .send(baseEventBody());

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(mockStructure.recordStructureCostEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ...baseEventBody(),
        scope_kind: 'MARKET_DIRECT',
        market_id: 'market-cm',
      }),
      'partner-1'
    );
  });

  test('un client qui envoie scope_kind=GROUP dans le corps est ignoré — le serveur force MARKET_DIRECT', async () => {
    await request(app())
      .post('/api/admin/workspaces/pricing/market/CM/structure-events')
      .send(baseEventBody({ scope_kind: 'GROUP' }));

    expect(mockStructure.recordStructureCostEvent).toHaveBeenCalledWith(
      expect.objectContaining({ scope_kind: 'MARKET_DIRECT', market_id: 'market-cm' }),
      'partner-1'
    );
  });

  test('un client qui envoie market_id dans le corps est rejeté par rejectBrowserAuthority', async () => {
    const res = await request(app())
      .post('/api/admin/workspaces/pricing/market/CM/structure-events')
      .send(baseEventBody({ market_id: 'market-cg' }));

    expect(res.status).toBe(400);
    expect(mockStructure.recordStructureCostEvent).not.toHaveBeenCalled();
  });

  test('viewer (non-manager) ne peut pas écrire un ajustement', async () => {
    mockScopeRole = 'viewer';
    const res = await request(app())
      .post('/api/admin/workspaces/pricing/market/CM/structure-events')
      .send(baseEventBody());
    expect(res.status).toBe(403);
    expect(mockStructure.recordStructureCostEvent).not.toHaveBeenCalled();
  });

  test('une erreur de validation métier renvoie 400 avec le message du service', async () => {
    mockStructure.recordStructureCostEvent.mockRejectedValueOnce(new Error('invalid event_kind'));
    const res = await request(app())
      .post('/api/admin/workspaces/pricing/market/CM/structure-events')
      .send(baseEventBody({ event_kind: 'BOGUS' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('structure_event_invalid');
  });

  test('charge introuvable renvoie 404', async () => {
    mockStructure.recordStructureCostEvent.mockRejectedValueOnce(new Error('charge not found'));
    const res = await request(app())
      .post('/api/admin/workspaces/pricing/market/CM/structure-events')
      .send(baseEventBody());
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('structure_event_charge_not_found');
  });
});

describe('GET/POST /structure-events — GROUP (mutualisé, admin only)', () => {
  test('market_operator ne peut pas accéder aux routes GROUP', async () => {
    const res = await request(app()).get('/api/admin/workspaces/pricing/structure-events');
    expect(res.status).toBe(403);
  });

  test('admin avec autorité globale lit l’historique GROUP', async () => {
    mockRole = 'admin';
    mockCentralPricing = true;
    const res = await request(app()).get('/api/admin/workspaces/pricing/structure-events?charge_id=charge-1');
    expect(res.status).toBe(200);
    expect(mockStructure.listStructureCostEvents).toHaveBeenCalledWith({
      chargeId: 'charge-1',
      scopeKind: 'GROUP',
      limit: undefined,
    });
  });

  test('admin enregistre un ajustement mutualisé — market_id toujours null', async () => {
    mockRole = 'admin';
    mockCentralPricing = true;
    const res = await request(app())
      .post('/api/admin/workspaces/pricing/structure-events')
      .send(baseEventBody({ scope_kind: 'GROUP' }));

    expect(res.status).toBe(201);
    expect(mockStructure.recordStructureCostEvent).toHaveBeenCalledWith(
      expect.objectContaining({ scope_kind: 'GROUP', market_id: null }),
      'partner-1'
    );
  });

  test('un admin sans autorité globale pricing ne peut pas écrire GROUP', async () => {
    mockRole = 'admin';
    mockCentralPricing = false;
    const res = await request(app())
      .post('/api/admin/workspaces/pricing/structure-events')
      .send(baseEventBody({ scope_kind: 'GROUP' }));
    expect(res.status).toBe(403);
    expect(mockStructure.recordStructureCostEvent).not.toHaveBeenCalled();
  });
});
