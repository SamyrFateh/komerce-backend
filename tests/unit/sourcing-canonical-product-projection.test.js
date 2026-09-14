'use strict';

// Regression boundary: Canonical Offer/Unit shadow must not change this authority.


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  PRODUCT_FIELDS,
  FORBIDDEN_ECONOMIC_FIELDS,
  buildCanonicalProductProjection,
  projectField,
  _stableValue,
} = require('../../services/sourcing-canonical-product-projection');

const { buildReport } = require('../../scripts/sourcing-product-projection-trial-staging');

function row(sourceId, observedAt, normalized = {}) {
  return {
    canonical_entity_id: '11111111-1111-4111-8111-111111111111',
    observation_id: `${sourceId}-${observedAt}`,
    source_id: sourceId,
    adapter_type: 'manual',
    observed_at: observedAt,
    normalized,
  };
}

describe('canonical Product projection trial', () => {
  test('projette le consensus et préserve explicitement un conflit multi-source', () => {
    const rows = [
      row('manual:a', '2026-09-14T09:00:00.000Z', {
        product_name: 'Produit source A',
        brand: 'Komerce Proof',
        supplier_category: 'Maison',
        purchase_price: 11.5,
        currency: 'EUR',
        stock_available: 7,
      }),
      row('manual:b', '2026-09-14T09:01:00.000Z', {
        product_name: 'Produit source B',
        brand: 'Komerce Proof',
        supplier_category: 'Maison',
        purchase_price: 14.2,
        currency: 'USD',
        stock_available: 9,
      }),
    ];
    const evidence = [
      { evidence_type: 'deterministic_id', evidence_key: 'gtin', value: '3560071499999' },
      { evidence_type: 'deterministic_id', evidence_key: 'gtin', value: '3560071499999' },
    ];

    const product = buildCanonicalProductProjection(rows, evidence);

    expect(product.source_count).toBe(2);
    expect(product.observation_count).toBe(2);
    expect(product.resolved.brand).toBe('Komerce Proof');
    expect(product.resolved.supplier_category).toBe('Maison');
    expect(product.fields.product_name.status).toBe('CONFLICT_PRESERVED');
    expect(product.resolved).not.toHaveProperty('product_name');
    expect(product.conflicts).toContain('product_name');
    expect(product.identity_evidence).toEqual([
      { evidence_type: 'deterministic_id', evidence_key: 'gtin', values: ['3560071499999'] },
    ]);
  });

  test('les faits économiques sont hors whitelist Product', () => {
    for (const field of FORBIDDEN_ECONOMIC_FIELDS) {
      expect(PRODUCT_FIELDS).not.toContain(field);
    }

    const product = buildCanonicalProductProjection([
      row('api:cj', '2026-09-14T09:00:00.000Z', {
        product_name: 'Produit',
        purchase_price: 1,
        currency: 'USD',
        stock_available: 12,
        sellable_units: [{ supplier_sku: 'SKU-1' }],
      }),
    ]);

    expect(product.resolved.product_name).toBe('Produit');
    expect(product.resolved).not.toHaveProperty('purchase_price');
    expect(product.resolved).not.toHaveProperty('currency');
    expect(product.resolved).not.toHaveProperty('stock_available');
    expect(product.resolved).not.toHaveProperty('sellable_units');
  });

  test('stableValue neutralise l’ordre des clés objet sans réordonner les listes', () => {
    expect(_stableValue({ b: 2, a: 1 })).toBe(_stableValue({ a: 1, b: 2 }));
    expect(_stableValue(['a', 'b'])).not.toBe(_stableValue(['b', 'a']));
  });

  test('projectField distingue ABSENT, CONSENSUS et CONFLICT_PRESERVED', () => {
    expect(projectField([row('a', '2026-09-14T09:00:00Z', {})], 'brand').status).toBe('ABSENT');
    expect(projectField([
      row('a', '2026-09-14T09:00:00Z', { brand: 'X' }),
      row('b', '2026-09-14T09:01:00Z', { brand: 'X' }),
    ], 'brand').status).toBe('CONSENSUS');
    expect(projectField([
      row('a', '2026-09-14T09:00:00Z', { brand: 'X' }),
      row('b', '2026-09-14T09:01:00Z', { brand: 'Y' }),
    ], 'brand').status).toBe('CONFLICT_PRESERVED');
  });

  test('le trial PASS exige gate proof, multi-source et zéro fuite économique', () => {
    const proof = { verdict: { ready_for_product_projection_trial: true } };
    const projection = {
      forbidden_economic_fields: [...FORBIDDEN_ECONOMIC_FIELDS],
      products: [{
        canonical_product_id: 'p1',
        source_count: 2,
        projection_status: 'PARTIAL_CONFLICT_PRESERVED',
        resolved: { brand: 'Komerce Proof' },
        conflicts: ['product_name'],
      }],
    };

    const report = buildReport(proof, projection);
    expect(report.verdict).toEqual({
      status: 'PASS',
      hard_failures: [],
      ready_for_parallel_product_read_comparison: true,
    });
    expect(report.historical_catalog_authority_unchanged).toBe(true);
  });
});
