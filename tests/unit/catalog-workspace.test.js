'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockGetRuleNumber = jest.fn();
jest.mock('../../utils/rules', () => ({
  getRuleNumber: (...args) => mockGetRuleNumber(...args),
}));

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
  mockGetRuleNumber.mockResolvedValue(120);
  mockListCategories.mockResolvedValue([{ key: 'Maison', label: 'Maison', is_active: true, subcategories: [] }]);
  mockQuery.mockImplementation(async sql => {
    const text = String(sql);
    if (text.includes('COUNT(*)::int AS total_products')) {
      return { rows: [{ total_products: 2, active_products: 1, inactive_products: 1, approval_pending: 1, needs_review: 1 }] };
    }
    if (text.includes('FROM products p') && text.includes('ORDER BY p.updated_at')) {
      return { rows: [{ product_ref: 'KPR-000001', name: 'Produit', category: 'Maison', price_kmf: '5000', stock: 3, is_active: true, is_available: true }] };
    }
    if (text.includes('GROUP BY 1') && text.includes('sourcing_decision')) {
      return { rows: [
        { sourcing_decision: 'TEST', count: 1 },
        { sourcing_decision: 'SOMETHING_NEW', count: 2 },
      ] };
    }
    if (text.includes("p.lifecycle_status = 'candidate'") && text.includes('LEFT JOIN LATERAL')) {
      return { rows: [{
        product_ref: 'KPR-000002',
        name: 'Candidat',
        category: 'Maison',
        price_kmf: '4000',
        stock: 2,
        content_source: 'ai_enriched',
        needs_review: true,
        enrichment_confidence: '0.6',
        supplier_name: 'CJdropshipping',
        supplier_product_id: 'CJ-2',
        supplier_stock: 12,
        sourcing_confidence: 'high',
        sourcing_decision: 'TEST',
        sourcing_reason: 'Référence économique contributive à tester.',
        economic_health_status: 'healthy',
        economic_test_margin_pct: '31.5',
      }] };
    }
    if (text.includes('WHERE product_ref = $1')) {
      return { rows: [{ id: 'internal-uuid-product', product_ref: 'KPR-000001', lifecycle_status: 'active', is_active: true }] };
    }
    return { rows: [] };
  });
});

test('projection Catalogue ne sort que les identités métier et expose le cap de curation', async () => {
  const payload = await workspace.buildWorkspace({});
  expect(payload.scope).toEqual({ mode: 'global_catalog', label: 'Catalogue commun Komerce' });
  expect(payload.products[0].product_ref).toBe('KPR-000001');
  expect(payload.approval[0].product_ref).toBe('KPR-000002');
  expect(payload.approval[0]).toEqual(expect.objectContaining({
    sourcing_decision: 'TEST',
    sourcing_confidence: 'high',
    supplier_name: 'CJdropshipping',
    supplier_stock: 12,
    economic_health_status: 'healthy',
    economic_test_margin_pct: 31.5,
  }));
  expect(payload.approval_breakdown).toEqual({
    PRIORITY: 0,
    TEST: 1,
    WATCH: 0,
    AVOID: 0,
    LOSS: 0,
    UNKNOWN: 2,
  });
  expect(payload.approval_strategy).toEqual(expect.objectContaining({
    authority: 'human_approval',
    value_density_used: false,
  }));
  expect(JSON.stringify(payload)).not.toContain('internal-uuid');
  expect(payload.summary.categories).toBe(1);
  expect(mockGetRuleNumber).toHaveBeenCalledWith('CATALOG_CAP_MVP', 120);
  expect(payload.approval_page).toEqual({
    total: 1,
    limit: 50,
    offset: 0,
    has_previous: false,
    has_next: false,
  });
  expect(payload.curation).toEqual({
    catalog_cap_mvp: 120,
    published_products: 1,
    remaining_slots: 119,
    fill_pct: 1,
    at_cap: false,
    first_publication_authority: 'human_approval',
    catalog_scope: 'global',
  });
});

test('état de curation borne le remplissage à 100 % quand le cap est atteint', () => {
  expect(workspace._test.buildCurationState({ active_products: 125 }, 120)).toEqual({
    catalog_cap_mvp: 120,
    published_products: 125,
    remaining_slots: 0,
    fill_pct: 100,
    at_cap: true,
    first_publication_authority: 'human_approval',
    catalog_scope: 'global',
  });
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

test('file de curation accepte offset/limit bornés pour parcourir un gros vivier', async () => {
  const payload = await workspace.buildWorkspace({ approval_limit: '75', approval_offset: '150' });
  expect(payload.approval_page).toEqual({
    total: 1,
    limit: 75,
    offset: 150,
    has_previous: true,
    has_next: false,
  });
  const approvalCall = mockQuery.mock.calls.find(([sql]) =>
    String(sql).includes("WHERE lifecycle_status = 'candidate'") && String(sql).includes('OFFSET $2')
  );
  expect(approvalCall[1]).toEqual([75, 150]);
});


test('ordre de curation privilégie le signal sourcing sans densité de valeur', async () => {
  await workspace.buildWorkspace({ approval_limit: '50', approval_offset: '0' });
  const approvalCall = mockQuery.mock.calls.find(([sql]) =>
    String(sql).includes('LEFT JOIN LATERAL') &&
    String(sql).includes("WHEN 'PRIORITY' THEN 0") &&
    String(sql).includes("WHEN 'TEST' THEN 1")
  );
  expect(approvalCall).toBeTruthy();
  expect(String(approvalCall[0])).not.toContain('margin_kmf_per_dm3');
  expect(String(approvalCall[0])).toContain("candidate.state = 'imported_to_catalog'");
  expect(approvalCall[1]).toEqual([50, 0]);
});
