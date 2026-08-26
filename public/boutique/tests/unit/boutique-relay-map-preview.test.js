/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

'use strict';

const mockBus = { on: jest.fn() };
const mockNoop = jest.fn();
const mockState = { relais: [], orderData: null };

jest.mock('../../js/b-bus.js', () => ({ bus: mockBus }));
jest.mock('../../js/b-store.js', () => ({
  state: mockState, dom: {}, initDom: mockNoop, updateMobileScrollTop: mockNoop,
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

function appendRelaySummary({ href, ariaLabel = 'Localiser Relais Anjouan sur la carte' }) {
  const container = document.createElement('div');
  container.id = 'ck-relais-section';
  const summary = document.createElement('div');
  summary.id = 'ck-relais-summary';
  const link = document.createElement('a');
  link.className = 'ck-relais-map-link';
  link.href = href;
  link.setAttribute('aria-label', ariaLabel);
  link.textContent = '📍 Localiser ce relais';
  summary.appendChild(link);
  container.appendChild(summary);
  document.body.appendChild(container);
  return { container, link };
}

describe('checkout relay visible map preview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.relais = [];
    mockState.orderData = null;
    document.body.innerHTML = '';
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    delete window.visualViewport;
  });

  test('transforme le lien Maps du relais en carte visible sans supprimer le lien', async () => {
    jest.isolateModules(() => {
      require('../../js/boutique.js');
    });

    const { container, link } = appendRelaySummary({
      href: 'https://www.google.com/maps/search/?api=1&query=Relais%20Anjouan%2C%20Mutsamudu',
    });

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
    expect(preview.querySelector('.ck-relais-visit-title').textContent)
      .toBe('Venez nous voir au relais 👋');
    expect(link.isConnected).toBe(true);

    // Une mutation ultérieure ne doit jamais dupliquer la carte.
    container.appendChild(document.createElement('span'));
    await flushMutations();
    expect(container.querySelectorAll('.ck-relais-map-preview')).toHaveLength(1);
  });

  test('utilise le GPS exact et affiche la photo cliquable du relais quand ils sont disponibles', async () => {
    mockState.relais = [{
      id: 'relay-1',
      name: 'Relais Anjouan',
      latitude: '-12.1714000',
      longitude: '44.3991000',
      photo_url: 'https://images.example.test/relais-anjouan.jpg',
    }];
    mockState.orderData = { selectedRelaisId: 'relay-1' };

    jest.isolateModules(() => {
      require('../../js/boutique.js');
    });

    const { container, link } = appendRelaySummary({
      href: 'https://www.google.com/maps/search/?api=1&query=Relais%20Anjouan%2C%20Mutsamudu',
    });

    await flushMutations();

    const preview = container.querySelector('.ck-relais-map-preview');
    const frame = preview.querySelector('.ck-relais-map-frame');
    const photoLink = preview.querySelector('.ck-relais-photo-link');
    const photo = preview.querySelector('.ck-relais-photo');

    expect(link.href).toBe('https://www.google.com/maps?q=-12.1714,44.3991&z=17&hl=fr');
    expect(link.dataset.locationPrecision).toBe('gps');
    expect(frame.src).toContain('q=-12.1714,44.3991');
    expect(frame.src).toContain('z=17');
    expect(frame.title).toBe('Carte de Relais Anjouan');
    expect(photoLink.href).toBe('https://images.example.test/relais-anjouan.jpg');
    expect(photoLink.target).toBe('_blank');
    expect(photo.alt).toBe('Entrée de Relais Anjouan');
    expect(preview.querySelector('.ck-relais-visit-note').textContent)
      .toContain('photo cliquable');
  });

  test('ne crée aucune iframe si le lien ne porte pas de requête cartographique', async () => {
    jest.isolateModules(() => {
      require('../../js/boutique.js');
    });

    const { container } = appendRelaySummary({ href: 'https://www.google.com/maps/' });

    await flushMutations();
    expect(container.querySelector('.ck-relais-map-preview')).toBeNull();
  });
});
