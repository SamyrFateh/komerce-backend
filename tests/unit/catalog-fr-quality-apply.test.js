'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../../services/catalog-overrides', () => ({
  upsertOverrides: jest.fn(),
  finalizeReviewedManualPreparation: jest.fn(),
  isPipelineSourced: jest.fn((product) => Boolean(
    product && ['connector_raw', 'ai_enriched', 'manual'].includes(product.content_source)
      && (product.name_source || product.description_source)
  )),
}));

const apply = require('../../scripts/catalog-fr-quality-apply');
const { sourceDocumentFromRow, sourceFingerprint, proposalFingerprint } = require('../../services/catalog-fr-quality');

describe('catalog FR quality apply', () => {
  const sourceRow = {
    product_id: '11111111-1111-1111-1111-111111111111',
    product_ref: 'KPR-000001',
    current_name: 'Wireless Charger Stand',
    current_description: 'Ancienne préparation',
    name_source: 'Wireless Charger Stand 15W for iPhone',
    description_source: 'Adjustable wireless charger stand with 15W charging power.',
    source_locale: 'en',
    category: 'phones',
    subcategory: null,
    content_source: 'manual',
    needs_review: false,
    lifecycle_status: 'candidate',
    is_active: false,
    supplier_name: 'CJdropshipping',
    supplier_product_id: 'CJ-1',
    supplier_category: 'Phones',
    sourcing_decision: 'TEST',
    normalized_source_contract: {
      schema_version: '2',
      product_name: 'Wireless Charger Stand 15W for iPhone',
      description: 'Adjustable wireless charger stand with 15W charging power.',
      source_locale: 'en',
      supplier_category: 'Phones',
    },
  };

  function validTranslation(overrides = {}) {
    const source = sourceDocumentFromRow(sourceRow);
    return {
      product_ref: sourceRow.product_ref,
      source_hash: sourceFingerprint(source),
      title_fr: 'Support de charge sans fil 15 W pour iPhone',
      description_fr: 'Support réglable pour charger un iPhone sans fil avec une puissance de charge de 15 W. Il maintient le téléphone posé pendant la recharge.',
      ...overrides,
    };
  }

  function validReview(translation = validTranslation(), overrides = {}) {
    const source = sourceDocumentFromRow(sourceRow);
    const sourceHash = sourceFingerprint(source);
    return {
      product_ref: sourceRow.product_ref,
      source_hash: sourceHash,
      output_hash: proposalFingerprint({
        source_hash: sourceHash,
        title_fr: translation.title_fr,
        description_fr: translation.description_fr,
      }),
      review_status: 'PASS',
      reviewer_mode: 'assistant_second_pass',
      ...overrides,
    };
  }

  test('accepts only a separately reviewed, source-bound natural French proposal', () => {
    const translation = validTranslation();
    const verdict = apply.evaluateRow(sourceRow, translation, validReview(translation));
    expect(verdict.ok).toBe(true);
    expect(verdict.blocking).toEqual([]);
  });

  test('rejects stale source hash', () => {
    const translation = validTranslation({ source_hash: '0'.repeat(64) });
    const verdict = apply.evaluateRow(sourceRow, translation, validReview());
    expect(verdict.ok).toBe(false);
    expect(verdict.blocking).toContain('source_hash_mismatch');
  });

  test('requires a distinct second-pass review bound to exact output hash', () => {
    const translation = validTranslation();
    const noReview = apply.evaluateRow(sourceRow, translation, null);
    expect(noReview.ok).toBe(false);
    expect(noReview.blocking).toContain('offline_review_missing');

    const stale = apply.evaluateRow(sourceRow, translation, validReview(translation, { output_hash: 'f'.repeat(64) }));
    expect(stale.ok).toBe(false);
    expect(stale.blocking).toContain('review_output_hash_mismatch');
  });

  test('preflight rejects unsupported source state before any write', () => {
    const legacy = { ...sourceRow, content_source: null, name_source: null, description_source: null };
    const translation = validTranslation();
    const verdict = apply.evaluateRow(legacy, translation, validReview(translation));
    expect(verdict.ok).toBe(false);
    expect(verdict.blocking).toContain('product_without_pipeline_source_lineage');
  });

  test('never accepts active/non-candidate product', () => {
    const translation = validTranslation();
    const verdict = apply.evaluateRow(
      { ...sourceRow, is_active: true, lifecycle_status: 'active' },
      translation,
      validReview(translation)
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.blocking).toContain('product_not_inactive_candidate');
  });

  test('parseArgs requires a separate review artifact', () => {
    expect(() => apply.parseArgs(['--input=a.json'])).toThrow(/--review requis/);
    expect(() => apply.parseArgs(['--input=a.json', '--review=a.json'])).toThrow(/artifact séparé/);
    expect(apply.parseArgs(['--input=a.json', '--review=b.json'])).toMatchObject({ execute: false });
  });

  test('refuses non disposable runtime', () => {
    expect(() => apply.assertDisposableRuntime({
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://prod.example.com/production',
    })).toThrow(/base jetable/);
  });
});
