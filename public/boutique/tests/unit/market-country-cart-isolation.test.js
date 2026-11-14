/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

describe('Panier isolé entre boutiques pays', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    global.fetch = jest.fn(() => new Promise(() => {}));
  });
  afterEach(() => {
    delete window.KomerceMarket;
    localStorage.clear();
    jest.resetModules();
  });

  function openMarket(code) {
    jest.resetModules();
    window.KomerceMarket = { get: () => ({ code }) };
    const store = require('../../js/b-store.js');
    const cartCore = require('../../js/b-cart-core.js');
    return { ...store, ...cartCore };
  }

  test('KM conserve ses clés historiques et son panier après un aller-retour par CM', () => {
    let { state, saveCart, cartStorageKeys } = openMarket('KM');
    expect(cartStorageKeys().cart).toBe('kmrc_cart');
    state.cart = [{ id: 'km-item', qty: 1 }];
    saveCart();

    ({ state, saveCart, cartStorageKeys } = openMarket('CM'));
    expect(cartStorageKeys().cart).toBe('kmrc_cart_CM');
    expect(state.cart).toEqual([]);
    state.cart = [{ id: 'cm-item', qty: 2 }];
    saveCart();

    ({ state } = openMarket('KM'));
    expect(state.cart).toEqual([{ id: 'km-item', qty: 1 }]);
    ({ state } = openMarket('CM'));
    expect(state.cart).toEqual([{ id: 'cm-item', qty: 2 }]);
  });

  test('CG et DJ ne récupèrent jamais les articles CM', () => {
    let { state, saveCart } = openMarket('CM');
    state.cart = [{ id: 'cm-only', qty: 1 }];
    saveCart();
    expect(openMarket('CG').state.cart).toEqual([]);
    expect(openMarket('DJ').state.cart).toEqual([]);
    expect(openMarket('YT').state.cart).toEqual([]);
  });
});
