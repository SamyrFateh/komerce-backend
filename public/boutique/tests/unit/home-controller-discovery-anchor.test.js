'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../js/render/render-categories.js', () => ({
  renderCategoryRailMarkup: jest.fn(() => ''),
}));

jest.mock('../../js/shop-schema.js', () => ({
  getSubcategories: jest.fn(() => []),
  getRailCategories: jest.fn(() => [
    { key: 'all', image: '' },
    { key: 'mode', image: '' },
  ]),
  getCategorySectionEmoji: jest.fn(() => ''),
  getCategoryLabel: jest.fn((key) => key),
}));

jest.mock('../../js/b-catalog.js', () => ({
  renderGrid: jest.fn(),
  setActiveCat: jest.fn(),
}));

const mockScrollPageToElement = jest.fn();
const mockScrollPageToTop = jest.fn();
jest.mock('../../js/b-scroll-owner.js', () => ({
  scrollPageToElement: (...args) => mockScrollPageToElement(...args),
  scrollPageToTop: (...args) => mockScrollPageToTop(...args),
}));

const { state } = require('../../js/b-store.js');
const { setActiveCat } = require('../../js/b-catalog.js');
const { setupHomeController } = require('../../js/controllers/home-controller.js');

function mountDesktopFixture({ discoveryHidden = false } = {}) {
  Object.defineProperty(window, 'innerWidth', {
    value: 1440,
    writable: true,
    configurable: true,
  });
  window.requestAnimationFrame = (callback) => { callback(); return 1; };

  document.body.innerHTML = `
    <div class="k-hero-cats-sticky"></div>
    <div id="k-subcats-wrap"></div>
    <div id="k-cats">
      <button class="k-chip active" data-cat="all"></button>
      <button class="k-chip" data-cat="mode"></button>
    </div>
    <section id="k-discovery-local" ${discoveryHidden ? 'hidden' : ''}></section>
    <section id="k-catalog-section"><div id="k-grid"></div></section>
  `;

  setActiveCat.mockImplementation((cat, sub = null) => {
    state.activeCat = cat;
    state.activeSubcat = sub;
    state.flatSubcat = null;
  });
  state.activeCat = 'all';
  state.activeSubcat = null;
  state.flatSubcat = null;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('desktop category navigation anchors visible Disponible ici before the catalog', () => {
  mountDesktopFixture();
  setupHomeController({ renderGrid: jest.fn(), scrollPagerToCat: jest.fn(() => false) });

  document.querySelector('.k-chip[data-cat="mode"]').click();

  expect(mockScrollPageToElement).toHaveBeenCalledWith(
    document.getElementById('k-discovery-local'),
    expect.any(Number),
    'smooth',
  );
});

test('desktop category navigation falls back to catalog when Disponible ici is hidden', () => {
  mountDesktopFixture({ discoveryHidden: true });
  setupHomeController({ renderGrid: jest.fn(), scrollPagerToCat: jest.fn(() => false) });

  document.querySelector('.k-chip[data-cat="mode"]').click();

  expect(mockScrollPageToElement).toHaveBeenCalledWith(
    document.getElementById('k-catalog-section'),
    expect.any(Number),
    'smooth',
  );
});
