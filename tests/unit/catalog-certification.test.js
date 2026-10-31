'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  CATALOG_CERTIFICATION_VERSION,
  evaluateCatalogProductCertification,
  evaluateVisualFrCatalogCertification,
  certifyCatalogProduct,
  certifyCatalogBatch,
} = require('../../services/catalog-certification');

const PASS_GUARD = jest.fn(() => ({ ok: true }));

function readyRow(overrides = {}) {
  return {
    supplier_name: 'CJdropshipping',
    supplier_product_id: 'CJ-1',
    normalized_source_contract: { schema_version: '2' },
    sourcing_decision: 'TEST',
    product_id: 'p-1',
    product_ref: 'KPR-1',
    name: 'Chargeur USB-C 20W',
    description: 'Chargeur USB-C compact avec une description française suffisante.',
    category: 'electronics',
    boutique_category_key: 'Tech',
    boutique_subcategory_key: 'Audio',
    taxonomy_active: true,
    price_kmf: 5000,
    stock: 5,
    content_source: 'manual',
    needs_review: false,
    source_locale: 'en',
    lifecycle_status: 'candidate',
    is_active: false,
    is_available: false,
    active_media: 2,
    active_supplier_skus: 2,
    complete_supplier_skus: 2,
    enabled_markets: 0,
    ...overrides,
  };
}

describe('category-only supplier publication proof is independent of Discovery',()=>{
  test('a provenance-backed family can complete catalogue certification even without a leaf',()=>{
    const row=readyRow({boutique_category_key:'Mode & Beauté',
      boutique_subcategory_key:null,taxonomy_active:true,has_sourcing_candidate:true,
      supplier_product_name:'Silky Light Fog Lip Gloss',
      supplier_category:'Health, Beauty & Hair > Makeup > Lipstick'});
    const result=evaluateCatalogProductCertification(row,{publicationGuard:PASS_GUARD});
    expect(result).toMatchObject({certified:true,reasons:[]});
  });
  test.each([
    ['native unlinked',{has_sourcing_candidate:false}],
    ['missing source path',{supplier_category:null}],
    ['contradictory supplier path',{supplier_category:'Automobiles & Motorcycles > Auto Replacement Parts'}],
    ['wrong boutique category',{boutique_category_key:'Auto'}],
    ['no source identity',{supplier_product_name:null}]
  ])('a category-only product with %s is not certifiable',(_label,mutation)=>{
    const row=readyRow({...mutation,boutique_subcategory_key:null,
      boutique_category_key:mutation.boutique_category_key||'Mode & Beauté',
      taxonomy_active:true,has_sourcing_candidate:mutation.has_sourcing_candidate??true,
      supplier_product_name:mutation.supplier_product_name===undefined
        ?'Silky Light Fog Lip Gloss':mutation.supplier_product_name,
      supplier_category:mutation.supplier_category===undefined
        ?'Health, Beauty & Hair > Makeup > Lipstick':mutation.supplier_category});
    const result=evaluateCatalogProductCertification(row,{publicationGuard:PASS_GUARD});
    expect(result.certified).toBe(false);
    expect(result.reasons).toContain('boutique_subcategory_missing');
  });
  test('loader exposes source identity and checks active category without requiring leaf',async()=>{
    const {loadCatalogProductCertificationFacts}=require('../../services/catalog-certification');
    const q={query:jest.fn().mockResolvedValue({rows:[]})};
    await loadCatalogProductCertificationFacts(q,'candidate-id');
    const sql=q.query.mock.calls[0][0];
    expect(sql).toContain('candidate.product_name AS supplier_product_name');
    expect(sql).toContain('candidate.supplier_category');
    expect(sql).toContain('p.boutique_subcategory_key IS NULL OR bs.key IS NOT NULL');
  });
});

describe('catalog canonical certification', () => {
  beforeEach(() => PASS_GUARD.mockClear());

  test('sourcing-linked candidate with NULL global price is certifiable, but native price-less product is not', () => {
    const base = readyRow({
      price_kmf: null,
      source_locale: 'fr',
      has_sourcing_candidate: true,
    });
    const sourced = evaluateCatalogProductCertification(base);
    expect(sourced.certified).toBe(true);
    expect(sourced.publication_guard).toBe('PASS');

    const notProvenSourced = evaluateCatalogProductCertification({
      ...base, has_sourcing_candidate: false,
    });
    expect(notProvenSourced.certified).toBe(false);
    expect(notProvenSourced.reasons).toContain('publication_guard:invalid_price');

    // Supplier order identity and approved editorial copy are still mandatory.
    const noSupplierUnit = evaluateCatalogProductCertification({
      ...base, complete_supplier_skus: 0,
    });
    expect(noSupplierUnit.certified).toBe(false);
    expect(noSupplierUnit.reasons).toContain('supplier_order_identity_incomplete');
  });

  test('certifies a complete provider-independent catalog candidate', () => {
    const result = evaluateCatalogProductCertification(readyRow(), {
      publicationGuard: PASS_GUARD,
    });
    expect(result).toEqual({
      certification_version: CATALOG_CERTIFICATION_VERSION,
      certified: true,
      reasons: [],
      publication_guard: 'PASS',
    });
  });

  test.each([
    ['supplier identity', { supplier_product_id: null }, 'supplier_product_id_missing'],
    ['source contract', { normalized_source_contract: { schema_version: '1' } }, 'source_contract_v2_missing'],
    ['sourcing decision', { sourcing_decision: 'WATCH' }, 'decision_not_accepted'],
    ['editorial review', { needs_review: true }, 'french_editorial_not_ready'],
    ['customs category', { category: null }, 'customs_category_missing'],
    ['boutique category', { boutique_category_key: null }, 'boutique_category_missing'],
    ['boutique subcategory', { boutique_subcategory_key: null }, 'boutique_subcategory_missing'],
    ['active taxonomy', { taxonomy_active: false }, 'boutique_taxonomy_inactive_or_invalid'],
    ['media', { active_media: 0 }, 'media_missing'],
    ['supplier sku', { active_supplier_skus: 0, complete_supplier_skus: 0 }, 'active_supplier_sku_missing'],
    ['supplier order identity', { active_supplier_skus: 2, complete_supplier_skus: 1 }, 'supplier_order_identity_incomplete'],
    ['candidate lifecycle', { lifecycle_status: 'active', is_active: true }, 'not_inactive_candidate'],
    ['market exposure', { enabled_markets: 1 }, 'market_exposure_enabled'],
  ])('fails closed when %s invariant is broken', (_label, mutation, expectedReason) => {
    const result = evaluateCatalogProductCertification(readyRow(mutation), {
      publicationGuard: PASS_GUARD,
    });
    expect(result.certified).toBe(false);
    expect(result.reasons).toContain(expectedReason);
  });

  test('un produit natif non sourcé peut être certifié sans identité fournisseur', () => {
    const result = evaluateCatalogProductCertification(readyRow({
      supplier_name: null,
      supplier_product_id: null,
      normalized_source_contract: null,
      sourcing_decision: 'UNKNOWN',
      active_supplier_skus: 0,
      complete_supplier_skus: 0,
    }), {
      publicationGuard: PASS_GUARD,
      requireSourceIdentity: false,
      requireSourceContractV2: false,
      requireAcceptedSourcingDecision: false,
      requireSupplierSku: false,
    });

    expect(result.certified).toBe(true);
  });

  test('certification live d’un produit fournisseur reste fail-closed sur Supplier Order Identity', async () => {
    const q = {
      query: jest.fn().mockResolvedValueOnce({ rows: [{
        ...readyRow(),
        has_sourcing_candidate: true,
        active_supplier_skus: 1,
        complete_supplier_skus: 0,
      }] }),
    };

    const result = await certifyCatalogProduct(q, 'p-1', { publicationGuard: PASS_GUARD });

    expect(result.certification.certified).toBe(false);
    expect(result.certification.reasons).toContain('supplier_order_identity_incomplete');
  });

  test('SQL certification excludes blank supplier unit refs and blank SOI', async () => {
    const q = {query: jest.fn().mockResolvedValue({rows:[]})};
    await certifyCatalogProduct(q, 'p-1', {publicationGuard:PASS_GUARD});
    const sql = q.query.mock.calls[0][0];
    expect(sql).toContain("NULLIF(BTRIM(supplier_unit_ref), '') IS NOT NULL");
    expect(sql).toContain("jsonb_typeof(supplier_order_identity) = 'object' AND supplier_order_identity <> '{}'::jsonb");
  });

  test('combined refinery certification requires explicit source-linked visual FR review', () => {
    const media = [{ supplier_media_id:'supplier:img:1', url:'https://supplier.example/image.jpg' }];
    const technicalOnly = evaluateVisualFrCatalogCertification(readyRow(), media, []);
    expect(technicalOnly.technical_certified).toBe(true);
    expect(technicalOnly.certified).toBe(false);
    expect(technicalOnly.visual_fr_reason).toBe('VISUAL_FR_REVIEW_PENDING');
    const reviewed = evaluateVisualFrCatalogCertification(readyRow(), media, [{
      source_media_id:'supplier:img:1', source_url:media[0].url,
      text_presence:'NONE', reviewed_by:'editor', reviewed_at:'2026-10-16T10:00:00Z',
    }]);
    expect(reviewed.certified).toBe(true);
    expect(reviewed.visual_fr_certified).toBe(true);
  });

  test('publication guard failure is part of the same certification verdict', () => {
    const result = evaluateCatalogProductCertification(readyRow(), {
      publicationGuard: () => ({ ok: false, code: 'invalid_price' }),
    });
    expect(result.certified).toBe(false);
    expect(result.publication_guard).toBe('invalid_price');
    expect(result.reasons).toContain('publication_guard:invalid_price');
  });

  test('batch certification exposes UNACCOUNTED when one product is not certified', () => {
    const batch = certifyCatalogBatch([
      readyRow({ supplier_product_id: '1', product_id: 'p1' }),
      readyRow({ supplier_product_id: '2', product_id: 'p2', boutique_subcategory_key: null }),
    ], {
      inputTotal: 2,
      options: { publicationGuard: PASS_GUARD },
    });

    expect(batch.accounting).toMatchObject({
      input_total: 2,
      certified: 1,
      unaccounted: 1,
      balanced: false,
    });
  });
});
