'use strict';

const { state } = require('../../js/b-store.js');
const { cartTotal } = require('../../js/b-cart-core.js');

describe('b-cart-core — prix de ligne SKU', () => {
  beforeEach(() => {
    state.cart = [];
  });

  test('item.price prime sur le prix catalogue du produit', () => {
    state.cart = [
      { qty: 2, price: 7200, product: { id: 1, price_kmf: 5000, price: 4000 } },
    ];
    expect(cartTotal()).toBe(14400);
  });

  test('ancien item : fallback price_kmf puis price produit', () => {
    state.cart = [
      { qty: 3, product: { id: 1, price_kmf: 5000, price: 4000 } },
      { qty: 2, product: { id: 2, price: 3000 } },
    ];
    expect(cartTotal()).toBe(21000);
  });

  test('absence de prix ou de produit contribue zéro sans crash', () => {
    state.cart = [
      { qty: 2, product: { id: 1 } },
      { qty: 4 },
      { qty: null, price: 9999, product: { id: 3 } },
    ];
    expect(cartTotal()).toBe(0);
  });

  test('tolère prix et quantité sérialisés en string', () => {
    state.cart = [
      { qty: '2', price: '7200', product: { id: 1, price_kmf: 5000 } },
    ];
    expect(cartTotal()).toBe(14400);
  });

  test('additionne correctement plusieurs lignes SKU du même produit', () => {
    state.cart = [
      { qty: 1, price: 7200, product: { id: 1, sku_id: 'red' } },
      { qty: 2, price: 8100, product: { id: 1, sku_id: 'blue' } },
    ];
    expect(cartTotal()).toBe(23400);
  });
});
