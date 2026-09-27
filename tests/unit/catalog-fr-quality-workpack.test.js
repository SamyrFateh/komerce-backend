'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
}));

const workpack = require('../../scripts/catalog-fr-quality-workpack');

describe('catalog FR quality workpack', () => {
  const row = {
    product_ref: 'KPR-000001',
    current_name: 'Wireless Phone Stand',
    current_description: 'Ancienne préparation',
    name_source: 'Wireless Phone Stand',
    description_source: 'Foldable phone stand for desk use.',
    source_locale: 'en',
    category: 'phones',
    subcategory: null,
    content_source: 'manual',
    needs_review: false,
    supplier_name: 'CJdropshipping',
    supplier_product_id: 'CJ-1',
    supplier_category: 'Phones',
    sourcing_decision: 'TEST',
    normalized_source_contract: {
      schema_version: '2',
      product_name: 'Wireless Phone Stand',
      description: 'Foldable phone stand for desk use.',
      source_locale: 'en',
      supplier_category: 'Phones',
      materials: ['ABS'],
      option_axes: null,
    },
  };

  test('exports source lineage and immutable source hash', () => {
    const entry = workpack.buildEntry(row);
    expect(entry.product_ref).toBe('KPR-000001');
    expect(entry.source_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.source.title).toBe('Wireless Phone Stand');
    expect(entry.current_output.title_fr).toBe('Wireless Phone Stand');
  });

  test('translation contract forbids invention and review is a separate artifact', () => {
    const contract = workpack.translationContract();
    const review = workpack.reviewContract();
    expect(contract.title_max_chars).toBe(80);
    expect(contract.rules.join(' ')).toMatch(/jamais inventer/i);
    expect(contract.expected_output_shape.translations[0].review_status).toBeUndefined();
    expect(review.separate_artifact_required).toBe(true);
    expect(review.expected_output_shape.reviews[0].review_status).toBe('PASS');
  });

  test('splits the workpack into bounded batches plus manifest', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'komerce-fr-workpack-'));
    const entries = Array.from({ length: 5 }, (_, i) => ({
      ...workpack.buildEntry(row),
      product_ref: `KPR-${i}`,
    }));
    const manifest = workpack.writeBatches(entries, dir, 2);
    expect(manifest.total_products).toBe(5);
    expect(manifest.batch_count).toBe(3);
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'batch-003.json'))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('refuses non disposable runtime', () => {
    expect(() => workpack.assertDisposableRuntime({
      KOMERCE_ENV: 'production',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://komerce:komerce@127.0.0.1:5432/komerce_real_catalog_stress',
    })).toThrow(/staging/);
  });
});
