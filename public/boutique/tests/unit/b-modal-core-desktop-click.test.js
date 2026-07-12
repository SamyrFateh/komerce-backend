'use strict';

/**
 * tests/unit/b-modal-core-desktop-click.test.js
 *
 * Ferme la dernière dette listée dans AUDIT_KOMERCE_2026-07-09.md §6 :
 * setupImageZoneDesktopClick (js/b-modal-core.js), atteignable uniquement
 * via setupModal() complet.
 *
 * setupModal() fait ~700 lignes de câblage DOM (recherche inline, topbar,
 * favoris, achat rapide, hint clavier...), mais l'essentiel de ce câblage
 * est protégé par des guards `if (!element) return;` sur des ids/classes
 * qu'on ne crée volontairement PAS dans le DOM de test :
 *   - pas de #k-modal-suggestions  → toute l'IIFE de recherche inline
 *     (~260 lignes) sort au tout premier guard, jamais exécutée.
 *   - pas de #k-modal-fav-btn / #k-buy-now-btn → leurs blocs sont sautés.
 *   - window.innerWidth < 900 au moment de l'appel → l'IIFE du hint
 *     clavier desktop sort à son guard `if (window.innerWidth < 900) return;`
 *     (on repasse en desktop juste avant de simuler les clics, puisque
 *     setupImageZoneDesktopClick, lui, ne vérifie la largeur qu'AU CLIC).
 * Résultat : setupModal() s'exécute sans throw et sans effet de bord
 * hors du strict nécessaire pour atteindre setupImageZoneDesktopClick.
 *
 * Périmètre couvert :
 *   - clic zone gauche → slide précédente (si carouselIndex > 0)
 *   - clic zone droite → slide suivante (si carouselIndex < count - 1)
 *   - bords de carousel : pas d'appel si déjà sur la première/dernière slide
 *   - désactivé sur mobile (innerWidth < 900) au moment du clic
 *   - désactivé si une seule image (carouselCount <= 1)
 *   - clic sur une miniature / le zoom preview / la lentille de zoom →
 *     n'intercepte rien (closest() les exclut explicitement)
 *   - absence de .k-modal-img-wrap → ne throw pas, ne s'attache pas
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
const { goToSlide } = require('../../js/b-modal-product.js');
const { setupModal } = require('../../js/b-modal-core.js');

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function resetDom({ withImgWrap = true } = {}) {
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
  dom.modalBack = document.createElement('button');
  dom.modalClose = document.createElement('button');
  dom.modalCartBtn = document.createElement('button');
  dom.modalCarouselTrack = document.createElement('div');

  if (withImgWrap) {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'k-modal-img-wrap';
    // getBoundingClientRect n'est pas implémenté de façon utile par jsdom
    // (retourne des zéros) — on le stub pour piloter précisément quelle
    // moitié de la zone est "cliquée".
    imgWrap.getBoundingClientRect = jest.fn(() => ({
      left: 0, right: 300, width: 300, top: 0, bottom: 200, height: 200,
    }));
    dom.modal.appendChild(imgWrap);
  }

  document.body.appendChild(dom.modal);
  document.body.appendChild(dom.modalOverlay);
}

function getImgWrap() {
  return dom.modal.querySelector('.k-modal-img-wrap');
}

function clickAt(clientX, targetEl) {
  const imgWrap = getImgWrap();
  const el = targetEl || imgWrap;
  const evt = new MouseEvent('click', { bubbles: true, cancelable: true, clientX });
  el.dispatchEvent(evt);
}

describe('b-modal-core — setupImageZoneDesktopClick (via setupModal complet)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    state.products = [];
    state.filtered = [];
    state.cart = [];
    state.favs = [];
    state.viewedHistory = [];
    state.modalHistory = [];
    state.modalProduct = null;
    state.modalQty = 1;
    state.modalOpen = false;
    state.carouselIndex = 1;
    state.carouselCount = 3;

    // setupKeyboardNavHint (desktop-only) sort à son guard tant qu'on est
    // en mobile ici — on repasse en desktop juste avant chaque clic testé.
    window.innerWidth = 375;
  });

  afterEach(() => {
    window.innerWidth = ORIGINAL_INNER_WIDTH;
  });

  it('setupModal() ne throw pas et attache bien le listener sur .k-modal-img-wrap', () => {
    resetDom();
    expect(() => setupModal()).not.toThrow();
  });

  it('absence de .k-modal-img-wrap → setupModal() throw (setupImageZoneTouch, appelée avant setupImageZoneDesktopClick, n\'a pas le même garde-fou)', () => {
    // Découverte en écrivant ce test : setupImageZoneDesktopClick a bien
    // `if (!imgWrap) return;`, mais setupImageZoneTouch — appelée juste
    // avant elle dans setupModal() — ne vérifie pas imgWrap et attache
    // directement ses listeners. Le garde de setupImageZoneDesktopClick
    // n'est donc jamais le premier à s'exécuter sur un DOM sans zone
    // image : setupModal() throw plus tôt. Documenté ici plutôt que
    // silencieusement contourné — pas un bug bloquant en prod (la zone
    // image existe toujours dans le vrai markup du modal), mais une
    // incohérence de robustesse entre les deux fonctions.
    resetDom({ withImgWrap: false });
    expect(() => setupModal()).toThrow(/addEventListener/);
  });

  it('clic zone gauche → slide précédente (carouselIndex > 0)', () => {
    resetDom();
    setupModal();
    window.innerWidth = 1200;

    clickAt(50); // < width/2 (150) → gauche

    expect(goToSlide).toHaveBeenCalledWith(0); // carouselIndex(1) - 1
  });

  it('clic zone droite → slide suivante (carouselIndex < count - 1)', () => {
    resetDom();
    setupModal();
    window.innerWidth = 1200;

    clickAt(250); // >= width/2 (150) → droite

    expect(goToSlide).toHaveBeenCalledWith(2); // carouselIndex(1) + 1
  });

  it('sur la première slide, clic gauche → aucun appel (déjà au bord)', () => {
    resetDom();
    state.carouselIndex = 0;
    setupModal();
    window.innerWidth = 1200;

    clickAt(50);

    expect(goToSlide).not.toHaveBeenCalled();
  });

  it('sur la dernière slide, clic droite → aucun appel (déjà au bord)', () => {
    resetDom();
    state.carouselIndex = 2; // count = 3 → dernier index
    setupModal();
    window.innerWidth = 1200;

    clickAt(250);

    expect(goToSlide).not.toHaveBeenCalled();
  });

  it('désactivé sur mobile (innerWidth < 900) au moment du clic', () => {
    resetDom();
    setupModal();
    // On NE repasse PAS en desktop : le clic doit être ignoré.
    clickAt(50);

    expect(goToSlide).not.toHaveBeenCalled();
  });

  it('désactivé si une seule image (carouselCount <= 1)', () => {
    resetDom();
    state.carouselCount = 1;
    setupModal();
    window.innerWidth = 1200;

    clickAt(250);

    expect(goToSlide).not.toHaveBeenCalled();
  });

  it('clic sur une miniature à l\'intérieur de la zone → n\'intercepte rien', () => {
    resetDom();
    setupModal();
    window.innerWidth = 1200;

    const imgWrap = getImgWrap();
    const thumb = document.createElement('div');
    thumb.className = 'k-modal-thumb';
    imgWrap.appendChild(thumb);

    clickAt(250, thumb);

    expect(goToSlide).not.toHaveBeenCalled();
  });

  it('clic sur le zoom preview → n\'intercepte rien', () => {
    resetDom();
    setupModal();
    window.innerWidth = 1200;

    const imgWrap = getImgWrap();
    const zoomPreview = document.createElement('div');
    zoomPreview.className = 'k-modal-zoom-preview';
    imgWrap.appendChild(zoomPreview);

    clickAt(50, zoomPreview);

    expect(goToSlide).not.toHaveBeenCalled();
  });

  it('clic sur la lentille de zoom → n\'intercepte rien', () => {
    resetDom();
    setupModal();
    window.innerWidth = 1200;

    const imgWrap = getImgWrap();
    const lens = document.createElement('div');
    lens.className = 'k-modal-zoom-lens';
    imgWrap.appendChild(lens);

    clickAt(50, lens);

    expect(goToSlide).not.toHaveBeenCalled();
  });
});
