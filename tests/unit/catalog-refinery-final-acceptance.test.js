'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
}));

const {
  assertDisposableRuntime,
  sourceTruthReady,
  approvalQueueVisible,
  editorialReady,
  classify,
  countReasons,
} = require('../../scripts/catalog-refinery-final-acceptance');

function baseRow(overrides = {}) {
  return {
    product_ref: 'KPR-TEST-1',
    supplier_product_id: 'CJ-1',
    normalized_source_contract: {
      schema_version: '2',
      product_name: 'USB-C charger',
    },
    name_source: 'USB-C charger',
    description_source: '20W charger',
    source_locale: 'en',
    name: 'Chargeur USB-C 20W',
    description: 'Chargeur USB-C compact avec une puissance indiquée de 20W.',
    category: 'Tech',
    subcategory: 'Chargeurs',
    price_kmf: 5000,
    stock: 10,
    content_source: 'manual',
    needs_review: false,
    lifecycle_status: 'candidate',
    is_active: false,
    is_available: false,
    sourcing_decision: 'TEST',
    active_media: 2,
    supplier_skus: 2,
    complete_soi_skus: 2,
    active_supplier_skus: 2,
    active_complete_soi_skus: 2,
    market_decisions: 0,
    enabled_markets: 0,
    ...overrides,
  };
}

describe('catalog Raffinerie final acceptance', () => {
  test('refuses non-disposable runtime', () => {
    expect(() => assertDisposableRuntime({
      KOMERCE_ENV: 'production',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://komerce:komerce@127.0.0.1:5432/komerce_real_catalog_stress',
    })).toThrow(/staging/);

    expect(() => assertDisposableRuntime({
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://prod.example.com/production',
    })).toThrow(/base jetable/);
  });

  test('accepts structurally complete inactive candidate', () => {
    const row = baseRow();
    expect(sourceTruthReady(row)).toBe(true);
    expect(approvalQueueVisible(row)).toBe(true);
    expect(editorialReady(row)).toBe(true);

    const verdict = classify(row);
    expect(verdict.structural_ok).toBe(true);
    expect(verdict.final_ok).toBe(true);
    expect(verdict.publication_guard).toBe('PASS');
  });

  test('pre-publication market exposure is a structural blocker', () => {
    const verdict = classify(baseRow({ enabled_markets: 1 }));
    expect(verdict.structural_ok).toBe(false);
    expect(verdict.structural).toContain('market_exposure_enabled_before_global_publication');
  });

  test('missing editorial preparation is final-only blocker', () => {
    const verdict = classify(baseRow({
      content_source: 'connector_raw',
      needs_review: true,
    }));
    expect(verdict.structural_ok).toBe(true);
    expect(verdict.final_ok).toBe(false);
    expect(verdict.final).toContain('editorial_not_ready');
    expect(verdict.final).toContain('publication_guard:enrichment_required');
  });

  test('partial supplier order identity blocks structural acceptance', () => {
    const verdict = classify(baseRow({
      supplier_skus: 3,
      complete_soi_skus: 2,
    }));
    expect(verdict.structural).toContain('supplier_order_identity_partial');
  });

  test('reason aggregation is explicit', () => {
    const counts = countReasons([
      { structural: ['media_missing', 'category_missing'] },
      { structural: ['media_missing'] },
    ], 'structural');
    expect(counts).toEqual({ media_missing: 2, category_missing: 1 });
  });
});
