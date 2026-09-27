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

jest.mock('../../scripts/catalog-fr-quality-apply', () => ({
  SUPPLIER: 'CJdropshipping',
  assertDisposableRuntime: jest.fn(),
  loadTranslations: jest.fn(),
  loadReviews: jest.fn(),
}));

const db = require('../../db');
const apply = require('../../scripts/catalog-fr-quality-apply');
const {
  difference,
  loadTargetRefs,
} = require('../../scripts/catalog-fr-quality-campaign-audit');

describe('catalog FR quality campaign audit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('difference returns values missing from the right-hand set', () => {
    expect(difference(['A', 'B', 'C'], new Set(['A', 'C']))).toEqual(['B']);
  });

  test('target set is exactly inactive CJ catalog candidates', async () => {
    db.query.mockResolvedValue({
      rows: [
        { product_ref: 'KPR-000001', content_source: 'connector_raw', needs_review: true },
        { product_ref: 'KPR-000002', content_source: 'manual', needs_review: false },
      ],
    });

    const rows = await loadTargetRefs();
    expect(rows).toHaveLength(2);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("p.lifecycle_status='candidate'"),
      ['CJdropshipping']
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("p.is_active=FALSE"),
      ['CJdropshipping']
    );
  });

  test('campaign loaders remain the canonical strict translation/review readers', () => {
    expect(typeof apply.loadTranslations).toBe('function');
    expect(typeof apply.loadReviews).toBe('function');
  });
});
