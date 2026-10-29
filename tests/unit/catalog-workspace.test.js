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

const mockListRegistry = jest.fn();
jest.mock('../../services/catalog-registry', () => ({
  listRegistry: (...args) => mockListRegistry(...args),
}));
const mockAssignBoutiqueTaxonomy = jest.fn();
jest.mock('../../services/catalog-product-mutation-service', () => ({
  assignBoutiqueTaxonomy: (...args) => mockAssignBoutiqueTaxonomy(...args),
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
  mockListRegistry.mockResolvedValue({
    products: [{
      product_ref: 'KPR-000001', name: 'Produit', supplier_name: 'CJdropshipping',
      work_status: 'approval_pending', issues: ['approval_pending'],
      lifecycle_status: 'candidate',
    }],
    page: { total: 2, limit: 50, offset: 0, has_previous: false, has_next: false },
  });
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
        cost_kmf: '2500',
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
  expect(payload.scope).toEqual({ mode: 'global_catalog_registry', label: 'Catalogue global Komerce' });
  expect(payload.products[0].product_ref).toBe('KPR-000001');
  expect(payload.approval[0].product_ref).toBe('KPR-000002');
  expect(payload.approval[0]).toEqual(expect.objectContaining({
    sourcing_decision: 'TEST',
    sourcing_confidence: 'high',
    supplier_name: 'CJdropshipping',
    cost_kmf: 2500,
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
    supplier_name: 'CJdropshipping',
    issues: ['approval_pending'],
  }));
  expect(payload.commercial_products[0]).toEqual(expect.objectContaining({
    source_lots: ['KIR-000004'], approved_markets: ['KM'],
  }));
  expect(payload.registry_page.total).toBe(2);
  expect(payload.summary.registry_total).toBe(2);
  expect(mockListCommercialAssortment).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
  expect(mockListRegistry).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 0 }));
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

test('le filtre métier est transmis à la projection canonique sans changer la liste commerciale', async () => {
  await workspace.buildWorkspace({ supplier: 'CJdropshipping', category: 'mode',
    subcategory: 'enfant', status: 'taxonomy_to_confirm', catalog_offset: '50' });
  expect(mockListRegistry).toHaveBeenCalledWith(expect.objectContaining({
    supplier: 'CJdropshipping', category: 'mode', subcategory: 'enfant',
    status: 'taxonomy_to_confirm', offset: '50',
  }));
  expect(mockListCommercialAssortment).toHaveBeenCalledWith({ limit: 200 });
});

test('classer un produit remis délègue au moteur canonique sans activer la vente', async () => {
  mockQuery.mockImplementation(async sql => {
    if (String(sql).includes('WHERE product_ref = $1')) {
      return { rows: [{ id: 'prod-1', product_ref: 'KPR-000001' }] };
    }
    if (String(sql).includes("FROM sourcing_candidates WHERE product_id=$1")) {
      return { rows: [{ '?column?': 1 }] };
    }
    return { rows: [] };
  });
  mockAssignBoutiqueTaxonomy.mockResolvedValue({
    product_ref: 'KPR-000001', boutique_category_key: 'mode',
    boutique_subcategory_key: 'enfant',
  });
  const result = await workspace.classifyProduct('KPR-000001',
    { category: 'mode', subcategory: 'enfant' });
  expect(mockAssignBoutiqueTaxonomy).toHaveBeenCalledWith(expect.anything(),
    'prod-1', 'mode', 'enfant');
  expect(result).toMatchObject({ approved: false, market_exposure_changed: false });
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
  await workspace.createCategory({ key: 'Tech', label: 'Tech' }, { id: 'central-admin', role: 'admin' });
  expect(mockCreateCategory).toHaveBeenCalledWith({ key: 'Tech', label: 'Tech' }, undefined, expect.objectContaining({ source_surface: 'canonical_catalog_workspace' }));
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

test('un brouillon issu du Sourcing sans prix global atteint la curation humaine sans fuite d’ID DB', async () => {
  mockQuery.mockImplementation(async sql => {
    if (String(sql).includes("p.lifecycle_status = 'candidate'") && String(sql).includes('LEFT JOIN LATERAL')) {
      return {rows:[{
        product_id:'internal-product-id',product_ref:'KPR-NULL-PRICE',
        candidate_id:'internal-source-id',
        supplier_name:'AliExpress',supplier_product_id:'supplier-123',
        name:'Produit fournisseur',category:'tech',
        price_kmf:null,content_source:'manual',source_locale:'fr',
        needs_review:false,sourcing_decision:'TEST'
      }]};
    }
    return {rows:[]};
  });
  const rows=await workspace._test.queryApprovalQueue({limit:10});
  expect(rows).toHaveLength(1);
  expect(rows[0].supplier_source_linked).toBe(true);
  expect(rows[0].price_kmf).toBeNull();
  expect(rows[0]).not.toHaveProperty('candidate_id');
  expect(rows[0].product_ref).toBe('KPR-NULL-PRICE');
  const ui=require('fs').readFileSync(
    require('path').join(__dirname,'../../public/dashboards/canonical/js/catalog-workspace.js'),'utf8'
  );
  expect(ui).toContain('row.supplier_source_linked === true && row.price_kmf == null');
  expect(ui).toContain('aucune mise en vente acheteur avant LOCAL_ACTIVE');
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

test('C3 : préparation FR dont le texte reste anglais → 422 catalog_fr_language_check_failed', async () => {
  mockQuery.mockImplementation(async sql => {
    if (String(sql).includes('WHERE product_ref = $1')) {
      return { rows: [{ id: 'candidate-internal-id', product_ref: 'KPR-CJ', lifecycle_status: 'candidate', is_active: false }] };
    }
    return { rows: [] };
  });
  mockUpsertOverrides.mockRejectedValueOnce(Object.assign(new Error('Préparation française refusée : le texte ne semble pas être en français.'), { code: 'FRENCH_NOT_DETECTED' }));

  await expect(workspace.prepareCandidateFrench('KPR-CJ', { name: 'Wireless dress', description: 'Pleated dress for women with the best fabric.' }, { id: 'central-admin' }))
    .rejects.toMatchObject({ code: 'catalog_fr_language_check_failed', status: 422 });
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

test('product_ref publié reste matérialisé comme relais marché après sortie de curation', async () => {
  mockQuery.mockImplementation(async (sql, params) => {
    const text = String(sql);
    if (text.includes('COUNT(*)::int AS total_products')) {
      return { rows: [{ total_products: 2, active_products: 1, inactive_products: 1, approval_pending: 0, needs_review: 0 }] };
    }
    if (text.includes('GROUP BY 1') && text.includes('sourcing_decision')) return { rows: [] };
    if (text.includes("p.lifecycle_status = 'candidate'") && text.includes('LEFT JOIN LATERAL')) return { rows: [] };
    if (text.includes("JOIN markets m ON m.is_active = TRUE") && text.includes("p.lifecycle_status = 'active'")) {
      expect(params).toEqual(['KPR-131959']);
      return { rows: [
        {
          product_ref: 'KPR-131959',
          name: 'Jupe bouffante en coton blanc',
          lifecycle_status: 'active',
          is_active: true,
          is_available: true,
          market_code: 'KM',
          market_name: 'Comores',
          market_currency: 'KMF',
          commercial_exposure: 'DISABLED',
          exposure_decision_recorded: false,
          price_status: null,
          local_price_amount: null,
          local_price_currency: null,
        },
      ] };
    }
    return { rows: [] };
  });

  const payload = await workspace.buildWorkspace({ product_ref: 'KPR-131959' });
  expect(payload.focused_handoff).toEqual(expect.objectContaining({
    product_ref: 'KPR-131959',
    state: 'MARKET_DECISION_PENDING',
  }));
  expect(payload.focused_handoff.markets).toEqual([
    expect.objectContaining({
      code: 'KM',
      commercial_exposure: 'DISABLED',
      exposure_decision_recorded: false,
      price_status: null,
      buyer_visible: false,
    }),
  ]);
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

test('le montage rejoue afterRender après chaque rendu (le rendu vide la racine)',()=>{
  const src=require('fs').readFileSync(require('path').join(__dirname,'..','..','public/dashboards/canonical/js/catalog-workspace.js'),'utf8');
  expect(src).toContain('afterRender: typeof options.afterRender');
  expect(src).toContain('if (context.afterRender) context.afterRender(payload);');
});

test('la Raffinerie demande un verdict serveur en lecture seule uniquement sur demande', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '../../services/catalog-workspace.js'), 'utf8');
  expect(source).toContain("query.include_readiness === '1'");
  expect(source).toContain('certifyCatalogProduct(db, row.product_id)');
  expect(source).toContain('certification: facts?.certification || null');
});

test('identifiant DB privé : jamais exposé par la projection publique Produit', () => {
  const projected = workspace._test.publicProduct({ product_id: 9876, product_ref: 'KPR-000001', is_active: false });
  expect(projected.product_ref).toBe('KPR-000001');
  expect(projected).not.toHaveProperty('product_id');
});

test('file Raffinerie transmet l identifiant DB en interne pour la certification', async () => {
  mockQuery.mockImplementation(async sql => {
    if (String(sql).includes('FROM products p') && String(sql).includes('sourcing_candidates candidate')) {
      return { rows: [{ product_id: 42, product_ref: 'KPR-42', sourcing_decision: 'TEST' }] };
    }
    return { rows: [] };
  });
  const rows = await workspace._test.queryApprovalQueue({ limit: 1 });
  expect(rows[0].product_id).toBe(42);
});

test('Raffinerie: vrai moteur de certification côté serveur, sans publication ni fuite d’ID', async () => {
  const baseline = mockQuery.getMockImplementation();
  let certificationFactsReads = 0;
  mockQuery.mockImplementation(async (sql, params) => {
    const text = String(sql);
    if (text.includes('WITH media AS (') && text.includes('product_market_exposure')) {
      certificationFactsReads += 1;
      expect(params).toEqual([42]);
      return { rows: [{
        product_id: 42, product_ref: 'KPR-CJ-TEST',
        has_sourcing_candidate: true, supplier_name: 'CJdropshipping',
        supplier_product_id: 'CJ-TEST-1', normalized_source_contract: { schema_version: '2' },
        sourcing_decision: 'TEST', name: 'Produit de test',
        description: 'Description en français', source_locale: 'fr',
        content_source: 'manual', needs_review: false,
        category: 'general', boutique_category_key: 'maison', boutique_subcategory_key: 'deco',
        taxonomy_active: true, lifecycle_status: 'candidate',
        is_active: false, is_available: false, price_kmf: 5000, stock: 0,
        active_media: 0, active_supplier_skus: 0, complete_supplier_skus: 0, enabled_markets: 0,
      }] };
    }
    if (text.includes("p.lifecycle_status = 'candidate'") && text.includes('LEFT JOIN LATERAL')) {
      const result = await baseline(sql, params);
      return { rows: result.rows.map(row => ({ ...row, product_id: 42 })) };
    }
    return baseline(sql, params);
  });
  const refinery = await workspace.buildWorkspace({ include_readiness: '1', approval_limit: '1' });
  expect(refinery.approval).toHaveLength(1);
  expect(certificationFactsReads).toBe(1);
  expect(refinery.approval[0]).not.toHaveProperty('product_id');
  expect(refinery.approval[0].certification).toMatchObject({
    certification_version: 'catalog-certification-v1',
    certified: false,
    reasons: expect.arrayContaining(['media_missing', 'active_supplier_sku_missing']),
  });
  // Même produit mais Vue Catalogue: zéro lecture de certification supplémentaire.
  const commercial = await workspace.buildWorkspace({ approval_limit: '1' });
  expect(certificationFactsReads).toBe(1);
  expect(commercial.approval[0]).not.toHaveProperty('certification');
  expect(commercial.approval[0]).not.toHaveProperty('product_id');
  expect(mockApprove).not.toHaveBeenCalled();
});

describe('C4 : un repli technique « autre » n’est pas une classification validée', () => {
  const { classificationStatus } = workspace._test;

  test('catégorie absente chez le candidat + produit en « autre » = repli non résolu', () => {
    expect(classificationStatus({ category: 'autre', candidate_komerce_category: null, supplier_category: 'Phone Cases' }))
      .toEqual(expect.objectContaining({ status: 'fallback_unresolved', supplier_category: 'Phone Cases' }));
  });

  test('« autre » choisi explicitement par le candidat reste une classification', () => {
    expect(classificationStatus({ category: 'autre', candidate_komerce_category: 'autre', supplier_category: null }).status).toBe('classified');
  });

  test('catégorie résolue = classée', () => {
    expect(classificationStatus({ category: 'maison', candidate_komerce_category: 'maison' }).status).toBe('classified');
  });

  test('produit sans candidat sourcing : pas de verdict de repli', () => {
    expect(classificationStatus({ category: 'autre', candidate_komerce_category: undefined, has_candidate: false }).status).toBe('not_from_sourcing');
  });
});

test('Catalogue/Raffinerie : « Définir le prix » transporte marché, période et périmètre de la page quand ils existent', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/catalog-workspace.js'), 'utf8');
  expect(src).toContain('nav.withContext(basePricingPath, nav.readContext(globalThis.location && globalThis.location.search))');
  expect(src).toContain("/admin/workspaces/pricing?product_ref=${encodeURIComponent(row.product_ref)}");
});

test('paramètres économiques à valider : la ligne porte la classe de mise en page (bouton Configurer sur sa propre ligne)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/catalog-workspace.js'), 'utf8');
  expect(src).toContain("line.className = 'kmc-param-line'");
});
