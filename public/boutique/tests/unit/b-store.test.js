'use strict';

/**
 * Test de contrat minimal du store partagé.
 *
 * PDC-4 ajoute trois états explicites au cycle modal enrichi. Ce test protège
 * leur présence et leur valeur initiale sans tester ici les owners qui les
 * mutent (`modal-selection-model` et `b-modal-mobile-product`).
 */

describe('b-store — état modal Product Detail', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    sessionStorage.clear();
  });

  test('déclare explicitement le contrat détail, la sélection SKU et la signature média', () => {
    const { state } = require('../../js/b-store.js');

    expect(state.modalProductDetail).toBeNull();
    expect(state.modalSelection).toBeNull();
    expect(state.modalMediaSignature).toBe('');
    expect(state.modalVariantCombo).toEqual({});
  });

  test('les états PDC-4 ne sont pas reconstruits depuis le localStorage panier', () => {
    localStorage.setItem('kmrc_cart_v', '3');
    localStorage.setItem('kmrc_cart', JSON.stringify([{ id: 'product-1', qty: 2 }]));

    const { state } = require('../../js/b-store.js');

    expect(state.cart).toEqual([{ id: 'product-1', qty: 2 }]);
    expect(state.modalProductDetail).toBeNull();
    expect(state.modalSelection).toBeNull();
    expect(state.modalMediaSignature).toBe('');
  });
});
