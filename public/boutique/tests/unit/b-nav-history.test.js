/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * @komerce-arch-lite
 * @role          boutique-nav-history-tests
 * @domain        boutique
 * @layer         test
 * @status        production
 * @owner         public/boutique/tests/unit/b-nav-history.test.js
 * @purpose       G-03/G-04 — un clic d'onglet pose une entrée d'historique
 *                (push depuis la Boutique, replace entre onglets) ; le
 *                retour Android (popstate) restaure l'onglet précédent au
 *                lieu de quitter le site ; le popstate de la fiche produit
 *                (kModal) et une fiche ouverte restent prioritaires et ne
 *                déclenchent aucun changement d'onglet.
 * @impact-areas  boutique-navigation, history, android-back
 * @version       2026-09
 */
'use strict';

jest.mock('../../js/b-cart-core.js', () => ({ showToast: jest.fn() }));
jest.mock('../../js/b-cart.js', () => ({
  openCart: jest.fn(),
  closeCart: jest.fn(),
  renderCart: jest.fn(),
  clearCart: jest.fn(),
  loadSharedCart: jest.fn(),
}));
jest.mock('../../js/b-checkout.js', () => ({
  checkoutCart: jest.fn(),
  closeOrderModal: jest.fn(),
}));
jest.mock('../../js/b-catalog.js', () => ({
  renderGrid: jest.fn(),
  appendNextPage: jest.fn(),
}));
jest.mock('../../js/b-favs.js', () => ({ renderFavView: jest.fn() }));
jest.mock('../../js/b-tracking.js', () => ({ renderTrackView: jest.fn(), renderListsView: jest.fn() }));
jest.mock('../../js/b-komerce.js', () => ({ openMonKomerce: jest.fn() }));
jest.mock('../../js/group/group-side-cart.js', () => ({
  detectParticipantToken: jest.fn(),
  activateFromParticipantUrl: jest.fn(),
}));
jest.mock('../../js/b-pager.js', () => ({ destroyMobilePager: jest.fn() }));
jest.mock('../../js/b-scroll-owner.js', () => ({ scrollPageToTop: jest.fn() }));

const { state, dom } = require('../../js/b-store.js');
const { openCart } = require('../../js/b-cart.js');
const { renderFavView } = require('../../js/b-favs.js');
const { renderTrackView, renderListsView } = require('../../js/b-tracking.js');
const { openMonKomerce } = require('../../js/b-komerce.js');
const { detectParticipantToken } = require('../../js/group/group-side-cart.js');

const { mockWindowK, resetState, resetDom, mountFixture } = require('./helpers/boutiqueTestKit');

const { setupBnav, handleParticipantUrl } = require('../../js/b-nav.js');

function mountNavButtons() {
  mountFixture(
    '<button class="k-bnav-item" data-tab="cart"></button>' +
    '<button class="k-bnav-item" data-tab="fav"></button>' +
    '<button class="k-bnav-item" data-tab="track"></button>' +
    '<button class="k-bnav-item" data-tab="shares"></button>' +
    '<button class="k-bnav-item" data-tab="komerce"></button>' +
    '<button class="k-bnav-item" data-tab="shop"></button>'
  );
}

beforeEach(() => {
  resetState(state);
  resetDom(dom, { modalOverlay: 'div' });
  mountNavButtons();
  mockWindowK();
  detectParticipantToken.mockReturnValue(null);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  // Chaque test part d'un historique propre : aucune entrée d'onglet posée.
  window.history.replaceState(null, '');
});

describe('setupBnav — historique des onglets (G-03/G-04)', () => {
  test("Boutique -> clic Favoris : pushState({kTab:'fav'})", () => {
    setupBnav();
    const pushSpy = jest.spyOn(window.history, 'pushState');

    document.querySelector('[data-tab="fav"]').click();

    expect(pushSpy).toHaveBeenCalledWith({ kTab: 'fav' }, '');
    expect(renderFavView).toHaveBeenCalled();
  });

  test("Favoris -> clic Commandes : replaceState({kTab:'track'}), pas de push", () => {
    setupBnav();
    document.querySelector('[data-tab="fav"]').click();
    const pushSpy = jest.spyOn(window.history, 'pushState');
    const replaceSpy = jest.spyOn(window.history, 'replaceState');

    document.querySelector('[data-tab="track"]').click();

    expect(replaceSpy).toHaveBeenCalledWith({ kTab: 'track' }, '');
    expect(pushSpy).not.toHaveBeenCalled();
    expect(renderTrackView).toHaveBeenCalled();
  });

  test("popstate avec state=null depuis Favoris -> revient à la Boutique", () => {
    setupBnav();
    document.querySelector('[data-tab="fav"]').click();
    expect(document.body.classList.contains('k-view-fav')).toBe(true);

    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

    expect(document.body.classList.contains('k-view-shop')).toBe(true);
  });

  test('popstate avec {kModal:true} -> aucun changement d’onglet', () => {
    setupBnav();
    document.querySelector('[data-tab="fav"]').click();
    expect(document.body.classList.contains('k-view-fav')).toBe(true);

    window.dispatchEvent(new PopStateEvent('popstate', { state: { kModal: true } }));

    // La fiche produit (b-modal-core.js) gère cette entrée : l'onglet actif
    // (Favoris) ne doit pas bouger.
    expect(document.body.classList.contains('k-view-fav')).toBe(true);
  });

  test('popstate pendant qu’une fiche produit est ouverte -> aucun changement d’onglet', () => {
    setupBnav();
    document.querySelector('[data-tab="fav"]').click();
    dom.modalOverlay.classList.add('open');

    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

    expect(document.body.classList.contains('k-view-fav')).toBe(true);
  });

  test("clic Boutique depuis un onglet (entrée d'historique présente) -> history.back()", () => {
    setupBnav();
    document.querySelector('[data-tab="fav"]').click();
    const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {});

    document.querySelector('[data-tab="shop"]').click();

    expect(backSpy).toHaveBeenCalled();
    expect(document.body.classList.contains('k-view-shop')).toBe(true);
  });

  test('clic Panier -> ni push ni replace', () => {
    setupBnav();
    const pushSpy = jest.spyOn(window.history, 'pushState');
    const replaceSpy = jest.spyOn(window.history, 'replaceState');

    document.querySelector('[data-tab="cart"]').click();

    expect(openCart).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  test("clic Mon Komerce : pushState({kTab:'komerce'}) sans focus wallet", () => {
    setupBnav();
    const pushSpy = jest.spyOn(window.history, 'pushState');

    document.querySelector('[data-tab="komerce"]').click();

    expect(pushSpy).toHaveBeenCalledWith({ kTab: 'komerce' }, '');
    expect(openMonKomerce).toHaveBeenCalledWith(undefined);
  });
});

describe("G-04 — rechargement sans ?tab= : restauration depuis l'entrée d'historique", () => {
  afterEach(() => {
    window.history.replaceState(null, '', window.location.pathname);
  });

  test("history.state.kTab='fav' et pas de ?tab= dans l'URL -> ouvre Favoris", () => {
    window.history.replaceState({ kTab: 'fav' }, '', window.location.pathname);

    handleParticipantUrl();

    expect(renderFavView).toHaveBeenCalled();
    expect(document.body.classList.contains('k-view-fav')).toBe(true);
  });

  test("aucune entrée d'historique ni ?tab= -> reste sur la Boutique, aucune vue déclenchée", () => {
    handleParticipantUrl();

    expect(renderFavView).not.toHaveBeenCalled();
    expect(renderTrackView).not.toHaveBeenCalled();
    expect(openMonKomerce).not.toHaveBeenCalled();
  });
});
