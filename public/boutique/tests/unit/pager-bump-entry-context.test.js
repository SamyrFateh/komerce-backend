'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  PAGER_BUMP_EVENT,
  setupPagerEndBounce,
} = require('../../js/b-pager-end-bounce.js');

function makePage(cat, top = 600) {
  const page = document.createElement('section');
  page.dataset.cat = cat;
  page.scrollTop = top;
  Object.defineProperty(page, 'clientHeight', { configurable: true, value: 300 });
  Object.defineProperty(page, 'scrollHeight', { configurable: true, value: 900 });
  return page;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

test('le bump publie from/to avant le changement de page', () => {
  const current = makePage('Tech', 500);
  const next = makePage('Maison', 0);
  const order = [];
  const details = [];
  const handler = event => {
    order.push('event');
    details.push(event.detail);
  };
  window.addEventListener(PAGER_BUMP_EVENT, handler);

  setupPagerEndBounce({
    pages: [current, next],
    onAdvance: () => order.push('advance'),
  });

  // Passage volontaire : la page est déjà en bas, l'utilisateur tire vers le
  // haut (arriver en bas par un simple scroll ne change plus de rayon).
  current.scrollTop = 600;
  const touch = (type, y) => { const e = new Event(type); Object.defineProperty(e, type === 'touchend' ? 'changedTouches' : 'touches', { value: [{ clientX: 100, clientY: y }] }); return e; };
  current.dispatchEvent(touch('touchstart', 200));
  current.dispatchEvent(touch('touchmove', 130));
  current.dispatchEvent(touch('touchend', 130));
  jest.advanceTimersByTime(40);

  expect(details).toEqual([{ from: 'Tech', to: 'Maison' }]);
  expect(order).toEqual(['event', 'advance']);
  window.removeEventListener(PAGER_BUMP_EVENT, handler);
});
