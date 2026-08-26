/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

'use strict';

const mockBus = { on: jest.fn() };
const noop = jest.fn();

jest.mock('../../js/b-bus.js', () => ({ bus: mockBus }));
jest.mock('../../js/b-store.js', () => ({
  state: {}, dom: {}, initDom: noop, updateMobileScrollTop: noop,
  $: jest.fn(), $$: jest.fn(() => []), CART_VERSION: 1, PAGE_SIZE: 24,
}));
jest.mock('../../js/b-utils.js', () => ({
  optimizeImgUrl: noop, sanitize: noop, promoImgUrl: noop,
  renderProductCarousel: noop, bindCarouselDots: noop, detectCurrency: noop,
  fmt: noop, fmtPrice: noop, productEmoji: noop, genIdempotencyKey: noop,
  _currency: 'KMF', _rates: {},
}));
jest.mock('../../js/b-cart-core.js', () => ({
  showToast: noop, cartQty: noop, cartTotal: noop, saveCart: noop,
  updateCartBadge: noop, isFav: noop, saveFavs: noop,
}));
jest.mock('../../js/b-catalog.js', () => ({
  renderPromos: noop, renderGrid: noop, appendNextPage: noop,
  setupCats: noop, setupCatSwipeNav: noop, centerActiveChip: noop,
  setupSearch: noop, loadProducts: noop, setActiveCat: noop,
}));
jest.mock('../../js/b-subcat.js', () => ({ initFlatSubcat: noop, renderSubcatChips: noop }));
jest.mock('../../js/b-modal.js', () => ({ openModal: noop, closeModal: noop, modalGoBack: noop, setupModal: noop }));
jest.mock('../../js/b-cart.js', () => ({
  addToCart: noop, openCart: noop, closeCart: noop, renderCartBody: noop,
  quickAdd: noop, quickRemove: noop, setQty: noop, loadSharedCart: noop,
}));
jest.mock('../../js/b-checkout.js', () => ({
  checkoutCart: noop, closeOrderModal: noop, renderCheckout: noop,
  makeInput: noop, makeIntlPhoneInput: noop, digitsOnly: noop,
  normalizeLocal: noop, prettifyLocal: noop, buildE164: noop,
  makePhoneInput: noop, checkWalletBalance: noop, updateWalletDisplay: noop,
  submitOrder: noop, renderOrderSuccess: noop,
}));
jest.mock('../../js/b-nav.js', () => ({
  setupDrawer: noop, setupInfiniteScroll: noop, switchView: noop,
  setupBnav: noop, loadRelais: noop, handleParticipantUrl: noop,
}));
jest.mock('../../js/b-favs.js', () => ({ renderFavView: noop, updateFavPromoBadge: noop, shareWishlistWhatsApp: noop }));
jest.mock('../../js/b-tracking.js', () => ({
  buildTimeline: noop, renderOrdersHistory: noop, renderOrderDetail: noop,
  renderTrackView: noop, renderMyOrdersList: noop, getStatusDisplay: noop,
  formatOrderDate: noop, renderTrackViewSearchMode: noop,
}));
jest.mock('../../js/b-pager.js', () => ({
  _setupMobilePager: noop, _setupSectionAutoAdvance: noop,
  _setupHorizontalWrap: noop, _syncChipToScroll: noop, _onPagerScroll: noop,
}));
jest.mock('../../js/b-scroll-owner.js', () => ({ installScrollOwner: noop, scrollPageToElement: noop }));
jest.mock('../../js/b-share-cart.js', () => ({ install: noop }));
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
