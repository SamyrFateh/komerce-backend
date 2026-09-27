'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../../services/suppliers/e2e-isolated-runtime', () => ({
  assertIsolatedE2eRuntime: jest.fn(() => ({ mode: 'railway-isolated', dataset_id: 'catalog-e2e-700-v1' })),
}));
jest.mock('../../services/product-publication-guard', () => ({
  validatePublicationUpdate: jest.fn(() => ({ ok: true })),
}));
jest.mock('../../scripts/aliexpress-incremental-e2e-200', () => ({
  WAVE_ID: 'incremental-e2e-200-v1',
}));
jest.mock('../../scripts/cj-reconcile-current-new-12-promote', () => ({
  NEW_UNIQUE_IDS: Array.from({ length: 12 }, (_, i) => `cj-new-${i + 1}`),
}));
jest.mock('../../scripts/catalog-cj-certified-500-materialize', () => ({
  decodeCertifiedIds: jest.fn(() => Array.from({ length: 500 }, (_, i) => `cj-old-${i + 1}`)),
  CERTIFIED_RUN_ID: 36299995007,
}));

const gate = require('../../scripts/catalog-e2e-712-acceptance');

function readyRow({ supplier, supplierId, productId }) {
  return {
    supplier_name: supplier,
    supplier_product_id: supplierId,
    product_id: productId,
    normalized_source_contract: { schema_version: '2' },
    sourcing_decision: 'TEST',
    product_ref: `KPR-${productId}`,
    name: 'Produit français',
    description: 'Description française.',
    category: 'electro',
    subcategory: null,
    boutique_category_key: 'Tech',
    boutique_subcategory_key: 'Audio',
    price_kmf: 5000,
    stock: 10,
    content_source: 'manual',
    needs_review: false,
    source_locale: 'en',
    lifecycle_status: 'candidate',
    is_active: false,
    is_available: false,
    active_media: 2,
    active_supplier_skus: 1,
    complete_supplier_skus: 1,
    enabled_markets: 0,
    taxonomy_active: true,
  };
}

describe('catalog E2E 712 acceptance', () => {
  test('builds an exact 512-id CJ union with no historical/new overlap', () => {
    const expected = gate.buildExpectedCjIds({});
    expect(expected.historical).toHaveLength(500);
    expect(expected.additions).toHaveLength(12);
    expect(expected.all).toHaveLength(512);
    expect(new Set(expected.all).size).toBe(512);
    expect(gate.TOTAL_TARGET).toBe(712);
  });

  test('acceptance aggregation proves 712 distinct supplier identities and 712 distinct catalog products', () => {
    const expectedCj = gate.buildExpectedCjIds({}).all;
    const rows = [
      ...expectedCj.map((id, i) => readyRow({ supplier: 'CJdropshipping', supplierId: id, productId: `cj-p-${i + 1}` })),
      ...Array.from({ length: 200 }, (_, i) => readyRow({ supplier: 'AliExpress', supplierId: `ali-${i + 1}`, productId: `ali-p-${i + 1}` })),
    ];
    const out = gate.aggregate(rows, expectedCj);
    expect(out.summary).toMatchObject({
      target: 712,
      total_rows: 712,
      ready: 712,
      ali_total: 200,
      ali_ready: 200,
      cj_total: 512,
      cj_ready: 512,
      distinct_supplier_identities: 712,
      distinct_product_ids: 712,
      duplicate_supplier_identities: 0,
      duplicate_product_links: 0,
      missing_cj_ids: 0,
      enabled_market_exposure: 0,
      invalid_taxonomy: 0,
    });
  });

  test('detects accidental duplicate product linkage even when supplier identities differ', () => {
    const expectedCj = gate.buildExpectedCjIds({}).all;
    const rows = [
      readyRow({ supplier: 'CJdropshipping', supplierId: expectedCj[0], productId: 'same-product' }),
      readyRow({ supplier: 'AliExpress', supplierId: 'ali-1', productId: 'same-product' }),
    ];
    const out = gate.aggregate(rows, expectedCj);
    expect(out.summary.duplicate_product_links).toBe(1);
    expect(out.summary.missing_cj_ids).toBe(511);
  });

  test('dynamic boutique taxonomy or SOI gaps block a product', () => {
    const invalidTaxonomy = gate.classify(readyRow({
      supplier: 'CJdropshipping', supplierId: 'cj-x', productId: 'p-x',
    }));
    expect(invalidTaxonomy.ready).toBe(true);

    const row = readyRow({ supplier: 'CJdropshipping', supplierId: 'cj-y', productId: 'p-y' });
    row.taxonomy_active = false;
    row.complete_supplier_skus = 0;
    const blocked = gate.classify(row);
    expect(blocked.ready).toBe(false);
    expect(blocked.reasons).toEqual(expect.arrayContaining([
      'boutique_taxonomy_inactive_or_invalid',
      'supplier_order_identity_incomplete',
    ]));
  });
});
