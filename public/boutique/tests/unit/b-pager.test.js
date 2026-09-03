'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Temu V2.9 — invariants utiles :
 * - swipe horizontal explicite entre catégories ;
 * - un ghost droite inerte de Tout pour la continuité dernière catégorie → Tout ;
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
  Object.defineProperty(grid, 'clientWidth', { configurable: true, value: 390 });
  grid.scrollTo = jest.fn(({ left }) => {
    grid.scrollLeft = Number(left) || 0;
  });
  cats.forEach((cat) => {
    const page = document.createElement('section');
    page.className = 'k-cat-section';
    page.dataset.cat = cat;
    const inner = document.createElement('div');
    inner.className = 'k-sec-grid';
    inner.id = `grid-${cat}`;
    const button = document.createElement('button');
    button.id = `button-${cat}`;
    button.textContent = cat;
    inner.appendChild(button);
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

test('setup mobile : installe le swipe horizontal avec un unique ghost droite de Tout', () => {
  const grid = makeGrid(['all', 'Mode', 'Maison']);
  pager._setupInfiniteLoop();
  pager._setupMobilePager();

  expect(typeof grid._pagerScrollH).toBe('function');
  expect(grid.querySelectorAll(':scope > [data-ghost="right"]')).toHaveLength(1);
  const ghost = grid.lastElementChild;
  expect(ghost.dataset.ghost).toBe('right');
  expect(ghost.dataset.cat).toBe('all');
  expect(ghost.getAttribute('aria-hidden')).toBe('true');
  expect(ghost.hasAttribute('inert')).toBe(true);
  expect(ghost.style.pointerEvents).toBe('none');
  expect(ghost.querySelector('[id]')).toBeNull();
  expect(ghost.querySelector('button').getAttribute('tabindex')).toBe('-1');
  expect(grid.querySelectorAll(':scope > .k-cat-section:not([data-ghost])')).toHaveLength(3);
});

test('_setupInfiniteLoop remplace un ghost existant par un snapshot frais sans dupliquer les ids', () => {
  const grid = makeGrid(['all', 'Mode']);
  pager._setupInfiniteLoop();
  const firstGhost = grid.querySelector('[data-ghost="right"]');
  expect(firstGhost).not.toBeNull();

  const realTout = grid.querySelector('[data-cat="all"]:not([data-ghost])');
  realTout.querySelector('button').textContent = 'Tout actualisé';
  pager._setupInfiniteLoop();

  const ghosts = grid.querySelectorAll('[data-ghost="right"]');
  expect(ghosts).toHaveLength(1);
  expect(ghosts[0]).not.toBe(firstGhost);
  expect(ghosts[0].textContent).toContain('Tout actualisé');
  expect(ghosts[0].querySelector('[id]')).toBeNull();
  expect(document.querySelectorAll('#grid-all')).toHaveLength(1);
  expect(document.querySelectorAll('#button-all')).toHaveLength(1);
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

test('tap catégorie conserve la navigation horizontale explicite et ignore le ghost', () => {
  const grid = makeGrid(['all', 'Mode', 'Maison']);
  pager._setupInfiniteLoop();
  const ok = pager._scrollPagerToCat('Maison', 'smooth');
  expect(ok).toBe(true);
  expect(grid.scrollTo).toHaveBeenCalledWith({ left: 780, behavior: 'smooth' });
});

test('catégorie absente : ne navigue pas', () => {
  const grid = makeGrid(['all']);
  pager._setupInfiniteLoop();
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

test('destroy nettoie ghost, classes et variables pager mais conserve la mémoire locale', () => {
  const grid = makeGrid(['all', 'Mode']);
  grid.classList.add('k-grid-cat-pager');
  dom.pageScroll.classList.add('k-pager-active');
  pager._setupInfiniteLoop();
  pager._setupMobilePager();

  expect(grid.querySelector('[data-ghost]')).not.toBeNull();
  pager.destroyMobilePager();

  expect(grid.querySelector('[data-ghost]')).toBeNull();
  expect(grid.classList.contains('k-grid-cat-pager')).toBe(false);
  expect(dom.pageScroll.classList.contains('k-pager-active')).toBe(false);
  expect(document.documentElement.style.getPropertyValue('--pager-w')).toBe('');
});
