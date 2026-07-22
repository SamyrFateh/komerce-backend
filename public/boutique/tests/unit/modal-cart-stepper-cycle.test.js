'use strict';

/**
 * tests/unit/modal-cart-stepper-cycle.test.js
 *
 * Oracle §6.3 — cycle bouton panier ↔ stepper (règle F).
 *
 * b-modal-cart.test.js mocke b-cart.js (unitaire, vérifie juste que
 * quickRemove est appelé). Ce test-ci fait l'inverse : il utilise le VRAI
 * b-cart.js pour vérifier le comportement bout en bout demandé par la
 * règle F : qté 1 → clic sur "−" → quickRemove → removeFromCart réellement
 * exécuté (state.cart vidé) → _syncModalQtyUI fait réapparaître le bouton
 * "Ajouter au panier" (classe in-cart retirée). Un seul contrôle visible
 * à la fois — jamais stepper ET bouton en même temps.
 */

jest.mock('../../js/b-catalog.js', () => ({ scrollToCategorySection: jest.fn() }));

jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((s) => s),
  fmt: jest.fn((n) => String(n) + ' KMF'),
  fmtPrice: jest.fn((n) => String(n)),
  optimizeImgUrl: jest.fn((url) => url),
  productEmoji: jest.fn(() => '📦'),
  _currency: 'KMF',
  apiGet: jest.fn(),
  apiPost: jest.fn(),
}));

jest.mock('../../js/b-cart-core.js', () => ({
  showToast: jest.fn(),
  updateCartBadge: jest.fn(),
  saveCart: jest.fn(),
  cartQty: jest.fn(() => 0),
  cartTotal: jest.fn(() => 0),
  saveFavs: jest.fn(),
}));

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(() => false),
  getScrollY: jest.fn(() => 0),
  scrollToPosition: jest.fn(),
}));

jest.mock('../../js/shop-schema.js', () => ({
  getCategoryIcon: jest.fn(),
  normalizeCategoryKey: jest.fn((k) => k),
}));

const { state, dom, scroll } = require('../../js/b-store.js');
const { _syncModalQtyUI, setupModalCart } = require('../../js/b-modal-cart.js');

function resetDom() {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = jest.fn();
  }
  document.body.innerHTML = '';
  dom.cartBody = document.createElement('div');
  dom.cartFooter = document.createElement('div');
  dom.cartHeaderTitle = document.createElement('div');
  dom.cartHeader = document.createElement('div');
  dom.cartOverlay = document.createElement('div');
  dom.cartDrawer = document.createElement('div');
  dom.cartTotalVal = document.createElement('div');
  dom.cartTotalConv = document.createElement('div');
  dom.cartBtn = document.createElement('button');

  dom.modalQtyVal = document.createElement('span');
  dom.addCartBtn = document.createElement('button');
  dom.qtyMinus = document.createElement('button');
  dom.qtyPlus = document.createElement('button');
}

describe('Cycle bouton panier ↔ stepper — bout en bout (règle F, oracle §6.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDom();
    state.cart = [];
    state.favs = [];
    state.products = [];
    state.modalProduct = null;
    state.modalQty = 0;
    setupModalCart();
  });

  test('qté 1 dans le panier → clic "−" → removeFromCart réellement exécuté, panier vidé', () => {
    const product = { id: 77, name: 'Sac tressé raphia', price_kmf: 18500, image_url: '' };
    state.modalProduct = product;
    state.cart = [{ id: 77, product, qty: 1 }];
    _syncModalQtyUI();

    // État initial : stepper visible (bouton en mode "in-cart").
    expect(dom.addCartBtn.classList.contains('in-cart')).toBe(true);
    expect(dom.addCartBtn.innerHTML).toContain('Dans le panier (1)');

    dom.qtyMinus.dispatchEvent(new window.Event('click'));

    // removeFromCart a réellement tourné (pas mocké) : le panier est vidé.
    expect(state.cart).toHaveLength(0);

    // _syncModalQtyUI (appelé après quickRemove dans le listener) fait
    // réapparaître le bouton "Ajouter au panier" — un seul contrôle affiché.
    expect(dom.addCartBtn.classList.contains('in-cart')).toBe(false);
    expect(dom.addCartBtn.innerHTML).toContain('Ajouter au panier');
    expect(dom.modalQtyVal.textContent).toBe('1'); // qty par défaut hors panier, jamais 0 fantôme
  });

  test('qté 3 dans le panier → clic "−" une fois → décrément simple, PAS de removeFromCart (encore dans le panier)', () => {
    const product = { id: 88, name: 'Chapeau raphia', price_kmf: 9000, image_url: '' };
    state.modalProduct = product;
    state.cart = [{ id: 88, product, qty: 3 }];
    _syncModalQtyUI();

    dom.qtyMinus.dispatchEvent(new window.Event('click'));

    expect(state.cart).toHaveLength(1);
    expect(state.cart[0].qty).toBe(2);
    expect(dom.addCartBtn.classList.contains('in-cart')).toBe(true);
    expect(dom.addCartBtn.innerHTML).toContain('Dans le panier (2)');
  });

  test('qté 0 (produit jamais ajouté) → clic "+" → addToCart réellement exécuté, produit ajouté au panier', () => {
    const product = { id: 99, name: 'Bracelet coquillage', price_kmf: 3000, image_url: '' };
    state.modalProduct = product;
    state.products = [product];
    state.cart = [];
    _syncModalQtyUI();

    expect(dom.addCartBtn.classList.contains('in-cart')).toBe(false);

    dom.qtyPlus.dispatchEvent(new window.Event('click'));

    expect(state.cart).toHaveLength(1);
    expect(state.cart[0].product.id).toBe(99);
    expect(dom.addCartBtn.classList.contains('in-cart')).toBe(true);
  });
});
