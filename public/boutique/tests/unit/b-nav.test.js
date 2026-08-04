/**
 * @komerce-arch-lite
 * @role          boutique-nav-tests
 * @domain        boutique
 * @layer         test
 * @status        production
 * @owner         public/boutique/tests/unit/b-nav.test.js
 * @purpose       Tests unitaires de la navigation principale de la boutique
 *                (switchView, setupBnav, deep-links). Vérifie que Mon Komerce
 *                utilise openMonKomerce comme point d'entrée canonique (Lot 4B).
 * @impact-areas  boutique-navigation, account
 * @version       2026-07-lot4b
 */
'use strict';

/**
 * tests/unit/b-nav.test.js
 *
 * Module js/b-nav.js (274L) — @role boutique-nav, @criticality high.
 * Navigation : setupDrawer, setupInfiniteScroll, switchView, setupBnav,
 * handleParticipantUrl, loadRelais.
 *
 * 0% de couverture réelle avant cette session : seul point de contact,
 * `b-share-cart.test.js`, le mocke intégralement (`switchView: jest.fn()`)
 * — jamais importé pour de vrai nulle part.
 *
 * Toutes les dépendances de vues (b-cart, b-checkout, b-catalog, b-favs,
 * b-tracking, b-komerce, b-group-view, b-pager, b-scroll-owner,
 * b-cart-core) sont mockées — hors périmètre, couvertes par leurs propres
 * suites. Seuls b-bus.js et b-store.js sont réels (état/bus partagés,
 * comme dans les autres suites boutique). b-utils.js (apiGet) réel aussi,
 * via mockWindowK() du kit, pour loadRelais().
 *
 * Lot 4 (2026-07-31) : l'ancien onglet wallet autonome a disparu ; b-nav.js
 * route désormais 'komerce' vers b-komerce.js (renderKomerceView), qui
 * monte lui-même b-wallet.js dans son propre panneau. b-wallet.js n'est
 * donc plus une dépendance directe de b-nav.js.
 */

jest.mock('../../js/b-cart-core.js', () => ({ showToast: jest.fn() }));
jest.mock('../../js/b-cart.js', () => ({
  openCart: jest.fn(),
  closeCart: jest.fn(),
  renderCart: jest.fn(),
  clearCart: jest.fn(),
  shareCartWhatsApp: jest.fn(),
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
jest.mock('../../js/b-tracking.js', () => ({ renderTrackView: jest.fn() }));
jest.mock('../../js/b-komerce.js', () => ({ openMonKomerce: jest.fn() }));
// PROMPT_FINAL_IMPLEMENTATION_LISTE_PARTAGEABLE_SIDE_CART — b-nav.js route
// désormais 'Mes listes', le lien participant et ?tab=group vers
// group-side-cart.js (side cart / drawer canonique). group-render-list.js
// (et son stopPolling(), no-op) sont supprimés (mandat §2/§4/§10).
jest.mock('../../js/group/group-side-cart.js', () => ({
  detectParticipantToken: jest.fn(),
  activateFromParticipantUrl: jest.fn(),
  activateOwnerLibrary: jest.fn(),
}));
jest.mock('../../js/b-pager.js', () => ({ destroyMobilePager: jest.fn() }));
jest.mock('../../js/b-scroll-owner.js', () => ({ scrollPageToTop: jest.fn() }));

const { bus } = require('../../js/b-bus.js');
const { state, dom } = require('../../js/b-store.js');
const { showToast } = require('../../js/b-cart-core.js');
const { openCart, closeCart, clearCart, shareCartWhatsApp, loadSharedCart } = require('../../js/b-cart.js');
const { checkoutCart, closeOrderModal } = require('../../js/b-checkout.js');
const { renderGrid } = require('../../js/b-catalog.js');
const { renderFavView } = require('../../js/b-favs.js');
const { renderTrackView } = require('../../js/b-tracking.js');
const { openMonKomerce } = require('../../js/b-komerce.js');
const {
  detectParticipantToken,
  activateFromParticipantUrl,
  activateOwnerLibrary,
} = require('../../js/group/group-side-cart.js');
const { destroyMobilePager } = require('../../js/b-pager.js');
const { scrollPageToTop } = require('../../js/b-scroll-owner.js');

const { mockWindowK, resetState, resetDom, mountFixture, flush } = require('./helpers/boutiqueTestKit');

const {
  setupDrawer,
  setupInfiniteScroll,
  switchView,
  setupBnav,
  handleParticipantUrl,
  loadRelais,
} = require('../../js/b-nav.js');

let K;

beforeEach(() => {
  resetState(state);
  resetDom(dom, {});
  mountFixture();
  K = mockWindowK();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('setupDrawer', () => {
  test('sans dom.cartBtn -> log erreur et sort immédiatement (pas de binding)', () => {
    dom.cartBtn = null;
    setupDrawer();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('setupDrawer'), );
  });

  test('branche le clic cartBtn -> openCart()', () => {
    dom.cartBtn = document.createElement('button');
    setupDrawer();
    dom.cartBtn.click();
    expect(openCart).toHaveBeenCalled();
  });

  test('ne re-branche pas deux fois le même bouton (anti double-binding)', () => {
    dom.cartBtn = document.createElement('button');
    setupDrawer();
    setupDrawer();
    dom.cartBtn.click();
    expect(openCart).toHaveBeenCalledTimes(1);
  });

  test('cartClear : vide si panier non vide, appelle clearCart + showToast', () => {
    dom.cartBtn = document.createElement('button');
    dom.cartClear = document.createElement('button');
    state.cart = [{ qty: 1, product: {} }];
    setupDrawer();
    dom.cartClear.click();
    expect(clearCart).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('vidé'));
  });

  test('cartClear : no-op si panier déjà vide', () => {
    dom.cartBtn = document.createElement('button');
    dom.cartClear = document.createElement('button');
    state.cart = [];
    setupDrawer();
    dom.cartClear.click();
    expect(clearCart).not.toHaveBeenCalled();
  });

  test('cartWhatsapp -> shareCartWhatsApp, cartCheckout -> checkoutCart', () => {
    dom.cartBtn = document.createElement('button');
    dom.cartWhatsapp = document.createElement('button');
    dom.cartCheckout = document.createElement('button');
    setupDrawer();
    dom.cartWhatsapp.click();
    dom.cartCheckout.click();
    expect(shareCartWhatsApp).toHaveBeenCalled();
    expect(checkoutCart).toHaveBeenCalled();
  });

  test('orderModal : clic sur l\'overlay lui-même ferme, clic à l\'intérieur ne ferme pas', () => {
    dom.cartBtn = document.createElement('button');
    dom.orderModal = document.createElement('div');
    const inner = document.createElement('div');
    dom.orderModal.appendChild(inner);
    setupDrawer();
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(closeOrderModal).not.toHaveBeenCalled();
    dom.orderModal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(closeOrderModal).toHaveBeenCalled();
  });

  test('appelle loadSharedCart()', () => {
    dom.cartBtn = document.createElement('button');
    setupDrawer();
    expect(loadSharedCart).toHaveBeenCalled();
  });

  test('éléments optionnels manquants -> warning listant les noms', () => {
    dom.cartBtn = document.createElement('button');
    setupDrawer();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('setupDrawer'),
      expect.stringContaining('cartClose')
    );
  });
});

describe('setupInfiniteScroll', () => {
  test('crée sentinel + spinner et observe le sentinel', () => {
    mountFixture('<div id="k-catalog-section"></div>');
    const observeSpy = jest.fn();
    global.IntersectionObserver = jest.fn().mockImplementation((cb) => ({ observe: observeSpy, _cb: cb }));

    setupInfiniteScroll();

    expect(document.getElementById('k-scroll-sentinel')).not.toBeNull();
    expect(document.getElementById('k-load-more-spinner')).not.toBeNull();
    expect(observeSpy).toHaveBeenCalled();
  });

  test('quand le sentinel intersecte -> spinner visible puis appendNextPage() après 300ms', () => {
    mountFixture('<div id="k-catalog-section"></div>');
    let capturedCb;
    global.IntersectionObserver = jest.fn().mockImplementation((cb) => {
      capturedCb = cb;
      return { observe: jest.fn() };
    });
    jest.useFakeTimers();

    setupInfiniteScroll();
    capturedCb([{ isIntersecting: true }]);

    const spinner = document.getElementById('k-load-more-spinner');
    expect(spinner.classList.contains('show')).toBe(true);
    jest.advanceTimersByTime(300);
    expect(require('../../js/b-catalog.js').appendNextPage).toHaveBeenCalled();

    jest.useRealTimers();
  });

  test('pas de #k-catalog-section -> ne plante pas (spinner/sentinel non attachés au DOM)', () => {
    mountFixture('');
    global.IntersectionObserver = jest.fn().mockImplementation(() => ({ observe: jest.fn() }));
    expect(() => setupInfiniteScroll()).not.toThrow();
  });
});

describe('switchView', () => {
  function mountViews() {
    mountFixture(
      '<div id="k-catalog-section"></div><div id="k-fav-view"></div><div id="k-track-view"></div>' +
      '<div id="k-group-view"></div><div id="k-komerce-view"></div><div id="k-hero-fixed-wrap"></div>' +
      '<div id="k-promos-section"></div><div id="k-cart-overlay" class="open"></div>' +
      '<div id="k-cart-drawer" class="open"></div>'
    );
    document.body.classList.add('cart-open');
  }

  test('bascule les classes body et affiche la bonne vue (fav)', () => {
    mountViews();
    switchView('fav');
    expect(document.body.classList.contains('k-view-fav')).toBe(true);
    expect(document.body.classList.contains('k-view-shop')).toBe(false);
    expect(document.getElementById('k-fav-view').classList.contains('show')).toBe(true);
    expect(document.getElementById('k-catalog-section').classList.contains('u-hidden')).toBe(true);
  });

  test('ferme le panier ouvert quel que soit l\'onglet visé', () => {
    mountViews();
    switchView('fav');
    expect(document.getElementById('k-cart-overlay').classList.contains('open')).toBe(false);
    expect(document.getElementById('k-cart-drawer').classList.contains('open')).toBe(false);
    expect(document.body.classList.contains('cart-open')).toBe(false);
  });

  test('émet view:changed avec le nom de l\'onglet', () => {
    mountViews();
    const spy = jest.fn();
    bus.on('view:changed', spy);
    switchView('track');
    expect(spy).toHaveBeenCalledWith('track');
    bus.off('view:changed', spy);
  });

  test('quitter shop pour un autre onglet -> destroyMobilePager()', () => {
    mountViews();
    document.body.classList.add('k-view-shop');
    switchView('fav');
    expect(destroyMobilePager).toHaveBeenCalled();
  });

  test('ne quitte pas shop -> pas de destroyMobilePager()', () => {
    mountViews();
    switchView('shop');
    expect(destroyMobilePager).not.toHaveBeenCalled();
  });

  test('retour sur shop -> renderGrid() puis scrollPageToTop("auto") en rAF', () => {
    mountViews();
    global.requestAnimationFrame = (fn) => { fn(); return 1; };
    switchView('shop');
    expect(renderGrid).toHaveBeenCalled();
    expect(scrollPageToTop).toHaveBeenCalledWith('auto');
  });

  test('onglet non-shop -> scrollPageToTop("smooth") direct (pas de rAF)', () => {
    mountViews();
    switchView('track');
    expect(scrollPageToTop).toHaveBeenCalledWith('smooth');
  });

  test('Lot 4 : bascule vers komerce -> body.k-view-komerce + #k-komerce-view.show', () => {
    mountViews();
    switchView('komerce');
    expect(document.body.classList.contains('k-view-komerce')).toBe(true);
    expect(document.getElementById('k-komerce-view').classList.contains('show')).toBe(true);
  });

  test('Lot 4 : quitter komerce retire la classe show', () => {
    mountViews();
    switchView('komerce');
    switchView('fav');
    expect(document.getElementById('k-komerce-view').classList.contains('show')).toBe(false);
  });
});

describe('setupBnav', () => {
  function mountNavButtons() {
    mountFixture(
      '<button class="k-bnav-item" data-tab="cart"></button>' +
      '<button class="k-bnav-item" data-tab="fav"></button>' +
      '<button class="k-bnav-item" data-tab="track"></button>' +
      '<button class="k-bnav-item" data-tab="komerce"></button>' +
      '<button class="k-bnav-item" data-tab="shop"></button>'
    );
  }

  test('tab=cart -> openCart(), pas de switchView', () => {
    mountNavButtons();
    setupBnav();
    document.querySelector('[data-tab="cart"]').click();
    expect(openCart).toHaveBeenCalled();
  });

  test('tab=fav -> renderFavView() puis vue fav active', () => {
    mountNavButtons();
    setupBnav();
    document.querySelector('[data-tab="fav"]').click();
    expect(renderFavView).toHaveBeenCalled();
    expect(document.body.classList.contains('k-view-fav')).toBe(true);
  });

  test('tab=track -> renderTrackView()', () => {
    mountNavButtons();
    setupBnav();
    document.querySelector('[data-tab="track"]').click();
    expect(renderTrackView).toHaveBeenCalled();
  });

  test("bus 'nav:goto-group' (émis par Mon Komerce > Mes listes) -> activateOwnerLibrary(), aucun switchView('group')", () => {
    mountNavButtons();
    setupBnav();
    bus.emit('nav:goto-group');
    expect(activateOwnerLibrary).toHaveBeenCalled();
    // Mandat §2/§4/§16 : plus d'onglet 'group' — le composant komerce
    // (Mon Komerce) reste la source d'activation, jamais un onglet dédié.
    expect(document.querySelector('[data-tab="komerce"]').classList.contains('active')).toBe(true);
  });

  test('tab=komerce -> renderKomerceView()', () => {
    mountNavButtons();
    setupBnav();
    document.querySelector('[data-tab="komerce"]').click();
    expect(openMonKomerce).toHaveBeenCalled();
  });

  test('active la classe "active" uniquement sur le bouton cliqué', () => {
    mountNavButtons();
    setupBnav();
    document.querySelector('[data-tab="fav"]').click();
    const buttons = document.querySelectorAll('.k-bnav-item');
    buttons.forEach((b) => {
      expect(b.classList.contains('active')).toBe(b.dataset.tab === 'fav');
    });
  });
});

describe('handleParticipantUrl', () => {
  test('pas de token -> ne fait rien', () => {
    detectParticipantToken.mockReturnValue(null);
    handleParticipantUrl();
    expect(activateFromParticipantUrl).not.toHaveBeenCalled();
  });

  test("token présent -> nettoie l'URL, désactive tous les onglets, activateFromParticipantUrl(token), aucun switchView('group')", () => {
    mountFixture('<button class="k-bnav-item active" data-tab="shop"></button><button class="k-bnav-item" data-tab="fav"></button>');
    detectParticipantToken.mockReturnValue('TOK123');
    const replaceStateSpy = jest.spyOn(window.history, 'replaceState').mockImplementation(() => {});

    handleParticipantUrl();

    expect(replaceStateSpy).toHaveBeenCalled();
    expect(activateFromParticipantUrl).toHaveBeenCalledWith('TOK123');
    expect(document.querySelector('[data-tab="shop"]').classList.contains('active')).toBe(false);
    expect(document.querySelector('[data-tab="fav"]').classList.contains('active')).toBe(false);

    replaceStateSpy.mockRestore();
  });
});

describe('handleParticipantUrl -> deep-link ?tab= (PROMPT_FINAL_IMPLEMENTATION_LISTE_PARTAGEABLE_SIDE_CART)', () => {
  function setSearch(qs) {
    const url = new URL(window.location.href);
    url.search = qs;
    window.history.replaceState({}, '', url.toString());
  }

  afterEach(() => {
    window.history.replaceState({}, '', window.location.pathname);
  });

  test('?tab=group -> activateOwnerLibrary(), pas de switchView', () => {
    detectParticipantToken.mockReturnValue(null);
    setSearch('?tab=group');
    handleParticipantUrl();
    expect(activateOwnerLibrary).toHaveBeenCalled();
  });

  test('?tab=wallet -> redirige vers komerce (openMonKomerce focus wallet)', () => {
    detectParticipantToken.mockReturnValue(null);
    setSearch('?tab=wallet');
    handleParticipantUrl();
    expect(openMonKomerce).toHaveBeenCalledWith({ focus: 'wallet' });
  });

  test('?tab=invalide -> ignoré, aucune activation', () => {
    detectParticipantToken.mockReturnValue(null);
    setSearch('?tab=nope');
    handleParticipantUrl();
    expect(activateOwnerLibrary).not.toHaveBeenCalled();
    expect(openMonKomerce).not.toHaveBeenCalled();
  });
});

describe('loadRelais', () => {
  test('succès -> state.relais reçoit data.relais', async () => {
    K.request.mockResolvedValueOnce({ relais: [{ id: 1 }, { id: 2 }] });
    await loadRelais();
    expect(K.request).toHaveBeenCalledWith('/api/relais/public', 'GET', null, 2, {});
    expect(state.relais).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test('réponse = tableau brut (sans wrapper .relais) -> utilisé tel quel', async () => {
    K.request.mockResolvedValueOnce([{ id: 9 }]);
    await loadRelais();
    expect(state.relais).toEqual([{ id: 9 }]);
  });

  test('échec réseau -> state.relais = [] (pas de throw)', async () => {
    K.request.mockRejectedValueOnce(new Error('network down'));
    await expect(loadRelais()).resolves.not.toThrow();
    expect(state.relais).toEqual([]);
  });
});
