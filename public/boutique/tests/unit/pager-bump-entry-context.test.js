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

  current.scrollTop = 600;
  current.dispatchEvent(new Event('scroll'));
  jest.advanceTimersByTime(160);

  expect(details).toEqual([{ from: 'Tech', to: 'Maison' }]);
  expect(order).toEqual(['event', 'advance']);
  window.removeEventListener(PAGER_BUMP_EVENT, handler);
});
