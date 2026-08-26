'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockCatalogAllowed = true;

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'admin-central', role: 'admin', full_name: 'Central Admin' };
    next();
  },
  requireRole: roles => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ code: 'role_forbidden' });
    next();
  },
}));

jest.mock('../../middleware/require-catalog-global-authority', () => ({
  requireCatalogGlobalAuthority: (req, res, next) => {
    if (!mockCatalogAllowed) return res.status(403).json({ code: 'catalog_global_access_denied' });
    req.catalogGlobalAuthority = true;
    next();
  },
}));

const mockBuildWorkspace = jest.fn();
const mockCreateProduct = jest.fn();
const mockUpdateProduct = jest.fn();
const mockDeactivateProduct = jest.fn();
const mockApproveCandidate = jest.fn();
const mockRejectCandidate = jest.fn();
const mockOverrideCandidate = jest.fn();
const mockCreateCategory = jest.fn();
const mockUpdateCategory = jest.fn();
const mockDeactivateCategory = jest.fn();
const mockCreateSubcategory = jest.fn();
const mockUpdateSubcategory = jest.fn();
const mockDeactivateSubcategory = jest.fn();

jest.mock('../../services/catalog-workspace', () => {
  class CatalogWorkspaceError extends Error {}
  return {
    CatalogWorkspaceError,
    buildWorkspace: (...args) => mockBuildWorkspace(...args),
    createProduct: (...args) => mockCreateProduct(...args),
    updateProduct: (...args) => mockUpdateProduct(...args),
    deactivateProduct: (...args) => mockDeactivateProduct(...args),
    approveCandidate: (...args) => mockApproveCandidate(...args),
    rejectCandidate: (...args) => mockRejectCandidate(...args),
    overrideCandidate: (...args) => mockOverrideCandidate(...args),
    createCategory: (...args) => mockCreateCategory(...args),
    updateCategory: (...args) => mockUpdateCategory(...args),
    deactivateCategory: (...args) => mockDeactivateCategory(...args),
    createSubcategory: (...args) => mockCreateSubcategory(...args),
    updateSubcategory: (...args) => mockUpdateSubcategory(...args),
    deactivateSubcategory: (...args) => mockDeactivateSubcategory(...args),
  };
});

jest.mock('../../services/boutique-taxonomy-admin', () => ({
  TaxonomyAdminError: class TaxonomyAdminError extends Error {},
}));

jest.mock('../../utils/logger', () => ({ child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }) }));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-catalog-workspace');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/admin/workspaces/catalog', router);
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCatalogAllowed = true;
  mockBuildWorkspace.mockResolvedValue({ scope: { mode: 'global_catalog' }, summary: {}, categories: [], products: [], approval: [] });
  mockCreateProduct.mockResolvedValue({ product_ref: 'KPR-000001', name: 'Produit' });
  mockUpdateProduct.mockResolvedValue({ product_ref: 'KPR-000001', price_kmf: 5000 });
  mockDeactivateProduct.mockResolvedValue({ product_ref: 'KPR-000001', deactivated: true });
  mockApproveCandidate.mockResolvedValue({ product_ref: 'KPR-000001', is_active: true });
  mockRejectCandidate.mockResolvedValue({ product_ref: 'KPR-000001', rejected: true });
  mockOverrideCandidate.mockResolvedValue({ product_ref: 'KPR-000001', overridden: ['name'] });
});

test('admin central avec grant ouvre le Workspace global sans marché', async () => {
  const res = await request(app()).get('/api/admin/workspaces/catalog');
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toContain('no-store');
  expect(mockBuildWorkspace).toHaveBeenCalledWith(expect.objectContaining({}));
});

test('role admin seul ne suffit pas sans grant catalogue', async () => {
  mockCatalogAllowed = false;
  const res = await request(app()).get('/api/admin/workspaces/catalog');
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('catalog_global_access_denied');
  expect(mockBuildWorkspace).not.toHaveBeenCalled();
});

test.each([
  ['/api/admin/workspaces/catalog?market_id=market-cm', 'get'],
  ['/api/admin/workspaces/catalog/products', 'post'],
])('aucune dimension marché client ne peut entrer dans le catalogue global', async (url, method) => {
  const call = request(app())[method](url);
  const res = method === 'post' ? await call.send({ marketId: 'market-cm', name: 'X' }) : await call;
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('catalog_market_dimension_forbidden');
});

test('mutation produit utilise product_ref métier et acteur authentifié', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/catalog/products/KPR-000001/update')
    .send({ price_kmf: 5000 });
  expect(res.status).toBe(200);
  expect(mockUpdateProduct).toHaveBeenCalledWith(
    'KPR-000001',
    { price_kmf: 5000 },
    expect.objectContaining({ id: 'admin-central', role: 'admin' })
  );
});

test('validation humaine utilise product_ref, jamais UUID navigateur', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/catalog/approval/KPR-000001/approve')
    .send({});
  expect(res.status).toBe(200);
  expect(mockApproveCandidate).toHaveBeenCalledWith('KPR-000001', expect.objectContaining({ id: 'admin-central' }));
});
