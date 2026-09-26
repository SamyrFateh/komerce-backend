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
jest.mock('../../services/catalog-overrides', () => ({
  upsertOverrides: jest.fn(),
}));

const apply = require('../../scripts/catalog-fr-quality-apply');
const { sourceDocumentFromRow, sourceFingerprint } = require('../../services/catalog-fr-quality');

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
      review_status: 'PASS',
      ...overrides,
    };
  }

  test('accepts a reviewed, source-bound natural French proposal', () => {
    const verdict = apply.evaluateRow(sourceRow, validTranslation());
    expect(verdict.ok).toBe(true);
    expect(verdict.blocking).toEqual([]);
  });

  test('rejects stale source hash', () => {
    const verdict = apply.evaluateRow(sourceRow, validTranslation({ source_hash: '0'.repeat(64) }));
    expect(verdict.ok).toBe(false);
    expect(verdict.blocking).toContain('source_hash_mismatch');
  });

  test('requires the second offline review pass', () => {
    const verdict = apply.evaluateRow(sourceRow, validTranslation({ review_status: 'PENDING' }));
    expect(verdict.ok).toBe(false);
    expect(verdict.blocking).toContain('offline_review_missing_or_failed');
  });

  test('never accepts active/non-candidate product', () => {
    const verdict = apply.evaluateRow(
      { ...sourceRow, is_active: true, lifecycle_status: 'active' },
      validTranslation()
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.blocking).toContain('product_not_inactive_candidate');
  });

  test('refuses non disposable runtime', () => {
    expect(() => apply.assertDisposableRuntime({
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://prod.example.com/production',
    })).toThrow(/base jetable/);
  });
});
