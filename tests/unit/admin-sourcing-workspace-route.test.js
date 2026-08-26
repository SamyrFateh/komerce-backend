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
  importCatalog: jest.fn(),
  updatePortfolioProduct: jest.fn(),
  updateCandidate: jest.fn(),
  scanCandidate: jest.fn(),
  watchlistCandidate: jest.fn(),
  rejectCandidate: jest.fn(),
  promoteCandidate: jest.fn(),
  createSupplier: jest.fn(),
  updateSupplier: jest.fn(),
  setSupplierActive: jest.fn(),
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
  createSupplier: (...args) => mockCalls.createSupplier(...args),
  updateSupplier: (...args) => mockCalls.updateSupplier(...args),
  setSupplierActive: (...args) => mockCalls.setSupplierActive(...args),
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
  mockCalls.buildWorkspace.mockResolvedValue({ scope: { mode: 'global_sourcing' }, summary: {}, portfolio: {}, imports: [], candidates: [], suppliers: [] });
  mockCalls.updatePortfolioProduct.mockResolvedValue({ product_ref: 'KPR-000001' });
  mockCalls.scanCandidate.mockResolvedValue({ candidate_ref: 'KSC-000001', state: 'scanned' });
  mockCalls.promoteCandidate.mockResolvedValue({ candidate_ref: 'KSC-000001', product_ref: 'KPR-000002' });
  mockCalls.createSupplier.mockResolvedValue({ partner_ref: 'KPT-000001', name: 'Supplier' });
});

test('grant sourcing ouvre la projection globale sans marché', async () => {
  const res = await request(app()).get('/api/admin/workspaces/sourcing');
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toContain('no-store');
  expect(mockCalls.buildWorkspace).toHaveBeenCalledTimes(1);
});

test('role admin seul ne suffit jamais sans grant sourcing', async () => {
  mockSourcingAllowed = false;
  const res = await request(app()).get('/api/admin/workspaces/sourcing');
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('sourcing_global_access_denied');
  expect(mockCalls.buildWorkspace).not.toHaveBeenCalled();
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

test('création fournisseur reste dans la frontière sourcing', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/sourcing/suppliers')
    .send({ name: 'Supplier', partner_type: 'sourcing' });
  expect(res.status).toBe(201);
  expect(mockCalls.createSupplier).toHaveBeenCalledWith({ name: 'Supplier', partner_type: 'sourcing' });
});
