'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-desktop-global-cart-access.test.js
 *
 * js/b-desktop-global-cart-access.js — sur desktop, la "petite dame"
 * (#k-cart-btn) doit toujours ouvrir un vrai panier, même quand le
 * side-cart n'est pas visible dans la vue courante (favoris/suivi/groupes).
 *
 * Périmètre couvert :
 *   - applyMobileCartAccessVisibility (via le setup) : nettoyage des
 *     attributs qui masqueraient #k-cart-btn
 *   - guard `installed` : un seul jeu de listeners posé même si le setup
 *     est appelé plusieurs fois (jest.resetModules() par test pour repartir
 *     d'un état propre, le flag `installed` étant au niveau module)
 *   - onCartClick : fallback drawer déclenché seulement si (a) clic sur un
 *     déclencheur panier, (b) viewport desktop, (c) side-cart non visible,
 *     (d) panier non vide
 *
 * jsdom ne fournit pas window.matchMedia ni des layouts réels
 * (getBoundingClientRect renvoie des zéros par défaut) : chaque cas mocke
 * explicitement ce dont il a besoin plutôt que de s'appuyer sur un layout
 * réel.
 */

const { mountFixture, resetBodyState } = require('./helpers/boutiqueTestKit.js');

function mockViewport(isDesktop) {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: isDesktop,
    media: query,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
}

function mockVisible(el, visible) {
  el.getBoundingClientRect = jest.fn().mockReturnValue(
    visible
      ? { width: 100, height: 40, top: 10, bottom: 50, left: 10, right: 110 }
      : { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 }
  );
}

describe('b-desktop-global-cart-access', () => {
  let setupDesktopGlobalCartAccess;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    // openDrawerFallback() pose `cart-open` directement sur document.body
    // (pas sur le fixture #boutique-test-root) : sans ce reset, une classe
    // posée par un test fuit vers le suivant (cf. resetBodyState() dans le
    // kit, même piège déjà géré en dur dans b-cart.test.js).
    resetBodyState();
    // eslint-disable-next-line global-require
    ({ setupDesktopGlobalCartAccess } = require('../../js/b-desktop-global-cart-access.js'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('nettoie les attributs qui masqueraient #k-cart-btn au setup', () => {
    mockViewport(false);
    mountFixture(`
      <button id="k-cart-btn" style="display:none" aria-hidden="true" tabindex="-1"></button>
    `);

    setupDesktopGlobalCartAccess();

    const cartBtn = document.getElementById('k-cart-btn');
    expect(cartBtn.style.display).toBe('');
    expect(cartBtn.hasAttribute('aria-hidden')).toBe(false);
    expect(cartBtn.hasAttribute('tabindex')).toBe(false);
  });

  test('ne fait rien si #k-cart-btn est absent (garde-fou)', () => {
    mockViewport(false);
    mountFixture('<div></div>');

    expect(() => setupDesktopGlobalCartAccess()).not.toThrow();
  });

  test('le guard `installed` empêche de reposer les listeners deux fois', () => {
    mockViewport(false);
    mountFixture('<button id="k-cart-btn"></button>');
    const addSpy = jest.spyOn(document, 'addEventListener');

    setupDesktopGlobalCartAccess();
    const callsAfterFirst = addSpy.mock.calls.filter((c) => c[0] === 'click').length;
    setupDesktopGlobalCartAccess();
    const callsAfterSecond = addSpy.mock.calls.filter((c) => c[0] === 'click').length;

    expect(callsAfterFirst).toBe(1);
    expect(callsAfterSecond).toBe(1);
    addSpy.mockRestore();
  });

  test('clic sur #k-cart-btn en desktop, side-cart non visible → ouvre le drawer fallback', () => {
    mockViewport(true);
    mountFixture(`
      <button id="k-cart-btn"></button>
      <div id="k-side-cart"></div>
      <div id="k-cart-overlay"></div>
      <div id="k-cart-drawer"></div>
    `);
    mockVisible(document.getElementById('k-side-cart'), false);

    setupDesktopGlobalCartAccess();
    document.getElementById('k-cart-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.runOnlyPendingTimers();

    expect(document.getElementById('k-cart-overlay').classList.contains('open')).toBe(true);
    expect(document.getElementById('k-cart-drawer').classList.contains('open')).toBe(true);
    expect(document.body.classList.contains('cart-open')).toBe(true);
  });

  test('clic sur #k-cart-btn en desktop, side-cart visible → pas de fallback', () => {
    mockViewport(true);
    mountFixture(`
      <button id="k-cart-btn"></button>
      <div id="k-side-cart"></div>
      <div id="k-cart-overlay"></div>
      <div id="k-cart-drawer"></div>
    `);
    mockVisible(document.getElementById('k-side-cart'), true);
    // window.innerHeight/innerWidth par défaut dans jsdom sont > 0, la rect
    // mockée (top:10, left:10) tombe donc bien dans le viewport.

    setupDesktopGlobalCartAccess();
    document.getElementById('k-cart-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.runOnlyPendingTimers();

    expect(document.getElementById('k-cart-overlay').classList.contains('open')).toBe(false);
    expect(document.getElementById('k-cart-drawer').classList.contains('open')).toBe(false);
    expect(document.body.classList.contains('cart-open')).toBe(false);
  });

  test('clic sur #k-cart-btn en mobile → pas de fallback même si side-cart invisible', () => {
    mockViewport(false);
    mountFixture(`
      <button id="k-cart-btn"></button>
      <div id="k-side-cart"></div>
      <div id="k-cart-overlay"></div>
      <div id="k-cart-drawer"></div>
    `);
    mockVisible(document.getElementById('k-side-cart'), false);

    setupDesktopGlobalCartAccess();
    document.getElementById('k-cart-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.runOnlyPendingTimers();

    expect(document.getElementById('k-cart-overlay').classList.contains('open')).toBe(false);
  });

  test('panier vide (.is-empty) → le fallback ne s\'ouvre pas', () => {
    mockViewport(true);
    mountFixture(`
      <button id="k-cart-btn" class="is-empty"></button>
      <div id="k-side-cart"></div>
      <div id="k-cart-overlay"></div>
      <div id="k-cart-drawer"></div>
    `);
    mockVisible(document.getElementById('k-side-cart'), false);

    setupDesktopGlobalCartAccess();
    document.getElementById('k-cart-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.runOnlyPendingTimers();

    expect(document.getElementById('k-cart-overlay').classList.contains('open')).toBe(false);
  });

  test('clic en dehors d\'un déclencheur panier → aucun effet', () => {
    mockViewport(true);
    mountFixture(`
      <button id="k-cart-btn"></button>
      <div id="k-side-cart"></div>
      <div id="k-cart-overlay"></div>
      <div id="k-cart-drawer"></div>
      <div id="somewhere-else"></div>
    `);
    mockVisible(document.getElementById('k-side-cart'), false);

    setupDesktopGlobalCartAccess();
    document.getElementById('somewhere-else').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.runOnlyPendingTimers();

    expect(document.getElementById('k-cart-overlay').classList.contains('open')).toBe(false);
  });

  test('resize déclenche à nouveau applyMobileCartAccessVisibility', () => {
    mockViewport(false);
    mountFixture('<button id="k-cart-btn" style="display:none"></button>');

    setupDesktopGlobalCartAccess();
    const cartBtn = document.getElementById('k-cart-btn');
    // On force à nouveau un style masquant pour vérifier que resize le nettoie.
    cartBtn.style.display = 'none';
    window.dispatchEvent(new Event('resize'));

    expect(cartBtn.style.display).toBe('');
  });
});
