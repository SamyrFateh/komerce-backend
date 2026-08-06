'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-desktop-upgrade.test.js
 *
 * js/b-desktop-upgrade.js — orchestrateur des enrichissements desktop
 * (≥ 900px) : délègue à b-catalog-desktop-enhancers / b-modal-desktop-enhancers,
 * et installe deux glues locales (scroll-to-top, side-cart footer guard).
 *
 * Périmètre couvert :
 *   - court-circuit total sur mobile (!isDesktop())
 *   - délégation aux deux enhancers sur desktop
 *   - setupScrollToTop : création idempotente du bouton, clic → scrollPageToTop,
 *     scroll → toggle .is-visible selon getScrollY()
 *   - setupSideCartFooterGuard : confirmé no-op (désactivé, cf. docstring
 *     du fichier source) — aucun IntersectionObserver ne doit être posé
 *
 * b-scroll-owner.js, b-catalog-desktop-enhancers.js et
 * b-modal-desktop-enhancers.js sont mockés (dépendances hors périmètre,
 * déjà/à couvrir dans leurs propres suites).
 */

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(),
  getScrollY: jest.fn(() => 0),
  scrollPageToTop: jest.fn(),
}));
jest.mock('../../js/b-catalog-desktop-enhancers.js', () => ({
  setupCatalogDesktopEnhancers: jest.fn(),
}));
jest.mock('../../js/b-modal-desktop-enhancers.js', () => ({
  setupModalDesktopEnhancers: jest.fn(),
}));

const { isDesktop, getScrollY, scrollPageToTop } = require('../../js/b-scroll-owner.js');
const { setupCatalogDesktopEnhancers } = require('../../js/b-catalog-desktop-enhancers.js');
const { setupModalDesktopEnhancers } = require('../../js/b-modal-desktop-enhancers.js');
const { setupDesktopUpgrade } = require('../../js/b-desktop-upgrade.js');

describe('b-desktop-upgrade', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
    // rAF non implémenté de façon synchrone dans jsdom : on le rend
    // immédiat pour ne pas dépendre d'un vrai timer d'animation.
    window.requestAnimationFrame = (cb) => cb();
  });

  test('mobile (!isDesktop) : court-circuit total, aucun enhancer ni bouton', () => {
    isDesktop.mockReturnValue(false);

    setupDesktopUpgrade();

    expect(setupCatalogDesktopEnhancers).not.toHaveBeenCalled();
    expect(setupModalDesktopEnhancers).not.toHaveBeenCalled();
    expect(document.querySelector('.k-scroll-top')).toBeNull();
  });

  test('desktop : délègue aux deux enhancers et crée le bouton scroll-to-top', () => {
    isDesktop.mockReturnValue(true);

    setupDesktopUpgrade();

    expect(setupCatalogDesktopEnhancers).toHaveBeenCalledTimes(1);
    expect(setupModalDesktopEnhancers).toHaveBeenCalledTimes(1);
    const btn = document.querySelector('.k-scroll-top');
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('Retour en haut');
  });

  test('setupScrollToTop est idempotent : un seul bouton même après deux appels', () => {
    isDesktop.mockReturnValue(true);

    setupDesktopUpgrade();
    setupDesktopUpgrade();

    expect(document.querySelectorAll('.k-scroll-top')).toHaveLength(1);
  });

  test('clic sur le bouton scroll-to-top appelle scrollPageToTop("smooth")', () => {
    isDesktop.mockReturnValue(true);

    setupDesktopUpgrade();
    document.querySelector('.k-scroll-top').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(scrollPageToTop).toHaveBeenCalledWith('smooth');
  });

  test('scroll au-delà de 600px ajoute .is-visible sur le bouton', () => {
    isDesktop.mockReturnValue(true);
    getScrollY.mockReturnValue(650);

    setupDesktopUpgrade();
    window.dispatchEvent(new Event('scroll'));

    expect(document.querySelector('.k-scroll-top').classList.contains('is-visible')).toBe(true);
  });

  test('scroll en dessous de 600px n\'ajoute pas .is-visible', () => {
    isDesktop.mockReturnValue(true);
    getScrollY.mockReturnValue(100);

    setupDesktopUpgrade();
    window.dispatchEvent(new Event('scroll'));

    expect(document.querySelector('.k-scroll-top').classList.contains('is-visible')).toBe(false);
  });

  test('setupSideCartFooterGuard reste no-op : aucun IntersectionObserver posé même si footer/side-cart présents', () => {
    isDesktop.mockReturnValue(true);
    document.body.innerHTML = '<div id="k-footer"></div><div id="k-side-cart"></div>';
    const observeSpy = jest.fn();
    global.IntersectionObserver = jest.fn().mockImplementation(() => ({ observe: observeSpy }));

    setupDesktopUpgrade();

    expect(global.IntersectionObserver).not.toHaveBeenCalled();
    expect(observeSpy).not.toHaveBeenCalled();
  });
});
