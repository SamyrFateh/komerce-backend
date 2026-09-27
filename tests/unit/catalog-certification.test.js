'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  CATALOG_CERTIFICATION_VERSION,
  evaluateCatalogProductCertification,
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

describe('catalog canonical certification', () => {
  beforeEach(() => PASS_GUARD.mockClear());

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
