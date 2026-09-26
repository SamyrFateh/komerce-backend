'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  PULL_PX,
  setupPagerEndBounce,
  teardownPagerEndBounce,
  isAtBottom,
  isAtTop,
  distanceFromBottom,
} = require('../../js/b-pager-end-bounce.js');

function touch(type, x, y) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, type === 'touchend' ? 'changedTouches' : 'touches', {
    value: [{ clientX: x, clientY: y }],
  });
  return event;
}

function makePage(cat, { top = 0, height = 300, scrollHeight = 900 } = {}) {
  const page = document.createElement('section');
  page.className = 'k-cat-section';
  page.dataset.cat = cat;
  page.scrollTop = top;
  Object.defineProperty(page, 'clientHeight', { configurable: true, value: height });
  Object.defineProperty(page, 'scrollHeight', { configurable: true, value: scrollHeight });
  return page;
}

// Par défaut : tirage vers le HAUT de 60 px (≥ PULL_PX), quasi vertical.
function gesture(page, start = { x: 100, y: 180 }, end = { x: 104, y: 120 }) {
  page.dispatchEvent(touch('touchstart', start.x, start.y));
  page.dispatchEvent(touch('touchmove', end.x, end.y));
  page.dispatchEvent(touch('touchend', end.x, end.y));
}

beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = `
    <div id="k-cats">
      <button class="k-chip" data-cat="Mode"><span class="k-chip-label">La mode</span></button>
    </div>`;
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

function pullDown(page, px = 60) { gesture(page, { x: 100, y: 120 }, { x: 103, y: 120 + px }); }

test('mesure la fin et le début de page', () => {
  const page = makePage('all', { top: 568 });
  expect(isAtBottom(page)).toBe(true);
  expect(isAtBottom(page, 12)).toBe(false);
  expect(distanceFromBottom(page)).toBe(32);
  expect(distanceFromBottom(null)).toBe(Infinity);
  expect(isAtBottom(null)).toBe(false);
  expect(isAtTop(makePage('x', { top: 0 }))).toBe(true);
  expect(isAtTop(makePage('x', { top: 5 }))).toBe(false);
  expect(isAtTop(null)).toBe(false);
  expect(PULL_PX).toBe(56);
});

test('A — arriver en bas par un simple scroll ne change JAMAIS de rayon', () => {
  const page = makePage('all', { top: 500 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);
  expect(setupPagerEndBounce({ pages: [page, next], onAdvance })).toBe(2);

  page.scrollTop = 600; // bas atteint (600 + 300 = 900)
  page.dispatchEvent(new Event('scroll'));
  jest.advanceTimersByTime(2000);
  expect(onAdvance).not.toHaveBeenCalled();
});

test('A — un geste qui arrive en bas pendant le glissement ne change pas de rayon', () => {
  const page = makePage('all', { top: 540 }); // pas encore en bas au départ du geste
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], onAdvance });

  page.dispatchEvent(touch('touchstart', 100, 300));
  page.scrollTop = 600;
  page.dispatchEvent(new Event('scroll'));
  page.dispatchEvent(touch('touchmove', 100, 180));
  page.dispatchEvent(touch('touchend', 100, 180));
  jest.advanceTimersByTime(2000);
  expect(onAdvance).not.toHaveBeenCalled();
});

test('A — déjà en bas, un tirage volontaire vers le haut avance', () => {
  const page = makePage('all', { top: 600 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], onAdvance });

  gesture(page);
  jest.advanceTimersByTime(39);
  expect(onAdvance).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(onAdvance).toHaveBeenCalledWith(page, next);
});

test('A — un tirage trop court depuis le bas ne fait rien', () => {
  const page = makePage('all', { top: 600 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], onAdvance });

  gesture(page, { x: 100, y: 180 }, { x: 100, y: 180 - (PULL_PX - 1) });
  jest.advanceTimersByTime(500);
  expect(onAdvance).not.toHaveBeenCalled();
});

test('A — page courte : un tirage volontaire vers le haut avance', () => {
  const page = makePage('all', { height: 300, scrollHeight: 300 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], onAdvance });

  gesture(page);
  jest.advanceTimersByTime(40);
  expect(onAdvance).toHaveBeenCalledWith(page, next);
});

test('B — tout en haut, un tirage volontaire vers le bas recule au rayon précédent', () => {
  const prev = makePage('all', { top: 0 });
  const page = makePage('Mode', { top: 0 });
  const onAdvance = jest.fn();
  const onRetreat = jest.fn();
  document.body.append(prev, page);
  setupPagerEndBounce({ pages: [prev, page], onAdvance, onRetreat });

  pullDown(page);
  jest.advanceTimersByTime(40);
  expect(onRetreat).toHaveBeenCalledWith(page, prev);
  expect(onAdvance).not.toHaveBeenCalled();
});

test('B — le premier rayon ne recule pas, et sans onRetreat rien ne se passe', () => {
  const first = makePage('all', { top: 0 });
  const second = makePage('Mode', { top: 0 });
  const onRetreat = jest.fn();
  document.body.append(first, second);
  setupPagerEndBounce({ pages: [first, second], onAdvance: jest.fn(), onRetreat });
  pullDown(first);
  jest.advanceTimersByTime(500);
  expect(onRetreat).not.toHaveBeenCalled();

  setupPagerEndBounce({ pages: [first, second], onAdvance: jest.fn() });
  pullDown(second);
  jest.advanceTimersByTime(500);
  expect(onRetreat).not.toHaveBeenCalled();
});

test('B — un tirage vers le bas en milieu de page ne recule pas', () => {
  const prev = makePage('all');
  const page = makePage('Mode', { top: 200 });
  const onRetreat = jest.fn();
  document.body.append(prev, page);
  setupPagerEndBounce({ pages: [prev, page], onAdvance: jest.fn(), onRetreat });

  pullDown(page, 120);
  jest.advanceTimersByTime(500);
  expect(onRetreat).not.toHaveBeenCalled();
});

test('un swipe surtout horizontal ne change jamais de rayon (haut ou bas)', () => {
  const prev = makePage('all', { top: 0 });
  const page = makePage('Mode', { top: 600 });
  const onAdvance = jest.fn();
  const onRetreat = jest.fn();
  document.body.append(prev, page);
  setupPagerEndBounce({ pages: [prev, page], onAdvance, onRetreat });

  gesture(page, { x: 40, y: 180 }, { x: 160, y: 120 });
  page.scrollTop = 0;
  gesture(page, { x: 40, y: 120 }, { x: 160, y: 180 });
  jest.advanceTimersByTime(500);
  expect(onAdvance).not.toHaveBeenCalled();
  expect(onRetreat).not.toHaveBeenCalled();
});

test('quitter le bord pendant l’attente annule le passage', () => {
  const page = makePage('all', { top: 600 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], onAdvance });

  gesture(page);
  page.scrollTop = 450;
  page.dispatchEvent(new Event('scroll'));
  jest.advanceTimersByTime(500);
  expect(onAdvance).not.toHaveBeenCalled();
});

test('une modale ouverte bloque avance et recul, y compris après armement du timer', () => {
  const prev = makePage('all', { top: 0 });
  const page = makePage('Mode', { top: 600 });
  const onAdvance = jest.fn();
  const onRetreat = jest.fn();
  let blocked = true;
  document.body.append(prev, page);
  setupPagerEndBounce({ pages: [prev, page], isBlocked: () => blocked, onAdvance, onRetreat });

  gesture(page);
  jest.advanceTimersByTime(500);
  expect(onAdvance).not.toHaveBeenCalled();

  blocked = false;
  gesture(page);
  blocked = true;
  jest.advanceTimersByTime(40);
  expect(onAdvance).not.toHaveBeenCalled();

  blocked = false;
  page.scrollTop = 0;
  pullDown(page);
  blocked = true;
  jest.advanceTimersByTime(40);
  expect(onRetreat).not.toHaveBeenCalled();
});

test('touchcancel et teardown annulent tout passage et retirent les listeners', () => {
  const page = makePage('all', { top: 600 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], onAdvance });

  page.dispatchEvent(touch('touchstart', 100, 180));
  page.dispatchEvent(touch('touchmove', 100, 120));
  page.dispatchEvent(new Event('touchcancel'));
  jest.advanceTimersByTime(500);
  expect(onAdvance).not.toHaveBeenCalled();

  gesture(page);
  teardownPagerEndBounce([page, next]);
  expect(page._pagerEndBounce).toBeUndefined();
  jest.advanceTimersByTime(500);
  expect(onAdvance).not.toHaveBeenCalled();
});

test('la dernière page boucle bien vers la première', () => {
  const first = makePage('all', { top: 600 });
  const last = makePage('Mode', { top: 600 });
  const onAdvance = jest.fn();
  document.body.append(first, last);
  setupPagerEndBounce({ pages: [first, last], onAdvance });

  gesture(last);
  jest.advanceTimersByTime(40);
  expect(onAdvance).toHaveBeenCalledWith(last, first);
});

test('API défensive : pas de pages, une seule page ou aucun callback', () => {
  const page = makePage('all');
  expect(setupPagerEndBounce({ pages: [], onAdvance: jest.fn() })).toBe(0);
  expect(setupPagerEndBounce({ pages: null, onAdvance: jest.fn() })).toBe(0);
  expect(setupPagerEndBounce({ pages: [page], onAdvance: jest.fn() })).toBe(0);
  expect(setupPagerEndBounce({ pages: [page, makePage('Mode')] })).toBe(0);
  teardownPagerEndBounce();
});

test('les événements tactiles incomplets restent inertes', () => {
  const page = makePage('all', { top: 600 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], onAdvance });

  page.dispatchEvent(new Event('scroll'));
  const changedOnlyStart = new Event('touchstart');
  Object.defineProperty(changedOnlyStart, 'changedTouches', {
    value: [{ clientX: 100, clientY: 180 }],
  });
  page.dispatchEvent(changedOnlyStart);
  page.dispatchEvent(new Event('touchmove'));
  page.dispatchEvent(new Event('touchend'));
  page.dispatchEvent(new Event('touchstart'));
  jest.advanceTimersByTime(500);
  expect(onAdvance).not.toHaveBeenCalled();
});
