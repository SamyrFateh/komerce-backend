/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

'use strict';

const mockBus = { on: jest.fn() };
const mockNoop = jest.fn();

jest.mock('../../js/b-bus.js', () => ({ bus: mockBus }));
jest.mock('../../js/b-store.js', () => ({
  state: {}, dom: {}, initDom: mockNoop, updateMobileScrollTop: mockNoop,
  $: jest.fn(), $$: jest.fn(() => []), CART_VERSION: 1, PAGE_SIZE: 24,
}));
jest.mock('../../js/b-utils.js', () => ({
  optimizeImgUrl: mockNoop, sanitize: mockNoop, promoImgUrl: mockNoop,
  renderProductCarousel: mockNoop, bindCarouselDots: mockNoop, detectCurrency: mockNoop,
  fmt: mockNoop, fmtPrice: mockNoop, productEmoji: mockNoop, genIdempotencyKey: mockNoop,
  _currency: 'KMF', _rates: {},
}));
jest.mock('../../js/b-cart-core.js', () => ({
  showToast: mockNoop, cartQty: mockNoop, cartTotal: mockNoop, saveCart: mockNoop,
  updateCartBadge: mockNoop, isFav: mockNoop, saveFavs: mockNoop,
}));
jest.mock('../../js/b-catalog.js', () => ({
  renderPromos: mockNoop, renderGrid: mockNoop, appendNextPage: mockNoop,
  setupCats: mockNoop, setupCatSwipeNav: mockNoop, centerActiveChip: mockNoop,
  setupSearch: mockNoop, loadProducts: mockNoop, setActiveCat: mockNoop,
}));
jest.mock('../../js/b-subcat.js', () => ({ initFlatSubcat: mockNoop, renderSubcatChips: mockNoop }));
jest.mock('../../js/b-modal.js', () => ({ openModal: mockNoop, closeModal: mockNoop, modalGoBack: mockNoop, setupModal: mockNoop }));
jest.mock('../../js/b-cart.js', () => ({
  addToCart: mockNoop, openCart: mockNoop, closeCart: mockNoop, renderCartBody: mockNoop,
  quickAdd: mockNoop, quickRemove: mockNoop, setQty: mockNoop, loadSharedCart: mockNoop,
}));
jest.mock('../../js/b-checkout.js', () => ({
  checkoutCart: mockNoop, closeOrderModal: mockNoop, renderCheckout: mockNoop,
  makeInput: mockNoop, makeIntlPhoneInput: mockNoop, digitsOnly: mockNoop,
  normalizeLocal: mockNoop, prettifyLocal: mockNoop, buildE164: mockNoop,
  makePhoneInput: mockNoop, checkWalletBalance: mockNoop, updateWalletDisplay: mockNoop,
  submitOrder: mockNoop, renderOrderSuccess: mockNoop,
}));
jest.mock('../../js/b-nav.js', () => ({
  setupDrawer: mockNoop, setupInfiniteScroll: mockNoop, switchView: mockNoop,
  setupBnav: mockNoop, loadRelais: mockNoop, handleParticipantUrl: mockNoop,
}));
jest.mock('../../js/b-favs.js', () => ({ renderFavView: mockNoop, updateFavPromoBadge: mockNoop, shareWishlistWhatsApp: mockNoop }));
jest.mock('../../js/b-tracking.js', () => ({
  buildTimeline: mockNoop, renderOrdersHistory: mockNoop, renderOrderDetail: mockNoop,
  renderTrackView: mockNoop, renderMyOrdersList: mockNoop, getStatusDisplay: mockNoop,
  formatOrderDate: mockNoop, renderTrackViewSearchMode: mockNoop,
}));
jest.mock('../../js/b-pager.js', () => ({
  _setupMobilePager: mockNoop, _setupSectionAutoAdvance: mockNoop,
  _setupHorizontalWrap: mockNoop, _syncChipToScroll: mockNoop, _onPagerScroll: mockNoop,
}));
jest.mock('../../js/b-scroll-owner.js', () => ({ installScrollOwner: mockNoop, scrollPageToElement: mockNoop }));
jest.mock('../../js/b-share-cart.js', () => ({ install: mockNoop }));
jest.mock('../../js/b-group-banner.js', () => ({}));
jest.mock('../../js/b-cart-stepper-guard.js', () => ({}));

function flushMutations() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('checkout relay visible map preview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    delete window.visualViewport;
  });

  test('transforme le lien Maps du relais en carte visible sans supprimer le lien', async () => {
    jest.isolateModules(() => {
      require('../../js/boutique.js');
    });

    const container = document.createElement('div');
    container.id = 'ck-relais-section';
    const summary = document.createElement('div');
    summary.id = 'ck-relais-summary';
    const link = document.createElement('a');
    link.className = 'ck-relais-map-link';
    link.href = 'https://www.google.com/maps/search/?api=1&query=Relais%20Anjouan%2C%20Mutsamudu';
    link.setAttribute('aria-label', 'Localiser Relais Anjouan sur la carte');
    link.textContent = '📍 Localiser ce relais';
    summary.appendChild(link);
    container.appendChild(summary);
    document.body.appendChild(container);

    await flushMutations();

    const preview = container.querySelector('.ck-relais-map-preview');
    const frame = preview?.querySelector('.ck-relais-map-frame');
    expect(preview).not.toBeNull();
    expect(frame).not.toBeNull();
    expect(frame.src).toContain('https://www.google.com/maps?q=');
    expect(frame.src).toContain('Relais%20Anjouan%2C%20Mutsamudu');
    expect(frame.src).toContain('output=embed');
    expect(frame.loading).toBe('lazy');
    expect(frame.title).toContain('Carte de Relais Anjouan');
    expect(link.isConnected).toBe(true);

    // Une mutation ultérieure ne doit jamais dupliquer la carte.
    container.appendChild(document.createElement('span'));
    await flushMutations();
    expect(container.querySelectorAll('.ck-relais-map-preview')).toHaveLength(1);
  });

  test('ne crée aucune iframe si le lien ne porte pas de requête cartographique', async () => {
    jest.isolateModules(() => {
      require('../../js/boutique.js');
    });

    const container = document.createElement('div');
    const summary = document.createElement('div');
    summary.id = 'ck-relais-summary';
    const link = document.createElement('a');
    link.className = 'ck-relais-map-link';
    link.href = 'https://www.google.com/maps/';
    summary.appendChild(link);
    container.appendChild(summary);
    document.body.appendChild(container);

    await flushMutations();
    expect(container.querySelector('.ck-relais-map-preview')).toBeNull();
  });
});
