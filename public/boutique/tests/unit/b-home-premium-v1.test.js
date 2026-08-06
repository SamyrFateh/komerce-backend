'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-home-premium-v1.test.js
 *
 * js/b-home-premium-v1.js — couche premium desktop de la page d'accueil.
 *
 * Point clé du fichier source : `SHOW_CURATION = false` (bande promesse
 * désactivée, cf. commentaire du fichier). Conséquence directe sur ce qui
 * est observable/testable :
 *   - injectHomeBlocks() pose la classe `k-home-premium-v1` sur
 *     <html> puis s'arrête AVANT de créer `.k-home-curation` (return
 *     anticipé sur `!SHOW_CURATION`).
 *   - applyHomeCurationVisibility() fait donc toujours un no-op observable
 *     (querySelector('.k-home-curation') renvoie null → return immédiat),
 *     y compris quand les listeners bus `view:changed` / `catalog:cat-changed`
 *     sont déclenchés. On teste ces listeners pour leur contrat
 *     d'enregistrement et leur innocuité, pas pour un effet DOM qui n'existe
 *     plus tant que SHOW_CURATION reste à false.
 *
 * `_installed` / `_styleInjected` / `_blocksInjected` sont des états de
 * module → jest.resetModules() + re-require par test.
 */

const { mountFixture } = require('./helpers/boutiqueTestKit.js');

function load() {
  jest.doMock('../../js/b-scroll-owner.js', () => ({ isDesktop: jest.fn() }));
  jest.doMock('../../js/b-bus.js', () => ({ bus: { on: jest.fn(), emit: jest.fn() } }));
  // eslint-disable-next-line global-require
  const { isDesktop } = require('../../js/b-scroll-owner.js');
  // eslint-disable-next-line global-require
  const { bus } = require('../../js/b-bus.js');
  // eslint-disable-next-line global-require
  const { setupHomePremiumV1 } = require('../../js/b-home-premium-v1.js');
  return { isDesktop, bus, setupHomePremiumV1 };
}

describe('b-home-premium-v1', () => {
  beforeEach(() => {
    jest.resetModules();
    document.documentElement.className = '';
  });

  afterEach(() => {
    document.documentElement.className = '';
  });

  test('mobile (!isDesktop) : aucune classe posée sur <html>', () => {
    const { isDesktop, setupHomePremiumV1 } = load();
    isDesktop.mockReturnValue(false);
    mountFixture('<div id="k-page-scroll"></div><div id="k-desktop-catalog-wrap"></div>');

    setupHomePremiumV1();

    expect(document.documentElement.classList.contains('k-home-premium-v1')).toBe(false);
  });

  test('desktop mais #k-page-scroll absent : no-op sans erreur', () => {
    const { isDesktop, setupHomePremiumV1 } = load();
    isDesktop.mockReturnValue(true);
    mountFixture('<div id="k-desktop-catalog-wrap"></div>');

    expect(() => setupHomePremiumV1()).not.toThrow();
    expect(document.documentElement.classList.contains('k-home-premium-v1')).toBe(false);
  });

  test('desktop mais #k-desktop-catalog-wrap absent : no-op sans erreur', () => {
    const { isDesktop, setupHomePremiumV1 } = load();
    isDesktop.mockReturnValue(true);
    mountFixture('<div id="k-page-scroll"></div>');

    expect(() => setupHomePremiumV1()).not.toThrow();
    expect(document.documentElement.classList.contains('k-home-premium-v1')).toBe(false);
  });

  test('desktop + DOM requis présent : pose la classe k-home-premium-v1 sur <html>', () => {
    const { isDesktop, setupHomePremiumV1 } = load();
    isDesktop.mockReturnValue(true);
    mountFixture('<div id="k-page-scroll"></div><div id="k-desktop-catalog-wrap"></div>');

    setupHomePremiumV1();

    expect(document.documentElement.classList.contains('k-home-premium-v1')).toBe(true);
  });

  test('SHOW_CURATION désactivée : aucune section .k-home-curation créée même sur desktop', () => {
    const { isDesktop, setupHomePremiumV1 } = load();
    isDesktop.mockReturnValue(true);
    mountFixture('<div id="k-page-scroll"></div><div id="k-desktop-catalog-wrap"></div>');

    setupHomePremiumV1();

    expect(document.querySelector('.k-home-curation')).toBeNull();
  });

  test('appels multiples de setupHomePremiumV1() restent idempotents (guard _installed)', () => {
    const { isDesktop, bus, setupHomePremiumV1 } = load();
    isDesktop.mockReturnValue(true);
    mountFixture('<div id="k-page-scroll"></div><div id="k-desktop-catalog-wrap"></div>');

    setupHomePremiumV1();
    setupHomePremiumV1();

    // bus.on n'est câblé qu'une seule fois par event (2 events écoutés).
    expect(bus.on).toHaveBeenCalledTimes(2);
  });

  test('enregistre les listeners bus view:changed et catalog:cat-changed, sans effet observable (SHOW_CURATION false)', () => {
    const { isDesktop, bus, setupHomePremiumV1 } = load();
    isDesktop.mockReturnValue(true);
    mountFixture('<div id="k-page-scroll"></div><div id="k-desktop-catalog-wrap"></div>');

    setupHomePremiumV1();

    const viewChangedHandler = bus.on.mock.calls.find((c) => c[0] === 'view:changed')[1];
    const catChangedHandler = bus.on.mock.calls.find((c) => c[0] === 'catalog:cat-changed')[1];

    expect(() => viewChangedHandler('shop')).not.toThrow();
    expect(() => catChangedHandler('mode')).not.toThrow();
    // Le seul effet DOM possible (toggle .u-hidden sur .k-home-curation)
    // ne peut pas se produire : la section n'a jamais été injectée.
    expect(document.querySelector('.k-home-curation')).toBeNull();
  });

  test('document.readyState === "loading" : injectHomeBlocks est différé à DOMContentLoaded', () => {
    const { isDesktop, setupHomePremiumV1 } = load();
    isDesktop.mockReturnValue(true);
    mountFixture('<div id="k-page-scroll"></div><div id="k-desktop-catalog-wrap"></div>');
    const readyStateSpy = jest.spyOn(document, 'readyState', 'get').mockReturnValue('loading');

    setupHomePremiumV1();
    expect(document.documentElement.classList.contains('k-home-premium-v1')).toBe(false);

    readyStateSpy.mockRestore();
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(document.documentElement.classList.contains('k-home-premium-v1')).toBe(true);
  });
});
