'use strict';

/**
 * Couverture du contrat public de b-catalog.js.
 *
 * Les dépendances de rendu, panier, pager et stockage sont testées dans leurs
 * modules respectifs. Ici, on vérifie l'orchestration catalogue : état,
 * desktop/mobile, pagination, recherche, délégation des clics et chargement.
 */

const mockBus = { on: jest.fn(), emit: jest.fn() };
const mockState = {};
const mockDom = {};
const mockScroll = {};

const mockRenderProductCard = jest.fn((item) =>
  `<article class="k-card" data-id="${item.id}">` +
    `<button class="k-card-add" data-add="${item.id}">+</button>` +
  '</article>'
);
const mockRenderHomeSections = jest.fn(() =>
  '<section class="k-cat-section"><article class="k-card" data-id="home"></article></section>'
);
const mockBindCarouselDots = jest.fn();
const mockOpenModal = jest.fn();
const mockToggleFav = jest.fn();
const mockQuickAdd = jest.fn();
const mockQuickRemove = jest.fn();
const mockMarkAllCartButtons = jest.fn();
const mockPruneObsoleteCart = jest.fn();
const mockShowToast = jest.fn();
const mockRenderSubcatRail = jest.fn();
const mockSetupHomeController = jest.fn();
const mockCenterRailChip = jest.fn();
const mockIsDesktop = jest.fn(() => true);
const mockClearInlinePagerStyles = jest.fn();
const mockEnsureDesktopScrollOwner = jest.fn();
const mockScrollPageToTop = jest.fn();
const mockScrollPageToElement = jest.fn();
const mockDestroyMobilePager = jest.fn();
const mockSetupMobilePager = jest.fn();
const mockRecalcPagerVars = jest.fn();
const mockSetupSectionAutoAdvance = jest.fn();
const mockScrollPagerToCat = jest.fn();
const mockSetupInfiniteLoop = jest.fn();
const mockRenderFlatSubcat = jest.fn(() => '<article class="k-card" data-id="flat"></article>');
const mockMountFlatSubcatChrome = jest.fn();
const mockUnmountFlatSubcatChrome = jest.fn();
const mockBindFlatSubcatControls = jest.fn();
const mockRecalcPagerHeight = jest.fn();
const mockSetupFlatSubcatPager = jest.fn();
const mockWriteCache = jest.fn();
const mockSetProducts = jest.fn((items) => items);
const mockGetAllProducts = jest.fn(() => mockState.products || []);

jest.mock('../../js/b-bus.js', () => ({ bus: mockBus }));
jest.mock('../../js/b-store.js', () => ({
  state: mockState,
  dom: mockDom,
  $: jest.fn((selector) => global.document.querySelector(selector)),
  $$: jest.fn((selector) => Array.from(global.document.querySelectorAll(selector))),
  PAGE_SIZE: 24,
  scroll: mockScroll,
}));
jest.mock('../../js/b-utils.js', () => ({
  optimizeImgUrl: jest.fn((url, width) => `${url}?w=${width}`),
  sanitize: jest.fn((value) => String(value == null ? '' : value)),
  promoImgUrl: jest.fn((url, width) => `${url}?promo=${width}`),
  fmt: jest.fn(String),
  fmtPrice: jest.fn((value) => `${value} KMF`),
  productEmoji: jest.fn(() => '📦'),
  _currency: 'KMF',
  _rates: {},
  renderProductCarousel: jest.fn(),
  bindCarouselDots: mockBindCarouselDots,
}));
jest.mock('../../js/b-cart-core.js', () => ({
  showToast: mockShowToast,
  cartQty: jest.fn(() => 0),
  updateCartBadge: jest.fn(),
  isFav: jest.fn(() => false),
}));
jest.mock('../../js/b-cart.js', () => ({
  renderCartBody: jest.fn(),
  toggleFav: mockToggleFav,
  quickAdd: mockQuickAdd,
  quickRemove: mockQuickRemove,
  markAllCartButtons: mockMarkAllCartButtons,
  pruneObsoleteCart: mockPruneObsoleteCart,
}));
jest.mock('../../js/b-subcat.js', () => ({
  initFlatSubcat: jest.fn(),
  renderSubcatChips: jest.fn(),
  _setupFlatSubcatPager: mockSetupFlatSubcatPager,
  _renderFlatSubcat: mockRenderFlatSubcat,
  _mountFlatSubcatChrome: mockMountFlatSubcatChrome,
  _unmountFlatSubcatChrome: mockUnmountFlatSubcatChrome,
  _bindFlatSubcatControls: mockBindFlatSubcatControls,
  _recalcPagerHeight: mockRecalcPagerHeight,
}));
jest.mock('../../js/b-pager.js', () => ({
  _setupMobilePager: mockSetupMobilePager,
  _recalcPagerVars: mockRecalcPagerVars,
  _setupSectionAutoAdvance: mockSetupSectionAutoAdvance,
  _setupHorizontalWrap: jest.fn(),
  _syncChipToScroll: jest.fn(),
  _onPagerScroll: jest.fn(),
  _scrollPagerToCat: mockScrollPagerToCat,
  _scrollPagerToGhost: jest.fn(),
  _reshuffleToutInDOM: jest.fn(),
  _setupInfiniteLoop: mockSetupInfiniteLoop,
  destroyMobilePager: mockDestroyMobilePager,
}));
jest.mock('../../js/b-modal.js', () => ({ openModal: mockOpenModal }));
jest.mock('../../js/shop-schema.js', () => ({
  normalizeCategoryKey: jest.fn((category) => category),
  getSectionOrder: jest.fn(() => []),
}));
jest.mock('../../js/render/render-product-card.js', () => ({
  renderProductCard: mockRenderProductCard,
}));
jest.mock('../../js/render/render-home-sections.js', () => ({
  renderHomeSections: mockRenderHomeSections,
}));
jest.mock('../../js/controllers/home-controller.js', () => ({
  setupHomeController: mockSetupHomeController,
  centerRailChip: mockCenterRailChip,
  renderSubcatRail: mockRenderSubcatRail,
}));
jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: mockIsDesktop,
  clearInlinePagerStyles: mockClearInlinePagerStyles,
  ensureDesktopScrollOwner: mockEnsureDesktopScrollOwner,
  scrollPageToTop: mockScrollPageToTop,
  scrollPageToElement: mockScrollPageToElement,
}));
jest.mock('../../js/product-store.js', () => ({
  setProducts: mockSetProducts,
  getAllProducts: mockGetAllProducts,
  getPromoProducts: jest.fn(() => []),
  writeCache: mockWriteCache,
}));

const catalog = require('../../js/b-catalog.js');

function product(id, category = 'Tech', overrides = {}) {
  return {
    id,
    name: `Produit ${id}`,
    category,
    subcategory: 'Téléphones',
    description: `Description ${id}`,
    image_url: `/p${id}.jpg`,
    price_kmf: id * 1000,
    promo_pct: 0,
    is_available: true,
    ...overrides,
  };
}

function mountCatalogDom() {
  document.body.innerHTML = `
    <section id="k-catalog-section"></section>
    <div id="k-page-scroll"></div>
    <div id="k-grid"></div>
    <div id="k-promo-rail"></div>
    <div id="k-promos-section"></div>
    <div class="k-search">
      <input id="k-search-input">
      <div id="k-search-drop"></div>
    </div>
    <div id="k-load-more-spinner" class="show"></div>
  `;
  mockDom.grid = document.getElementById('k-grid');
  mockDom.pageScroll = document.getElementById('k-page-scroll');
  mockDom.promoRail = document.getElementById('k-promo-rail');
  mockDom.searchInput = document.getElementById('k-search-input');
  mockDom.searchDrop = document.getElementById('k-search-drop');
  mockDom.cats = document.createElement('div');
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.clearAllTimers();
  mountCatalogDom();
  Object.keys(mockState).forEach((key) => delete mockState[key]);
  Object.assign(mockState, {
    products: [],
    filtered: [],
    cart: [],
    favs: [],
    activeCat: 'all',
    activeSubcat: null,
    flatSubcat: null,
    page: 0,
    pageSize: 2,
    searchTimeout: null,
  });
  mockScroll.scrollingToSection = false;
  mockIsDesktop.mockReturnValue(true);
  mockGetAllProducts.mockImplementation(() => mockState.products);
  mockSetProducts.mockImplementation((items) => items);
  mockPruneObsoleteCart.mockImplementation(() => {});
  global.requestAnimationFrame = (callback) => { callback(); return 1; };
  global.K = { products: { list: jest.fn() } };
  window.K = global.K;
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  delete global.K;
  delete window.K;
});

describe('b-catalog — rendu et pagination', () => {
  test('rend les promotions, duplique le rail et ouvre le produit', () => {
    mockState.products = [product(1, 'Tech', { promo_pct: 20 })];

    catalog.renderPromos();

    expect(mockDom.promoRail.querySelectorAll('.k-promo-card')).toHaveLength(2);
    mockDom.promoRail.querySelector('.k-promo-card').click();
    expect(mockOpenModal).toHaveBeenCalledWith('1');
  });

  test('marque la section promotions vide', () => {
    mockState.products = [product(1)];
    catalog.renderPromos();
    expect(document.getElementById('k-promos-section').dataset.empty).toBe('1');
  });

  test('rend une catégorie desktop et réserve la hauteur si une page reste', () => {
    mockState.activeCat = 'Tech';
    mockState.filtered = [product(1), product(2), product(3, 'Mode')];
    mockState.pageSize = 1;

    catalog.renderGrid();

    expect(mockDestroyMobilePager).toHaveBeenCalled();
    expect(mockRenderSubcatRail).toHaveBeenCalledWith('Tech', { count: 2 });
    expect(mockDom.grid.querySelectorAll('.k-card')).toHaveLength(1);
    expect(document.getElementById('k-catalog-section').classList.contains('k-cat-has-more')).toBe(true);
  });

  test('rend la home desktop en sections et nettoie le pager mobile', () => {
    mockState.filtered = [
      product(1), product(2), product(3), product(4),
      product(5, 'Mode'), product(6, 'Mode'), product(7, 'Mode'), product(8, 'Mode'),
    ];

    catalog.renderGrid();

    expect(mockRenderHomeSections).toHaveBeenCalledWith(expect.objectContaining({
      isMobile: false,
      allProducts: mockState.filtered,
    }));
    expect(mockRenderSubcatRail).toHaveBeenCalledWith(null);
    expect(mockEnsureDesktopScrollOwner).toHaveBeenCalled();
    expect(mockDom.grid.classList.contains('k-grid-has-sections')).toBe(true);
  });

  test('monte le mode flat-subcat mobile', () => {
    mockIsDesktop.mockReturnValue(false);
    mockState.flatSubcat = 'Téléphones';
    mockState.filtered = [product(1)];

    catalog.renderGrid();

    expect(mockRenderFlatSubcat).toHaveBeenCalled();
    expect(mockMountFlatSubcatChrome).toHaveBeenCalled();
    expect(mockBindFlatSubcatControls).toHaveBeenCalled();
    expect(mockRecalcPagerHeight).toHaveBeenCalled();
    expect(mockSetupFlatSubcatPager).toHaveBeenCalled();
    expect(mockDom.pageScroll.classList.contains('k-pager-active')).toBe(true);
  });

  test('ajoute la page suivante et libère le spinner', () => {
    mockState.activeCat = 'Tech';
    mockState.filtered = [product(1), product(2), product(3)];
    mockState.pageSize = 1;

    catalog.appendNextPage();

    expect(mockState.page).toBe(1);
    expect(mockDom.grid.querySelector('[data-id="2"]')).not.toBeNull();
    expect(document.getElementById('k-load-more-spinner').classList.contains('show')).toBe(false);
    expect(document.getElementById('k-catalog-section').classList.contains('k-cat-has-more')).toBe(true);
  });

  test('setActiveCat remet la navigation à zéro et émet le changement', () => {
    mockState.flatSubcat = 'Ancien';
    mockState.page = 4;

    catalog.setActiveCat('Maison', 'Cuisine');

    expect(mockState.activeCat).toBe('Maison');
    expect(mockState.activeSubcat).toBe('Cuisine');
    expect(mockState.flatSubcat).toBeNull();
    expect(mockState.page).toBe(0);
    expect(mockBus.emit).toHaveBeenCalledWith('catalog:cat-changed', 'Maison');
  });
});

describe('b-catalog — navigation et recherche', () => {
  test('délègue favori, ajout, retrait et ouverture de modal', () => {
    mockState.activeCat = 'Tech';
    mockState.filtered = [product(1)];
    catalog.renderGrid();

    const card = mockDom.grid.querySelector('.k-card');
    card.insertAdjacentHTML('afterbegin', '<button class="k-card-fav" data-fav="1">♡</button>');
    card.querySelector('.k-card-fav').click();
    expect(mockToggleFav).toHaveBeenCalledWith('1', expect.any(HTMLElement));

    card.querySelector('.k-card-add').click();
    expect(mockQuickAdd).toHaveBeenCalledWith('1', expect.any(HTMLElement));

    card.querySelector('.k-card-add').innerHTML = '<span class="k-add-minus">−</span>';
    card.querySelector('.k-add-minus').click();
    expect(mockQuickRemove).toHaveBeenCalledWith('1', expect.any(HTMLElement));

    card.querySelector('.k-card-add').remove();
    card.click();
    expect(mockOpenModal).toHaveBeenCalledWith('1');
  });

  test('route le scroll vers le pager mobile puis une section desktop', () => {
    mockIsDesktop.mockReturnValue(false);
    mockDom.pageScroll.classList.add('k-pager-active');
    mockDom.grid.scrollTo = jest.fn();

    catalog.scrollToCategorySection('all');
    expect(mockDom.grid.scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'smooth' });
    catalog.scrollToCategorySection('Tech');
    expect(mockScrollPagerToCat).toHaveBeenCalledWith('Tech');

    mockIsDesktop.mockReturnValue(true);
    const section = document.createElement('section');
    section.id = 'k-sec-Mode---Beaut-';
    document.body.appendChild(section);
    jest.useFakeTimers();
    catalog.scrollToCategorySection('Mode & Beauté');
    expect(mockScrollPageToElement).toHaveBeenCalledWith(section, -8, 'smooth');
    expect(mockScroll.scrollingToSection).toBe(true);
    jest.advanceTimersByTime(700);
    expect(mockScroll.scrollingToSection).toBe(false);
  });

  test('branche le contrôleur catégories et centralise le centrage', () => {
    const chip = document.createElement('button');
    catalog.setupCats();
    expect(mockSetupHomeController).toHaveBeenCalledWith(expect.objectContaining({
      renderGrid: expect.any(Function),
      scrollPagerToCat: mockScrollPagerToCat,
      scrollToCategorySection: catalog.scrollToCategorySection,
    }));
    catalog.centerActiveChip(chip);
    expect(mockCenterRailChip).toHaveBeenCalledWith(chip);
  });

  test('recherche dans la catégorie desktop et ouvre le résultat', () => {
    jest.useFakeTimers();
    mockState.activeCat = 'Tech';
    mockState.products = [
      product(1, 'Tech', { name: 'Téléphone Alpha' }),
      product(2, 'Mode', { name: 'Robe Alpha' }),
    ];
    mockState.filtered = [...mockState.products];
    catalog.setupSearch();

    mockDom.searchInput.value = 'alpha';
    mockDom.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    jest.advanceTimersByTime(250);

    expect(mockState.filtered.map((item) => item.id)).toEqual([1]);
    expect(mockDom.searchDrop.classList.contains('open')).toBe(true);
    expect(mockDom.searchDrop.querySelectorAll('.k-search-item')).toHaveLength(1);
    mockDom.searchDrop.querySelector('.k-search-item').click();
    expect(mockOpenModal).toHaveBeenCalledWith('1');
    expect(mockDom.searchInput.value).toBe('');
    expect(mockDom.searchDrop.classList.contains('open')).toBe(false);
  });

  // [P0-A #2] Verrouille le correctif « grille vide après recherche »
  // (cf. js/b-catalog.js — _resetSearchFilter, L745). Sans cette
  // restauration, un clic sur un résultat de recherche laisse
  // state.filtered narrow : le rendu suivant applique _balancedPick() à
  // cette liste étroite et produit 0 carte pour 1, 2 ou 3 résultats
  // (MIN_PER_SECTION=4, rejet du reliquat impair). Ce test échoue si
  // _resetSearchFilter() est retiré de l'écouteur de clic du dropdown.
  test.each([1, 2, 3])(
    'clic sur un résultat de recherche (%i correspondance(s)) : la grille se re-rend non vide',
    (hitCount) => {
      jest.useFakeTimers();
      mockState.activeCat = 'all';
      // 3 catégories × 5 produits — de quoi survivre à _balancedPick une
      // fois state.filtered restauré au catalogue complet.
      mockState.products = [
        ...Array.from({ length: 5 }, (_, i) => product(`tech-${i}`, 'Tech')),
        ...Array.from({ length: 5 }, (_, i) => product(`mode-${i}`, 'Mode')),
        ...Array.from({ length: 5 }, (_, i) => product(`maison-${i}`, 'Maison')),
      ];
      // Marque exactement `hitCount` produits avec un terme unique cherché.
      for (let i = 0; i < hitCount; i++) mockState.products[i].name = `Zorglub ${i}`;
      mockState.filtered = [...mockState.products];
      catalog.setupSearch();

      mockDom.searchInput.value = 'zorglub';
      mockDom.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      jest.advanceTimersByTime(250);
      expect(mockState.filtered).toHaveLength(hitCount);
      expect(mockDom.searchDrop.querySelectorAll('.k-search-item')).toHaveLength(hitCount);

      mockRenderHomeSections.mockClear();
      mockDom.searchDrop.querySelector('.k-search-item').click();

      // La restauration doit repasser sur le catalogue complet, pas rester
      // sur les `hitCount` résultats de recherche.
      expect(mockState.filtered).toHaveLength(mockState.products.length);
      // Le dernier appel de rendu doit recevoir des items à afficher —
      // c'est la mesure qui distingue « grille vide » de « grille rendue ».
      const lastCall = mockRenderHomeSections.mock.calls.at(-1)[0];
      expect(lastCall.items.length).toBeGreaterThan(0);
    }
  );
});

describe('b-catalog — chargement produits', () => {
  test('charge, normalise, rend et nettoie le panier obsolète', async () => {
    const raw = [product(1), product(2, 'Mode', { is_available: false })];
    global.K.products.list.mockResolvedValue({ products: raw });
    mockState.cart = [{ id: 'obsolete' }];
    mockPruneObsoleteCart.mockImplementation(() => { mockState.cart = []; });
    mockSetProducts.mockImplementation((items) => {
      mockState.products = items;
      return items;
    });
    mockGetAllProducts.mockImplementation(() => mockState.products);

    await catalog.loadProducts();

    expect(global.K.products.list).toHaveBeenCalledWith({ limit: 1000 });
    expect(mockWriteCache).toHaveBeenCalledWith([raw[0]]);
    expect(mockState.products).toEqual([raw[0]]);
    expect(mockMarkAllCartButtons).toHaveBeenCalled();
    expect(mockPruneObsoleteCart).toHaveBeenCalledWith(new Set(['1']));
    expect(mockShowToast).toHaveBeenCalledWith('1 produit obsolète retiré du panier', 'info');
  });
});
