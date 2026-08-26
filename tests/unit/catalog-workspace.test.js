'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockCreateProduct = jest.fn();
const mockUpdateProduct = jest.fn();
const mockDeleteProduct = jest.fn();
jest.mock('../../services/product-admin-service', () => ({
  createProduct: (...args) => mockCreateProduct(...args),
  updateProduct: (...args) => mockUpdateProduct(...args),
  deleteProduct: (...args) => mockDeleteProduct(...args),
}));

const mockApprove = jest.fn();
const mockReject = jest.fn();
const mockOverride = jest.fn();
jest.mock('../../services/catalog-approval', () => ({
  approveProduct: (...args) => mockApprove(...args),
  rejectProduct: (...args) => mockReject(...args),
  overrideAndApprove: (...args) => mockOverride(...args),
}));

const mockListCategories = jest.fn();
const mockCreateCategory = jest.fn();
jest.mock('../../services/boutique-taxonomy-admin', () => ({
  listCategories: (...args) => mockListCategories(...args),
  createCategory: (...args) => mockCreateCategory(...args),
  updateCategory: jest.fn(),
  deactivateCategory: jest.fn(),
  createSubcategory: jest.fn(),
  updateSubcategory: jest.fn(),
  deactivateSubcategory: jest.fn(),
}));

const workspace = require('../../services/catalog-workspace');

beforeEach(() => {
  jest.clearAllMocks();
  mockListCategories.mockResolvedValue([{ key: 'Maison', label: 'Maison', is_active: true, subcategories: [] }]);
  mockQuery.mockImplementation(async sql => {
    const text = String(sql);
    if (text.includes('COUNT(*)::int AS total_products')) {
      return { rows: [{ total_products: 2, active_products: 1, inactive_products: 1, approval_pending: 1, needs_review: 1 }] };
    }
    if (text.includes('FROM products p') && text.includes('ORDER BY p.updated_at')) {
      return { rows: [{ product_ref: 'KPR-000001', name: 'Produit', category: 'Maison', price_kmf: '5000', stock: 3, is_active: true, is_available: true }] };
    }
    if (text.includes("WHERE lifecycle_status = 'candidate'") && text.includes('content_source')) {
      return { rows: [{ product_ref: 'KPR-000002', name: 'Candidat', category: 'Maison', price_kmf: '4000', stock: 2, content_source: 'ai_enriched', needs_review: true, enrichment_confidence: '0.6' }] };
    }
    if (text.includes('WHERE product_ref = $1')) {
      return { rows: [{ id: 'internal-uuid-product', product_ref: 'KPR-000001', lifecycle_status: 'active', is_active: true }] };
    }
    return { rows: [] };
  });
});

test('projection Catalogue ne sort que les identités métier', async () => {
  const payload = await workspace.buildWorkspace({});
  expect(payload.scope).toEqual({ mode: 'global_catalog', label: 'Catalogue commun Komerce' });
  expect(payload.products[0].product_ref).toBe('KPR-000001');
  expect(payload.approval[0].product_ref).toBe('KPR-000002');
  expect(JSON.stringify(payload)).not.toContain('internal-uuid');
  expect(payload.summary.categories).toBe(1);
});

test('update résout product_ref côté serveur puis délègue product-admin-service', async () => {
  mockUpdateProduct.mockResolvedValue({
    status: 200,
    body: { product_ref: 'KPR-000001', name: 'Produit', category: 'Maison', price_kmf: 6000, is_active: true, is_available: true },
  });
  const actor = { id: 'central-admin', role: 'admin' };
  const result = await workspace.updateProduct('KPR-000001', { price_kmf: 6000, product_ref: 'EVIL' }, actor);
  expect(mockUpdateProduct).toHaveBeenCalledWith(
    expect.anything(),
    'internal-uuid-product',
    { price_kmf: 6000 },
    actor
  );
  expect(result.product_ref).toBe('KPR-000001');
});

test('taxonomie Canonical délègue au service partagé', async () => {
  mockCreateCategory.mockResolvedValue({ key: 'Tech', label: 'Tech' });
  await workspace.createCategory({ key: 'Tech', label: 'Tech' });
  expect(mockCreateCategory).toHaveBeenCalledWith({ key: 'Tech', label: 'Tech' });
});

test('approval résout la référence avant délégation au moteur de validation', async () => {
  mockQuery.mockImplementation(async sql => {
    if (String(sql).includes('WHERE product_ref = $1')) {
      return { rows: [{ id: 'candidate-internal-id', product_ref: 'KPR-000002', lifecycle_status: 'candidate', is_active: false }] };
    }
    return { rows: [] };
  });
  mockApprove.mockResolvedValue({
    status: 200,
    body: { product_ref: 'KPR-000002', name: 'Candidat', category: 'Maison', price_kmf: 4000, is_active: true, is_available: true },
  });
  await workspace.approveCandidate('KPR-000002', { id: 'central-admin' });
  expect(mockApprove).toHaveBeenCalledWith(expect.anything(), 'candidate-internal-id', { id: 'central-admin' });
});
