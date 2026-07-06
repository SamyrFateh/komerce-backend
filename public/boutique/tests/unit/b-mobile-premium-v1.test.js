'use strict';

/**
 * tests/unit/b-mobile-premium-v1.test.js
 *
 * js/b-mobile-premium-v1.js — couche premium mobile (accueil + PDP).
 *
 * Périmètre couvert :
 *   - setup pose toujours la classe html.k-mobile-premium-v1 (inconditionnel,
 *     contrairement à b-home-premium-v1.js qui gardait `isDesktop()`)
 *   - guard quantité (#k-qty-minus, capture phase) : bloque la décrémentation
 *     sous 1 sur mobile avec un produit de modale actif ; no-op desktop, no-op
 *     sans modalProduct, no-op hors seuil (qty > 1), no-op hors cible
 *   - bus 'modal:opened' → applyMobilePremium() après deux rAF imbriqués,
 *     seulement sur mobile ; répercute state.cart sur modalQty/qtyVal/addBtn/buyBtn
 *   - guard `_installed` : un seul jeu de listeners même après deux appels
 *
 * `_installed` / `_qtyGuardInstalled` sont des états de module →
 * jest.resetModules() + re-require par test (pattern déjà en place pour
 * b-desktop-global-cart-access.test.js / b-home-premium-v1.test.js).
 */

const { mountFixture, resetState, trackDocumentListeners } = require('./helpers/boutiqueTestKit.js');

function load() {
  jest.doMock('../../js/b-scroll-owner.js', () => ({ isDesktop: jest.fn() }));
  jest.doMock('../../js/b-bus.js', () => ({ bus: { on: jest.fn(), emit: jest.fn() } }));
  jest.doMock('../../js/b-utils.js', () => ({ fmtPrice: jest.fn((v) => `${v} KMF`) }));
  // eslint-disable-next-line global-require
  const { isDesktop } = require('../../js/b-scroll-owner.js');
  // eslint-disable-next-line global-require
  const { bus } = require('../../js/b-bus.js');
  // eslint-disable-next-line global-require
  const { fmtPrice } = require('../../js/b-utils.js');
  // eslint-disable-next-line global-require
  const { state } = require('../../js/b-store.js');
  resetState(state);
  // eslint-disable-next-line global-require
  const { setupMobilePremiumV1 } = require('../../js/b-mobile-premium-v1.js');
  return { isDesktop, bus, fmtPrice, state, setupMobilePremiumV1 };
}

/** Fait tourner deux requestAnimationFrame imbriqués de façon synchrone. */
function mockSyncRaf() {
  window.requestAnimationFrame = (cb) => { cb(); return 0; };
}

describe('b-mobile-premium-v1', () => {
  let restoreDocListeners;

  beforeEach(() => {
    jest.resetModules();
    document.documentElement.className = '';
    mockSyncRaf();
    // installQtyGuard() pose un document.addEventListener('click', ..., true)
    // fermé sur le `state` du module require()-é dans CE test. Sans détacher
    // ce listener en afterEach, il reste actif au test suivant (resetModules()
    // ne recrée qu'un nouveau module, pas le `document` réel) et se déclenche
    // en plus du nouveau sur le même clic, avec un `state.modalQty` figé sur
    // l'ancienne valeur → faux déclenchements de preventDefault().
    restoreDocListeners = trackDocumentListeners();
  });

  afterEach(() => {
    document.documentElement.className = '';
    restoreDocListeners();
  });

  test('setup pose toujours html.k-mobile-premium-v1, mobile comme desktop', () => {
    const { isDesktop, setupMobilePremiumV1 } = load();
    isDesktop.mockReturnValue(true);
    mountFixture('');

    setupMobilePremiumV1();

    expect(document.documentElement.classList.contains('k-mobile-premium-v1')).toBe(true);
  });

  test('appels multiples restent idempotents (guard _installed) : bus.on câblé une seule fois', () => {
    const { isDesktop, bus, setupMobilePremiumV1 } = load();
    isDesktop.mockReturnValue(false);

    setupMobilePremiumV1();
    setupMobilePremiumV1();

    expect(bus.on).toHaveBeenCalledTimes(1);
  });

  describe('guard quantité (#k-qty-minus)', () => {
    test('mobile + modalProduct + qty <= 1 : bloque le clic et force qtyVal à 1', () => {
      const { isDesktop, state, setupMobilePremiumV1 } = load();
      isDesktop.mockReturnValue(false);
      state.modalProduct = { id: 1, price_kmf: 1000 };
      state.modalQty = 1;
      mountFixture('<button id="k-qty-minus"></button><span id="k-qty-val">1</span>');
      setupMobilePremiumV1();

      const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
      const preventSpy = jest.spyOn(evt, 'preventDefault');
      document.getElementById('k-qty-minus').dispatchEvent(evt);

      expect(preventSpy).toHaveBeenCalled();
      expect(state.modalQty).toBe(1);
      expect(document.getElementById('k-qty-val').textContent).toBe('1');
    });

    test('mobile + modalProduct + qty > 1 : laisse passer (pas de preventDefault)', () => {
      const { isDesktop, state, setupMobilePremiumV1 } = load();
      isDesktop.mockReturnValue(false);
      state.modalProduct = { id: 1, price_kmf: 1000 };
      state.modalQty = 3;
      mountFixture('<button id="k-qty-minus"></button><span id="k-qty-val">3</span>');
      setupMobilePremiumV1();

      const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
      const preventSpy = jest.spyOn(evt, 'preventDefault');
      document.getElementById('k-qty-minus').dispatchEvent(evt);

      expect(preventSpy).not.toHaveBeenCalled();
    });

    test('desktop : guard no-op même sous le seuil', () => {
      const { isDesktop, state, setupMobilePremiumV1 } = load();
      isDesktop.mockReturnValue(true);
      state.modalProduct = { id: 1, price_kmf: 1000 };
      state.modalQty = 1;
      mountFixture('<button id="k-qty-minus"></button>');
      setupMobilePremiumV1();

      const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
      const preventSpy = jest.spyOn(evt, 'preventDefault');
      document.getElementById('k-qty-minus').dispatchEvent(evt);

      expect(preventSpy).not.toHaveBeenCalled();
    });

    test('sans state.modalProduct : guard no-op', () => {
      const { isDesktop, state, setupMobilePremiumV1 } = load();
      isDesktop.mockReturnValue(false);
      state.modalProduct = null;
      state.modalQty = 1;
      mountFixture('<button id="k-qty-minus"></button>');
      setupMobilePremiumV1();

      const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
      const preventSpy = jest.spyOn(evt, 'preventDefault');
      document.getElementById('k-qty-minus').dispatchEvent(evt);

      expect(preventSpy).not.toHaveBeenCalled();
    });

    test('clic hors #k-qty-minus : aucun effet', () => {
      const { isDesktop, state, setupMobilePremiumV1 } = load();
      isDesktop.mockReturnValue(false);
      state.modalProduct = { id: 1 };
      state.modalQty = 1;
      mountFixture('<div id="somewhere-else"></div>');
      setupMobilePremiumV1();

      expect(() => {
        document.getElementById('somewhere-else').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }).not.toThrow();
    });
  });

  describe("bus 'modal:opened' → applyMobilePremium", () => {
    test('mobile : synchronise modalQty/qtyVal/buyBtn depuis state.cart après deux rAF', () => {
      const { isDesktop, bus, state, setupMobilePremiumV1 } = load();
      isDesktop.mockReturnValue(false);
      state.modalProduct = { id: 42, price_kmf: 500 };
      state.cart = [{ product: { id: 42 }, qty: 3 }];
      mountFixture(`
        <span id="k-qty-val">1</span>
        <button id="k-add-cart-btn"></button>
        <button id="k-buy-now-btn"></button>
      `);
      setupMobilePremiumV1();

      const modalOpenedHandler = bus.on.mock.calls.find((c) => c[0] === 'modal:opened')[1];
      modalOpenedHandler();

      expect(state.modalQty).toBe(3);
      expect(document.getElementById('k-qty-val').textContent).toBe('3');
      expect(document.getElementById('k-buy-now-btn').getAttribute('aria-label')).toBe('Acheter maintenant — 1500 KMF');
    });

    test('desktop : le handler modal:opened ne synchronise rien', () => {
      const { isDesktop, bus, state, setupMobilePremiumV1 } = load();
      isDesktop.mockReturnValue(true);
      state.modalProduct = { id: 42, price_kmf: 500 };
      state.cart = [{ product: { id: 42 }, qty: 3 }];
      mountFixture('<span id="k-qty-val">1</span>');
      setupMobilePremiumV1();

      const modalOpenedHandler = bus.on.mock.calls.find((c) => c[0] === 'modal:opened')[1];
      modalOpenedHandler();

      expect(document.getElementById('k-qty-val').textContent).toBe('1');
    });

    test('produit absent du panier : qty retombe à 1 et le bouton ajouter est reconstruit', () => {
      const { isDesktop, bus, state, setupMobilePremiumV1 } = load();
      isDesktop.mockReturnValue(false);
      state.modalProduct = { id: 99 };
      state.cart = [];
      mountFixture(`
        <span id="k-qty-val">5</span>
        <button id="k-add-cart-btn" class="in-cart">déjà ajouté</button>
      `);
      setupMobilePremiumV1();

      const modalOpenedHandler = bus.on.mock.calls.find((c) => c[0] === 'modal:opened')[1];
      modalOpenedHandler();

      expect(state.modalQty).toBe(1);
      expect(document.getElementById('k-qty-val').textContent).toBe('1');
      const addBtn = document.getElementById('k-add-cart-btn');
      expect(addBtn.classList.contains('in-cart')).toBe(false);
      expect(addBtn.textContent).toContain('Ajouter au panier');
    });
  });
});
