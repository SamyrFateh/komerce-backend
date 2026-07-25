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
  _syncScrollPadding: jest.fn(),
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
  resetAddCartButtonState: jest.fn(),
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

const { openModal, closeModal, modalGoBack, setupImageZoneTouch } = require('../../js/b-modal-core.js');
const { goToSlide } = require('../../js/b-modal-product.js');

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
  dom.modalCarouselTrack = document.createElement('div');
  const imgWrap = document.createElement('div');
  imgWrap.className = 'k-modal-img-wrap';
  dom.modal.appendChild(imgWrap);
}

/** Fabrique un événement tactile minimal (jsdom n'a pas TouchEvent natif). */
function touchEvent(type, x, y) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  e.touches = [{ clientX: x, clientY: y }];
  e.changedTouches = [{ clientX: x, clientY: y }];
  return e;
}

/** Événement tactile multi-doigts (pinch), pour vérifier la non-interception. */
function multiTouchEvent(type, points) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  e.touches = points.map(p => ({ clientX: p.x, clientY: p.y }));
  e.changedTouches = e.touches;
  return e;
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
      expect(dom.modalCat.textContent).toBe('🍚 Alimentation');
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

    it('avec promo_pct → badge visible + classe promo sur .modal, mais prix barré JAMAIS reconstruit ici', () => {
      // PDC-6 : oldPrice ne vient plus que du contrat détail (pricing.old_price_kmf),
      // rendu par le renderer PDC. Le paint immédiat de b-modal-core.js ne le
      // reconstruit plus depuis promo_pct et le laisse donc toujours masqué.
      state.products = [makeProduct({ promo_pct: 20, price_kmf: 4000 })];
      openModal(1);
      expect(dom.modalOldPrice.classList.contains('u-hidden')).toBe(true);
      expect(dom.modalOldPrice.textContent).toBe('');
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

    it.each([0, 5, 50])(
      'stock=%i sur le produit liste → n\'a plus aucune influence sur #k-modal-stock (vidé par hygiène)',
      (stock) => {
        // PDC-6 : plus aucune interprétation de product.stock dans le chemin
        // modal. La disponibilité est désormais rendue exclusivement par le
        // renderer PDC (renderStock), à partir du contrat détail.
        state.products = [makeProduct({ stock })];
        openModal(1);
        expect(dom.modalStock.textContent).toBe('');
        expect(dom.modalStock.className).toBe('k-modal-stock');
      }
    );

    it('PDC-6 : b-modal-core.js ne référence structurellement plus product.stock / product.stock_qty', () => {
      const fs = require('fs');
      const path = require('path');
      const source = fs.readFileSync(
        path.join(__dirname, '../../js/b-modal-core.js'),
        'utf8'
      );
      expect(source).not.toMatch(/product\.stock_qty/);
      expect(source).not.toMatch(/product\.stock\b/);
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

  // ── Zone tactile mobile : swipe carousel, pull-to-close, tap→fullscreen ──
  // Jamais testée (ni unitaire ni e2e — le spec Playwright ne couvre que
  // Escape). setupImageZoneTouch est exporté publiquement par la façade ;
  // openImageFullscreen ne l'est pas mais est atteint via la branche tap.
  describe('setupImageZoneTouch', () => {
    let imgWrap, track, modalEl;

    beforeEach(() => {
      setupImageZoneTouch();
      imgWrap = dom.modal.querySelector('.k-modal-img-wrap');
      track = dom.modalCarouselTrack;
      modalEl = dom.modal;
      Object.defineProperty(imgWrap, 'offsetWidth', { value: 300, configurable: true });
      state.carouselIndex = 0;
      state.carouselCount = 3;
    });

    it('verrouille la direction horizontale au-delà de 8px et translate le track en %', () => {
      imgWrap.dispatchEvent(touchEvent('touchstart', 200, 100));
      imgWrap.dispatchEvent(touchEvent('touchmove', 160, 100)); // dx=-40
      expect(track.style.transition).toBe('none');
      expect(track.style.transform).toBe('translateX(-13.333333333333334%)');
    });

    it('swipe horizontal gauche > 40px + relâchement → goToSlide(index+1)', () => {
      imgWrap.dispatchEvent(touchEvent('touchstart', 200, 100));
      imgWrap.dispatchEvent(touchEvent('touchmove', 100, 100)); // dx=-100
      imgWrap.dispatchEvent(touchEvent('touchend', 100, 100));
      expect(goToSlide).toHaveBeenCalledWith(1);
    });

    it('swipe horizontal droite > 40px + relâchement (index>0) → goToSlide(index-1)', () => {
      state.carouselIndex = 1;
      imgWrap.dispatchEvent(touchEvent('touchstart', 100, 100));
      imgWrap.dispatchEvent(touchEvent('touchmove', 200, 100)); // dx=+100
      imgWrap.dispatchEvent(touchEvent('touchend', 200, 100));
      expect(goToSlide).toHaveBeenCalledWith(0);
    });

    it('swipe horizontal < 40px + relâchement → snap back sur l\'index courant', () => {
      imgWrap.dispatchEvent(touchEvent('touchstart', 100, 100));
      imgWrap.dispatchEvent(touchEvent('touchmove', 90, 100)); // dx=-10, direction lock (>8px)
      imgWrap.dispatchEvent(touchEvent('touchend', 90, 100));
      expect(goToSlide).toHaveBeenCalledWith(0);
    });

    it('une seule image (carouselCount ≤ 1) → aucun swipe horizontal appliqué', () => {
      state.carouselCount = 1;
      imgWrap.dispatchEvent(touchEvent('touchstart', 200, 100));
      imgWrap.dispatchEvent(touchEvent('touchmove', 100, 100));
      imgWrap.dispatchEvent(touchEvent('touchend', 100, 100));
      expect(goToSlide).not.toHaveBeenCalled();
      expect(track.style.transform).toBe('');
    });

    it('swipe vertical vers le bas déplace la modal (translateY + opacity réduite)', () => {
      imgWrap.dispatchEvent(touchEvent('touchstart', 100, 100));
      imgWrap.dispatchEvent(touchEvent('touchmove', 100, 130)); // dy=+30
      expect(modalEl.style.transform).toBe('translateY(12px)');
      expect(modalEl.style.opacity).toBe('0.94');
    });

    it('swipe vertical > 100px + relâchement → ferme la modal après l\'anim (260ms)', () => {
      jest.useFakeTimers();
      imgWrap.dispatchEvent(touchEvent('touchstart', 100, 100));
      imgWrap.dispatchEvent(touchEvent('touchmove', 100, 250)); // dy=150
      imgWrap.dispatchEvent(touchEvent('touchend', 100, 250));
      expect(modalEl.style.transform).toBe('translateY(100%)');
      jest.advanceTimersByTime(260);
      expect(dom.modalOverlay.classList.contains('open')).toBe(false);
      jest.useRealTimers();
    });

    it('swipe vertical < 100px + relâchement → revient à sa place, ne ferme pas', () => {
      imgWrap.dispatchEvent(touchEvent('touchstart', 100, 100));
      imgWrap.dispatchEvent(touchEvent('touchmove', 100, 130)); // dy=30
      imgWrap.dispatchEvent(touchEvent('touchend', 100, 130));
      expect(modalEl.style.transform).toBe('');
    });

    it('tap court sans mouvement significatif → ouvre l\'image en plein écran', () => {
      state.modalProduct = makeProduct({ images: ['a.jpg', 'b.jpg'] });
      imgWrap.dispatchEvent(touchEvent('touchstart', 100, 100));
      imgWrap.dispatchEvent(touchEvent('touchend', 100, 100));
      expect(document.getElementById('k-modal-fullscreen')).not.toBeNull();
    });

    it.each([
      'k-modal-back-overlay',
      'k-modal-cart-overlay',
      'k-modal-close-overlay',
    ])('un tap sur %s ne déclenche pas le fullscreen image', (className) => {
      state.modalProduct = makeProduct({ images: ['a.jpg', 'b.jpg'] });

      const control = document.createElement('button');
      control.className = className;
      control.innerHTML = '<svg><path></path></svg>';
      imgWrap.appendChild(control);

      const nestedTarget = control.querySelector('path');
      nestedTarget.dispatchEvent(touchEvent('touchstart', 100, 100));
      nestedTarget.dispatchEvent(touchEvent('touchend', 100, 100));

      expect(document.getElementById('k-modal-fullscreen')).toBeNull();
      expect(goToSlide).not.toHaveBeenCalled();
    });

    it('touchend sans touchstart préalable (isDragging=false) → ne fait rien, ne throw pas', () => {
      expect(() => imgWrap.dispatchEvent(touchEvent('touchend', 100, 100))).not.toThrow();
      expect(goToSlide).not.toHaveBeenCalled();
    });
  });

  describe('openImageFullscreen (atteint via le tap de setupImageZoneTouch)', () => {
    let imgWrap;

    beforeEach(() => {
      jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(); return 1; });
      setupImageZoneTouch();
      imgWrap = dom.modal.querySelector('.k-modal-img-wrap');
      Object.defineProperty(imgWrap, 'offsetWidth', { value: 300, configurable: true });
      state.modalProduct = makeProduct({ images: ['a.jpg', 'b.jpg', 'c.jpg'] });
      state.carouselIndex = 1;
      imgWrap.dispatchEvent(touchEvent('touchstart', 100, 100));
      imgWrap.dispatchEvent(touchEvent('touchend', 100, 100));
    });

    it('produit sans image (images vides et pas d\'image_url) → n\'ouvre aucun overlay', () => {
      document.getElementById('k-modal-fullscreen').remove();
      state.modalProduct = makeProduct({ images: [], image_url: null });
      imgWrap.dispatchEvent(touchEvent('touchstart', 100, 100));
      imgWrap.dispatchEvent(touchEvent('touchend', 100, 100));
      expect(document.getElementById('k-modal-fullscreen')).toBeNull();
    });

    it('crée l\'overlay avec une slide par image, une par image', () => {
      const overlay = document.getElementById('k-modal-fullscreen');
      expect(overlay).not.toBeNull();
      expect(overlay.querySelectorAll('.k-modal-fullscreen-slide')).toHaveLength(3);
    });

    it('démarre sur l\'image courante (carouselIndex) et affiche le compteur "2 / 3"', () => {
      const counter = document.querySelector('#k-modal-fullscreen .k-modal-fullscreen-counter');
      expect(counter.textContent).toBe('2 / 3');
    });

    it('un seul appel réutilise/replace un overlay déjà ouvert (pas de doublon)', () => {
      state.carouselIndex = 0;
      imgWrap.dispatchEvent(touchEvent('touchstart', 100, 100));
      imgWrap.dispatchEvent(touchEvent('touchend', 100, 100));
      expect(document.querySelectorAll('#k-modal-fullscreen').length).toBe(1);
    });

    it('le bouton fermer retire l\'overlay après l\'anim (200ms)', () => {
      jest.useFakeTimers();
      document.querySelector('.k-modal-fullscreen-close')
        .dispatchEvent(new Event('click', { bubbles: true }));
      jest.advanceTimersByTime(200);
      expect(document.getElementById('k-modal-fullscreen')).toBeNull();
      jest.useRealTimers();
    });

    it('swipe horizontal > 50px sur le track fullscreen change de slide sans fermer', () => {
      const track = document.querySelector('#k-modal-fullscreen .k-modal-fullscreen-track');
      track.dispatchEvent(touchEvent('touchstart', 200, 100));
      track.dispatchEvent(touchEvent('touchmove', 100, 100)); // dx=-100 → fsMoved=true
      track.dispatchEvent(touchEvent('touchend', 100, 100));
      const counter = document.querySelector('#k-modal-fullscreen .k-modal-fullscreen-counter');
      expect(counter.textContent).toBe('3 / 3');
      expect(document.getElementById('k-modal-fullscreen')).not.toBeNull();
    });

    it('tap simple sur le track (sans mouvement) ferme après l\'anim (200ms)', () => {
      jest.useFakeTimers();
      const track = document.querySelector('#k-modal-fullscreen .k-modal-fullscreen-track');
      track.dispatchEvent(touchEvent('touchstart', 100, 100));
      track.dispatchEvent(touchEvent('touchend', 100, 100));
      jest.advanceTimersByTime(200);
      expect(document.getElementById('k-modal-fullscreen')).toBeNull();
      jest.useRealTimers();
    });

    it('multi-touch (pinch, 2 doigts) sur le track fullscreen n\'intercepte rien et ne throw pas', () => {
      const track = document.querySelector('#k-modal-fullscreen .k-modal-fullscreen-track');
      expect(() => {
        track.dispatchEvent(multiTouchEvent('touchstart', [{ x: 100, y: 100 }, { x: 200, y: 100 }]));
        track.dispatchEvent(multiTouchEvent('touchend', [{ x: 100, y: 100 }, { x: 200, y: 100 }]));
      }).not.toThrow();
      expect(document.getElementById('k-modal-fullscreen')).not.toBeNull();
    });
  });
});
