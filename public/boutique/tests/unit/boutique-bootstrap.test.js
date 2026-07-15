'use strict';

/**
 * Smoke test de boutique.js. Le but n'est pas de retester chaque module mais
 * de protéger le câblage du boot, les événements globaux et le reset desktop.
 */

const mockBus = { on: jest.fn() };
const mockInitDom = jest.fn();
const mockUpdateCartBadge = jest.fn();
const mockSetupCats = jest.fn();
const mockSetupCatSwipeNav = jest.fn();
const mockSetupSearch = jest.fn();
const mockSetupModal = jest.fn();
const mockSetupDrawer = jest.fn();
const mockSetupBnav = jest.fn();
const mockHandleParticipantUrl = jest.fn();
const mockSetupInfiniteScroll = jest.fn();
const mockInitFlatSubcat = jest.fn();
const mockInstallShareCart = jest.fn();
const mockLoadProducts = jest.fn();
const mockLoadRelais = jest.fn();
const mockInstallScrollOwner = jest.fn();
const mockCheckoutCart = jest.fn();
const mockSetQty = jest.fn();

jest.mock('../../js/b-bus.js', () => ({ bus: mockBus }));
jest.mock('../../js/b-store.js', () => ({
  state: {},
  dom: {},
  initDom: mockInitDom,
  updateMobileScrollTop: jest.fn(),
  $: jest.fn(),
  $$: jest.fn(() => []),
  CART_VERSION: 1,
  PAGE_SIZE: 24,
}));
jest.mock('../../js/b-utils.js', () => ({
  optimizeImgUrl: jest.fn(), sanitize: jest.fn(), promoImgUrl: jest.fn(),
  renderProductCarousel: jest.fn(), bindCarouselDots: jest.fn(),
  detectCurrency: jest.fn(), fmt: jest.fn(), fmtPrice: jest.fn(),
  productEmoji: jest.fn(), genIdempotencyKey: jest.fn(), _currency: 'KMF', _rates: {},
}));
jest.mock('../../js/b-cart-core.js', () => ({
  showToast: jest.fn(), cartQty: jest.fn(), cartTotal: jest.fn(), saveCart: jest.fn(),
  updateCartBadge: mockUpdateCartBadge, isFav: jest.fn(), saveFavs: jest.fn(),
}));
jest.mock('../../js/b-catalog.js', () => ({
  renderPromos: jest.fn(), renderGrid: jest.fn(), appendNextPage: jest.fn(),
  setupCats: mockSetupCats, setupCatSwipeNav: mockSetupCatSwipeNav,
  centerActiveChip: jest.fn(), setupSearch: mockSetupSearch,
  loadProducts: mockLoadProducts, setActiveCat: jest.fn(),
}));
jest.mock('../../js/b-subcat.js', () => ({
  initFlatSubcat: mockInitFlatSubcat,
  renderSubcatChips: jest.fn(),
}));
jest.mock('../../js/b-modal.js', () => ({
  openModal: jest.fn(), closeModal: jest.fn(), modalGoBack: jest.fn(),
  setupModal: mockSetupModal,
}));
jest.mock('../../js/b-cart.js', () => ({
  addToCart: jest.fn(), openCart: jest.fn(), closeCart: jest.fn(), renderCartBody: jest.fn(),
  quickAdd: jest.fn(), quickRemove: jest.fn(), setQty: mockSetQty,
  shareCartWhatsApp: jest.fn(), showShareChoiceModal: jest.fn(), loadSharedCart: jest.fn(),
}));
jest.mock('../../js/b-checkout.js', () => ({
  checkoutCart: mockCheckoutCart, closeOrderModal: jest.fn(), renderCheckout: jest.fn(),
  makeInput: jest.fn(), makeIntlPhoneInput: jest.fn(), digitsOnly: jest.fn(),
  normalizeLocal: jest.fn(), prettifyLocal: jest.fn(), buildE164: jest.fn(),
  makePhoneInput: jest.fn(), checkWalletBalance: jest.fn(), updateWalletDisplay: jest.fn(),
  submitOrder: jest.fn(), renderOrderSuccess: jest.fn(),
}));
jest.mock('../../js/b-nav.js', () => ({
  setupDrawer: mockSetupDrawer,
  setupInfiniteScroll: mockSetupInfiniteScroll,
  switchView: jest.fn(),
  setupBnav: mockSetupBnav,
  loadRelais: mockLoadRelais,
  handleParticipantUrl: mockHandleParticipantUrl,
}));
jest.mock('../../js/b-favs.js', () => ({
  renderFavView: jest.fn(), updateFavPromoBadge: jest.fn(), shareWishlistWhatsApp: jest.fn(),
}));
jest.mock('../../js/b-tracking.js', () => ({
  buildTimeline: jest.fn(), renderOrdersHistory: jest.fn(), renderOrderDetail: jest.fn(),
  renderTrackView: jest.fn(), renderMyOrdersList: jest.fn(), getStatusDisplay: jest.fn(),
  formatOrderDate: jest.fn(), renderTrackViewSearchMode: jest.fn(),
}));
jest.mock('../../js/b-pager.js', () => ({
  _setupMobilePager: jest.fn(), _setupSectionAutoAdvance: jest.fn(),
  _setupHorizontalWrap: jest.fn(), _syncChipToScroll: jest.fn(), _onPagerScroll: jest.fn(),
}));
jest.mock('../../js/b-scroll-owner.js', () => ({
  installScrollOwner: mockInstallScrollOwner,
  scrollPageToElement: jest.fn(),
}));
jest.mock('../../js/b-share-cart.js', () => ({ install: mockInstallShareCart }));
jest.mock('../../js/b-group-banner.js', () => ({}));

test('boutique câble le boot, les événements globaux et le reset desktop', () => {
  jest.clearAllMocks();
  document.body.innerHTML = `
    <div id="k-page-scroll" style="top:10px;position:fixed;height:20px;overflow:hidden"></div>
    <div id="k-grid"></div>
    <a data-footer-cat="Mode"></a>
    <button class="k-chip" data-cat="Mode"></button>
    <div class="k-modal-carousel-track">
      <div class="k-modal-slide"></div><div class="k-modal-slide"></div>
    </div>
    <button class="k-modal-dot" data-index="0"></button>
    <button class="k-modal-dot" data-index="1"></button>
  `;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
  Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading' });

  jest.isolateModules(() => {
    require('../../js/boutique.js');
  });

  expect(mockBus.on).toHaveBeenCalledWith('checkout:open', mockCheckoutCart);
  const pageScroll = document.getElementById('k-page-scroll');
  expect(pageScroll.style.top).toBe('');
  expect(pageScroll.style.position).toBe('');

  const chip = document.querySelector('.k-chip[data-cat="Mode"]');
  chip.click = jest.fn();
  document.dispatchEvent(new Event('DOMContentLoaded'));

  expect(document.body.classList.contains('k-view-shop')).toBe(true);
  expect(mockInitDom).toHaveBeenCalledTimes(1);
  expect(mockInstallScrollOwner).toHaveBeenCalledTimes(1);
  expect(mockUpdateCartBadge).toHaveBeenCalledTimes(1);
  expect(mockSetupCats).toHaveBeenCalledTimes(1);
  expect(mockSetupCatSwipeNav).toHaveBeenCalledTimes(1);
  expect(mockSetupSearch).toHaveBeenCalledTimes(1);
  expect(mockSetupModal).toHaveBeenCalledTimes(1);
  expect(mockSetupDrawer).toHaveBeenCalledTimes(1);
  expect(mockSetupBnav).toHaveBeenCalledTimes(1);
  expect(mockHandleParticipantUrl).toHaveBeenCalledTimes(1);
  expect(mockSetupInfiniteScroll).toHaveBeenCalledTimes(1);
  expect(mockInitFlatSubcat).toHaveBeenCalledTimes(1);
  expect(mockInstallShareCart).toHaveBeenCalledTimes(1);
  expect(mockLoadProducts).toHaveBeenCalledTimes(1);
  expect(mockLoadRelais).toHaveBeenCalledTimes(1);

  document.dispatchEvent(new CustomEvent('cart:setqty', {
    detail: { pid: 'p-1', qty: 3 },
  }));
  expect(mockSetQty).toHaveBeenCalledWith('p-1', 3);

  document.querySelector('[data-footer-cat="Mode"]').click();
  expect(chip.click).toHaveBeenCalledTimes(1);

  document.querySelector('.k-modal-dot[data-index="1"]').click();
  expect(document.querySelector('.k-modal-carousel-track').style.transform)
    .toBe('translateX(-100%)');
  expect(document.querySelector('.k-modal-dot[data-index="1"]').classList.contains('active'))
    .toBe(true);
});

describe('syncModalViewportOwner (fix Samsung Internet)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.documentElement.style.cssText = '';
    document.body.innerHTML = '<div id="k-modal"></div>';
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    delete window.visualViewport;
  });

  it('mobile : utilise directement la hauteur du visual viewport', () => {
    const vvResizeListeners = [];
    const vv = {
      height: 540.8,
      addEventListener: jest.fn((eventName, handler) => {
        if (eventName === 'resize') vvResizeListeners.push(handler);
      }),
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });

    jest.isolateModules(() => {
      require('../../js/boutique.js');
    });

    const modal = document.getElementById('k-modal');
    expect(modal.style.height).toBe('540px');
    expect(modal.style.maxHeight).toBe('540px');
    expect(vv.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(mockBus.on).toHaveBeenCalledWith('modal:opened', expect.any(Function));

    vv.height = 512.2;
    vvResizeListeners[0]();
    expect(modal.style.height).toBe('512px');
    expect(modal.style.maxHeight).toBe('512px');
  });

  it('mobile sans visualViewport : utilise innerHeight en fallback', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 684 });

    jest.isolateModules(() => {
      require('../../js/boutique.js');
    });

    const modal = document.getElementById('k-modal');
    expect(modal.style.height).toBe('684px');
    expect(modal.style.maxHeight).toBe('684px');
  });

  it('passage desktop : retire les overrides runtime et rend la main au shell desktop', () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: 540, addEventListener: jest.fn() },
    });

    jest.isolateModules(() => {
      require('../../js/boutique.js');
    });

    const modal = document.getElementById('k-modal');
    expect(modal.style.height).toBe('540px');
    expect(modal.style.maxHeight).toBe('540px');

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    window.dispatchEvent(new Event('resize'));

    expect(modal.style.height).toBe('');
    expect(modal.style.maxHeight).toBe('');
  });
});
