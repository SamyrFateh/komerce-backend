'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockSourcingAllowed = true;

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'central-sourcing', role: 'admin', full_name: 'Central Sourcing' };
    next();
  },
  requireRole: roles => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ code: 'role_forbidden' });
    next();
  },
}));

jest.mock('../../middleware/require-sourcing-global-authority', () => ({
  requireSourcingGlobalAuthority: (req, res, next) => {
    if (!mockSourcingAllowed) return res.status(403).json({ code: 'sourcing_global_access_denied' });
    req.sourcingGlobalAuthority = true;
    next();
  },
}));

const mockCalls = {
  buildWorkspace: jest.fn(),
  buildHealthDashboard: jest.fn(),
  importCatalog: jest.fn(),
  updatePortfolioProduct: jest.fn(),
  updateCandidate: jest.fn(),
  scanCandidate: jest.fn(),
  watchlistCandidate: jest.fn(),
  rejectCandidate: jest.fn(),
  promoteCandidate: jest.fn(),
  setSourceAutopilot: jest.fn(),
  createSupplier: jest.fn(),
  updateSupplier: jest.fn(),
  setSupplierActive: jest.fn(),
  recordUnitStockChange: jest.fn(),
};

jest.mock('../../services/sourcing-workspace', () => ({
  SourcingWorkspaceError: class SourcingWorkspaceError extends Error {},
  buildWorkspace: (...args) => mockCalls.buildWorkspace(...args),
  importCatalog: (...args) => mockCalls.importCatalog(...args),
  updatePortfolioProduct: (...args) => mockCalls.updatePortfolioProduct(...args),
  updateCandidate: (...args) => mockCalls.updateCandidate(...args),
  scanCandidate: (...args) => mockCalls.scanCandidate(...args),
  watchlistCandidate: (...args) => mockCalls.watchlistCandidate(...args),
  rejectCandidate: (...args) => mockCalls.rejectCandidate(...args),
  promoteCandidate: (...args) => mockCalls.promoteCandidate(...args),
  setSourceAutopilot: (...args) => mockCalls.setSourceAutopilot(...args),
  createSupplier: (...args) => mockCalls.createSupplier(...args),
  updateSupplier: (...args) => mockCalls.updateSupplier(...args),
  setSupplierActive: (...args) => mockCalls.setSupplierActive(...args),
}));

jest.mock('../../services/sourcing-catalog-change-observation', () => ({
  recordUnitStockChange: (...args) => mockCalls.recordUnitStockChange(...args),
}));

jest.mock('../../services/sourcing-integrity-service', () => ({
  buildHealthDashboard: (...args) => mockCalls.buildHealthDashboard(...args),
}));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-sourcing-workspace');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/admin/workspaces/sourcing', router);
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSourcingAllowed = true;
  mockCalls.buildWorkspace.mockResolvedValue({ scope: { mode: 'global_sourcing' }, summary: {}, portfolio: {}, imports: [], candidates: [], suppliers: [], sources: [] });
  mockCalls.buildHealthDashboard.mockResolvedValue({
    schema_version: 'sourcing-health-dashboard-v1',
    scope: { mode: 'global_sourcing' },
    state: { global: 'HEALTHY', integrity: 'HEALTHY', performance: 'HEALTHY', blockers: 0, attention: 0 },
  });
  mockCalls.updatePortfolioProduct.mockResolvedValue({ product_ref: 'KPR-000001' });
  mockCalls.scanCandidate.mockResolvedValue({ candidate_ref: 'KSC-000001', state: 'scanned' });
  mockCalls.promoteCandidate.mockResolvedValue({ candidate_ref: 'KSC-000001', product_ref: 'KPR-000002' });
  mockCalls.setSourceAutopilot.mockResolvedValue({ source_ref: 'api:cj', autopilot_enabled: true });
  mockCalls.createSupplier.mockResolvedValue({ partner_ref: 'KPT-000001', name: 'Supplier' });
  mockCalls.recordUnitStockChange.mockResolvedValue({ status: 'recorded', capture_id: 'capture-1', observations: 1, application_status: 'NOT_EVALUATED' });
});

test('grant sourcing ouvre une projection globale incluant la santé canonique', async () => {
  const res = await request(app()).get('/api/admin/workspaces/sourcing');
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toContain('no-store');
  expect(mockCalls.buildWorkspace).toHaveBeenCalledTimes(1);
  expect(mockCalls.buildHealthDashboard).toHaveBeenCalledTimes(1);
  expect(res.body.health).toMatchObject({ schema_version: 'sourcing-health-dashboard-v1', state: { global: 'HEALTHY' } });
});

test('role admin seul ne suffit jamais sans grant sourcing', async () => {
  mockSourcingAllowed = false;
  const res = await request(app()).get('/api/admin/workspaces/sourcing');
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('sourcing_global_access_denied');
  expect(mockCalls.buildWorkspace).not.toHaveBeenCalled();
  expect(mockCalls.buildHealthDashboard).not.toHaveBeenCalled();
});

test.each([
  ['/api/admin/workspaces/sourcing?market_id=cm', 'get', null, 'sourcing_market_dimension_forbidden'],
  ['/api/admin/workspaces/sourcing/imports', 'post', { marketCode: 'CM' }, 'sourcing_market_dimension_forbidden'],
  ['/api/admin/workspaces/sourcing/imports', 'post', { import_id: 'internal' }, 'sourcing_internal_id_forbidden'],
])('refuse les dimensions d’autorité navigateur', async (url, method, body, code) => {
  const call = request(app())[method](url);
  const res = body ? await call.send(body) : await call;
  expect(res.status).toBe(400);
  expect(res.body.code).toBe(code);
});

test('mutation produit délègue product_ref et acteur authentifié', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/sourcing/products/KPR-000001/update')
    .send({ sourcing_rail: 'A' });
  expect(res.status).toBe(200);
  expect(mockCalls.updatePortfolioProduct).toHaveBeenCalledWith(
    'KPR-000001',
    { sourcing_rail: 'A' },
    expect.objectContaining({ id: 'central-sourcing', role: 'admin' })
  );
});

test('mutation candidat délègue candidate_ref et jamais UUID', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/sourcing/candidates/KSC-000001/scan')
    .send({});
  expect(res.status).toBe(200);
  expect(mockCalls.scanCandidate).toHaveBeenCalledWith('KSC-000001', expect.objectContaining({ id: 'central-sourcing' }));
});

test.each([
  ['activate', true],
  ['deactivate', false],
])('interrupteur source %s délègue uniquement la référence métier', async (action, enabled) => {
  mockCalls.setSourceAutopilot.mockResolvedValueOnce({ source_ref: 'api:cj', autopilot_enabled: enabled });
  const res = await request(app())
    .post(`/api/admin/workspaces/sourcing/sources/api%3Acj/${action}`)
    .send({});
  expect(res.status).toBe(200);
  expect(mockCalls.setSourceAutopilot).toHaveBeenCalledWith('api:cj', enabled);
  expect(res.body.action).toBe(`${action === 'activate' ? 'activate' : 'deactivate'}_source_autopilot`);
});

test('création fournisseur reste dans la frontière sourcing', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/sourcing/suppliers')
    .send({ name: 'Supplier', partner_type: 'sourcing' });
  expect(res.status).toBe(201);
  expect(mockCalls.createSupplier).toHaveBeenCalledWith({ name: 'Supplier', partner_type: 'sourcing' });
});


describe('first Catalog Change Intake observation seam — global Sourcing guard', () => {
  const endpoint = '/api/admin/workspaces/sourcing/sources/api%3Acj/catalog-changes/observe';
  const body = {
    source: { provider: 'cj', account_scope: 'default', source_ref: 'external-product-1' },
    method: 'PULL_EXACT', event_id: 'event-1', observed_at: '2026-09-23T20:00:00Z',
    subject: { product_ref: 'product-1', unit_ref: 'unit-1' },
    facts: { stock_available: { status: 'OBSERVED', value: 0 } },
  };

  test('authorized operator records observation without publishing or applying product updates', async () => {
    const res = await request(app()).post(endpoint).send(body);
    expect(res.status).toBe(201);
    expect(res.body.action).toBe('observe_unit_stock_change');
    expect(res.body.result).toMatchObject({ status: 'recorded', application_status: 'NOT_EVALUATED' });
    expect(mockCalls.recordUnitStockChange).toHaveBeenCalledWith({
      sourceRef: 'api:cj', envelope: body,
    });
    expect(mockCalls.updatePortfolioProduct).not.toHaveBeenCalled();
    expect(mockCalls.promoteCandidate).not.toHaveBeenCalled();
    expect(res.headers['cache-control']).toContain('no-store');
  });

  test('global sourcing grant is required before any stock observation is recorded', async () => {
    mockSourcingAllowed = false;
    const res = await request(app()).post(endpoint).send(body);
    expect(res.status).toBe(403);
    expect(mockCalls.recordUnitStockChange).not.toHaveBeenCalled();
  });

  test('backend source error is fail-closed and does not produce a successful observation', async () => {
    mockCalls.recordUnitStockChange.mockRejectedValue(
      Object.assign(new Error('Source non enregistrée'), {
        status: 409, code: 'catalog_change_source_unavailable',
      })
    );
    const res = await request(app()).post(endpoint).send(body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('catalog_change_source_unavailable');
  });

  test('an exact retry returns 200 with the original capture reference', async () => {
    mockCalls.recordUnitStockChange.mockResolvedValue({
      status: 'already_recorded', capture_id: 'capture-1',
      observations: 1, application_status: 'NOT_EVALUATED',
    });
    const res = await request(app()).post(endpoint).send(body);
    expect(res.status).toBe(200);
    expect(res.body.result.capture_id).toBe('capture-1');
  });
});
