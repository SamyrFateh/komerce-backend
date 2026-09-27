/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const scanner = require('../../services/supplier-catalog-scanner');

const categories = [
  { key: 'phones', classification_terms: { smartphone: 10, phone: 8, mobile: 8 } },
  { key: 'electronique', classification_terms: { headphone: 10, headphones: 10, earbud: 10, earbuds: 10, earphone: 10, earphones: 10, headset: 10 } },
  { key: 'autre', classification_terms: {} },
];

describe('supplier category mapping — audio vs phone', () => {
  test('classifies headphones / earbuds as electronics, not phones', () => {
    const result = scanner.mapCategory(
      'Wireless Bluetooth Earphones TWS Bluetooth Headset Wireless Earbuds Headphones',
      categories
    );
    expect(result.key).toBe('electronique');
  });

  test('keeps an actual smartphone in phones', () => {
    const result = scanner.mapCategory('Android Smartphone Mobile Phone', categories);
    expect(result.key).toBe('phones');
  });
});
