'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  collectShadowProof,
  buildVerdict,
  _economicIdentityKey,
} = require('../../services/sourcing-shadow-proof-service');

function result(rows) {
  return { rows };
}

describe('sourcing multi-source shadow proof', () => {
  test('declare la projection Product essayable avec plusieurs sources, convergence et zero conflit', () => {
    const verdict = buildVerdict({
      sources: [
        { source_id: 'api:a', adapter_type: 'a' },
        { source_id: 'api:b', adapter_type: 'b' },
        { source_id: 'manual:c', adapter_type: 'manual' },
      ],
      convergence: { cross_source_products: 2 },
      deterministicConflicts: [],
      prohibitedEvidence: [],
      unresolved: { unbound_products: 0 },
      decisions: { review_required: 0 },
    });

    expect(verdict).toMatchObject({
      status: 'PASS',
      invariant_safe: true,
      multisource_observed: true,
      distinct_adapters_observed: 3,
      cross_source_convergence_proven: true,
      ready_for_product_projection_trial: true,
    });
  });

  test('un conflit deterministe est un hard fail', () => {
    const verdict = buildVerdict({
      sources: [{ source_id: 'api:a', adapter_type: 'a' }, { source_id: 'api:b', adapter_type: 'b' }],
      convergence: { cross_source_products: 1 },
      deterministicConflicts: [{ canonical_entity_id: 'p1', evidence_key: 'gtin', values: ['1', '2'] }],
      prohibitedEvidence: [],
      unresolved: {},
      decisions: {},
    });
    expect(verdict.status).toBe('FAIL');
    expect(verdict.ready_for_product_projection_trial).toBe(false);
    expect(verdict.hard_failures).toContain('deterministic_identity_conflict');
  });

  test('prix stock fret delai devise ne peuvent devenir Evidence identitaire', () => {
    for (const key of ['purchase_price', 'stock_available', 'freight_cost', 'delivery_delay', 'currency', 'margin_pct']) {
      expect(_economicIdentityKey.test(key)).toBe(true);
    }
    expect(_economicIdentityKey.test('gtin')).toBe(false);
    expect(_economicIdentityKey.test('brand_model')).toBe(false);
  });

  test('le rapport est provider-agnostic et agrege automatiquement les sources observees', async () => {
    const replies = [
      result([
        { source_id: 'api:aliexpress', adapter_type: 'aliexpress', captures: '2', products: '4', offers: '4', units: '8', bound_observations: '16' },
        { source_id: 'api:cj', adapter_type: 'cj', captures: '1', products: '2', offers: '2', units: '4', bound_observations: '8' },
        { source_id: 'api:allegro', adapter_type: 'allegro', captures: '1', products: '1', offers: '1', units: '1', bound_observations: '3' },
      ]),
      result([{ canonical_products: '5', cross_source_products: '2', max_sources_per_product: '3', repeatedly_observed_products: '3' }]),
      result([]),
      result([
        { evidence_type: 'deterministic_id', evidence_key: 'gtin' },
        { evidence_type: 'attribute', evidence_key: 'brand' },
        { evidence_type: 'lexical', evidence_key: 'brand_model' },
      ]),
      result([{ unbound_products: '0', unbound_offers: '1', unbound_units: '2' }]),
      result([{ links: '20', review_required: '0', distinct_decisions: '0', merges: '0', splits: '0' }]),
    ];
    const query = jest.fn(async () => replies.shift());

    const report = await collectShadowProof(query);

    expect(query).toHaveBeenCalledTimes(6);
    expect(report.sources.map((source) => source.adapter_type)).toEqual(['aliexpress', 'cj', 'allegro']);
    expect(report.observations).toEqual({ products: 7, offers: 7, units: 13, bound: 27, captures: 4 });
    expect(report.convergence).toMatchObject({ cross_source_products: 2, max_sources_per_product: 3 });
    expect(report.safety.deterministic_identity_conflicts).toEqual([]);
    expect(report.verdict.ready_for_product_projection_trial).toBe(true);
  });

  test('absence de convergence reste un warning et ne pretend pas au cutover', async () => {
    const replies = [
      result([{ source_id: 'api:a', adapter_type: 'a', captures: 1, products: 2, offers: 0, units: 0, bound_observations: 2 }]),
      result([{ canonical_products: 2, cross_source_products: 0, max_sources_per_product: 1, repeatedly_observed_products: 0 }]),
      result([]),
      result([{ evidence_type: 'deterministic_id', evidence_key: 'gtin' }]),
      result([{ unbound_products: 0, unbound_offers: 0, unbound_units: 0 }]),
      result([{ links: 2, review_required: 0, distinct_decisions: 0, merges: 0, splits: 0 }]),
    ];
    const report = await collectShadowProof(jest.fn(async () => replies.shift()));
    expect(report.verdict.status).toBe('WARN');
    expect(report.verdict.ready_for_product_projection_trial).toBe(false);
    expect(report.verdict.warnings).toEqual(expect.arrayContaining([
      'fewer_than_two_sources_observed',
      'no_cross_source_product_convergence_proven',
    ]));
  });
});
