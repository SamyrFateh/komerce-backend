'use strict';

/**
 * tests/unit/b-modal-core-desktop-click.test.js
 *
 * js/b-modal-core.js — setupImageZoneDesktopClick() (clic gauche/droite sur
 * l'image du modal produit pour naviguer dans le carousel, desktop only).
 *
 * Signalé "hors périmètre" dans le lot précédent (audit 2026-07-09 §4/§6) :
 * cette fonction n'est pas exportée directement, elle n'est atteignable
 * qu'en appelant setupModal() en entier (~700L, câblage exhaustif). En
 * pratique, la majorité de ce câblage se neutralise tout seul :
 *   - setupModalInnerSearch (recherche inline, ~360L) : `return` immédiat
 *     si #k-modal-suggestions est absent du DOM.
 *   - setupTopbarSearch : `return` immédiat si window.innerWidth >= 900
 *     (desktop) — on force justement le desktop pour ce test.
 *   - setupVoiceSearch : `return` immédiat si window.SpeechRecognition et
 *     window.webkitSpeechRecognition sont absents (cas par défaut en jsdom).
 *   - setupKeyboardNavHint : `return` immédiat si .k-modal-topbar est absent.
 *
 * En ne posant PAS ces éléments dans le DOM de test, on isole exactement
 * le périmètre voulu : listeners globaux (modalBack/Close/CartBtn/Overlay,
 * fav btn absent, actionsBar absent, buyNowBtn absent — tous guardés),
 * setupImageZoneTouch() (déjà testé dans un lot antérieur, ici juste câblé
 * sans exception) et enfin setupImageZoneDesktopClick(), notre cible.
 *
 * state/dom viennent du vrai b-store.js. Tous les sous-modules périphériques
 * sont mockés, à l'identique de b-modal-core.test.js.
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
  isDesktop: jest.fn(() => true),
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
const { goToSlide } = require('../../js/b-modal-product.js');
const { setupModal } = require('../../js/b-modal-core.js');

const OLD_INNER_WIDTH = window.innerWidth;

function resetDesktopModalDom() {
  document.body.innerHTML = '';

  dom.modalOverlay = document.createElement('div');
  dom.modalBack = document.createElement('button');
  dom.modalClose = document.createElement('button');
  dom.modalCartBtn = document.createElement('button');
  dom.modal = document.createElement('div');
  dom.modalVariants = document.createElement('div');
  dom.modalDetails = document.createElement('div');
  dom.addCartBtn = document.createElement('button');
  dom.pageScroll = document.createElement('div');

  // Zone image : requise par setupImageZoneTouch() ET setupImageZoneDesktopClick()
  const imgWrap = document.createElement('div');
  imgWrap.className = 'k-modal-img-wrap';
  dom.modal.appendChild(imgWrap);

  const track = document.createElement('div');
  track.className = 'k-card-carousel';
  imgWrap.appendChild(track);
  dom.modalCarouselTrack = track;

  document.body.appendChild(dom.modal);
  document.body.appendChild(dom.modalOverlay);

  return imgWrap;
}

/** Simule un clic sur imgWrap à une position horizontale donnée. */
function clickAt(imgWrap, clientX, targetEl) {
  const evt = new Event('click', { bubbles: true });
  Object.assign(evt, { clientX });
  const target = targetEl || imgWrap;
  Object.defineProperty(evt, 'target', { value: target, configurable: true });
  imgWrap.dispatchEvent(evt);
}

describe('b-modal-core — setupImageZoneDesktopClick (via setupModal réel)', () => {
  let imgWrap;

  beforeEach(() => {
    jest.clearAllMocks();
    window.innerWidth = 1200; // desktop — neutralise setupTopbarSearch/keyboardNavHint mobile
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;

    imgWrap = resetDesktopModalDom();
    // rect stable et prévisible pour calculer clickedLeft
    imgWrap.getBoundingClientRect = jest.fn(() => ({ left: 100, width: 400 }));

    state.modalProduct = null;
    state.modalQty = 1;
    state.carouselIndex = 1;
    state.carouselCount = 3;

    setupModal();
  });

  afterEach(() => {
    window.innerWidth = OLD_INNER_WIDTH;
  });

  test('ne lève pas et ne casse pas le reste du câblage (pas de #k-modal-suggestions/.k-modal-topbar)', () => {
    // setupModal() s'est exécuté sans exception dans beforeEach — les listeners
    // globaux (modalBack/Close/CartBtn/Overlay) sont posés malgré l'absence
    // de #k-modal-fav-btn, .k-modal-actions, #k-buy-now-btn (tous optionnels).
    expect(() => dom.modalOverlay.dispatchEvent(new Event('click', { bubbles: true }))).not.toThrow();
  });

  test('clic sur la moitié gauche → goToSlide(index - 1)', () => {
    // rect: left=100, width=400 → moitié gauche = clientX < 300
    clickAt(imgWrap, 250);
    expect(goToSlide).toHaveBeenCalledWith(0); // carouselIndex(1) - 1
  });

  test('clic sur la moitié droite → goToSlide(index + 1)', () => {
    clickAt(imgWrap, 350); // >= 300 → moitié droite
    expect(goToSlide).toHaveBeenCalledWith(2); // carouselIndex(1) + 1
  });

  test('clic gauche sur la première image (index 0) → aucune navigation (borne)', () => {
    state.carouselIndex = 0;
    clickAt(imgWrap, 250);
    expect(goToSlide).not.toHaveBeenCalled();
  });

  test('clic droit sur la dernière image (index = count-1) → aucune navigation (borne)', () => {
    state.carouselIndex = 2; // carouselCount - 1
    clickAt(imgWrap, 350);
    expect(goToSlide).not.toHaveBeenCalled();
  });

  test('une seule image (carouselCount <= 1) → aucune navigation, quel que soit le clic', () => {
    state.carouselCount = 1;
    state.carouselIndex = 0;
    clickAt(imgWrap, 350);
    clickAt(imgWrap, 250);
    expect(goToSlide).not.toHaveBeenCalled();
  });

  test('clic redevenu mobile entre le montage et le clic (innerWidth < 900) → ignoré', () => {
    window.innerWidth = 375;
    clickAt(imgWrap, 350);
    expect(goToSlide).not.toHaveBeenCalled();
  });

  test('clic sur une miniature (.k-modal-thumb) à l\'intérieur de la zone → ignoré', () => {
    const thumb = document.createElement('div');
    thumb.className = 'k-modal-thumb';
    imgWrap.appendChild(thumb);
    clickAt(imgWrap, 350, thumb);
    expect(goToSlide).not.toHaveBeenCalled();
  });

  test('clic sur le zoom preview (.k-modal-zoom-preview) → ignoré', () => {
    const zoomPreview = document.createElement('div');
    zoomPreview.className = 'k-modal-zoom-preview';
    imgWrap.appendChild(zoomPreview);
    clickAt(imgWrap, 350, zoomPreview);
    expect(goToSlide).not.toHaveBeenCalled();
  });

  test('clic sur la lentille de zoom (.k-modal-zoom-lens) → ignoré', () => {
    const zoomLens = document.createElement('div');
    zoomLens.className = 'k-modal-zoom-lens';
    imgWrap.appendChild(zoomLens);
    clickAt(imgWrap, 250, zoomLens);
    expect(goToSlide).not.toHaveBeenCalled();
  });
});
