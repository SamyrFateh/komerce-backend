'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const mockIsDesktop = jest.fn(() => false);
const mockRenderGrid = jest.fn();
const mockOpenModal = jest.fn();
const mockToggleFav = jest.fn();
const mockQuickAdd = jest.fn();
const mockQuickRemove = jest.fn();
const mockOpenCartWithHighlight = jest.fn();
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
  destroyMobilePager: jest.fn(),
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
  openCartWithHighlight: mockOpenCartWithHighlight,
}));
jest.mock('../../js/b-cart-core.js', () => ({ showToast: jest.fn() }));
jest.mock('../../js/shop-schema.js', () => ({
  getSubcategories: mockGetSubcategories,
  normalizeCategoryKey: jest.fn((value) => value),
  matchesSubcategory: jest.fn((category, key, value) => key === value),
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

function mount({ pageSize = 2 } = {}) {
  state.flatSubcat = { cat: 'alimentation', sub: 'fruits' };
  state.pageSize = pageSize;
  state.page = 0;
  state.sectionSubcats = {};
  state.filtered = [
    product(1, 'fruits'), product(2, 'fruits'), product(3, 'fruits'),
    product(4, 'fruits'), product(5, 'fruits'), product(6, 'legumes'),
  ];
  document.body.innerHTML = '<section id="k-catalog-section"><div id="k-grid"></div></section>';
  dom.grid = document.getElementById('k-grid');
  dom.grid.scrollTo = jest.fn();
  dom.pageScroll = document.createElement('div');
  dom.pageScroll.scrollTo = jest.fn();
  dom.grid.innerHTML = _renderFlatSubcat();
  _mountFlatSubcatChrome();
  const bar = document.getElementById('k-flat-subcat-tabs');
  if (bar) bar.scrollTo = jest.fn();
  dom.grid.querySelectorAll('.k-flat-subcat-page').forEach((page, index) => {
    Object.defineProperty(page, 'offsetLeft', { configurable: true, value: index * 320 });
  });
  return dom.grid;
}

function pointer(type, x, y, target = dom.grid) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clientX', { configurable: true, value: x });
  Object.defineProperty(event, 'clientY', { configurable: true, value: y });
  target.dispatchEvent(event);
  return event;
}

function touch(type, x, y, target = dom.grid) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: x, clientY: y };
  Object.defineProperty(event, 'touches', { configurable: true, value: [point] });
  Object.defineProperty(event, 'changedTouches', { configurable: true, value: [point] });
  target.dispatchEvent(event);
  return event;
}

function subchip({ cat = 'alimentation', sub, all = false } = {}) {
  const chip = document.createElement('button');
  chip.className = 'k-sec-subchip';
  chip.dataset.secCat = cat;
  if (sub) chip.dataset.secSub = sub;
  if (all) chip.dataset.secSubAll = '1';
  document.body.appendChild(chip);
  return chip;
}

beforeAll(() => initFlatSubcat());

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  global.requestAnimationFrame = jest.fn((callback) => { callback(); return 1; });
  global.cancelAnimationFrame = jest.fn();
  ioInstances.length = 0;
  mockIsDesktop.mockReturnValue(false);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

test('rend le fallback vide', () => {
  mockGetSubcategories.mockReturnValueOnce([{ key: 'vide', label: 'Vide', icon: '✨' }]);
  state.flatSubcat = { cat: 'alimentation', sub: 'vide' };
  state.filtered = [];
  state.pageSize = 2;
  expect(_renderFlatSubcat()).toContain('k-flat-subcat-empty');
});

test('initialise le pager et synchronise la page visible', () => {
  const grid = mount();
  _setupFlatSubcatPager();
  expect(grid.classList.contains('k-grid-flat-subcat')).toBe(true);
  expect(ioInstances).toHaveLength(3);
  grid.scrollLeft = 330;
  grid.dispatchEvent(new Event('scroll'));
  expect(state.flatSubcat.sub).toBe('legumes');
});

test('le swipe tactile horizontal déplace la grille', () => {
  const grid = mount();
  _setupFlatSubcatPager();
  grid.scrollLeft = 100;
  touch('touchstart', 200, 100);
  const move = touch('touchmove', 120, 105);
  expect(move.defaultPrevented).toBe(true);
  expect(grid.scrollLeft).toBe(180);
  touch('touchend', 120, 105);
  jest.advanceTimersByTime(180);
  expect(grid.classList.contains('is-flat-dragging')).toBe(false);
});

test('le swipe vertical et les boutons sont ignorés', () => {
  const grid = mount();
  _setupFlatSubcatPager();
  grid.scrollLeft = 100;
  touch('touchstart', 200, 100);
  touch('touchmove', 195, 180);
  expect(grid.scrollLeft).toBe(100);
  const button = grid.querySelector('.k-card-add');
  touch('touchstart', 200, 100, button);
  touch('touchmove', 100, 100, button);
  expect(grid.classList.contains('is-flat-dragging')).toBe(false);
});

test('le drag pointeur neutralise le clic après swipe', () => {
  const grid = mount();
  _setupFlatSubcatPager();
  grid.scrollLeft = 50;
  pointer('pointerdown', 200, 100);
  const move = pointer('pointermove', 120, 104);
  expect(move.defaultPrevented).toBe(true);
  expect(grid.scrollLeft).toBe(130);
  pointer('pointerup', 120, 104);
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  grid.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);
});

test('le geste vertical pointeur ne déclenche pas le drag', () => {
  const grid = mount();
  _setupFlatSubcatPager();
  pointer('pointerdown', 200, 100);
  pointer('pointermove', 195, 190);
  expect(grid.classList.contains('is-flat-dragging')).toBe(false);
});

test('IntersectionObserver ajoute et câble les nouvelles cartes', () => {
  const grid = mount({ pageSize: 2 });
  _setupFlatSubcatPager();
  const page = grid.querySelector('[data-flat-sub="fruits"]');
  ioInstances[0].callback([{ isIntersecting: true }]);
  expect(page.querySelectorAll('.k-card')).toHaveLength(4);
  const card = page.querySelector('.k-card[data-id="3"]');
  card.querySelector('.k-card-fav').click();
  expect(mockToggleFav).toHaveBeenCalledWith('3', expect.any(HTMLElement));
  card.querySelector('.k-card-add').click();
  expect(mockQuickAdd).toHaveBeenCalledWith('3', expect.any(HTMLElement));
  card.querySelector('.k-card-add').innerHTML = '<span class="k-add-minus">−</span>';
  card.querySelector('.k-add-minus').click();
  expect(mockQuickRemove).toHaveBeenCalledWith('3', expect.any(HTMLElement));
  card.querySelector('.k-card-name').click();
  expect(mockOpenModal).toHaveBeenCalledWith('3');
  expect(mockBindCarouselDots).toHaveBeenCalled();
});

test('la fin de page propose la suivante et reste idempotente', () => {
  const grid = mount({ pageSize: 10 });
  _setupFlatSubcatPager();
  const fruitPage = grid.querySelector('[data-flat-sub="fruits"]');
  ioInstances[0].callback([{ isIntersecting: true }]);
  fruitPage.querySelector('.k-flat-page-end-next').click();
  expect(grid.scrollTo).toHaveBeenCalled();
  const last = grid.querySelector('[data-flat-sub="boissons"]');
  ioInstances[2].callback([{ isIntersecting: true }]);
  ioInstances[2].callback([{ isIntersecting: true }]);
  expect(last.querySelectorAll('.k-flat-page-end')).toHaveLength(1);
  expect(last.textContent).toContain('Dernière sous-catégorie');
});

test('réinstalle les observers en déconnectant les précédents', () => {
  const grid = mount();
  _setupFlatSubcatPager();
  const old = grid.querySelector('.k-flat-subcat-page')._flatIO;
  _setupFlatSubcatPager();
  expect(old.disconnect).toHaveBeenCalled();
});

test('les contrôles ferment le mode flat et défilent les tabs', () => {
  const grid = mount();
  _bindFlatSubcatControls();
  document.querySelector('.k-flat-subcat-tab[data-flat-sub="legumes"]').click();
  expect(grid.scrollTo).toHaveBeenCalled();
  document.getElementById('k-flat-subcat-close').click();
  expect(state.flatSubcat).toBeNull();
  expect(mockRenderGrid).toHaveBeenCalled();
  expect(dom.pageScroll.scrollTo).toHaveBeenCalled();
});

test('les chips déléguées gèrent mobile et Tout', () => {
  mount();
  subchip({ sub: 'legumes' }).click();
  expect(state.flatSubcat).toEqual({ cat: 'alimentation', sub: 'legumes' });
  subchip({ all: true }).click();
  expect(state.flatSubcat).toBeNull();
});

test('les chips déléguées desktop basculent sectionSubcats', () => {
  mount();
  mockIsDesktop.mockReturnValue(true);
  const chip = subchip({ sub: 'legumes' });
  chip.click();
  expect(state.sectionSubcats.alimentation).toBe('legumes');
  chip.click();
  expect(state.sectionSubcats.alimentation).toBeNull();
  subchip({ all: true }).click();
  expect(state.sectionSubcats.alimentation).toBeNull();
});

test('le compteur actif utilise le singulier', () => {
  mount();
  _syncFlatActiveTab('legumes');
  expect(document.getElementById('k-flat-subcat-count').textContent).toBe('1 produit');
});
