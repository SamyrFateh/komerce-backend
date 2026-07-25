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

describe('b-store — migration legacy delivery_mode → requested_transport_rail (chantier Air Shipped)', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    sessionStorage.clear();
  });

  test('sea → SEA_STANDARD, air → AIR_EXPRESS, champ legacy supprimé', () => {
    localStorage.setItem('kmrc_cart_v', '3');
    localStorage.setItem('kmrc_cart', JSON.stringify([
      { id: 'p-sea', qty: 1, delivery_mode: 'sea' },
      { id: 'p-air', qty: 1, delivery_mode: 'air' },
    ]));

    const { state } = require('../../js/b-store.js');

    expect(state.cart).toEqual([
      { id: 'p-sea', qty: 1, requested_transport_rail: 'SEA_STANDARD' },
      { id: 'p-air', qty: 1, requested_transport_rail: 'AIR_EXPRESS' },
    ]);
    state.cart.forEach((item) => expect(item.delivery_mode).toBeUndefined());
  });

  test('code legacy inconnu → requested_transport_rail null, champ legacy supprimé quand même', () => {
    localStorage.setItem('kmrc_cart_v', '3');
    localStorage.setItem('kmrc_cart', JSON.stringify([
      { id: 'p-x', qty: 1, delivery_mode: 'truck' },
    ]));

    const { state } = require('../../js/b-store.js');

    expect(state.cart).toEqual([{ id: 'p-x', qty: 1, requested_transport_rail: null }]);
  });

  test("n'écrase pas un requested_transport_rail déjà présent sur l'item", () => {
    localStorage.setItem('kmrc_cart_v', '3');
    localStorage.setItem('kmrc_cart', JSON.stringify([
      { id: 'p-y', qty: 1, delivery_mode: 'air', requested_transport_rail: 'SEA_STANDARD' },
    ]));

    const { state } = require('../../js/b-store.js');

    expect(state.cart[0].requested_transport_rail).toBe('SEA_STANDARD');
    expect(state.cart[0].delivery_mode).toBeUndefined();
  });

  test('items sans delivery_mode (paniers déjà migrés) restent inchangés', () => {
    localStorage.setItem('kmrc_cart_v', '3');
    localStorage.setItem('kmrc_cart', JSON.stringify([
      { id: 'p-z', qty: 2, requested_transport_rail: 'AIR_EXPRESS' },
    ]));

    const { state } = require('../../js/b-store.js');

    expect(state.cart).toEqual([{ id: 'p-z', qty: 2, requested_transport_rail: 'AIR_EXPRESS' }]);
  });
});

describe('b-store — getRequestedTransportRail (helper partagé CTA)', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    sessionStorage.clear();
  });

  test('null par défaut : aucun choix explicite au chargement', () => {
    const { state, getRequestedTransportRail } = require('../../js/b-store.js');
    expect(state.modalDeliverySelection).toEqual({ requested_transport_rail: null });
    expect(getRequestedTransportRail()).toBeNull();
  });

  test('reflète state.modalDeliverySelection.requested_transport_rail après un choix', () => {
    const { state, getRequestedTransportRail } = require('../../js/b-store.js');
    state.modalDeliverySelection = { requested_transport_rail: 'AIR_EXPRESS' };
    expect(getRequestedTransportRail()).toBe('AIR_EXPRESS');
  });

  test('modalDeliverySelection absent/malformé → null, ne jette pas', () => {
    const { state, getRequestedTransportRail } = require('../../js/b-store.js');
    state.modalDeliverySelection = null;
    expect(getRequestedTransportRail()).toBeNull();
  });
});
