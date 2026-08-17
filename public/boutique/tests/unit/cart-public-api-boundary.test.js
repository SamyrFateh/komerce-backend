'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '../../js');

describe('orders-client cart public API boundary', () => {
  test('la façade expose uniquement les primitives panier nécessaires aux consommateurs', () => {
    const src = fs.readFileSync(path.join(JS, 'cart-public-api.js'), 'utf8');
    expect(src).toContain("from './b-cart.js'");
    expect(src).toContain("from './cart-product-summary.js'");
    for (const name of ['quickAdd', 'quickRemove', 'openCartWithHighlight', 'getProductCartSummary']) {
      expect(src).toContain(name);
    }
  });

  test('recommendations consomme la façade et jamais les internes orders', () => {
    const src = fs.readFileSync(path.join(JS, 'b-modal-suggestions.js'), 'utf8');
    expect(src).toContain("from './cart-public-api.js'");
    expect(src).not.toContain("from './b-cart.js'");
    expect(src).not.toContain("from './cart-product-summary.js'");
  });
});
