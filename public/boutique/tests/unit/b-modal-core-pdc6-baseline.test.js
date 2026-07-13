'use strict';

jest.mock('../../js/b-bus.js', () => ({
  bus: { on: jest.fn(), emit: jest.fn() },
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
const { openModal } = require('../../js/b-modal-core.js');

function installDom() {
  document.body.innerHTML = `
    <div id="k-side-cart"></div>
    <div id="k-grid" class="k-grid-flat-subcat"></div>
    <div id="k-modal"><div class="k-modal-scroll"></div></div>
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

describe('b-modal-core — PDC-6 measured baseline closure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installDom();
    resetState();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ suggestions: [] }),
    });
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(); return 1; });
    jest.spyOn(window.history, 'pushState').mockImplementation(() => {});
  });

  afterEach(() => {
    delete global.fetch;
    jest.restoreAllMocks();
  });

  test('un id produit absent coupe le lifecycle avant toute ouverture', () => {
    openModal('missing');

    expect(state.modalProduct).toBeNull();
    expect(dom.modalOverlay.classList.contains('open')).toBe(false);
    expect(window.history.pushState).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('une recherche interne existante est remise à zéro avant la projection produit', () => {
    const wrap = document.createElement('div');
    wrap.className = 'k-modal-inner-search has-value';
    const input = document.createElement('input');
    input.value = 'robe';
    wrap.appendChild(input);
    document.body.appendChild(wrap);

    const rail = document.createElement('div');
    rail.id = 'k-sug-rail';
    const card = document.createElement('div');
    card.className = 'k-sug-card search-hidden';
    rail.appendChild(card);
    document.body.appendChild(rail);

    const dropdown = document.createElement('div');
    dropdown.id = 'k-modal-search-dropdown';
    dropdown.className = 'open';
    document.body.appendChild(dropdown);

    state._modalSearchInput = input;
    openModal(1, false);

    expect(input.value).toBe('');
    expect(wrap.classList.contains('has-value')).toBe(false);
    expect(card.classList.contains('search-hidden')).toBe(false);
    expect(dropdown.classList.contains('open')).toBe(false);
  });

  test('le reset recherche reste fail-safe sans wrapper, rail ni dropdown', () => {
    const input = document.createElement('input');
    input.value = 'robe';
    document.body.appendChild(input);
    state._modalSearchInput = input;

    openModal(1, false);

    expect(input.value).toBe('');
    expect(state.modalProduct.id).toBe(1);
  });

  test('panier, promo, favori, historique et liste filtrée suivent leurs branches positives', () => {
    const product = {
      ...state.products[0],
      sku: 'REF-1',
      promo_pct: 15,
    };
    state.products = [product];
    state.filtered = [product];
    state.cart = [{ product: { id: 1 }, qty: 3 }];
    state.favs = [1];
    state.modalHistory = [99];

    const fav = document.createElement('button');
    fav.id = 'k-modal-fav-btn';
    document.body.appendChild(fav);

    openModal(1, false);

    expect(state.modalQty).toBe(3);
    expect(dom.modalQtyVal.textContent).toBe('3');
    expect(dom.modalSku.textContent).toBe('Réf. REF-1');
    expect(dom.modalPromoBadge.textContent).toBe('-15%');
    expect(dom.modalPromoBadge.classList.contains('show')).toBe(true);
    expect(dom.modal.classList.contains('k-modal--has-promo')).toBe(true);
    expect(fav.classList.contains('liked')).toBe(true);
    expect(fav.innerHTML).toBe('❤️');
    expect(dom.modalBackLabel.textContent).toBe('Retour');
  });
});
