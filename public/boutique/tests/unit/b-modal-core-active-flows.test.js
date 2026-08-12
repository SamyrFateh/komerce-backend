'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/** Couverture active de b-modal-core.js : setup, recherche, pager et fullscreen. */

const mockAddToCart = jest.fn();
const mockToggleFav = jest.fn();
const mockOpenCart = jest.fn();
const mockUpdateCartBadge = jest.fn();
const mockCartQty = jest.fn(() => 0);
const mockIsDesktop = jest.fn(() => false);
const mockGetScrollY = jest.fn(() => 0);
const mockScrollToPosition = jest.fn();
const mockSetupImageUX = jest.fn();
const mockSetupSocialProof = jest.fn();
const mockBuildCarouselSlides = jest.fn();
const mockGoToSlide = jest.fn();
const mockSyncScrollPadding = jest.fn();
const mockSetupModalFAB = jest.fn();
const mockHideModalFAB = jest.fn();
const mockRenderSuggestions = jest.fn();
const mockUpdateModalNavArrows = jest.fn();
const mockNavigateModal = jest.fn();
const mockSyncModalQtyUI = jest.fn();
const mockSetupModalCart = jest.fn();

jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((value) => String(value == null ? '' : value)),
  fmt: jest.fn((value) => `${value} KMF`),
  fmtPrice: jest.fn((value) => `${value} KMF`),
  optimizeImgUrl: jest.fn((url, width) => `${url}?w=${width}`),
  renderProductCarousel: jest.fn(),
  bindCarouselDots: jest.fn(),
}));

jest.mock('../../js/b-cart-core.js', () => ({
  showToast: jest.fn(),
  updateCartBadge: mockUpdateCartBadge,
  saveCart: jest.fn(),
  cartQty: mockCartQty,
}));

jest.mock('../../js/b-cart.js', () => ({
  addToCart: mockAddToCart,
  quickAdd: jest.fn(),
  quickRemove: jest.fn(),
  toggleFav: mockToggleFav,
  setQty: jest.fn(),
  openCart: mockOpenCart,
  closeCart: jest.fn(),
  markAllCartButtons: jest.fn(),
}));

jest.mock('../../js/shop-schema.js', () => ({
  normalizeCategoryKey: jest.fn((category) => category || 'Autres'),
  getCategorySectionEmoji: jest.fn((category) => category === 'Tech' ? '💻' : '🏠'),
}));

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: mockIsDesktop,
  getScrollY: mockGetScrollY,
  scrollToPosition: mockScrollToPosition,
}));

jest.mock('../../js/b-modal-image-ux.js', () => ({ setupImageUX: mockSetupImageUX }));
jest.mock('../../js/b-modal-social-proof.js', () => ({ setupSocialProof: mockSetupSocialProof }));
jest.mock('../../js/b-modal-product.js', () => ({
  buildCarouselSlides: mockBuildCarouselSlides,
  goToSlide: mockGoToSlide,
  openSizeGuide: jest.fn(),
  closeSizeGuide: jest.fn(),
  _syncScrollPadding: mockSyncScrollPadding,
  setupModalFAB: mockSetupModalFAB,
  hideModalFAB: mockHideModalFAB,
}));
jest.mock('../../js/b-modal-suggestions.js', () => ({ renderSuggestions: mockRenderSuggestions }));
jest.mock('../../js/b-modal-nav.js', () => ({
  updateModalNavArrows: mockUpdateModalNavArrows,
  navigateModal: mockNavigateModal,
}));
jest.mock('../../js/b-modal-cart.js', () => ({
  _syncModalQtyUI: mockSyncModalQtyUI,
  setupModalCart: mockSetupModalCart,
  resetAddCartButtonState: jest.fn(),
}));

const { state, dom } = require('../../js/b-store.js');

function product(id, overrides = {}) {
  return {
    id,
    name: `Produit ${id}`,
    description: `Description ${id}`,
    category: 'Tech',
    subcategory: 'Téléphones',
    price_kmf: 1000 * Number(id),
    image_url: `/img/${id}.jpg`,
    images: [`/img/${id}-1.jpg`, `/img/${id}-2.jpg`],
    emoji: '📱',
    stock: 12,
    ...overrides,
  };
}

function mountDom() {
  document.body.innerHTML = `
    <input id="k-search-input">
    <div class="k-page-scroll"></div>
    <div id="k-grid" class="k-grid-flat-subcat"></div>
    <aside id="k-side-cart" class="has-items"></aside>
    <div id="k-sug-rail">
      <article class="k-sug-card" data-id="2"></article>
      <article class="k-sug-card" data-id="99"></article>
    </div>
    <div id="k-modal-overlay">
      <section id="k-modal">
        <header class="k-modal-topbar"><div class="k-modal-topbar-right"></div></header>
        <button id="k-modal-back"></button>
        <button id="k-modal-close"></button>
        <button id="k-modal-cart-btn"></button>
        <button id="k-modal-fav-btn"></button>
        <div class="k-modal-scroll">
          <div class="k-modal-img-wrap"></div>
          <div class="k-modal-details">
            <div id="k-modal-suggestions"></div>
            <div class="k-modal-actions"><button id="k-buy-now-btn">Acheter</button></div>
          </div>
        </div>
        <div id="k-modal-cart-slot"></div>
      </section>
    </div>
    <button class="k-card-fav" data-fav="1"></button>
  `;

  dom.modalOverlay = document.getElementById('k-modal-overlay');
  dom.modal = document.getElementById('k-modal');
  dom.modalBack = document.getElementById('k-modal-back');
  dom.modalClose = document.getElementById('k-modal-close');
  dom.modalCartBtn = document.getElementById('k-modal-cart-btn');
  dom.modalName = document.createElement('div');
  dom.modalSku = document.createElement('div');
  dom.modalDesc = document.createElement('div');
  dom.modalPrice = document.createElement('div');
  dom.modalQtyVal = document.createElement('div');
  dom.modalOldPrice = document.createElement('div');
  dom.modalPromoBadge = document.createElement('div');
  dom.modalCat = document.createElement('div');
  dom.modalStock = document.createElement('div');
  dom.modalBackLabel = document.createElement('div');
  dom.modalVariants = document.createElement('div');
  dom.modalDetails = dom.modal.querySelector('.k-modal-details');
  dom.addCartBtn = document.createElement('button');
  dom.pageScroll = document.querySelector('.k-page-scroll');
  dom.pageScroll.scrollTo = jest.fn();
  dom.grid = document.getElementById('k-grid');
  dom.searchInput = document.getElementById('k-search-input');
  dom.modalCarouselTrack = document.createElement('div');
  dom.modal.querySelector('.k-modal-img-wrap').appendChild(dom.modalCarouselTrack);
  dom.modal.append(
    dom.modalName, dom.modalSku, dom.modalDesc, dom.modalPrice,
    dom.modalQtyVal, dom.modalOldPrice, dom.modalPromoBadge, dom.modalCat,
    dom.modalStock, dom.modalBackLabel, dom.modalVariants, dom.addCartBtn,
  );
}

function touchEvent(type, x, y) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  event.touches = [{ clientX: x, clientY: y }];
  event.changedTouches = [{ clientX: x, clientY: y }];
  return event;
}

async function settle() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

mountDom();
Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
const pushStateSpy = jest.spyOn(window.history, 'pushState').mockImplementation(() => {});
const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {});
const { openModal, closeModal, setupModal } = require('../../js/b-modal-core.js');
setupModal();

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  localStorage.clear();
  state.products = [
    product(1, { sku: 'TECH-001', has_variants: true }),
    product(2),
    product(3, { category: 'Maison', subcategory: 'Cuisine' }),
    product(4, { category: 'Tech', promo_pct: 20 }),
  ];
  state.filtered = [];
  state.cart = [{ product: product(2), qty: 2 }];
  state.favs = [1];
  state.viewedHistory = [2, 3];
  state.modalHistory = [];
  state.modalProduct = null;
  state.modalQty = 1;
  state.modalOpen = false;
  state.carouselCount = 2;
  state.carouselIndex = 0;
  state._savedCatalogScrollY = 0;
  state._savedPagerInlineStyles = null;
  state._savedGridScrollLeft = null;
  state._modalSearchTimeout = null;
  dom.modalOverlay.classList.remove('open');
  document.body.className = '';
  document.getElementById('k-side-cart').classList.add('has-items');
  dom.pageScroll.style.cssText = 'position:fixed;top:12px;left:1px;right:2px;bottom:3px;width:100%;height:90px;overflow:hidden;overflow-x:auto;overflow-y:hidden';
  dom.grid.scrollLeft = 140;
  dom.grid.style.scrollSnapType = 'x mandatory';
  mockGetScrollY.mockReturnValue(321);
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true,
    json: async () => ({
      suggestions: [
        { product_id: 2, id: 2, category: 'Tech', name: 'Produit 2' },
        { product_id: 3, id: 3, category: 'Maison', name: 'Produit 3' },
      ],
    }),
  }));
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  document.querySelectorAll('#k-modal-fullscreen').forEach((node) => node.remove());
});

afterAll(() => {
  pushStateSpy.mockRestore();
  backSpy.mockRestore();
});

test('setupModal déplace les actions, câble favoris, panier et overlay', () => {
  expect(dom.modal.querySelector('.k-modal-actions').parentNode).toBe(dom.modal);
  state.modalProduct = state.products[0];
  document.getElementById('k-modal-fav-btn').click();
  expect(mockToggleFav).toHaveBeenCalledWith(1, document.getElementById('k-modal-fav-btn'));

  dom.modalCartBtn.click();
  jest.advanceTimersByTime(150);
  expect(mockOpenCart).toHaveBeenCalledTimes(1);

  dom.modalOverlay.classList.add('open');
  dom.modalOverlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(dom.modalOverlay.classList.contains('open')).toBe(false);
});

test('openModal charge les suggestions sans fetch legacy /api/products/:id puis restaure le pager mobile', async () => {
  openModal(1);
  await settle();

  expect(dom.modalSku.textContent).toBe('Réf. TECH-001');
  expect(document.getElementById('k-modal-fav-btn').classList.contains('liked')).toBe(true);
  // PDC-6 : le fetch legacy /api/products/:id + _renderVariants n'existent plus.
  expect(global.fetch).not.toHaveBeenCalledWith(
    expect.stringMatching(/^\/api\/products\//),
    expect.anything()
  );
  expect(mockRenderSuggestions).toHaveBeenCalledWith(
    [expect.objectContaining({ id: 2 })],
    [expect.objectContaining({ id: 3 })],
    'Tech',
  );
  expect(mockSetupImageUX).toHaveBeenCalled();
  expect(mockSetupSocialProof).toHaveBeenCalled();
  expect(document.body.classList.contains('modal-has-cart')).toBe(true);
  expect(dom.pageScroll.style.position).toBe('');
  expect(dom.grid.scrollLeft).toBe(0);

  closeModal();
  jest.advanceTimersByTime(20);
  expect(dom.pageScroll.style.position).toBe('fixed');
  expect(dom.pageScroll.style.top).toBe('12px');
  expect(mockScrollToPosition).toHaveBeenCalledWith(321);
  expect(dom.grid.scrollLeft).toBe(140);
  expect(dom.grid.style.scrollSnapType).toBe('');
});

test('openModal desktop monte le side-cart dans la colonne produit dédiée', () => {
  mockIsDesktop.mockReturnValue(true);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });

  openModal(1);

  const sideCart = document.getElementById('k-side-cart');
  expect(sideCart.parentElement).toBe(document.getElementById('k-modal-cart-slot'));
  expect(sideCart.classList.contains('k-side-cart--in-modal')).toBe(true);

  closeModal();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
});

// MDP-PROP1 (2.5) : le test "Acheter ajoute la quantité puis ouvre le panier" a été
// retiré d'ici — le câblage du clic #k-buy-now-btn n'est plus fait par openModal()
// (b-modal-core.js) mais par wireBuyNowButton() dans b-modal-buybox-shared.js, appelé
// depuis renderActions() des renderers PDC. Couverture équivalente désormais dans
// tests/unit/b-modal-buybox-shared.test.js.

// REF-2026-07d : recherche interne retirée complètement de la modale (barre
// inline + dropdown + récents + vocal), en plus de la loupe topbar (Sprint 4,
// REF-2026-07c) déjà retirée avant elle. Aucun point d'entrée recherche dans
// la modale désormais — voir css/modal-shell.css pour l'historique complet.
test('aucun point d\'entrée recherche n\'existe dans la modale', () => {
  expect(document.querySelector('.k-modal-inner-search')).toBeNull();
  expect(document.getElementById('k-modal-search-dropdown')).toBeNull();
  expect(document.querySelector('.k-topbar-search-trigger')).toBeNull();
  expect(document.querySelector('.k-topbar-search-expanded')).toBeNull();
});

test('navigation clavier et zones image desktop délèguent correctement', () => {
  dom.modalOverlay.classList.add('open');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  expect(mockNavigateModal).toHaveBeenNthCalledWith(1, 1);
  expect(mockNavigateModal).toHaveBeenNthCalledWith(2, -1);

  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
  const wrap = dom.modal.querySelector('.k-modal-img-wrap');
  wrap.getBoundingClientRect = () => ({ left: 0, width: 200 });
  state.carouselIndex = 0;
  wrap.dispatchEvent(new MouseEvent('click', { clientX: 180, bubbles: true }));
  expect(mockGoToSlide).toHaveBeenCalledWith(1);
  state.carouselIndex = 1;
  wrap.dispatchEvent(new MouseEvent('click', { clientX: 20, bubbles: true }));
  expect(mockGoToSlide).toHaveBeenCalledWith(0);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
});

test('un tap ouvre le fullscreen, le swipe change de slide puis ferme', () => {
  state.modalProduct = state.products[0];
  const wrap = dom.modal.querySelector('.k-modal-img-wrap');
  wrap.dispatchEvent(touchEvent('touchstart', 120, 100));
  wrap.dispatchEvent(touchEvent('touchend', 120, 100));

  const fullscreen = document.getElementById('k-modal-fullscreen');
  expect(fullscreen).not.toBeNull();
  const track = fullscreen.querySelector('.k-modal-fullscreen-track');
  track.dispatchEvent(touchEvent('touchstart', 160, 100));
  track.dispatchEvent(touchEvent('touchmove', 70, 100));
  track.dispatchEvent(touchEvent('touchend', 70, 100));
  expect(track.style.transform).toBe('translateX(-100%)');

  fullscreen.querySelector('.k-modal-fullscreen-close').click();
  jest.advanceTimersByTime(200);
  expect(document.getElementById('k-modal-fullscreen')).toBeNull();
});

test('popstate ferme une modal ouverte sans rappeler history.back', () => {
  openModal(2);
  backSpy.mockClear();
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  expect(dom.modalOverlay.classList.contains('open')).toBe(false);
  expect(backSpy).not.toHaveBeenCalled();
});
