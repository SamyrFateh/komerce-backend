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

test('mesure la fin de page et résout le libellé de la catégorie suivante', () => {
  const page = makePage('all', { top: 568 });
  const next = makePage('Mode');
  expect(isAtBottom(page)).toBe(true);
  expect(isAtBottom(page, 12)).toBe(false);
  expect(distanceFromBottom(page)).toBe(32);
  expect(nextPageLabel(next)).toBe('La mode');
  expect(nextPageLabel(makePage('Tech'))).toBe('Tech');
  expect(nextPageLabel(null)).toBe('Tout');
  expect(distanceFromBottom(null)).toBe(Infinity);
  expect(isAtBottom(null)).toBe(false);
});

test('arriver en bas par scroll avance automatiquement après le bump', () => {
  const page = makePage('all', { top: 500 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);
  expect(setupPagerEndBounce({ pages: [page, next], onAdvance })).toBe(2);

  page.scrollTop = 600;
  page.dispatchEvent(new Event('scroll'));
  jest.advanceTimersByTime(349);
  expect(onAdvance).not.toHaveBeenCalled();

  jest.advanceTimersByTime(1);
  expect(onAdvance).toHaveBeenCalledTimes(1);
  expect(onAdvance).toHaveBeenCalledWith(page, next);
  expect(page.querySelector('.k-pager-next-hint').textContent).toBe('La mode →');
  expect(page.querySelector('.k-pager-next-hint').getAttribute('aria-hidden')).toBe('true');
});

test('le touchend garantit le passage automatique sur une page courte ou déjà en bas', () => {
  const page = makePage('all', { height: 300, scrollHeight: 300 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], onAdvance });

  gesture(page);
  jest.advanceTimersByTime(219);
  expect(onAdvance).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(onAdvance).toHaveBeenCalledWith(page, next);
});

test('un swipe surtout horizontal annule le passage automatique', () => {
  const page = makePage('all', { top: 500 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], onAdvance });

  page.scrollTop = 600;
  page.dispatchEvent(new Event('scroll'));
  gesture(page, { x: 40, y: 180 }, { x: 160, y: 170 });
  jest.advanceTimersByTime(500);

  expect(onAdvance).not.toHaveBeenCalled();
});

test('remonter ou quitter le bas annule un passage encore en attente', () => {
  const page = makePage('all', { top: 500 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], onAdvance });

  page.scrollTop = 600;
  page.dispatchEvent(new Event('scroll'));
  page.scrollTop = 450;
  page.dispatchEvent(new Event('scroll'));
  jest.advanceTimersByTime(500);

  expect(onAdvance).not.toHaveBeenCalled();
  expect(page.querySelector('.k-pager-next-hint')).toBeNull();
});

test('une modale ouverte bloque le bump, y compris après armement du timer', () => {
  const page = makePage('all', { top: 500 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  let blocked = true;
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], isBlocked: () => blocked, onAdvance });

  page.scrollTop = 600;
  page.dispatchEvent(new Event('scroll'));
  gesture(page);
  jest.advanceTimersByTime(500);
  expect(onAdvance).not.toHaveBeenCalled();

  blocked = false;
  page.scrollTop = 500;
  page.dispatchEvent(new Event('scroll'));
  page.scrollTop = 600;
  page.dispatchEvent(new Event('scroll'));
  blocked = true;
  jest.advanceTimersByTime(350);
  expect(onAdvance).not.toHaveBeenCalled();
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
  expect(page.querySelector('.k-pager-next-hint')).toBeNull();
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
  jest.advanceTimersByTime(220);
  expect(onAdvance).toHaveBeenCalledWith(last, first);
});

test('API défensive : pas de pages, une seule page ou aucun callback', () => {
  const page = makePage('all');
  expect(setupPagerEndBounce({ pages: [], onAdvance: jest.fn() })).toBe(0);
  expect(setupPagerEndBounce({ pages: null, onAdvance: jest.fn() })).toBe(0);
  expect(setupPagerEndBounce({ pages: [page], onAdvance: jest.fn() })).toBe(0);
  expect(setupPagerEndBounce({ pages: [page, makePage('Mode')] })).toBe(0);
  expect(showNextHint(null, page)).toBeNull();
  expect(showNextHint(page, null)).toBeNull();
  teardownPagerEndBounce();
});

test('les événements tactiles incomplets restent inertes', () => {
  const page = makePage('all', { top: 600 });
  const next = makePage('Mode');
  const onAdvance = jest.fn();
  document.body.append(page, next);
  setupPagerEndBounce({ pages: [page, next], onAdvance });

  // Déjà en bas mais sans déplacement descendant : aucun auto-advance.
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
