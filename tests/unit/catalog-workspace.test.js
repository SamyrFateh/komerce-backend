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

const mockUpsertOverrides = jest.fn();
jest.mock('../../services/catalog-overrides', () => ({
  upsertOverrides: (...args) => mockUpsertOverrides(...args),
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

const mockListCommercialAssortment = jest.fn();
jest.mock('../../services/catalog-commercial-assortment', () => ({
  listCommercialAssortment: (...args) => mockListCommercialAssortment(...args),
}));

const workspace = require('../../services/catalog-workspace');

beforeEach(() => {
  jest.clearAllMocks();
  mockGetRuleNumber.mockResolvedValue(120);
  mockUpsertOverrides.mockResolvedValue({
    overridden: ['name', 'description'],
    product: {
      product_ref: 'KPR-CJ',
      name: 'Robe plissée à bretelles',
      description: 'Robe plissée à bretelles pour femme.',
      name_source: 'Lily Pleated Suspender Dress',
      description_source: 'Supplier description',
      source_locale: 'en',
      content_source: 'manual',
      needs_review: false,
    },
  });
  mockListCategories.mockResolvedValue([{ key: 'Maison', label: 'Maison', is_active: true, subcategories: [] }]);
  mockListCommercialAssortment.mockResolvedValue([{
    product_ref: 'KPR-000001',
    name: 'Produit',
    category: 'Maison',
    price_kmf: 5000,
    stock: 3,
    is_active: true,
    is_available: true,
    source_lots: ['KIR-000004'],
    approved_markets: ['KM'],
  }]);
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
        source_locale: 'en',
        name_source: 'Supplier raw title',
        description_source: 'Supplier raw description',
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

test('projection Catalogue conserve un prix absent à null', () => {
  expect(workspace._test.publicProduct({
    product_ref: 'KPR-NULL',
    name: 'Sans prix',
    category: 'Maison',
    price_kmf: null,
    stock: 1,
  }).price_kmf).toBeNull();
});

test('projection Catalogue ne sort que les identités métier et expose le cap de curation', async () => {
  const payload = await workspace.buildWorkspace({});
  expect(payload.scope).toEqual({ mode: 'global_commercial_catalog', label: 'Catalogue global commercial' });
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
  expect(payload.summary).toEqual(expect.objectContaining({
    commercial_approved: 1,
    commercial_closed_lots: 1,
    commercial_markets: 1,
  }));
  expect(payload.products[0]).toEqual(expect.objectContaining({
    source_lots: ['KIR-000004'],
    approved_markets: ['KM'],
  }));
  expect(mockListCommercialAssortment).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
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

test('file de curation expose la vérité source pour comparaison avant/après', async () => {
  mockQuery.mockImplementation(async sql => {
    if (String(sql).includes("FROM products p") && String(sql).includes("lifecycle_status = 'candidate'")) {
      return { rows: [{
        product_ref: 'KPR-COMPARE',
        name: 'Titre français',
        description: 'Description française',
        name_source: 'Supplier title',
        description_source: 'Supplier description',
        category: 'vetements',
        content_source: 'ai_enriched',
        source_locale: 'en',
        needs_review: true,
      }] };
    }
    return { rows: [] };
  });

  const rows = await workspace._test.queryApprovalQueue({ limit: 10, offset: 0 });

  expect(rows[0]).toMatchObject({
    product_ref: 'KPR-COMPARE',
    name_source: 'Supplier title',
    description_source: 'Supplier description',
  });
});

test('préparation FR résout product_ref puis applique des overrides manuels sans API IA', async () => {
  mockQuery.mockImplementation(async sql => {
    if (String(sql).includes('WHERE product_ref = $1')) {
      return { rows: [{ id: 'candidate-internal-id', product_ref: 'KPR-CJ', lifecycle_status: 'candidate', is_active: false }] };
    }
    return { rows: [] };
  });

  const result = await workspace.prepareCandidateFrench(
    'KPR-CJ',
    {
      name: 'Robe plissée à bretelles',
      description: 'Robe plissée à bretelles pour femme.',
    },
    { id: 'central-admin' }
  );

  expect(mockUpsertOverrides).toHaveBeenCalledWith(
    expect.anything(),
    'candidate-internal-id',
    {
      name: 'Robe plissée à bretelles',
      description: 'Robe plissée à bretelles pour femme.',
    },
    expect.objectContaining({
      reason: expect.stringContaining('zéro API IA payante'),
      setBy: 'central-admin',
    })
  );
  expect(result).toMatchObject({
    product_ref: 'KPR-CJ',
    status: 'manual_ready',
    content_source: 'manual',
    needs_review: false,
    api_calls: 0,
    paid_ai_dependency: false,
    before: { name: 'Lily Pleated Suspender Dress' },
    after: { name: 'Robe plissée à bretelles' },
  });
  expect(JSON.stringify(result)).not.toContain('candidate-internal-id');
});

test('préparation FR refuse un payload vide au lieu d’appeler une API payante', async () => {
  mockQuery.mockImplementation(async sql => {
    if (String(sql).includes('WHERE product_ref = $1')) {
      return { rows: [{ id: 'candidate-internal-id', product_ref: 'KPR-CJ', lifecycle_status: 'candidate', is_active: false }] };
    }
    return { rows: [] };
  });

  await expect(workspace.prepareCandidateFrench('KPR-CJ', {}, { id: 'central-admin' }))
    .rejects.toMatchObject({ code: 'catalog_fr_manual_fields_required', status: 422 });
  expect(mockUpsertOverrides).not.toHaveBeenCalled();
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
    String(sql).includes("p.lifecycle_status = 'candidate'") && String(sql).includes('OFFSET $2')
  );
  expect(approvalCall[1]).toEqual([75, 150]);
});


test('product_ref deep-link remonte le produit suivi dans la première page de curation', async () => {
  await workspace.buildWorkspace({
    approval_limit: '50',
    approval_offset: '0',
    product_ref: 'KPR-131959',
  });
  const approvalCall = mockQuery.mock.calls.find(([sql]) =>
    String(sql).includes('LEFT JOIN LATERAL') &&
    String(sql).includes('CASE WHEN p.product_ref = $1 THEN 0 ELSE 1 END ASC')
  );
  expect(approvalCall).toBeTruthy();
  expect(String(approvalCall[0])).toContain('LIMIT $2 OFFSET $3');
  expect(approvalCall[1]).toEqual(['KPR-131959', 50, 0]);
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
