'use strict';

/** Couverture active de b-subcat.js : pagination, gestes et chips déléguées. */

const mockIsDesktop = jest.fn(() => false);
const mockDestroyMobilePager = jest.fn();
const mockRenderGrid = jest.fn();
const mockOpenModal = jest.fn();
const mockToggleFav = jest.fn();
const mockQuickAdd = jest.fn();
const mockQuickRemove = jest.fn();
const mockBindCarouselDots = jest.fn();
const mockGetSubcategories = jest.fn(() => [
  { key: 'fruits', label: 'Fruits', icon: '🍎' },
  { key: 'legumes', label: 'Légumes', icon: '🥦' },
  { key: 'boissons', label: 'Boissons', icon: '🥤' },
]);

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: mockIsDesktop,
  getScrollY: jest.fn(() => 0),
  DESKTOP_BREAKPOINT: 900,
}));
jest.mock('../../js/b-pager.js', () => ({
  _setupMobilePager: jest.fn(),
  destroyMobilePager: mockDestroyMobilePager,
}));
jest.mock('../../js/b-catalog.js', () => ({
  _renderCard: jest.fn((p) => `
    <article class="k-card" data-id="${p.id}">
      <button class="k-card-fav" data-fav="${p.id}">♡</button>
      <button class="k-card-add" data-add="${p.id}"><span class="k-add-plus">+</span></button>
      <span class="k-card-name">${p.name}</span>
    </article>`),
  renderGrid: mockRenderGrid,
}));
jest.mock('../../js/b-modal.js', () => ({ openModal: mockOpenModal }));
jest.mock('../../js/b-cart.js', () => ({
  toggleFav: mockToggleFav,
  quickAdd: mockQuickAdd,
  quickRemove: mockQuickRemove,
}));
jest.mock('../../js/b-cart-core.js', () => ({ showToast: jest.fn() }));
jest.mock('../../js/shop-schema.js', () => ({
  getSubcategories: mockGetSubcategories,
  normalizeCategoryKey: jest.fn((value) => value),
}));
jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((value) => String(value == null ? '' : value)),
  fmt: jest.fn(String),
  bindCarouselDots: mockBindCarouselDots,
}));

const ioInstances = [];
class MockIntersectionObserver {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.observe = jest.fn();
    this.disconnect = jest.fn();
    ioInstances.push(this);
  }
}
global.IntersectionObserver = MockIntersectionObserver;
global.requestAnimationFrame = jest.fn((callback) => { callback(); return 1; });
global.cancelAnimationFrame = jest.fn();

const { state, dom } = require('../../js/b-store.js');
const {
  initFlatSubcat,
  _renderFlatSubcat,
  _mountFlatSubcatChrome,
  _bindFlatSubcatControls,
  _setupFlatSubcatPager,
  _syncFlatActiveTab,
} = require('../../js/b-subcat.js');

function product(id, subcategory) {
  return { id, name: `Produit ${id}`, category: 'alimentation', subcategory };
}

function fixture({ pageSize = 2 } = {}) {
  state.flatSubcat = { cat: 'alimentation', sub: 'fruits' };
  state.pageSize = pageSize;
  state.page = 0;
  state.sectionSubcats = {};
  state.filtered = [
    product(1, 'fruits'), product(2, 'fruits'), product(3, 'fruits'),
    product(4, 'fruits'), product(5, 'fruits'), product(6, 'legumes'),
  ];
  document.body.innerHTML = `
    <header class="k-header"></header>
    <div id="k-hero"></div>
    <div class="k-cats-shell"></div>
    <section id="k-catalog-section"><div id="k-grid"></div></section>
  `;
  dom.grid = document.getElementById('k-grid');
  dom.grid.scrollTo = jest.fn();
  dom.pageScroll = document.createElement('div');
  dom.pageScroll.scrollTo = jest.fn();
  dom.grid.innerHTML = _renderFlatSubcat();
  _mountFlatSubcatChrome();
  const tabBar = document.getElementById('k-flat-subcat-tabs');
  if (tabBar) tabBar.scrollTo = jest.fn();
  dom.grid.querySelectorAll('.k-flat-subcat-page').forEach((page, index) => {
    Object.defineProperty(page, 'offsetLeft', { configurable: true, value: index * 320 });
  });
  return dom.grid;
}

function eventWith(type, props = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.entries(props).forEach(([key, value]) => Object.defineProperty(event, key, {
    configurable: true, value,
  }));
  return event;
}

function touch(type, x, y, target) {
  const point = { clientX: x, clientY: y };
  const event = eventWith(type, { touches: [point], changedTouches: [point] });
  (target || dom.grid).dispatchEvent(event);
  return event;
}

beforeAll(() => {
  initFlatSubcat();
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  ioInstances.length = 0;
  mockIsDesktop.mockReturnValue(false);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

test('rend une page vide et utilise le fallback de métadonnées inconnu', () => {
  mockGetSubcategories.mockReturnValueOnce([
    { key: 'inconnue', label: 'Inconnue', icon: '✨' },
  ]);
  state.flatSubcat = { cat: 'alimentation', sub: 'inconnue' };
  state.filtered = [];
  state.pageSize = 2;
  const html = _renderFlatSubcat();
  expect(html).toContain('k-flat-subcat-empty');
  expect(html).toContain('Bientôt disponible');
});

test('initialise la page choisie, synchronise au scroll et nettoie un ancien binding', () => {
  const grid = fixture();
  grid._flatScrollBound = true;
  grid._flatScrollHandler = jest.fn();
  const removeSpy = jest.spyOn(grid, 'removeEventListener');

  _setupFlatSubcatPager();
  expect(grid.scrollLeft).toBe(0);
  expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
  expect(grid.classList.contains('k-grid-flat-subcat')).toBe(true);
  expect(ioInstances).toHaveLength(3);

  grid.scrollLeft = 330;
  grid.dispatchEvent(new Event('scroll'));
  expect(state.flatSubcat.sub).toBe('legumes');
  expect(document.querySelector('[data-flat-sub="legumes"]').classList.contains('is-active')).toBe(true);
});

test('le swipe tactile horizontal déplace la grille et le geste vertical est ignoré', () => {
  const grid = fixture();
  _setupFlatSubcatPager();
  grid.scrollLeft = 100;

  touch('touchstart', 200, 100);
  const move = touch('touchmove', 120, 105);
  expect(move.defaultPrevented).toBe(true);
  expect(grid.scrollLeft).toBe(180);
  expect(grid.classList.contains('is-flat-dragging')).toBe(true);
  touch('touchend', 120, 105);
  jest.advanceTimersByTime(180);
  expect(grid.classList.contains('is-flat-dragging')).toBe(false);

  grid.scrollLeft = 100;
  touch('touchstart', 200, 100);
  touch('touchmove', 195, 180);
  expect(grid.scrollLeft).toBe(100);
});

test('les boutons ne déclenchent pas le swipe tactile', () => {
  const grid = fixture();
  _setupFlatSubcatPager();
  const button = grid.querySelector('.k-card-add');
  touch('touchstart', 200, 100, button);
  touch('touchmove', 100, 100, button);
  expect(grid.classList.contains('is-flat-dragging')).toBe(false);
});

test('le drag pointeur horizontal déplace la grille et neutralise le clic suivant', () => {
  const grid = fixture();
  _setupFlatSubcatPager();
  grid.scrollLeft = 50;
  grid.dispatchEvent(eventWith('pointerdown', { clientX: 200, clientY: 100 }));
  const move = eventWith('pointermove', { clientX: 120, clientY: 104 });
  grid.dispatchEvent(move);
  expect(move.defaultPrevented).toBe(true);
  expect(grid.scrollLeft).toBe(130);
  expect(grid._flatDidDrag).toBe(true);

  const up = eventWith('pointerup', { clientX: 120, clientY: 104 });
  grid.dispatchEvent(up);
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  grid.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);
  expect(grid._flatDidDrag).toBe(false);
});

test('le drag vertical et les boutons sont laissés au navigateur', () => {
  const grid = fixture();
  _setupFlatSubcatPager();
  const button = grid.querySelector('.k-card-add');
  button.dispatchEvent(eventWith('pointerdown', { clientX: 200, clientY: 100 }));
  button.dispatchEvent(eventWith('pointermove', { clientX: 100, clientY: 100 }));
  expect(grid.scrollLeft).toBe(0);

  grid.dispatchEvent(eventWith('pointerdown', { clientX: 200, clientY: 100 }));
  grid.dispatchEvent(eventWith('pointermove', { clientX: 195, clientY: 190 }));
  expect(grid.classList.contains('is-flat-dragging')).toBe(false);
});

test('IntersectionObserver ajoute la page suivante et câble les nouvelles cartes', () => {
  const grid = fixture({ pageSize: 2 });
  _setupFlatSubcatPager();
  const fruitPage = grid.querySelector('[data-flat-sub="fruits"]');
  expect(fruitPage.querySelectorAll('.k-card')).toHaveLength(2);

  ioInstances[0].callback([{ isIntersecting: true }]);
  expect(fruitPage.dataset.flatPage).toBe('1');
  expect(fruitPage.querySelectorAll('.k-card')).toHaveLength(4);
  expect(mockBindCarouselDots).toHaveBeenCalled();

  const appended = fruitPage.querySelector('.k-card[data-id="3"]');
  appended.querySelector('.k-card-fav').click();
  expect(mockToggleFav).toHaveBeenCalledWith('3', expect.any(HTMLElement));
  appended.querySelector('.k-card-add').click();
  expect(mockQuickAdd).toHaveBeenCalledWith('3', expect.any(HTMLElement));
  appended.querySelector('.k-card-add').innerHTML = '<span class="k-add-minus">−</span>';
  appended.querySelector('.k-add-minus').click();
  expect(mockQuickRemove).toHaveBeenCalledWith('3', expect.any(HTMLElement));
  appended.querySelector('.k-card-name').click();
  expect(mockOpenModal).toHaveBeenCalledWith('3');
});

test('la fin d’une page propose la sous-catégorie suivante puis la dernière affiche son message', () => {
  const grid = fixture({ pageSize: 10 });
  _setupFlatSubcatPager();
  const fruitPage = grid.querySelector('[data-flat-sub="fruits"]');
  ioInstances[0].callback([{ isIntersecting: true }]);
  expect(fruitPage.querySelector('.k-flat-page-end-next').dataset.nextSub).toBe('legumes');
  fruitPage.querySelector('.k-flat-page-end-next').click();
  expect(grid.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));

  const lastPage = grid.querySelector('[data-flat-sub="boissons"]');
  ioInstances[2].callback([{ isIntersecting: true }]);
  expect(lastPage.textContent).toContain('Dernière sous-catégorie');
  ioInstances[2].callback([{ isIntersecting: true }]);
  expect(lastPage.querySelectorAll('.k-flat-page-end')).toHaveLength(1);
});

test('réinstalle les observers en déconnectant ceux déjà présents', () => {
  const grid = fixture();
  _setupFlatSubcatPager();
  const firstPage = grid.querySelector('.k-flat-subcat-page');
  const oldObserver = firstPage._flatIO;
  _setupFlatSubcatPager();
  expect(oldObserver.disconnect).toHaveBeenCalled();
});

test('les contrôles ferment le mode flat et font défiler les tabs', () => {
  const grid = fixture();
  _bindFlatSubcatControls();
  document.querySelector('[data-flat-sub="legumes"]').click();
  expect(grid.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
  document.getElementById('k-flat-subcat-close').click();
  expect(state.flatSubcat).toBeNull();
  expect(state.page).toBe(0);
  expect(mockRenderGrid).toHaveBeenCalled();
  expect(dom.pageScroll.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
});

test('le listener délégué gère les chips mobile Tout/sous-cat et ignore les chips flat', () => {
  fixture();
  const chip = document.createElement('button');
  chip.className = 'k-sec-subchip';
  chip.dataset.secCat = 'alimentation';
  chip.dataset.secSub = 'legumes';
  document.body.appendChild(chip);
  chip.click();
  expect(state.flatSubcat).toEqual({ cat: 'alimentation', sub: 'legumes' });
  expect(mockRenderGrid).toHaveBeenCalled();

  const all = document.createElement('button');
  all.className = 'k-sec-subchip';
  all.dataset.secCat = 'alimentation';
  all.dataset.secSubAll = '1';
  document.body.appendChild(all);
  all.click();
  expect(state.flatSubcat).toBeNull();

  const flat = document.createElement('button');
  flat.className = 'k-sec-subchip';
  flat.dataset.flatSub = 'fruits';
  document.body.appendChild(flat);
  mockRenderGrid.mockClear();
  flat.click();
  expect(mockRenderGrid).not.toHaveBeenCalled();
});

test('le listener délégué desktop bascule sectionSubcats', () => {
  fixture();
  mockIsDesktop.mockReturnValue(true);
  const chip = document.createElement('button');
  chip.className = 'k-sec-subchip';
  chip.dataset.secCat = 'alimentation';
  chip.dataset.secSub = 'fruits';
  document.body.appendChild(chip);
  chip.click();
  expect(state.sectionSubcats.alimentation).toBe('fruits');
  chip.click();
  expect(state.sectionSubcats.alimentation).toBeNull();

  const all = document.createElement('button');
  all.className = 'k-sec-subchip';
  all.dataset.secCat = 'alimentation';
  all.dataset.secSubAll = '1';
  document.body.appendChild(all);
  all.click();
  expect(state.sectionSubcats.alimentation).toBeNull();
});

test('les chips invalides sont ignorées et le compteur utilise le singulier', () => {
  const grid = fixture();
  _syncFlatActiveTab('legumes');
  expect(document.getElementById('k-flat-subcat-count').textContent).toBe('1 produit');

  const invalid = document.createElement('button');
  invalid.className = 'k-sec-subchip';
  document.body.appendChild(invalid);
  mockRenderGrid.mockClear();
  invalid.click();
  expect(mockRenderGrid).not.toHaveBeenCalled();
  expect(grid).not.toBeNull();
});
