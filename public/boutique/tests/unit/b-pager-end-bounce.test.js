'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  setupPagerEndBounce,
  teardownPagerEndBounce,
  isAtBottom,
  distanceFromBottom,
  nextPageLabel,
  showNextHint,
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

function pullUp(page, start = { x: 100, y: 180 }, end = { x: 104, y: 120 }) {
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

test('mesure la fin de page et résout le libellé de la catégorie suivante', () => {
  const page = makePage('all', { top: 588 });
  const next = makePage('Mode');
  expect(isAtBottom(page)).toBe(true);
  expect(distanceFromBottom(page)).toBe(12);
  expect(nextPageLabel(next)).toBe('La mode');
  expect(nextPageLabel(makePage('Tech'))).toBe('Tech');
  expect(distanceFromBottom(null)).toBe(Infinity);
  expect(isAtBottom(null)).toBe(false);
});

test('le premier geste en bas affiche le hint sans jamais avancer', () => {
  const page = makePage('all', { top: 600 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);

  expect(setupPagerEndBounce({ pages: [page, next], onAdvance })).toBe(2);
  pullUp(page);

  expect(onAdvance).not.toHaveBeenCalled();
  expect(page.querySelector('.k-pager-next-hint').textContent).toBe('La mode →');
  expect(page.querySelector('.k-pager-next-hint').getAttribute('aria-hidden')).toBe('true');
});

test('une seconde impulsion verticale volontaire avance une seule fois', () => {
  const page = makePage('all', { top: 600 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], onAdvance });

  pullUp(page);
  pullUp(page);

  expect(onAdvance).toHaveBeenCalledTimes(1);
  expect(onAdvance).toHaveBeenCalledWith(page, next);
  expect(page.querySelector('.k-pager-next-hint')).toBeNull();
});

test('un swipe surtout horizontal ne déclenche pas le changement', () => {
  const page = makePage('all', { top: 600 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], onAdvance });

  pullUp(page);
  pullUp(page, { x: 40, y: 180 }, { x: 160, y: 125 });

  expect(onAdvance).not.toHaveBeenCalled();
});

test('atteindre le bas par scroll arme le geste sans auto-advance', () => {
  const page = makePage('all', { top: 500 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], onAdvance });

  page.scrollTop = 600;
  page.dispatchEvent(new Event('scroll'));

  expect(onAdvance).not.toHaveBeenCalled();
  expect(page.querySelector('.k-pager-next-hint')).not.toBeNull();
  pullUp(page);
  expect(onAdvance).toHaveBeenCalledTimes(1);
});

test('quitter le bas ou laisser expirer le signal désarme le geste', () => {
  const page = makePage('all', { top: 600 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], onAdvance });

  pullUp(page);
  page.scrollTop = 450;
  page.dispatchEvent(new Event('scroll'));
  expect(page.querySelector('.k-pager-next-hint')).toBeNull();

  page.scrollTop = 600;
  pullUp(page);
  jest.advanceTimersByTime(4500);
  pullUp(page);
  expect(onAdvance).not.toHaveBeenCalled();
});

test('modale ouverte, annulation tactile et teardown restent inertes', () => {
  const page = makePage('all', { top: 600 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  let blocked = true;
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], isBlocked: () => blocked, onAdvance });

  pullUp(page);
  expect(page.querySelector('.k-pager-next-hint')).toBeNull();

  blocked = false;
  pullUp(page);
  page.dispatchEvent(touch('touchstart', 100, 180));
  page.dispatchEvent(new Event('touchcancel'));
  page.dispatchEvent(touch('touchend', 100, 110));
  expect(onAdvance).not.toHaveBeenCalled();

  teardownPagerEndBounce([page, next]);
  expect(page._pagerEndBounce).toBeUndefined();
  expect(page.querySelector('.k-pager-next-hint')).toBeNull();
  pullUp(page);
  expect(onAdvance).not.toHaveBeenCalled();
});

test('API défensive : pas de pages, une seule page ou aucun callback', () => {
  const page = makePage('all');
  expect(setupPagerEndBounce({ pages: [], onAdvance: jest.fn() })).toBe(0);
  expect(setupPagerEndBounce({ pages: null, onAdvance: jest.fn() })).toBe(0);
  expect(setupPagerEndBounce({ pages: [page], onAdvance: jest.fn() })).toBe(0);
  expect(setupPagerEndBounce({ pages: [page, makePage('Mode')] })).toBe(0);
  expect(nextPageLabel(null)).toBe('Tout');
  expect(showNextHint(null, page)).toBeNull();
  expect(showNextHint(page, null)).toBeNull();
  teardownPagerEndBounce();
});

test('les branches tactiles incomplètes et les scrolls ambigus restent inertes', () => {
  const page = makePage('all', { top: 500 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  let blocked = true;
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], isBlocked: () => blocked, onAdvance });

  page.scrollTop = 520;
  page.dispatchEvent(new Event('scroll'));

  blocked = false;
  page.scrollTop = 570;
  page.dispatchEvent(new Event('scroll'));
  expect(page.querySelector('.k-pager-next-hint')).toBeNull();

  page.scrollTop = 600;
  page.dispatchEvent(new Event('scroll'));
  page.scrollTop = 601;
  page.dispatchEvent(new Event('scroll'));

  const changedOnlyStart = new Event('touchstart');
  Object.defineProperty(changedOnlyStart, 'changedTouches', {
    value: [{ clientX: 100, clientY: 180 }],
  });
  page.dispatchEvent(changedOnlyStart);
  page.dispatchEvent(new Event('touchmove'));
  page.dispatchEvent(new Event('touchcancel'));
  page.dispatchEvent(new Event('touchstart'));

  expect(onAdvance).not.toHaveBeenCalled();
});
