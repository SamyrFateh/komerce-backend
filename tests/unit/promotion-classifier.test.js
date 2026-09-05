'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const { classifyPromotion } = require('../../services/suppliers/promotion-classifier');
const { REASON_CODES } = require('../../services/suppliers/pipeline-constants');

const profile = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../config/import-profiles/komerce-test-dummyjson.v1.json'),
  'utf8'
));

describe('promotion-classifier', () => {
  test('rejette les données source non interprétables avant toute promotion', () => {
    const product = {
      id: 9001,
      title: 'Produit invalide',
      price: 'douze dollars',
      stock: 'beaucoup',
      category: 'Beauty',
      images: [],
    };

    const result = classifyPromotion(product, profile);

    expect(result.status).toBe('REJECTED_SOURCE_DATA_INVALID');
    expect(result.reasonCode).toBe(REASON_CODES.SOURCE_VALUE_UNPARSABLE);
    expect(result.eligible).toBe(false);
    expect(result.contract).toBeNull();
  });

  test('la politique devise quarantine avant la validation du contrat', () => {
    const product = {
      id: 9002,
      title: 'Produit GBP',
      price: '12.50 GBP',
      stock: 4,
      category: 'Beauty',
      images: ['https://cdn.example.com/p.jpg'],
    };

    const result = classifyPromotion(product, profile);

    expect(result.status).toBe('QUARANTINED_CURRENCY_POLICY');
    expect(result.eligible).toBe(false);
    expect(result.currencyResolved).toMatchObject({ value: null, quarantined: true });
    expect(result.contract).toBeNull();
  });
});
