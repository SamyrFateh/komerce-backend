'use strict';

const { state } = require('../../js/b-store.js');
const { cartTotal } = require('../../js/b-cart-core.js');

describe('b-cart-core — prix de ligne SKU', () => {
  beforeEach(() => {
    state.cart = [];
  });

  test('item.price prime sur le prix catalogue du produit', () => {
    state.cart = [
      { qty: 2, price: 7200, product: { id: 1, price_kmf: 5000 } },
    ];
    expect(cartTotal()).toBe(14400);
  });

  test('reste compatible avec un ancien item sans prix de ligne', () => {
    state.cart = [
      { qty: 3, product: { id: 1, price_kmf: 5000 } },
    ];
    expect(cartTotal()).toBe(15000);
  });

  test('tolère les champs numériques sérialisés en string', () => {
    state.cart = [
      { qty: '2', price: '7200', product: { id: 1, price_kmf: 5000 } },
    ];
    expect(cartTotal()).toBe(14400);
  });
});
