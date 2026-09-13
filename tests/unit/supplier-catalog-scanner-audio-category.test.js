/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const scanner = require('../../services/supplier-catalog-scanner');

const categories = [
  { key: 'phones' },
  { key: 'electronique' },
  { key: 'autre' },
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
