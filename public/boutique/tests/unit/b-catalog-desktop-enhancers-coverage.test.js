'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../js/controllers/home-controller.js', () => ({
  syncRailActiveState: jest.fn(),
  renderSubcatRail: jest.fn(),
}));

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(),
  getScrollY: jest.fn(() => 0),
}));

function mount(markup) {
  document.body.replaceChildren();
  document.body.insertAdjacentHTML('beforeend', markup);
}

function installSynchronousAnimationFrame() {
  global.requestAnimationFrame = callback => {
    callback();
    return 0;
  };
}

function setHeight(element, height) {
  element.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    right: 0,
    bottom: height,
    width: 0,
    height,
    x: 0,
    y: 0,
    toJSON() {},
  });
}

describe('b-catalog-desktop-enhancers — flux desktop actifs', () => {
  let state;
  let bus;
  let isDesktop;
  let getScrollY;
  let renderSubcatRail;
  let syncRailActiveState;
  let setupCatalogDesktopEnhancers;
  let resizeObserver;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    document.body.replaceChildren();
    document.documentElement.style.removeProperty('--nav-stack-h');

    installSynchronousAnimationFrame();
    resizeObserver = { observe: jest.fn() };
    global.ResizeObserver = jest.fn(() => resizeObserver);

    ({ state } = require('../../js/b-store.js'));
    ({ bus } = require('../../js/b-bus.js'));
    ({ isDesktop, getScrollY } = require('../../js/b-scroll-owner.js'));
    ({ renderSubcatRail, syncRailActiveState } = require('../../js/controllers/home-controller.js'));
    ({ setupCatalogDesktopEnhancers } = require('../../js/b-catalog-desktop-enhancers.js'));

    state.activeCat = 'all';
    isDesktop.mockReturnValue(true);
    getScrollY.mockReturnValue(0);
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.ResizeObserver;
  });

  it('court-circuite intégralement sur mobile', () => {
    isDesktop.mockReturnValue(false);
    mount('<div class="k-cats"></div><div id="k-sticky-bar"></div>');

    setupCatalogDesktopEnhancers();

    expect(global.ResizeObserver).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue('--nav-stack-h')).toBe('');
  });

  it('prévisualise une catégorie au survol puis restaure la catégorie active', () => {
    state.activeCat = 'Mode';
    mount(`
      <div class="k-cats">
        <button class="k-chip" data-cat="Tech">Tech</button>
        <button class="k-chip" data-cat="Mode">Mode</button>
      </div>
    `);

    setupCatalogDesktopEnhancers();
    const cats = document.querySelector('.k-cats');
    const tech = cats.querySelector('[data-cat="Tech"]');

    tech.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    jest.advanceTimersByTime(79);
    expect(renderSubcatRail).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);

    expect(renderSubcatRail).toHaveBeenCalledWith('Tech');
    expect(syncRailActiveState).toHaveBeenCalledWith('Tech', { center: false });

    renderSubcatRail.mockClear();
    syncRailActiveState.mockClear();
    cats.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));

    expect(renderSubcatRail).toHaveBeenCalledWith('Mode');
    expect(syncRailActiveState).toHaveBeenCalledWith('Mode', { center: false });
  });

  it('ignore all, la catégorie active et les zones hors chip', () => {
    state.activeCat = 'Tech';
    mount(`
      <div class="k-cats">
        <button class="k-chip" data-cat="all">Tout</button>
        <button class="k-chip" data-cat="Tech">Tech</button>
        <span class="outside">Hors chip</span>
      </div>
    `);

    setupCatalogDesktopEnhancers();
    document.querySelector('[data-cat="all"]')
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    document.querySelector('[data-cat="Tech"]')
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    document.querySelector('.outside')
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    jest.advanceTimersByTime(200);

    expect(renderSubcatRail).not.toHaveBeenCalled();
  });

  it('annule le premier aperçu si un second hover arrive avant 80 ms', () => {
    mount(`
      <div class="k-cats">
        <button class="k-chip" data-cat="Tech">Tech</button>
        <button class="k-chip" data-cat="Mode">Mode</button>
      </div>
    `);

    setupCatalogDesktopEnhancers();
    document.querySelector('[data-cat="Tech"]')
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    jest.advanceTimersByTime(40);
    document.querySelector('[data-cat="Mode"]')
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    jest.advanceTimersByTime(80);

    expect(renderSubcatRail).toHaveBeenCalledTimes(1);
    expect(renderSubcatRail).toHaveBeenCalledWith('Mode');
  });

  it('mesure header + barre, observe leurs tailles et recalcule au resize', () => {
    jest.useRealTimers();
    installSynchronousAnimationFrame();
    mount('<header class="k-header"></header><div id="k-sticky-bar"></div>');
    const header = document.querySelector('.k-header');
    const bar = document.getElementById('k-sticky-bar');
    setHeight(header, 72);
    setHeight(bar, 48);

    setupCatalogDesktopEnhancers();

    expect(document.documentElement.style.getPropertyValue('--nav-stack-h')).toBe('120px');
    expect(resizeObserver.observe).toHaveBeenCalledWith(bar);
    expect(resizeObserver.observe).toHaveBeenCalledWith(header);

    setHeight(bar, 80);
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue('--nav-stack-h')).toBe('152px');
  });

  it('utilise 72 px sans header et tolère l’absence de barre ou de ResizeObserver', () => {
    jest.useRealTimers();
    installSynchronousAnimationFrame();
    delete global.ResizeObserver;
    mount('<div id="k-sticky-bar"></div>');
    setHeight(document.getElementById('k-sticky-bar'), 40);

    expect(() => setupCatalogDesktopEnhancers()).not.toThrow();
    expect(document.documentElement.style.getPropertyValue('--nav-stack-h')).toBe('112px');

    document.documentElement.style.removeProperty('--nav-stack-h');
    mount('<div class="k-cats"></div>');
    expect(() => setupCatalogDesktopEnhancers()).not.toThrow();
    expect(document.documentElement.style.getPropertyValue('--nav-stack-h')).toBe('');
  });

  it('synchronise les éléments desktop lorsque la vue change', () => {
    jest.useRealTimers();
    installSynchronousAnimationFrame();
    getScrollY.mockReturnValue(650);
    mount(`
      <div class="k-cats"></div>
      <div class="k-home-merch"></div>
      <div class="k-promo-strip"></div>
      <div class="k-scroll-top"></div>
    `);

    setupCatalogDesktopEnhancers();
    bus.emit('view:changed', 'favs');
    expect(document.querySelector('.k-home-merch').style.display).toBe('none');
    expect(document.querySelector('.k-promo-strip').style.display).toBe('none');
    expect(document.querySelector('.k-scroll-top').classList.contains('is-visible')).toBe(false);

    bus.emit('view:changed', 'shop');
    expect(document.querySelector('.k-home-merch').style.display).toBe('');
    expect(document.querySelector('.k-promo-strip').style.display).toBe('');
    expect(document.querySelector('.k-scroll-top').classList.contains('is-visible')).toBe(true);
  });

  it('tolère l’absence de tous les éléments optionnels lors du changement de vue', () => {
    jest.useRealTimers();
    installSynchronousAnimationFrame();
    mount('<div class="k-cats"></div>');
    setupCatalogDesktopEnhancers();
    expect(() => bus.emit('view:changed', 'shop')).not.toThrow();
  });
});
