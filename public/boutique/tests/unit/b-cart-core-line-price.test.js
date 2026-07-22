'use strict';

const { state } = require('../../js/b-store.js');
const { cartTotal } = require('../../js/b-cart-core.js');

describe('b-cart-core — line price snapshot', () => {
  beforeEach(() => {
    state.cart = [];
  });

  test('le prix de ligne SKU prévaut sur le prix catalogue', () => {
    state.cart = [{
      product: { id: 42, price_kmf: 10000 },
      sku_id: 'sku-premium',
      price: 13500,
      qty: 2,
    }];

    expect(cartTotal()).toBe(27000);
  });

  test('les anciens paniers sans snapshot utilisent product.price_kmf', () => {
    state.cart = [{ product: { id: 7, price_kmf: 5000 }, qty: 3 }];
    expect(cartTotal()).toBe(15000);
  });
});
