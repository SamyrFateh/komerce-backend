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

jest.mock('../../services/suppliers/connectors/cj-connector', () => ({
  fetchProducts: jest.fn(),
}));

const {
  assertDisposableRuntime,
  categoryBucket,
  selectDiverseCandidates,
  buildSource,
  challengeContract,
  summarizeCoverage,
} = require('../../scripts/cj-fr-cold-start-challenge');

describe('CJ FR cold-start challenge', () => {
  test('refuses production and non-local databases', () => {
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

  test('requires explicit cold-start flag and CJ credential for discovery', () => {
    const env = {
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://komerce:komerce@127.0.0.1:5432/komerce_real_catalog_stress',
      CJ_ACCESS_TOKEN: 'x',
    };
    expect(() => assertDisposableRuntime(env, { requireCj: true })).toThrow(/KOMERCE_ALLOW_CJ_FR_COLD_START_CHALLENGE/);
    env.KOMERCE_ALLOW_CJ_FR_COLD_START_CHALLENGE = '1';
    expect(() => assertDisposableRuntime(env, { requireCj: true })).not.toThrow();
  });

  test('extracts a stable top-level supplier category', () => {
    expect(categoryBucket({ supplier_category: 'Women Clothing > Dresses > Casual' })).toBe('women clothing');
    expect(categoryBucket({ supplier_category: 'Jewelry / Earrings' })).toBe('jewelry');
    expect(categoryBucket({ supplier_category: null })).toBe('<unknown>');
  });

  test('selects across categories before taking deeper rows from one category', () => {
    const products = [
      { supplier_product_id: 'a1', supplier_category: 'A > one' },
      { supplier_product_id: 'a2', supplier_category: 'A > two' },
      { supplier_product_id: 'a3', supplier_category: 'A > three' },
      { supplier_product_id: 'b1', supplier_category: 'B > one' },
      { supplier_product_id: 'c1', supplier_category: 'C > one' },
    ];
    const selected = selectDiverseCandidates(products, 3);
    expect(selected).toHaveLength(3);
    expect(new Set(selected.map(categoryBucket)).size).toBe(3);
  });

  test('builds a source-faithful challenge document without inventing taxonomy', () => {
    const source = buildSource({
      supplier_product_id: 'PID-42',
      source_locale: 'en',
      product_name: 'USB-C Fast Charger',
      description: '20W charger',
      supplier_category: 'Phones > Chargers',
      materials: ['ABS'],
      option_axes: [{ key: 'plug', values: ['EU', 'US'] }],
    }, 0);

    expect(source).toMatchObject({
      product_ref: 'COLD-001',
      supplier_name: 'CJdropshipping',
      supplier_product_id: 'PID-42',
      title: 'USB-C Fast Charger',
      description: '20W charger',
      supplier_category: 'Phones > Chargers',
      current_category: null,
      current_subcategory: null,
      materials: ['ABS'],
    });
  });

  test('coverage treats missing terminology as reviewable, not unprocessable', () => {
    const entries = [
      {
        product_ref: 'COLD-001',
        source_hash: 'a'.repeat(64),
        source: { title: 'Known product', supplier_product_id: '1' },
        terminology_hints: {
          curated: [{ term_source: 'power bank', term_fr: 'batterie externe' }],
          references: [{
            term_en: 'power bank',
            term_fr: 'batterie externe',
            dataset_domain: 'electronics',
          }],
        },
      },
      {
        product_ref: 'COLD-002',
        source_hash: 'b'.repeat(64),
        source: { title: 'Completely new wording', supplier_product_id: '2' },
        terminology_hints: { curated: [], references: [] },
      },
    ];

    const coverage = summarizeCoverage(entries);
    expect(coverage.translation_inputs_ready).toBe(2);
    expect(coverage.products_without_any_terminology_hint).toBe(1);
    expect(coverage.products_with_curated_glossary).toBe(1);
    expect(coverage.products_with_external_reference).toBe(1);
  });

  test('challenge contract explicitly requires review and forbids silent invention', () => {
    const contract = challengeContract();
    expect(contract.acceptance.unseen_supplier_ids).toBe('100/100');
    expect(contract.acceptance.critical_inventions_after_translation_review).toBe(0);
    expect(contract.acceptance.second_pass_review_required).toBe(true);
    expect(contract.acceptance.missing_glossary_or_termium_may_block_processing).toBe(false);
  });
});
