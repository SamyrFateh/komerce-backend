'use strict';

jest.mock('../../services/suppliers/connectors/aliexpress-connected-connector', () => ({ managedRuntimeEnv: jest.fn() }));
jest.mock('../../services/suppliers/connectors/aliexpress-connector', () => ({ invokeTop: jest.fn() }));

const { feedNames, categories, productIds } = require('../../scripts/aliexpress-feed-surface-proof');

describe('aliexpress-feed-surface-proof', () => {
  test('parse les feeds DS', () => {
    expect(feedNames({ result: { promos: { promo: [{ promo_name: 'DS bestseller' }, { promo_name: 'Hot sale' }] } } }))
      .toEqual(['DS bestseller', 'Hot sale']);
  });

  test('parse les catégories DS', () => {
    expect(categories({ resp_result: { result: { categories: { category: [{ category_id: 21, category_name: 'Sports' }] } } } }))
      .toEqual([{ id: '21', name: 'Sports' }]);
  });

  test('collecte les ids produits quel que soit le wrapper', () => {
    expect(productIds({ result: { products: [{ product_id: '100000000001' }, { itemId: '100000000002' }] } }).sort())
      .toEqual(['100000000001', '100000000002']);
  });
});
