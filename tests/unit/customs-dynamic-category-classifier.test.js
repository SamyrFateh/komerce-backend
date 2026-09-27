'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  classifySupplierProduct,
  scoreCategory,
} = require('../../services/customs-dynamic-category-classifier');

describe('dynamic customs supplier category classifier', () => {
  test('classifies into a category that does not exist anywhere in scanner code', () => {
    const categories = [
      {
        key: 'bagagerie_test',
        label: 'Bagagerie',
        classification_terms: { crossbody: 10, handbag: 9, satchel: 8 },
        display_order: 4,
        is_active: true,
      },
      {
        key: 'default',
        label: 'Default',
        classification_terms: {},
        display_order: 999,
        is_active: true,
      },
    ];

    const result = classifySupplierProduct({
      product_name: 'Women Leather Crossbody Bag',
      raw_payload: { discovery: { keyword: 'women crossbody bag' } },
    }, categories);

    expect(result).toEqual(expect.objectContaining({
      key: 'bagagerie_test',
      source: 'mapped',
      confidence: 'high',
      reason: 'configured_terms_match',
    }));
  });

  test('ignores inactive categories even when their terms match', () => {
    const result = classifySupplierProduct({
      product_name: 'Women Leather Crossbody Bag',
      raw_payload: { discovery: { keyword: 'crossbody bag' } },
    }, [
      {
        key: 'disabled_bags',
        label: 'Disabled Bags',
        classification_terms: { crossbody: 20 },
        is_active: false,
      },
      {
        key: 'default',
        label: 'Default',
        classification_terms: {},
        is_active: true,
      },
    ]);

    expect(result).toEqual(expect.objectContaining({
      key: 'default',
      source: 'default',
      reason: 'no_configured_term_match',
    }));
  });

  test('returns unresolved instead of inventing a business category when no match exists', () => {
    const result = classifySupplierProduct({
      product_name: 'Unknown Supplier Object',
      raw_payload: { discovery: { keyword: 'mystery object' } },
    }, [
      {
        key: 'known_category',
        label: 'Known',
        classification_terms: { known: 10 },
        is_active: true,
      },
    ]);

    expect(result).toEqual(expect.objectContaining({
      key: null,
      source: 'default',
      confidence: 'low',
      reason: 'no_configured_term_match',
    }));
  });

  test('configured weighted terms dominate weak label metadata', () => {
    const signals = [{ name: 'keyword', value: 'premium crossbody bag', multiplier: 5 }];
    const scored = scoreCategory({
      key: 'x',
      label: 'Bag',
      classification_terms: { crossbody: 10 },
    }, signals);

    expect(scored.score).toBeGreaterThanOrEqual(50);
    expect(scored.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ term: 'crossbody', contribution: 50 }),
    ]));
  });
});
