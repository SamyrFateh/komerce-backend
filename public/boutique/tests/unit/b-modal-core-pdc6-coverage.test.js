'use strict';

const handlers = {};

jest.mock('../../js/b-bus.js', () => ({
  bus: {
    on: jest.fn((event, fn) => { handlers[event] = fn; }),
    emit: jest.fn(),
  },
}));

jest.mock('../../js/b-store.js', () => ({
  state: {},
  dom: {},
  $: jest.fn((selector) => globalThis.document.querySelector(selector)),
  $$: jest.fn((selector) => Array.from(globalThis.document.querySelectorAll(selector))),
}));

jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((s) => String(s)),
  fmt: jest.fn((n) => String(n)),
  fmtPrice: jest.fn((n) => `${n} KMF`),
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
  normalizeCategoryKey: jest.fn((value) => value),
  getCategorySectionEmoji: jest.fn(() => '📦'),
}));

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(() => false),
  getScrollY: jest.fn(() => 123),
  scrollToPosition: jest.fn(),
}));

jest.mock('../../js/b-modal-image-ux.js', () => ({ setupImageUX: jest.fn() }));
jest.mock('../../js/b-modal-social-proof.js', () => ({ setupSocialProof: jest.fn() }));
jest.mock('../../js/b-modal-product.js', () => ({
  buildCarouselSlides: jest.fn(),
  goToSlide: jest.fn(),
  openSizeGuide: jest.fn(),
  closeSizeGuide: jest.fn(),
  _syncScrollPadding: jest.fn(),
  setupModalFAB: jest.fn(),
  hideModalFAB: jest.fn(),
}));
jest.mock('../../js/b-modal-suggestions.js', () => ({ renderSuggestions: jest.fn() }));
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
const { scrollToPosition } = require('../../js/b-scroll-owner.js');
const { openModal, closeModal } = require('../../js/b-modal-core.js');

function installDom() {
  document.body.innerHTML = `
    <div id="k-side-cart"></div>
    <div id="k-grid" class="k-grid-flat-subcat"></div>
    <div id="k-modal">
      <div class="k-modal-scroll"></div>
    </div>
    <div id="k-modal-variants"></div>`;

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
  dom.modal = document.getElementById('k-modal');
  dom.modalVariants = document.getElementById('k-modal-variants');
  dom.modalDetails = document.createElement('div');
  dom.addCartBtn = document.createElement('button');
  dom.pageScroll = document.createElement('div');
  dom.modalCarouselTrack = document.createElement('div');
  dom.modalSku = document.createElement('div');
}

function resetState() {
  state.products = [{
    id: 1,
    name: 'Produit',
    description: 'Description',
    price_kmf: 1000,
    category: 'Catalogue',
    emoji: '📦',
    sku: 'REF-1',
  }];
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
}

describe('b-modal-core — PDC-6 coverage recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installDom();
    resetState();
    window.innerWidth = 1200;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue({ suggestions: [] }) });
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(); return 1; });
    jest.spyOn(window.history, 'pushState').mockImplementation(() => {});
    jest.spyOn(window.history, 'back').mockImplementation(() => {});
  });

  afterEach(() => {
    delete global.fetch;
    jest.restoreAllMocks();
  });

  test('les handlers bus open/close restent la seule couture lifecycle externe', () => {
    expect(handlers['modal:open']).toEqual(expect.any(Function));
    expect(handlers['modal:close']).toEqual(expect.any(Function));

    handlers['modal:open']({ id: 1, pushHistory: false });
    expect(state.modalProduct.id).toBe(1);
    expect(dom.modalSku.textContent).toBe('Réf. REF-1');

    handlers['modal:close']();
    expect(state.modalProduct).toBeNull();
    expect(state.modalOpen).toBe(false);
    expect(scrollToPosition).toHaveBeenCalled();
  });

  test('popstate avant est ignoré et le back programmatique retardé ne ferme pas une modal rouverte', () => {
    openModal(1);
    expect(dom.modalOverlay.classList.contains('open')).toBe(true);

    window.dispatchEvent(new PopStateEvent('popstate', { state: { kModal: true } }));
    expect(state.modalOpen).toBe(true);

    closeModal();
    expect(window.history.back).toHaveBeenCalledTimes(1);

    openModal(1);
    expect(state.modalOpen).toBe(true);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

    expect(state.modalOpen).toBe(true);
    expect(dom.modalOverlay.classList.contains('open')).toBe(true);
  });

  test('popstate utilisateur ferme une modal ouverte sans rappeler history.back', () => {
    openModal(1);
    window.history.back.mockClear();

    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

    expect(state.modalOpen).toBe(false);
    expect(dom.modalOverlay.classList.contains('open')).toBe(false);
    expect(window.history.back).not.toHaveBeenCalled();
  });
});
