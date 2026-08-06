'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-desktop-sidebar.test.js
 *
 * js/b-desktop-sidebar.js — sidebar catégories desktop (≥ 900px), zéro
 * logique parallèle : lit shop-schema.js, écrit state.activeCat via
 * b-catalog.js:setActiveCat, et délègue la sync du rail chips à
 * home-controller.js.
 *
 * Périmètre couvert :
 *   - no-op mobile (!isDesktop()) et no-op si #k-desktop-sidebar absent
 *   - construction du markup (entrée "Tout voir" + catégories du rail,
 *     item actif selon state.activeCat)
 *   - clic / Enter / Espace sur un item → setActiveCat + syncRailActiveState
 *     + renderSubcatRail + scrollPageToTop('smooth') + classe is-active
 *   - clic sur un .k-chip ailleurs dans le document → resync (via rAF,
 *     rendu synchrone dans les tests)
 *   - resize → resync uniquement si toujours desktop
 *   - syncDesktopSidebar() exporté : no-op avant setup, sync sinon
 *
 * `_sidebarEl` est un état de module (persistant entre applles à
 * setupDesktopSidebar dans un même fichier de test) → jest.resetModules()
 * par test pour repartir d'un état propre, comme
 * b-desktop-global-cart-access.test.js.
 */

const { mountFixture, resetBodyState } = require('./helpers/boutiqueTestKit.js');

const RAIL_CATEGORIES = [
  { key: 'mode', shortLabel: 'Mode', label: 'Mode & Vêtements', emoji: '👗' },
  { key: 'maison', shortLabel: 'Maison', label: 'Maison & Déco', emoji: '🏠' },
];

function mockDesktop(isDesktopValue) {
  jest.doMock('../../js/b-scroll-owner.js', () => ({
    isDesktop: jest.fn(() => isDesktopValue),
    scrollPageToTop: jest.fn(),
  }));
}

describe('b-desktop-sidebar', () => {
  let state;
  let setActiveCat;
  let syncRailActiveState;
  let renderSubcatRail;
  let scrollPageToTop;
  let setupDesktopSidebar;
  let syncDesktopSidebar;

  beforeEach(() => {
    jest.resetModules();
    resetBodyState();
    window.requestAnimationFrame = (cb) => cb();

    jest.doMock('../../js/b-bus.js', () => ({ bus: { emit: jest.fn(), on: jest.fn() } }));
    jest.doMock('../../js/b-catalog.js', () => ({ setActiveCat: jest.fn() }));
    jest.doMock('../../js/controllers/home-controller.js', () => ({
      syncRailActiveState: jest.fn(),
      renderSubcatRail: jest.fn(),
    }));
    jest.doMock('../../js/shop-schema.js', () => ({
      getRailCategories: jest.fn(() => RAIL_CATEGORIES),
      getCategorySectionEmoji: jest.fn(() => null),
    }));
  });

  function load(isDesktopValue) {
    mockDesktop(isDesktopValue);
    // eslint-disable-next-line global-require
    ({ state } = require('../../js/b-store.js'));
    Object.assign(state, { activeCat: 'all' });
    // eslint-disable-next-line global-require
    ({ setActiveCat } = require('../../js/b-catalog.js'));
    // Le vrai setActiveCat() (b-catalog.js) mute state.activeCat ; le mock
    // doit reproduire cet effet, sinon _syncSidebarActive() (qui lit
    // state.activeCat pour poser .is-active) ne verrait jamais le changement
    // déclenché par un clic sidebar.
    setActiveCat.mockImplementation((cat) => { state.activeCat = cat; });
    // eslint-disable-next-line global-require
    ({ syncRailActiveState, renderSubcatRail } = require('../../js/controllers/home-controller.js'));
    // eslint-disable-next-line global-require
    ({ scrollPageToTop } = require('../../js/b-scroll-owner.js'));
    // eslint-disable-next-line global-require
    ({ setupDesktopSidebar, syncDesktopSidebar } = require('../../js/b-desktop-sidebar.js'));
  }

  test('mobile (!isDesktop) : no-op, aucun markup injecté', () => {
    load(false);
    mountFixture('<div id="k-desktop-sidebar"></div>');

    setupDesktopSidebar();

    expect(document.getElementById('k-desktop-sidebar').innerHTML).toBe('');
  });

  test('#k-desktop-sidebar absent : no-op sans erreur', () => {
    load(true);
    mountFixture('<div></div>');

    expect(() => setupDesktopSidebar()).not.toThrow();
  });

  test('desktop : construit "Tout voir" + catégories du rail, item actif selon state.activeCat', () => {
    load(true);
    state.activeCat = 'maison';
    mountFixture('<div id="k-desktop-sidebar"></div>');

    setupDesktopSidebar();

    const items = document.querySelectorAll('.k-sidebar-cat');
    expect(items).toHaveLength(3); // "Tout voir" + mode + maison
    expect(items[0].dataset.cat).toBe('all');
    expect(items[1].dataset.cat).toBe('mode');
    expect(items[2].dataset.cat).toBe('maison');
    expect(items[2].classList.contains('is-active')).toBe(true);
    expect(items[1].classList.contains('is-active')).toBe(false);
  });

  test('clic sur un item : setActiveCat + syncRailActiveState + renderSubcatRail + scrollPageToTop + classe is-active', () => {
    load(true);
    mountFixture('<div id="k-desktop-sidebar"></div>');
    setupDesktopSidebar();

    document.querySelector('.k-sidebar-cat[data-cat="mode"]').dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );

    expect(setActiveCat).toHaveBeenCalledWith('mode');
    expect(syncRailActiveState).toHaveBeenCalledWith('mode', { center: false });
    expect(renderSubcatRail).toHaveBeenCalledWith('mode');
    expect(scrollPageToTop).toHaveBeenCalledWith('smooth');
    expect(document.querySelector('.k-sidebar-cat[data-cat="mode"]').classList.contains('is-active')).toBe(true);
  });

  test('touche Entrée sur un item déclenche la même activation qu\'un clic', () => {
    load(true);
    mountFixture('<div id="k-desktop-sidebar"></div>');
    setupDesktopSidebar();

    const item = document.querySelector('.k-sidebar-cat[data-cat="maison"]');
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(setActiveCat).toHaveBeenCalledWith('maison');
  });

  test('touche Espace sur un item déclenche la même activation qu\'un clic', () => {
    load(true);
    mountFixture('<div id="k-desktop-sidebar"></div>');
    setupDesktopSidebar();

    const item = document.querySelector('.k-sidebar-cat[data-cat="mode"]');
    item.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));

    expect(setActiveCat).toHaveBeenCalledWith('mode');
  });

  test('touche autre que Entrée/Espace : aucune activation', () => {
    load(true);
    mountFixture('<div id="k-desktop-sidebar"></div>');
    setupDesktopSidebar();

    const item = document.querySelector('.k-sidebar-cat[data-cat="mode"]');
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));

    expect(setActiveCat).not.toHaveBeenCalled();
  });

  test('clic sur un .k-chip ailleurs dans le document resync la sidebar', () => {
    load(true);
    state.activeCat = 'all';
    mountFixture('<div id="k-desktop-sidebar"></div><button class="k-chip" data-cat="maison"></button>');
    setupDesktopSidebar();

    // On change l'état "à la main" (simulateur d'un clic chip déjà traité
    // par home-controller.js) puis on vérifie que le clic délégué resync bien.
    state.activeCat = 'maison';
    document.querySelector('.k-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(document.querySelector('.k-sidebar-cat[data-cat="maison"]').classList.contains('is-active')).toBe(true);
    expect(document.querySelector('.k-sidebar-cat[data-cat="all"]').classList.contains('is-active')).toBe(false);
  });

  test('resize en desktop resync la sidebar active', () => {
    load(true);
    mountFixture('<div id="k-desktop-sidebar"></div>');
    setupDesktopSidebar();

    state.activeCat = 'mode';
    window.dispatchEvent(new Event('resize'));

    expect(document.querySelector('.k-sidebar-cat[data-cat="mode"]').classList.contains('is-active')).toBe(true);
  });

  test('syncDesktopSidebar() ne fait rien si setupDesktopSidebar() n\'a jamais tourné (mobile)', () => {
    load(false);
    mountFixture('<div id="k-desktop-sidebar"></div>');
    setupDesktopSidebar(); // no-op, _sidebarEl reste null

    expect(() => syncDesktopSidebar()).not.toThrow();
  });

  test('syncDesktopSidebar() resync l\'item actif après un changement externe de state.activeCat', () => {
    load(true);
    mountFixture('<div id="k-desktop-sidebar"></div>');
    setupDesktopSidebar();

    state.activeCat = 'maison';
    syncDesktopSidebar();

    expect(document.querySelector('.k-sidebar-cat[data-cat="maison"]').classList.contains('is-active')).toBe(true);
    expect(document.querySelector('.k-sidebar-cat[data-cat="all"]').classList.contains('is-active')).toBe(false);
  });
});
