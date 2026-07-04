'use strict';

/**
 * tests/unit/b-modal-core.test.js
 *
 * Module #2 (suite) du plan d'attaque frontend — js/b-modal-core.js (1409L), 0%.
 *
 * Périmètre couvert : le cycle de vie de la modal produit —
 *   - openModal  (état modalProduct/modalQty, textes DOM, promo, stock,
 *     historique modal (push/skip), historique navigateur (pushState une
 *     seule fois), viewedHistory dédupliqué + plafonné à 30, bus modal:opened)
 *   - closeModal (unlock scroll/body, history.back() conditionnel, bus
 *     modal:closed, reset modalProduct/modalHistory)
 *   - modalGoBack (pile vide → closeModal ; pile non vide → pop + reopen
 *     avec pushHistory=false)
 *
 * Dette assumée, hors périmètre de ce lot (même logique que renderCheckout
 * pour b-checkout.js) : `setupModal()` (~700L — câblage exhaustif de tous
 * les listeners DOM du modal : recherche inline, topbar, clavier, swipe,
 * image-zone desktop/touch, fullscreen) et la nuance fine anti-rebond
 * popstate/history (`_closingFromPopstate`, `_pendingHistoryBack`), mieux
 * couverte par un test e2e réel (navigation navigateur) qu'en unitaire.
 *
 * state/dom viennent du vrai b-store.js. Tous les sous-modules périphériques
 * (utils, cart-core, cart, schema, scroll, image-ux, social-proof,
 * modal-product, modal-suggestions, modal-nav, modal-cart) sont mockés.
 */

jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((s) => s),
  fmt: jest.fn((n) => String(n) + ' KMF'),
  fmtPrice: jest.fn((n) => String(n) + ' KMF'),
  optimizeImgUrl: jest.fn((url) => url),
  renderProductCarousel: jest.fn(),
  bindCarouselDots: jest.fn(),
}));

jest.mock('../../js/b-cart-core.js', () => ({
  showToast: jest.fn(),
  updateCartBadge: jest.fn(),
  saveCart: jest.fn(),
  cartQty: jest.fn(() => 0),
}));

jest.mock('../../js/b-cart.js', () => ({
  addToCart: jest.fn(),
  quickAdd: jest.fn(),
  quickRemove: jest.fn(),
  toggleFav: jest.fn(),
  setQty: jest.fn(),
  openCart: jest.fn(),
  closeCart: jest.fn(),
  markAllCartButtons: jest.fn(),
}));

jest.mock('../../js/shop-schema.js', () => ({
  normalizeCategoryKey: jest.fn((k) => k),
  getCategorySectionEmoji: jest.fn(() => '📦'),
}));

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(() => false),
  getScrollY: jest.fn(() => 0),
  scrollToPosition: jest.fn(),
}));

jest.mock('../../js/b-modal-image-ux.js', () => ({
  setupImageUX: jest.fn(),
}));

jest.mock('../../js/b-modal-social-proof.js', () => ({
  setupSocialProof: jest.fn(),
}));

jest.mock('../../js/b-modal-product.js', () => ({
  buildCarouselSlides: jest.fn(),
  goToSlide: jest.fn(),
  openSizeGuide: jest.fn(),
  closeSizeGuide: jest.fn(),
  _renderVariants: jest.fn(),
  _syncScrollPadding: jest.fn(),
  _injectMobileDelivery: jest.fn(),
  _injectMobileTrust: jest.fn(),
  setupModalFAB: jest.fn(),
  hideModalFAB: jest.fn(),
}));

jest.mock('../../js/b-modal-suggestions.js', () => ({
  renderSuggestions: jest.fn(),
}));

jest.mock('../../js/b-modal-nav.js', () => ({
  updateModalNavArrows: jest.fn(),
  navigateModal: jest.fn(),
}));

jest.mock('../../js/b-modal-cart.js', () => ({
  _syncModalQtyUI: jest.fn(),
  setupModalCart: jest.fn(),
}));

const { state, dom } = require('../../js/b-store.js');
const { bus } = require('../../js/b-bus.js');
const { updateCartBadge } = require('../../js/b-cart-core.js');
const { buildCarouselSlides, hideModalFAB, setupModalFAB, _syncScrollPadding } =
  require('../../js/b-modal-product.js');
const { renderSuggestions } = require('../../js/b-modal-suggestions.js');
const { updateModalNavArrows } = require('../../js/b-modal-nav.js');
const { _syncModalQtyUI } = require('../../js/b-modal-cart.js');
const { getScrollY, scrollToPosition } = require('../../js/b-scroll-owner.js');

const { openModal, closeModal, modalGoBack } = require('../../js/b-modal-core.js');

function makeProduct(overrides) {
  return Object.assign({
    id: 1,
    name: 'Riz basmati 5kg',
    description: 'Sac de riz importé',
    price_kmf: 5000,
    category: 'Alimentation',
    emoji: '🍚',
    stock: 20,
  }, overrides);
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function resetDom() {
  document.body.innerHTML = '';
  dom.modalOverlay = document.createElement('div');
  dom.modalName = document.createElement('div');
  dom.modalDesc = document.createElement('div');
  dom.modalPrice = document.createElement('div');
  dom.modalQtyVal = document.createElement('div');
  dom.modalOldPrice = document.createElement('div');
  dom.modalPromoBadge = document.createElement('div');
  dom.modalCat = document.createElement('div');
  dom.modalStock = document.createElement('div');
  dom.modalBackLabel = document.createElement('div');
  dom.modal = document.createElement('div');
  dom.modalVariants = document.createElement('div');
  dom.modalDetails = document.createElement('div');
  dom.addCartBtn = document.createElement('button');
  dom.pageScroll = document.createElement('div');
}

describe('b-modal-core', () => {
  let pushStateSpy;
  let backSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    resetDom();
    state.products = [makeProduct()];
    state.filtered = [];
    state.cart = [];
    state.favs = [];
    state.viewedHistory = [];
    state.modalHistory = [];
    state.modalProduct = null;
    state.modalQty = 1;
    state.modalOpen = false;
    state._savedCatalogScrollY = 0;
    state._savedPagerInlineStyles = null;
    state._savedGridScrollLeft = null;
    state._modalSearchInput = null;
    localStorage.clear();

    // Neutralise la vraie navigation navigateur (pushState/back) pendant les tests
    pushStateSpy = jest.spyOn(window.history, 'pushState').mockImplementation(() => {});
    backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {});

    // Réponse par défaut de fetch (suggestions) → payload sans .suggestions
    // → déclenche systématiquement le fallback éditorial local, déterministe.
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  });

  afterEach(() => {
    pushStateSpy.mockRestore();
    backSpy.mockRestore();
  });

  describe('openModal', () => {
    it('pousse un history.pushState au premier appel (overlay pas encore ouvert)', () => {
      openModal(1);
      expect(pushStateSpy).toHaveBeenCalledWith({ kModal: true }, '');
    });

    it('produit introuvable → ne fait rien, ne throw pas', () => {
      expect(() => openModal(999)).not.toThrow();
      expect(state.modalProduct).toBeNull();
    });

    it('ouvre la modal : state.modalProduct posé, textes DOM remplis, overlay + body ouverts', async () => {
      openModal(1);
      await Promise.resolve(); // laisse le .then/.catch de fetch se résoudre

      expect(state.modalProduct.id).toBe(1);
      expect(dom.modalName.textContent).toBe('Riz basmati 5kg');
      expect(dom.modalDesc.textContent).toBe('Sac de riz importé');
      expect(dom.modalPrice.textContent).toBe('5000 KMF');
      expect(dom.modalOverlay.classList.contains('open')).toBe(true);
      expect(document.body.classList.contains('modal-open')).toBe(true);
      expect(state.modalOpen).toBe(true);
      expect(updateCartBadge).toHaveBeenCalled();
      expect(buildCarouselSlides).toHaveBeenCalledWith(state.products[0]);
      expect(_syncModalQtyUI).toHaveBeenCalled();
      expect(setupModalFAB).toHaveBeenCalled();
    });

    it('produit absent du panier → modalQty par défaut = 1', () => {
      state.cart = [];
      openModal(1);
      expect(state.modalQty).toBe(1);
      expect(dom.modalQtyVal.textContent).toBe('1');
    });

    it('produit déjà dans le panier avec qty 4 → modalQty reflète le panier', () => {
      state.cart = [{ product: { id: 1 }, qty: 4 }];
      openModal(1);
      expect(state.modalQty).toBe(4);
      expect(dom.modalQtyVal.textContent).toBe('4');
    });

    it('avec promo_pct → prix barré affiché + badge visible + classe promo sur .modal', () => {
      state.products = [makeProduct({ promo_pct: 20, price_kmf: 4000 })];
      openModal(1);
      expect(dom.modalOldPrice.classList.contains('u-hidden')).toBe(false);
      expect(dom.modalPromoBadge.classList.contains('show')).toBe(true);
      expect(dom.modalPromoBadge.textContent).toBe('-20%');
      expect(dom.modal.classList.contains('k-modal--has-promo')).toBe(true);
    });

    it('sans promo → prix barré masqué, badge caché, pas de classe promo', () => {
      state.products = [makeProduct({ promo_pct: null })];
      openModal(1);
      expect(dom.modalOldPrice.classList.contains('u-hidden')).toBe(true);
      expect(dom.modalPromoBadge.classList.contains('show')).toBe(false);
      expect(dom.modal.classList.contains('k-modal--has-promo')).toBe(false);
    });

    it.each([
      [0,  'Rupture',      'k-modal-stock k-modal-stock--out'],
      [5,  'Plus que 5',   'k-modal-stock k-modal-stock--low'],
      [50, 'Disponible',   'k-modal-stock k-modal-stock--ok'],
    ])('stock=%i → texte contient "%s" et classe "%s"', (stock, expectedText, expectedClass) => {
      state.products = [makeProduct({ stock })];
      openModal(1);
      expect(dom.modalStock.textContent).toContain(expectedText);
      expect(dom.modalStock.className).toBe(expectedClass);
    });

    it('pushHistory !== false (défaut) et un produit déjà ouvert → empile l\'ancien id dans modalHistory', () => {
      state.modalProduct = { id: 42 };
      state.products = [makeProduct({ id: 1 }), makeProduct({ id: 42 })];
      openModal(1);
      expect(state.modalHistory).toContain(42);
    });

    it('pushHistory = false → ne modifie pas modalHistory (cas modalGoBack)', () => {
      state.modalProduct = { id: 42 };
      state.products = [makeProduct({ id: 1 }), makeProduct({ id: 42 })];
      openModal(1, false);
      expect(state.modalHistory).toHaveLength(0);
    });

    it('dédoublonne l\'id courant dans viewedHistory et le pousse en fin de liste', () => {
      state.viewedHistory = [1, 2, 3];
      openModal(1);
      expect(state.viewedHistory).toEqual([2, 3, 1]);
    });

    it('plafonne viewedHistory à 30 entrées (garde les plus récentes)', () => {
      state.viewedHistory = Array.from({ length: 30 }, (_, i) => i + 100);
      openModal(1);
      expect(state.viewedHistory).toHaveLength(30);
      expect(state.viewedHistory[state.viewedHistory.length - 1]).toBe(1);
    });

    it('émet bus "modal:opened" avec le produit', () => {
      const spy = jest.spyOn(bus, 'emit');
      openModal(1);
      expect(spy).toHaveBeenCalledWith('modal:opened', state.products[0]);
      spy.mockRestore();
    });

    it('appelle updateModalNavArrows avec la liste filtrée si présente, sinon products', () => {
      state.filtered = [makeProduct({ id: 1 })];
      openModal(1);
      expect(updateModalNavArrows).toHaveBeenCalledWith(state.filtered, 0);
    });

    it('modal déjà ouverte → ne repousse pas d\'entrée history au ré-appel', () => {
      dom.modalOverlay.classList.add('open');
      openModal(1);
      expect(pushStateSpy).not.toHaveBeenCalled();
    });

    it('fallback suggestions (API vide) : renderSuggestions appelé avec les produits locaux', async () => {
      state.products = [
        makeProduct({ id: 1, category: 'Alimentation' }),
        makeProduct({ id: 2, category: 'Alimentation' }),
        makeProduct({ id: 3, category: 'Mode' }),
      ];
      openModal(1);
      await flushPromises();
      expect(renderSuggestions).toHaveBeenCalled();
      const [sameCat, otherCat, cat] = renderSuggestions.mock.calls[0];
      expect(cat).toBe('Alimentation');
      expect(sameCat.some(p => p.id === 2)).toBe(true);
      expect(otherCat.some(p => p.id === 3)).toBe(true);
    });
  });

  describe('closeModal', () => {
    beforeEach(() => {
      // Simule une modal déjà ouverte
      dom.modalOverlay.classList.add('open');
      document.body.classList.add('modal-open', 'modal-has-cart');
      state.modalProduct = makeProduct();
      state.modalHistory = [1, 2];
      state.modalOpen = true;
      state._savedCatalogScrollY = 321;
    });

    it('ferme l\'overlay et déverrouille le body', () => {
      closeModal();
      expect(dom.modalOverlay.classList.contains('open')).toBe(false);
      expect(document.body.classList.contains('modal-open')).toBe(false);
      expect(document.body.classList.contains('modal-has-cart')).toBe(false);
    });

    it('restaure le scroll catalogue sauvegardé', () => {
      closeModal();
      expect(scrollToPosition).toHaveBeenCalledWith(321);
    });

    it('reset modalProduct, modalHistory et modalOpen', () => {
      closeModal();
      expect(state.modalProduct).toBeNull();
      expect(state.modalHistory).toHaveLength(0);
      expect(state.modalOpen).toBe(false);
    });

    it('appelle hideModalFAB et émet bus "modal:closed"', () => {
      const spy = jest.spyOn(bus, 'emit');
      closeModal();
      expect(hideModalFAB).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith('modal:closed');
      spy.mockRestore();
    });
  });

  describe('modalGoBack', () => {
    it('historique modal vide → ferme simplement la modal', () => {
      state.modalHistory = [];
      dom.modalOverlay.classList.add('open');
      state.modalProduct = makeProduct();
      modalGoBack();
      expect(dom.modalOverlay.classList.contains('open')).toBe(false);
    });

    it('historique non vide → dépile le dernier id et rouvre ce produit sans repousser l\'historique', () => {
      state.products = [makeProduct({ id: 1 }), makeProduct({ id: 7 })];
      state.modalHistory = [7];
      state.modalProduct = makeProduct({ id: 1 });
      modalGoBack();
      expect(state.modalProduct.id).toBe(7);
      expect(state.modalHistory).toHaveLength(0);
    });
  });
});
