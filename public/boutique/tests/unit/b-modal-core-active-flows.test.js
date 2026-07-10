'use strict';

/**
 * Couverture des flux actifs de b-modal-core.js laissés hors du premier lot :
 * câblage setupModal, recherche interne/mobile, variantes, suggestions classées,
 * restauration du pager, navigation clavier et image plein écran.
 */

const mockShowToast = jest.fn();
const mockUpdateCartBadge = jest.fn();
const mockSaveCart = jest.fn();
const mockCartQty = jest.fn(() => 0);
const mockAddToCart = jest.fn();
const mockQuickAdd = jest.fn();
const mockQuickRemove = jest.fn();
const mockToggleFav = jest.fn();
const mockSetQty = jest.fn();
const mockOpenCart = jest.fn();
const mockCloseCart = jest.fn();
const mockMarkAllCartButtons = jest.fn();
const mockIsDesktop = jest.fn(() => false);
const mockGetScrollY = jest.fn(() => 0);
const mockScrollToPosition = jest.fn();
const mockSetupImageUX = jest.fn();
const mockSetupSocialProof = jest.fn();
const mockBuildCarouselSlides = jest.fn();
const mockGoToSlide = jest.fn();
const mockOpenSizeGuide = jest.fn();
const mockCloseSizeGuide = jest.fn();
const mockRenderVariants = jest.fn();
const mockSyncScrollPadding = jest.fn();
const mockInjectMobileDelivery = jest.fn();
const mockInjectMobileTrust = jest.fn();
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
  showToast: mockShowToast,
  updateCartBadge: mockUpdateCartBadge,
  saveCart: mockSaveCart,
  cartQty: mockCartQty,
}));

jest.mock('../../js/b-cart.js', () => ({
  addToCart: mockAddToCart,
  quickAdd: mockQuickAdd,
  quickRemove: mockQuickRemove,
  toggleFav: mockToggleFav,
  setQty: mockSetQty,
  openCart: mockOpenCart,
  closeCart: mockCloseCart,
  markAllCartButtons: mockMarkAllCartButtons,
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
  openSizeGuide: mockOpenSizeGuide,
  closeSizeGuide: mockCloseSizeGuide,
  _renderVariants: mockRenderVariants,
  _syncScrollPadding: mockSyncScrollPadding,
  _injectMobileDelivery: mockInjectMobileDelivery,
  _injectMobileTrust: mockInjectMobileTrust,
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
}));

const { state, dom } = require('../../js/b-store.js');
const { bus } = require('../../js/b-bus.js');

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

function mountModalDom() {
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

async function settleAsync() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

mountModalDom();
Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
global.requestAnimationFrame = jest.fn((callback) => { callback(); return 1; });
const pushStateSpy = jest.spyOn(window.history, 'pushState').mockImplementation(() => {});
const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {});

const {
  openModal,
  closeModal,
  setupModal,
} = require('../../js/b-modal-core.js');

beforeAll(() => {
  setupModal();
});

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
  document.body.style.removeProperty('--modal-scroll-y');
  document.getElementById('k-side-cart').classList.add('has-items');
  dom.pageScroll.style.cssText = 'position:fixed;top:12px;left:1px;right:2px;bottom:3px;width:100%;height:90px;overflow:hidden;overflow-x:auto;overflow-y:hidden';
  dom.grid.scrollLeft = 140;
  dom.grid.style.scrollSnapType = 'x mandatory';
  mockGetScrollY.mockReturnValue(321);
  global.fetch = jest.fn((url) => {
    if (String(url).startsWith('/api/products/')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ variants: { Taille: ['M', 'L'] } }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({
        suggestions: [
          { product_id: 2, id: 2, category: 'Tech', name: 'Produit 2' },
          { product_id: 3, id: 3, category: 'Maison', name: 'Produit 3' },
        ],
      }),
    });
  });
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

test('setupModal câble les propriétaires principaux et déplace les actions sur mobile', () => {
  expect(mockSetupModalCart).toHaveBeenCalledTimes(1);
  expect(dom.modal.querySelector('.k-modal-actions').parentNode).toBe(dom.modal);

  state.modalProduct = state.products[0];
  document.getElementById('k-modal-fav-btn').click();
  expect(mockToggleFav).toHaveBeenCalledWith(1, document.getElementById('k-modal-fav-btn'));

  dom.modalCartBtn.click();
  expect(mockOpenCart).not.toHaveBeenCalled();
  jest.advanceTimersByTime(150);
  expect(mockOpenCart).toHaveBeenCalledTimes(1);

  dom.modalOverlay.classList.add('open');
  dom.modalOverlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(dom.modalOverlay.classList.contains('open')).toBe(false);
});

test('openModal charge variantes et suggestions, puis restaure le pager mobile à la fermeture', async () => {
  openModal(1);
  await settleAsync();

  expect(dom.modalSku.textContent).toBe('Réf. TECH-001');
  expect(dom.modalSku.hidden).toBe(false);
  expect(document.getElementById('k-modal-fav-btn').classList.contains('liked')).toBe(true);
  expect(mockRenderVariants).toHaveBeenCalledWith({ Taille: ['M', 'L'] }, expect.any(Object));
  expect(mockRenderSuggestions).toHaveBeenCalledWith(
    [expect.objectContaining({ id: 2 })],
    [expect.objectContaining({ id: 3 })],
    'Tech',
  );
  expect(mockSetupImageUX).toHaveBeenCalled();
  expect(mockSetupSocialProof).toHaveBeenCalled();
  expect(mockInjectMobileDelivery).toHaveBeenCalledWith(state.products[0]);
  expect(mockInjectMobileTrust).toHaveBeenCalled();
  expect(document.body.classList.contains('modal-has-cart')).toBe(true);
  expect(dom.pageScroll.style.position).toBe('');
  expect(dom.grid.scrollLeft).toBe(0);

  closeModal();
  expect(dom.pageScroll.style.position).toBe('fixed');
  expect(dom.pageScroll.style.top).toBe('12px');
  expect(mockScrollToPosition).toHaveBeenCalledWith(321);
  expect(state.modalOpen).toBe(false);
  expect(state.modalProduct).toBeNull();
  expect(dom.grid.scrollLeft).toBe(140);
  expect(dom.grid.style.scrollSnapType).toBe('');
});

test('la description se déplie et le bouton Acheter ajoute puis ouvre le panier', () => {
  state.modalProduct = state.products[0];
  state.modalQty = 3;
  dom.modalDesc.onclick = () => dom.modalDesc.classList.toggle('is-expanded');
  dom.modalDesc.click();
  expect(dom.modalDesc.classList.contains('is-expanded')).toBe(true);

  const buyNow = document.getElementById('k-buy-now-btn');
  const original = buyNow.innerHTML;
  buyNow.click();
  expect(mockAddToCart).toHaveBeenCalledWith(state.products[0], 3, buyNow);
  expect(buyNow.disabled).toBe(true);
  expect(buyNow.classList.contains('buy-confirmed')).toBe(true);

  jest.advanceTimersByTime(1200);
  expect(buyNow.innerHTML).toBe(original);
  jest.advanceTimersByTime(400);
  expect(mockOpenCart).toHaveBeenCalled();
});

test('la recherche interne filtre, groupe, navigue et mémorise les recherches récentes', () => {
  const input = document.querySelector('.k-modal-inner-search-input');
  const dropdown = document.getElementById('k-modal-search-dropdown');
  expect(input).not.toBeNull();

  input.value = 'produit';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  jest.advanceTimersByTime(150);
  expect(dropdown.classList.contains('open')).toBe(true);
  expect(dropdown.querySelectorAll('.k-msearch-group')).toHaveLength(2);
  expect(dropdown.textContent).toContain('4 résultats');

  dropdown.querySelector('.k-msearch-item[data-id="2"]').click();
  expect(state.modalProduct.id).toBe(2);
  expect(JSON.parse(localStorage.getItem('k_recent_searches'))).toContain('produit');

  input.value = 'inexistant';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  jest.advanceTimersByTime(150);
  expect(dropdown.querySelector('.k-msearch-empty')).not.toBeNull();

  input.value = '';
  input.dispatchEvent(new FocusEvent('focus'));
  expect(dropdown.textContent).toContain('Récentes');
  dropdown.querySelector('.k-msearch-recents-clear').click();
  expect(localStorage.getItem('k_recent_searches')).toBeNull();
});

test('Enter relaie la recherche vers le catalogue et la topbar mobile reste synchronisée', () => {
  const inline = document.querySelector('.k-modal-inner-search-input');
  const trigger = document.querySelector('.k-topbar-search-trigger');
  const expanded = document.querySelector('.k-topbar-search-expanded');
  const topbarInput = expanded.querySelector('.k-topbar-search-input');

  trigger.click();
  expect(expanded.classList.contains('is-active')).toBe(true);
  topbarInput.value = 'maison';
  topbarInput.dispatchEvent(new Event('input', { bubbles: true }));
  expect(inline.value).toBe('maison');

  topbarInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(dom.searchInput.value).toBe('maison');
  expect(expanded.classList.contains('is-active')).toBe(false);

  trigger.click();
  topbarInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(expanded.classList.contains('is-active')).toBe(false);
});

test('navigation clavier et image desktop utilisent les propriétaires dédiés', () => {
  dom.modalOverlay.classList.add('open');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  expect(mockNavigateModal).toHaveBeenNthCalledWith(1, 1);
  expect(mockNavigateModal).toHaveBeenNthCalledWith(2, -1);

  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
  const wrap = dom.modal.querySelector('.k-modal-img-wrap');
  wrap.getBoundingClientRect = () => ({ left: 0, width: 200 });
  state.carouselIndex = 0;
  state.carouselCount = 2;
  wrap.dispatchEvent(new MouseEvent('click', { clientX: 180, bubbles: true }));
  expect(mockGoToSlide).toHaveBeenCalledWith(1);

  state.carouselIndex = 1;
  wrap.dispatchEvent(new MouseEvent('click', { clientX: 20, bubbles: true }));
  expect(mockGoToSlide).toHaveBeenCalledWith(0);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
});

test('un tap image ouvre le plein écran, le swipe change de slide et la fermeture nettoie l’overlay', () => {
  state.modalProduct = state.products[0];
  state.carouselIndex = 0;
  const wrap = dom.modal.querySelector('.k-modal-img-wrap');
  wrap.dispatchEvent(touchEvent('touchstart', 120, 100));
  wrap.dispatchEvent(touchEvent('touchend', 120, 100));

  const fullscreen = document.getElementById('k-modal-fullscreen');
  expect(fullscreen).not.toBeNull();
  expect(fullscreen.querySelector('.k-modal-fullscreen-counter').textContent).toBe('1 / 2');
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
