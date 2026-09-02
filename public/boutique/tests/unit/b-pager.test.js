'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Temu V2 — invariants utiles :
 * - swipe horizontal explicite entre catégories ;
 * - aucun ghost loop ;
 * - aucun auto-advance vertical ;
 * - position verticale mémorisée indépendamment par univers ;
 * - cage mobile nettoyable sans effet desktop.
 */

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(() => false),
  getScrollY: jest.fn(() => 0),
  scrollToPosition: jest.fn(),
  clearInlinePagerStyles: jest.fn(),
  DESKTOP_BREAKPOINT: 900,
}));

const { isDesktop } = require('../../js/b-scroll-owner.js');
const { state, dom } = require('../../js/b-store.js');
const pager = require('../../js/b-pager.js');

function makeGrid(cats = ['all', 'Mode']) {
  const grid = document.createElement('div');
  grid.id = 'k-grid';
  grid.scrollTo = jest.fn(({ left }) => {
    grid.scrollLeft = Number(left) || 0;
  });
  cats.forEach((cat) => {
    const page = document.createElement('section');
    page.className = 'k-cat-section';
    page.dataset.cat = cat;
    const inner = document.createElement('div');
    inner.className = 'k-sec-grid';
    page.appendChild(inner);
    grid.appendChild(page);
  });
  document.body.appendChild(grid);
  return grid;
}

beforeEach(() => {
  isDesktop.mockReturnValue(false);
  document.body.innerHTML = '';
  state.modalOpen = false;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  dom.pageScroll = document.createElement('div');
  dom.pageScroll.id = 'k-page-scroll';
  document.body.appendChild(dom.pageScroll);
  ['--pager-top', '--pager-h', '--pager-w', '--bnav-h'].forEach((name) => {
    document.documentElement.style.removeProperty(name);
  });
});

afterEach(() => {
  pager.destroyMobilePager();
  jest.clearAllTimers();
});

test('conserve le contrat d exports attendu par les appelants historiques', () => {
  [
    '_setupMobilePager', '_recalcPagerVars', '_setupSectionAutoAdvance',
    '_setupHorizontalWrap', '_syncChipToScroll', '_onPagerScroll',
    '_scrollPagerToCat', '_scrollPagerToGhost', '_reshuffleToutInDOM',
    '_setupInfiniteLoop', '_setupPagerDots', 'destroyMobilePager',
  ].forEach((name) => expect(typeof pager[name]).toBe('function'));
});

test('mobile : calcule les variables de cage sans changer la grammaire Temu', () => {
  pager._recalcPagerVars();
  expect(document.documentElement.style.getPropertyValue('--pager-w')).toBe('390px');
  expect(document.documentElement.style.getPropertyValue('--pager-h')).toBeTruthy();
  expect(dom.pageScroll.style.width).toBe('100vw');
});

test('desktop : détruit la cage mobile', () => {
  document.documentElement.style.setProperty('--pager-w', '390px');
  isDesktop.mockReturnValue(true);
  pager._recalcPagerVars();
  expect(document.documentElement.style.getPropertyValue('--pager-w')).toBe('');
});

test('setup mobile : installe le swipe horizontal sans créer de ghost', () => {
  const grid = makeGrid(['all', 'Mode', 'Maison']);
  pager._setupMobilePager();
  expect(typeof grid._pagerScrollH).toBe('function');
  expect(grid.querySelector('[data-ghost]')).toBeNull();
});

test('_setupInfiniteLoop nettoie un éventuel ghost legacy au lieu d en créer', () => {
  const grid = makeGrid(['all', 'Mode']);
  const ghost = grid.firstElementChild.cloneNode(true);
  ghost.dataset.ghost = 'true';
  grid.appendChild(ghost);
  expect(grid.querySelectorAll('[data-ghost]').length).toBe(1);

  pager._setupInfiniteLoop();

  expect(grid.querySelectorAll('[data-ghost]').length).toBe(0);
  expect(grid.querySelectorAll('.k-cat-section').length).toBe(2);
});

test('arriver en bas ne câble aucun changement automatique de catégorie', () => {
  const grid = makeGrid(['all', 'Mode']);
  const page = grid.querySelector('[data-cat="Mode"]');
  page._bounceH = jest.fn();
  page.addEventListener('scroll', page._bounceH);
  page._bounceTouchEnd = jest.fn();
  page.addEventListener('touchend', page._bounceTouchEnd);

  pager._setupSectionAutoAdvance();

  expect(page._bounceH).toBeNull();
  expect(page._bounceTouchEnd).toBeNull();
  expect(page._bounceTimer).toBeUndefined();
});

test('tap catégorie conserve la navigation horizontale explicite', () => {
  const grid = makeGrid(['all', 'Mode', 'Maison']);
  const ok = pager._scrollPagerToCat('Maison', 'smooth');
  expect(ok).toBe(true);
  expect(grid.scrollTo).toHaveBeenCalledWith({ left: 780, behavior: 'smooth' });
});

test('catégorie absente : ne navigue pas', () => {
  const grid = makeGrid(['all']);
  expect(pager._scrollPagerToCat('Tech')).toBe(false);
  expect(grid.scrollTo).not.toHaveBeenCalled();
});

test('restaure la position verticale après remplacement du DOM', () => {
  let grid = makeGrid(['temu-v2-a', 'temu-v2-b']);
  pager._setupMobilePager();

  const firstPageB = grid.querySelector('[data-cat="temu-v2-b"]');
  firstPageB.scrollTop = 428;
  firstPageB.dispatchEvent(new Event('scroll'));

  pager.destroyMobilePager();
  grid.remove();

  grid = makeGrid(['temu-v2-a', 'temu-v2-b']);
  pager._setupMobilePager();
  expect(grid.querySelector('[data-cat="temu-v2-b"]').scrollTop).toBe(428);
});

test('mémorise indépendamment chaque univers', () => {
  let grid = makeGrid(['temu-v2-c', 'temu-v2-d']);
  pager._setupMobilePager();

  const c = grid.querySelector('[data-cat="temu-v2-c"]');
  const d = grid.querySelector('[data-cat="temu-v2-d"]');
  c.scrollTop = 116;
  c.dispatchEvent(new Event('scroll'));
  d.scrollTop = 733;
  d.dispatchEvent(new Event('scroll'));

  pager.destroyMobilePager();
  grid.remove();

  grid = makeGrid(['temu-v2-c', 'temu-v2-d']);
  pager._setupMobilePager();
  expect(grid.querySelector('[data-cat="temu-v2-c"]').scrollTop).toBe(116);
  expect(grid.querySelector('[data-cat="temu-v2-d"]').scrollTop).toBe(733);
});

test('destroy nettoie classes et variables pager mais conserve la mémoire métier locale', () => {
  const grid = makeGrid(['all', 'Mode']);
  grid.classList.add('k-grid-cat-pager');
  dom.pageScroll.classList.add('k-pager-active');
  pager._setupMobilePager();

  pager.destroyMobilePager();

  expect(grid.classList.contains('k-grid-cat-pager')).toBe(false);
  expect(dom.pageScroll.classList.contains('k-pager-active')).toBe(false);
  expect(document.documentElement.style.getPropertyValue('--pager-w')).toBe('');
});
