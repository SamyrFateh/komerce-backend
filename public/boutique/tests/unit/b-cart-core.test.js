'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-cart-core.test.js
 *
 * Module js/b-cart-core.js (132L) — §3 TOAST & CART CORE, @criticality
 * medium mais dépendance transitive de quasiment tout le boutique (b-cart,
 * b-checkout, b-catalog, b-modal-core, b-share-cart, b-nav, b-tracking,
 * b-paypal, b-favs, b-identity, b-group-view, b-mini-cart, b-subcat,
 * render-product-card).
 *
 * Avant cette session : mocké intégralement (`jest.mock('../../js/
 * b-cart-core.js', ...)`) dans 12 fichiers de test consommateurs, jamais
 * importé pour de vrai — sauf cartQty/cartTotal, exercées indirectement
 * via b-cart-pill.test.js et b-mini-cart.test.js. `showToast`, `saveCart`,
 * `updateCartBadge`, `isFav`, `saveFavs` (5 des 7 exports) n'étaient
 * exécutés NULLE PART. `boutique-core.unit.test.js` prétendait couvrir ce
 * fichier mais réimplémentait `cartQty`/`cartTotal`/`isFav` en inline sans
 * jamais `require()` le vrai module — un bug ici serait passé inaperçu.
 *
 * Ici : b-store.js (state, dom) et b-bus.js (bus) réels — pas de mock,
 * fonctions pures/DOM-pures sur un state contrôlé par resetState/resetDom
 * du kit partagé.
 */

const { state, dom } = require('../../js/b-store.js');
const { bus } = require('../../js/b-bus.js');
const {
  showToast,
  cartQty,
  cartTotal,
  saveCart,
  updateCartBadge,
  isFav,
  saveFavs,
} = require('../../js/b-cart-core.js');

const { resetState, resetDom, resetLocalStorage, mountFixture } = require('./helpers/boutiqueTestKit');

beforeEach(() => {
  resetState(state);
  resetDom(dom, { toast: 'div' });
  resetLocalStorage();
  mountFixture();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('showToast', () => {
  test('affiche le message et applique la classe show', () => {
    showToast('Ajouté au panier');
    expect(dom.toast.innerHTML).toContain('Ajouté au panier');
    expect(dom.toast.className).toBe('k-toast show');
  });

  test('ajoute le type (error/success) à la classe CSS', () => {
    showToast('Erreur réseau', 'error');
    expect(dom.toast.className).toBe('k-toast show error');
  });

  test('sans message -> ne plante pas, contenu vide toléré', () => {
    showToast();
    expect(dom.toast.innerHTML).toContain('k-toast-simple');
  });

  test('masque le toast après la durée par défaut (2800ms)', () => {
    showToast('msg');
    expect(dom.toast.classList.contains('show')).toBe(true);
    jest.advanceTimersByTime(2799);
    expect(dom.toast.classList.contains('show')).toBe(true);
    jest.advanceTimersByTime(1);
    expect(dom.toast.classList.contains('show')).toBe(false);
  });

  test('respecte une durée personnalisée', () => {
    showToast('msg', '', 500);
    jest.advanceTimersByTime(500);
    expect(dom.toast.classList.contains('show')).toBe(false);
  });

  test('un second appel avant expiration annule le timer précédent (pas de double masquage prématuré)', () => {
    showToast('premier');
    jest.advanceTimersByTime(1000);
    showToast('second'); // repart sur 2800ms, annule le timer du premier
    jest.advanceTimersByTime(2000); // total réel 3000ms depuis 'premier', mais 'second' n'a que 2000ms
    expect(dom.toast.classList.contains('show')).toBe(true);
    jest.advanceTimersByTime(800);
    expect(dom.toast.classList.contains('show')).toBe(false);
  });
});

describe('cartQty / cartTotal', () => {
  test('cartQty() somme les quantités', () => {
    state.cart = [{ qty: 2, product: { price_kmf: 100 } }, { qty: 3, product: { price_kmf: 50 } }];
    expect(cartQty()).toBe(5);
  });

  test('cartQty() panier vide -> 0', () => {
    state.cart = [];
    expect(cartQty()).toBe(0);
  });

  test('cartTotal() somme prix * qty', () => {
    state.cart = [{ qty: 2, product: { price_kmf: 100 } }, { qty: 3, product: { price_kmf: 50 } }];
    expect(cartTotal()).toBe(2 * 100 + 3 * 50);
  });

  test('cartTotal() tolère un produit sans price_kmf (traité comme 0)', () => {
    state.cart = [{ qty: 2, product: {} }];
    expect(cartTotal()).toBe(0);
  });
});

describe('saveCart', () => {
  test('persiste le panier et la version dans localStorage', () => {
    state.cart = [{ qty: 1, product: { price_kmf: 100 } }];
    saveCart();
    expect(JSON.parse(localStorage.getItem('kmrc_cart'))).toEqual(state.cart);
    expect(localStorage.getItem('kmrc_cart_v')).toBe('3');
  });

  test('appelle updateCartBadge() (émet cart:update)', () => {
    const spy = jest.fn();
    bus.on('cart:update', spy);
    state.cart = [];
    saveCart();
    expect(spy).toHaveBeenCalled();
    bus.off('cart:update', spy);
  });

  test('échoue silencieusement si localStorage.setItem lève (mode privé)', () => {
    const orig = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(() => saveCart()).not.toThrow();
    localStorage.setItem = orig;
  });
});

describe('updateCartBadge', () => {
  function mountCartButton() {
    mountFixture(
      '<button class="k-cart-btn"><img class="k-cart-avatar"><span class="k-cart-badge"></span></button>'
    );
  }

  test('panier vide -> avatar_seule, badge masqué, classes is-empty', () => {
    mountCartButton();
    state.cart = [];
    updateCartBadge();
    const btn = document.querySelector('.k-cart-btn');
    const img = document.querySelector('.k-cart-avatar');
    const badge = document.querySelector('.k-cart-badge');
    expect(btn.classList.contains('is-empty')).toBe(true);
    expect(btn.classList.contains('has-items')).toBe(false);
    expect(img.src).toContain('/images/avatar_seule.png');
    expect(badge.classList.contains('show')).toBe(false);
    expect(badge.textContent).toBe('');
  });

  test('panier rempli -> avatar_panier, badge affiché avec le compte', () => {
    mountCartButton();
    state.cart = [{ qty: 3, product: { price_kmf: 100 } }];
    updateCartBadge();
    const btn = document.querySelector('.k-cart-btn');
    const img = document.querySelector('.k-cart-avatar');
    const badge = document.querySelector('.k-cart-badge');
    expect(btn.classList.contains('has-items')).toBe(true);
    expect(img.src).toContain('/images/avatar_panier.png');
    expect(badge.classList.contains('show')).toBe(true);
    expect(badge.textContent).toBe('3');
  });

  test('émet side-cart:render et cart:update', () => {
    const sideCartSpy = jest.fn();
    const cartUpdateSpy = jest.fn();
    bus.on('side-cart:render', sideCartSpy);
    bus.on('cart:update', cartUpdateSpy);
    state.cart = [];
    updateCartBadge();
    expect(sideCartSpy).toHaveBeenCalledTimes(1);
    expect(cartUpdateSpy).toHaveBeenCalledTimes(1);
    bus.off('side-cart:render', sideCartSpy);
    bus.off('cart:update', cartUpdateSpy);
  });

  test('aucun bouton panier dans le DOM -> ne plante pas', () => {
    mountFixture('');
    state.cart = [];
    expect(() => updateCartBadge()).not.toThrow();
  });
});

describe('isFav', () => {
  test('retourne true si le produit est dans les favoris (comparaison en string)', () => {
    state.favs = [12, '34'];
    expect(isFav(12)).toBe(true);
    expect(isFav('12')).toBe(true);
    expect(isFav(34)).toBe(true);
  });

  test('retourne false si absent', () => {
    state.favs = [12];
    expect(isFav(99)).toBe(false);
  });

  test('favs vide -> toujours false', () => {
    state.favs = [];
    expect(isFav(1)).toBe(false);
  });
});

describe('saveFavs', () => {
  test('persiste state.favs dans localStorage (clé k_favs)', () => {
    state.favs = [1, 2, 3];
    saveFavs();
    expect(JSON.parse(localStorage.getItem('k_favs'))).toEqual([1, 2, 3]);
  });

  test('favs vide -> persiste un tableau vide', () => {
    state.favs = [];
    saveFavs();
    expect(JSON.parse(localStorage.getItem('k_favs'))).toEqual([]);
  });
});
