'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  classifySupplierProduct,
  supplierSignals,
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

  test('supplier identity outranks a polluted discovery keyword', () => {
    const categories = [
      {
        key: 'hardware_dynamic',
        label: 'Hardware',
        classification_terms: { motorcycle: 7, footpeg: 10, bicycle: 9 },
        is_active: true,
      },
      {
        key: 'fashion_dynamic',
        label: 'Fashion',
        classification_terms: { blouse: 7, dress: 7 },
        is_active: true,
      },
    ];

    const result = classifySupplierProduct({
      product_name: 'Aluminum Motorcycle Part Universal Footpeg for bicycle',
      raw_payload: {
        discovery: {
          keyword: 'linen women blouse',
          target_subcategory: 'Femme',
        },
      },
    }, categories);

    expect(result).toEqual(expect.objectContaining({
      key: 'hardware_dynamic',
      source: 'mapped',
    }));
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ signal: 'product_name', term: 'footpeg' }),
    ]));
  });

  test('uses discovery intent only as a secondary signal', () => {
    const signals = supplierSignals({
      product_name: 'Real Product',
      supplier_category: 'Supplier Category',
      description: 'Description',
      raw_payload: { discovery: { keyword: 'Search Intent', target_subcategory: 'Target' } },
    });
    expect(signals.map(({ name, multiplier }) => [name, multiplier])).toEqual([
      ['product_name', 6],
      ['supplier_category', 4],
      ['description', 2],
      ['keyword', 2],
      ['target_subcategory', 1],
    ]);
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
