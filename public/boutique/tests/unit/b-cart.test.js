/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * @komerce-arch-lite
 * @role          canonical-cart-renderer-tests
 * @domain        shared-cart
 * @layer         test
 * @status        production
 * @owner         public/boutique/tests/unit/b-cart.test.js
 * @purpose       Tests unitaires de js/b-cart.js — panier personnel (inchangé,
 *                conservé du Lot B) et rendu canonique du snapshot shared-cart
 *                (Lot A/D : b-cart.js est l'unique propriétaire des lignes, y
 *                compris pour un contexte de liste partagée). Couvre le rendu
 *                snapshot, claimed/grisé + « Déjà acheté », lecture seule
 *                participant, mode édition organisateur, ouverture fiche
 *                produit, drawer mobile — sans reconstruire le panneau
 *                parallèle démantelé.
 * @impact-areas  shared-cart, cart, boutique
 * @version       2026-08-lotD
 */
'use strict';

/**
 * tests/unit/b-cart.test.js — Lot D (refactor soustractif shared-cart, clôture)
 *
 * Reclassification du set hérité du Lot B (46 échecs contre l'implémentation
 * actuelle) suivant la décision de clôture :
 *
 *   A. Supprimés  : tout ce qui vérifiait le panneau parallèle abandonné
 *      (#k-shared-list-panel, .k-shared-list-header, sélection Sélectionner/
 *      Sélectionné, is-selected, progression/footer dédiés). Rien de tel ne
 *      subsiste dans ce fichier.
 *   B. Réécrits   : le bloc "Amendement V2 §A" (coexistence panier/liste) de
 *      l'ancien fichier, qui assertait sur `.k-shared-list-header`, est
 *      remplacé par la section "Snapshot canonique (Lot A/B — renderCartSnapshot)"
 *      ci-dessous, qui vérifie les mêmes invariants métier via le chrome
 *      canonique réel (#k-sc-items, #k-cart-body, #k-cart-footer-btns,
 *      .k-sc-header) et des helpers texte/rôle (voir helpers/query-helpers.js).
 *   — : tout le reste (addToCart, setQty, removeFromCart, quickAdd/quickRemove,
 *      toggleFav, markAllCartButtons, openCart/closeCart/openCartWithHighlight,
 *      clearCart/pruneObsoleteCart) est conservé à l'identique : ces tests ne
 *      dépendaient déjà d'aucun sélecteur de l'ancien panneau.
 *
 * Répartition (Lot D, point C du mandat) : ce fichier ne teste que le rendu
 * et l'interaction avec les lignes (panier personnel + snapshot canonique).
 * Le contrôleur (chargement, capacités, absence de boucle/sélection) est
 * couvert par group-side-cart.test.js.
 */

jest.mock('../../js/b-catalog.js', () => ({
  scrollToCategorySection: jest.fn(),
}));

jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((s) => (s === null || s === undefined ? '' : String(s))),
  fmt: jest.fn((n) => String(n) + ' KMF'),
  fmtPrice: jest.fn((n) => String(n)),
  optimizeImgUrl: jest.fn((url) => url),
  productEmoji: jest.fn(() => '📦'),
  _currency: 'KMF',
  apiGet: jest.fn(),
  apiPost: jest.fn(),
}));

jest.mock('../../js/b-cart-core.js', () => ({
  showToast: jest.fn(),
  updateCartBadge: jest.fn(),
  saveCart: jest.fn(),
  cartQty: jest.fn(() => 0),
  cartTotal: jest.fn(() => 0),
  saveFavs: jest.fn(),
}));

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(() => false),
  getScrollY: jest.fn(() => 0),
  scrollToPosition: jest.fn(),
}));

jest.mock('../../js/shop-schema.js', () => ({
  getCategoryIcon: jest.fn(),
  normalizeCategoryKey: jest.fn((k) => k),
}));

const { state, dom, scroll, initDom } = require('../../js/b-store.js');
const { showToast, updateCartBadge, saveCart, cartQty, saveFavs } =
  require('../../js/b-cart-core.js');
const { isDesktop, getScrollY, scrollToPosition } = require('../../js/b-scroll-owner.js');
const { bus } = require('../../js/b-bus.js');
const { buildCartDom } = require('./helpers/cart-dom-fixture.js');
const { findButtonByText, byClass } = require('./helpers/query-helpers.js');

const {
  addToCart, quickAdd, quickRemove, toggleFav, setQty,
  openCart, closeCart, openCartWithHighlight,
  renderCartBody, removeFromCart, markAllCartButtons,
  clearCart, pruneObsoleteCart,
} = require('../../js/b-cart.js');
const {
  activateSharedListContext,
  clearSharedListContext,
} = require('../../js/group/group-side-cart.js');

function makeProduct(overrides) {
  return Object.assign({
    id: 1,
    name: 'Riz basmati 5kg',
    price_kmf: 5000,
    image_url: '',
  }, overrides);
}

function freshSharedListContext() {
  return {
    sharedCartId: null, token: null, status: 'open', isCreator: false,
    creatorFirstName: null, title: null, message: null, items: [],
  };
}

function resetDom() {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = jest.fn();
  }
  buildCartDom();
  initDom();
  document.body.classList.remove('cart-open', 'cart-empty');
}

describe('b-cart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDom();
    state.cart = [];
    state.favs = [];
    state.products = [];
    state.sharedListContext = freshSharedListContext();
    state.sharedListEditMode = false;
    state.cartSurface = 'personal';
    state.savedListTokensThisSession = new Set();
    state.modalReturnSurface = null;
    scroll.savedY = 0;
    isDesktop.mockReturnValue(false);
    saveCart.mockImplementation(() => {
      updateCartBadge();
      bus.emit('cart:update');
    });
  });

  describe('addToCart', () => {
    it("ajoute un nouvel article au panier avec qty par défaut = 1", () => {
      const product = makeProduct();
      addToCart(product);
      expect(state.cart).toHaveLength(1);
      expect(state.cart[0]).toMatchObject({
        id: 1, name: 'Riz basmati 5kg', price: 5000, qty: 1,
      });
      expect(saveCart).toHaveBeenCalled();
    });

    it('respecte la qty explicite passée en argument', () => {
      addToCart(makeProduct(), 3);
      expect(state.cart[0].qty).toBe(3);
    });

    it('incrémente la qty si le produit est déjà dans le panier', () => {
      const product = makeProduct();
      addToCart(product, 2);
      addToCart(product, 1);
      expect(state.cart).toHaveLength(1);
      expect(state.cart[0].qty).toBe(3);
    });

    it('complète les champs manquants (id/name/price/image) sur un item existant incomplet', () => {
      state.cart = [{ product: null, id: null, name: null, price: null, image: '', qty: 1 }];
      state.cart[0].id = 1;
      const product = makeProduct({ image_url: 'https://img/x.jpg' });
      addToCart(product, 1);
      const item = state.cart[0];
      expect(item.qty).toBe(2);
      expect(item.product).toBe(product);
      expect(item.name).toBe('Riz basmati 5kg');
      expect(item.image).toBe('https://img/x.jpg');
    });

    it('fallback price sur `price` si `price_kmf` absent, 0 si aucun des deux', () => {
      addToCart(makeProduct({ price_kmf: undefined, price: 999 }));
      expect(state.cart[0].price).toBe(999);

      state.cart = [];
      addToCart(makeProduct({ price_kmf: undefined, price: undefined }));
      expect(state.cart[0].price).toBe(0);
    });

    it('sans sourceBtn : pas de fly animation, pas de toast, pas de crash', () => {
      expect(() => addToCart(makeProduct())).not.toThrow();
      expect(showToast).not.toHaveBeenCalled();
    });

    it('avec un bouton grid classique : feedback added→in-cart après 800ms + toast succès', () => {
      jest.useFakeTimers();
      const btn = document.createElement('button');
      addToCart(makeProduct(), 1, btn);

      expect(btn.classList.contains('added')).toBe(true);
      expect(btn.disabled).toBe(true);
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('ajouté'), 'success');

      jest.advanceTimersByTime(800);
      expect(btn.classList.contains('added')).toBe(false);
      expect(btn.classList.contains('in-cart')).toBe(true);
      expect(btn.disabled).toBe(false);
      jest.useRealTimers();
    });

    it('bouton modal (dom.addCartBtn) : pas de classe added/in-cart immédiate, feedback différé "confirmed"', () => {
      jest.useFakeTimers();
      addToCart(makeProduct(), 1, dom.addCartBtn);

      expect(dom.addCartBtn.classList.contains('added')).toBe(false);
      expect(showToast).not.toHaveBeenCalled();

      cartQty.mockReturnValue(1);
      jest.advanceTimersByTime(700);
      expect(dom.addCartBtn.classList.contains('confirmed')).toBe(true);
      expect(dom.addCartBtn.innerHTML).toContain('Ajouté');
      jest.useRealTimers();
    });

    it('bouton buy-now (id=k-buy-now-btn) sur desktop : émet side-cart:render, pas de toast', () => {
      isDesktop.mockReturnValue(true);
      const busSpy = jest.spyOn(bus, 'emit');
      const buyNowBtn = document.createElement('button');
      buyNowBtn.id = 'k-buy-now-btn';

      addToCart(makeProduct(), 1, buyNowBtn);

      expect(busSpy).toHaveBeenCalledWith('side-cart:render');
      expect(showToast).not.toHaveBeenCalled();
      busSpy.mockRestore();
    });

    it('appelle markAllCartButtons (synchronise les boutons .k-card-add existants)', () => {
      const gridBtn = document.createElement('div');
      gridBtn.className = 'k-card-add';
      gridBtn.dataset.add = '1';
      document.body.appendChild(gridBtn);

      addToCart(makeProduct({ id: 1 }));

      expect(gridBtn.classList.contains('in-cart')).toBe(true);
      expect(gridBtn.innerHTML).toContain('k-add-qty');
    });
  });

  describe('addToCart — identité de ligne par rail de transport (chantier Air Shipped §7)', () => {
    it('stocke requested_transport_rail sur la ligne créée, null par défaut si aucun choix explicite', () => {
      addToCart(makeProduct(), 1);
      expect(state.cart[0].requested_transport_rail).toBeNull();
      expect(state.cart[0].delivery_mode).toBeUndefined();
    });

    it('transmet le code canonique du rail passé via options.requested_transport_rail', () => {
      addToCart(makeProduct(), 1, null, { requested_transport_rail: 'AIR_EXPRESS' });
      expect(state.cart[0].requested_transport_rail).toBe('AIR_EXPRESS');
    });

    it('même produit, même rail → fusionne (incrémente la même ligne)', () => {
      const product = makeProduct();
      addToCart(product, 1, null, { requested_transport_rail: 'SEA_STANDARD' });
      addToCart(product, 2, null, { requested_transport_rail: 'SEA_STANDARD' });

      expect(state.cart).toHaveLength(1);
      expect(state.cart[0].qty).toBe(3);
    });

    it('même produit, rails différents → deux lignes distinctes, jamais fusionnées', () => {
      const product = makeProduct();
      addToCart(product, 1, null, { requested_transport_rail: 'SEA_STANDARD' });
      addToCart(product, 1, null, { requested_transport_rail: 'AIR_EXPRESS' });

      expect(state.cart).toHaveLength(2);
      const rails = state.cart.map((item) => item.requested_transport_rail).sort();
      expect(rails).toEqual(['AIR_EXPRESS', 'SEA_STANDARD']);
      expect(state.cart.every((item) => item.qty === 1)).toBe(true);
    });

    it('même produit, un rail explicite et un rail null → deux lignes distinctes (null est une valeur de rail à part entière)', () => {
      const product = makeProduct();
      addToCart(product, 1);
      addToCart(product, 1, null, { requested_transport_rail: 'AIR_EXPRESS' });

      expect(state.cart).toHaveLength(2);
    });
  });

  describe('setQty', () => {
    beforeEach(() => {
      state.cart = [{ product: { id: 1 }, id: 1, name: 'X', price: 100, image: '', qty: 2 }];
    });

    it('met à jour la quantité et sauvegarde/rafraîchit', () => {
      setQty(1, 5);
      expect(state.cart[0].qty).toBe(5);
      expect(saveCart).toHaveBeenCalled();
      expect(updateCartBadge).toHaveBeenCalled();
    });

    it('newQty < 1 → supprime l\'article via removeFromCart', () => {
      setQty(1, 0);
      expect(state.cart).toHaveLength(0);
    });

    it('produit introuvable → ne modifie rien, ne throw pas', () => {
      expect(() => setQty(999, 3)).not.toThrow();
      expect(state.cart[0].qty).toBe(2);
    });

    it('compare les IDs en string (id numérique vs string)', () => {
      setQty('1', 7);
      expect(state.cart[0].qty).toBe(7);
    });
  });

  describe('removeFromCart', () => {
    it('retire l\'article correspondant et sauvegarde', () => {
      state.cart = [
        { product: { id: 1 }, qty: 1 },
        { product: { id: 2 }, qty: 1 },
      ];
      removeFromCart(1);
      expect(state.cart).toHaveLength(1);
      expect(state.cart[0].product.id).toBe(2);
      expect(saveCart).toHaveBeenCalled();
    });

    it('id inexistant → panier inchangé, pas de crash', () => {
      state.cart = [{ product: { id: 1 }, qty: 1 }];
      expect(() => removeFromCart(999)).not.toThrow();
      expect(state.cart).toHaveLength(1);
    });
  });

  describe('quickAdd', () => {
    it('trouve le produit dans state.products et appelle addToCart', () => {
      state.products = [makeProduct({ id: 42 })];
      quickAdd(42);
      expect(state.cart).toHaveLength(1);
      expect(state.cart[0].id).toBe(42);
    });

    it('produit introuvable → warn console, pas de crash, panier inchangé', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      state.products = [];
      expect(() => quickAdd(999)).not.toThrow();
      expect(state.cart).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('quickRemove', () => {
    it('qty === 1 → supprime complètement l\'article', () => {
      state.cart = [{ product: { id: 1 }, qty: 1 }];
      quickRemove(1);
      expect(state.cart).toHaveLength(0);
    });

    it('qty > 1 → décrémente via setQty sans supprimer', () => {
      state.cart = [{ product: { id: 1 }, qty: 3 }];
      quickRemove(1);
      expect(state.cart).toHaveLength(1);
      expect(state.cart[0].qty).toBe(2);
    });

    it('item introuvable → ne fait rien', () => {
      state.cart = [];
      expect(() => quickRemove(1)).not.toThrow();
    });
  });

  describe('toggleFav', () => {
    it('ajoute aux favoris (coeur plein, toast, classe liked+pop)', () => {
      jest.useFakeTimers();
      const btn = document.createElement('button');
      state.favs = [];
      toggleFav(7, btn);
      expect(state.favs).toContain(7);
      expect(btn.classList.contains('liked')).toBe(true);
      expect(btn.innerHTML).toBe('❤️');
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Ajouté aux favoris'));
      expect(saveFavs).toHaveBeenCalled();
      jest.advanceTimersByTime(300);
      expect(btn.classList.contains('k-pop')).toBe(false);
      jest.useRealTimers();
    });

    it('retire des favoris (coeur vide, toast retrait)', () => {
      const btn = document.createElement('button');
      btn.classList.add('liked');
      state.favs = [7];
      toggleFav(7, btn);
      expect(state.favs).not.toContain(7);
      expect(btn.classList.contains('liked')).toBe(false);
      expect(btn.innerHTML).toBe('🤍');
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Retiré des favoris'));
      expect(saveFavs).toHaveBeenCalled();
    });
  });

  describe('markAllCartButtons', () => {
    it('affiche le stepper − qty + pour un produit dans le panier', () => {
      state.cart = [{ product: { id: 5 }, qty: 4 }];
      const btn = document.createElement('div');
      btn.className = 'k-card-add';
      btn.dataset.add = '5';
      document.body.appendChild(btn);

      markAllCartButtons();

      expect(btn.classList.contains('in-cart')).toBe(true);
      expect(btn.querySelector('.k-add-qty').textContent).toBe('4');
    });

    it('remet le bouton "+" simple pour un produit absent du panier', () => {
      state.cart = [];
      const btn = document.createElement('div');
      btn.className = 'k-card-add';
      btn.classList.add('in-cart');
      btn.dataset.add = '5';
      document.body.appendChild(btn);

      markAllCartButtons();

      expect(btn.classList.contains('in-cart')).toBe(false);
      expect(btn.querySelector('.k-card-add-plus')).not.toBeNull();
      expect(btn.innerHTML).not.toContain('panier_tresse_vert.png');
    });
  });

  describe('openCart / closeCart / openCartWithHighlight', () => {
    it('openCart (mobile) : ouvre le drawer, sauvegarde le scroll', () => {
      isDesktop.mockReturnValue(false);
      getScrollY.mockReturnValue(123);
      openCart();
      expect(dom.cartOverlay.classList.contains('open')).toBe(true);
      expect(dom.cartDrawer.classList.contains('open')).toBe(true);
      expect(document.body.classList.contains('cart-open')).toBe(true);
      expect(scroll.savedY).toBe(123);
    });

    it('openCart (desktop) : n\'ouvre pas de drawer, scrolle vers le side cart persistant (montre les articles avant tout checkout)', () => {
      isDesktop.mockReturnValue(true);
      window.scrollTo = jest.fn();
      const busSpy = jest.spyOn(bus, 'emit');
      openCart();
      // Correctif UX — l'avatar ne doit plus sauter directement au
      // formulaire de paiement (checkout:open) : il doit d'abord montrer
      // le résumé des articles dans le side cart persistant.
      expect(busSpy).not.toHaveBeenCalledWith('checkout:open');
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
      expect(dom.cartOverlay.classList.contains('open')).toBe(false);
      busSpy.mockRestore();
    });

    it('closeCart : ferme le drawer et restaure le scroll sauvegardé', () => {
      dom.cartOverlay.classList.add('open');
      dom.cartDrawer.classList.add('open');
      document.body.classList.add('cart-open', 'cart-empty');
      scroll.savedY = 456;

      closeCart();

      expect(dom.cartOverlay.classList.contains('open')).toBe(false);
      expect(dom.cartDrawer.classList.contains('open')).toBe(false);
      expect(document.body.classList.contains('cart-open')).toBe(false);
      expect(document.body.classList.contains('cart-empty')).toBe(false);
      expect(scrollToPosition).toHaveBeenCalledWith(456);
      expect(scroll.savedY).toBe(0);
    });

    it('closeCart : sans scroll sauvegardé, ne rappelle pas scrollToPosition', () => {
      scroll.savedY = 0;
      closeCart();
      expect(scrollToPosition).not.toHaveBeenCalled();
    });

    it('openCartWithHighlight (mobile) : ouvre le drawer + bandeau célébration puis restore le titre après 2400ms', () => {
      jest.useFakeTimers();
      isDesktop.mockReturnValue(false);
      cartQty.mockReturnValue(2);
      state.cart = [{ product: { id: 9, price_kmf: 100 }, qty: 1 }];

      openCartWithHighlight(9);

      expect(dom.cartHeader.classList.contains('celebrating')).toBe(true);
      expect(dom.cartHeaderTitle.textContent).toContain('dans le panier');
      expect(dom.cartOverlay.classList.contains('open')).toBe(true);

      jest.advanceTimersByTime(2400);
      expect(dom.cartHeader.classList.contains('celebrating')).toBe(false);
      expect(dom.cartHeaderTitle.textContent).toBe('Mon Panier (2)');
      jest.useRealTimers();
    });

    it('openCartWithHighlight (desktop) : pas de drawer mobile ouvert', () => {
      isDesktop.mockReturnValue(true);
      state.cart = [{ product: { id: 9, price_kmf: 100 }, qty: 1 }];
      openCartWithHighlight(9);
      expect(dom.cartOverlay.classList.contains('open')).toBe(false);
      expect(document.body.classList.contains('cart-open')).toBe(false);
    });
  });

  describe('renderCartBody (rendu de surface, panier personnel)', () => {
    it('panier vide → message vide affiché, footer masqué, body marqué cart-empty', () => {
      state.cart = [];
      renderCartBody();
      expect(dom.cartBody.innerHTML).toContain('Votre panier est vide');
      expect(dom.cartFooter.classList.contains('u-hidden')).toBe(true);
      expect(document.body.classList.contains('cart-empty')).toBe(true);
    });

    it('panier rempli → une ligne par article, footer visible, body pas marqué vide', () => {
      state.cart = [
        { product: { id: 1, name: 'Riz', price_kmf: 1000 }, qty: 2 },
        { product: { id: 2, name: 'Huile', price_kmf: 2000 }, qty: 1 },
      ];
      renderCartBody();
      const rows = dom.cartBody.querySelectorAll('.k-cart-item');
      expect(rows).toHaveLength(2);
      expect(dom.cartFooter.classList.contains('u-hidden')).toBe(false);
      expect(document.body.classList.contains('cart-empty')).toBe(false);
    });

    it('highlightId correspondant → marque la ligne .new-item avec badge', () => {
      state.cart = [{ product: { id: 3, name: 'Sucre', price_kmf: 500 }, qty: 1 }];
      renderCartBody(3);
      const row = dom.cartBody.querySelector('.k-cart-item');
      expect(row.classList.contains('new-item')).toBe(true);
      expect(row.querySelector('.k-cart-item-badge')).not.toBeNull();
    });
  });

  describe('clearCart', () => {
    it('vide le panier et sauvegarde', () => {
      state.cart = [{ product: { id: 1 }, qty: 1 }];
      clearCart();
      expect(state.cart).toHaveLength(0);
      expect(saveCart).toHaveBeenCalled();
    });
  });

  describe('pruneObsoleteCart', () => {
    it('retire les articles dont l\'id n\'est plus dans validIdSet et sauvegarde', () => {
      state.cart = [
        { product: { id: 1 }, qty: 1 },
        { product: { id: 2 }, qty: 1 },
      ];
      pruneObsoleteCart(new Set(['1']));
      expect(state.cart).toHaveLength(1);
      expect(state.cart[0].product.id).toBe(1);
      expect(saveCart).toHaveBeenCalled();
    });

    it('rien à retirer → ne sauvegarde pas (pas de changement de longueur)', () => {
      state.cart = [{ product: { id: 1 }, qty: 1 }];
      pruneObsoleteCart(new Set(['1']));
      expect(saveCart).not.toHaveBeenCalled();
    });
  });

  /**
   * ── Snapshot canonique (Lot A/B — renderCartSnapshot) ─────────────────
   * Remplace l'ancien bloc "Amendement V2 §A" (coexistence), qui assertait
   * sur `.k-shared-list-header` (panneau parallèle, supprimé). Ici on active
   * un vrai contexte de liste via group-side-cart.js (réel, non mocké) et on
   * vérifie le rendu produit par b-cart.js dans le chrome canonique.
   */
  describe('Snapshot canonique — rendu et interactions de liste partagée', () => {
    function activateList(overrides = {}) {
      activateSharedListContext(
        {
          cart: Object.assign({
            id: 'sc-1', token: 'tok-1', status: 'open', creator_first_name: 'Samsam',
          }, overrides.cart),
          items: overrides.items || [
            { id: 'i1', product_id: 'p1', name: 'Riz', image: null, quantity: 1, unit_price_kmf: 6500, claimed: false },
            { id: 'i2', product_id: 'p2', name: 'Huile', image: null, quantity: 2, unit_price_kmf: 3000, claimed: true },
          ],
          is_creator: overrides.isCreator ?? false,
        },
        'tok-1',
      );
    }

    it('rend une ligne par article snapshot dans le side cart et le drawer, avec les données préservées', () => {
      activateList();
      const scItems = document.getElementById('k-sc-items').querySelectorAll('.k-cart-snapshot-item');
      const drawerItems = dom.cartBody.querySelectorAll('.k-cart-snapshot-item');
      expect(scItems).toHaveLength(2);
      expect(drawerItems).toHaveLength(2);
      expect(dom.cartBody.textContent).toContain('Riz');
      expect(dom.cartBody.textContent).toContain('6500 KMF');
    });

    it('P0 (audit terrain — F22-6/F22-7) : un side-cart:render externe (panier personnel vide) ne vide jamais le panneau pendant qu\'une liste est active', () => {
      // Régression du bug réel : renderSideCart() (rendu du panier
      // PERSONNEL) était câblée sur 'side-cart:render' sans aucune garde.
      // Cet événement est émis pour de multiples raisons pendant qu'une
      // liste partagée est active (ex. group-side-cart.js après une mutation
      // de la liste, ou tout autre code qui rafraîchit juste le badge). Sans
      // garde, chaque émission réécrivait #k-side-cart selon state.cart (le
      // panier personnel) — vide dans ce scénario — vidant #k-sc-items et
      // retirant .has-items, donc cachant tout le panneau de liste.
      activateList();
      state.cart = []; // panier personnel vide, scénario reproduit en conditions réelles

      bus.emit('side-cart:render');

      const sc = document.getElementById('k-side-cart');
      expect(sc.classList.contains('has-items')).toBe(true);
      expect(sc.querySelectorAll('.k-cart-snapshot-item')).toHaveLength(2);
      expect(document.getElementById('k-sc-items').innerHTML).not.toBe('');
    });

    it('image manquante (null) : fallback visuel affiché, aucun <img> avec src invalide', () => {
      activateList(); // items i1/i2 ont déjà image: null
      const row = dom.cartBody.querySelector('[data-item-id="i1"]');
      expect(row.querySelector('img')).toBeNull();
      expect(row.querySelector('.k-cart-item-img-fallback')).not.toBeNull();
      expect(row.querySelector('.k-cart-item-img').classList.contains('is-img-error')).toBe(true);
    });

    // Mandat §9 — une URL snapshotée invalide (chaîne non-URL, protocole non
    // http/https) ne doit jamais produire un <img src="..."> cassé : le même
    // garde-fou que l'image manquante s'applique, avant même toute tentative
    // de chargement réseau (isRenderableSnapshotImageUrl, pas seulement
    // onerror après coup).
    it('URL image invalide (non-URL) : même fallback que l\'image manquante, aucun <img> émis', () => {
      activateList({ items: [
        { id: 'i1', product_id: 'p1', name: 'Riz', image: 'ges.unsplash.com/photo-cassee', quantity: 1, unit_price_kmf: 6500, claimed: false },
      ] });
      const row = dom.cartBody.querySelector('[data-item-id="i1"]');
      expect(row.querySelector('img')).toBeNull();
      expect(row.querySelector('.k-cart-item-img-fallback')).not.toBeNull();
    });

    it('URL image valide : <img> émis avec un onerror de secours vers le fallback', () => {
      activateList({ items: [
        { id: 'i1', product_id: 'p1', name: 'Riz', image: 'https://cdn.komerce.co/riz.jpg', quantity: 1, unit_price_kmf: 6500, claimed: false },
      ] });
      const row = dom.cartBody.querySelector('[data-item-id="i1"]');
      const img = row.querySelector('img');
      expect(img).not.toBeNull();
      expect(img.getAttribute('src')).toBe('https://cdn.komerce.co/riz.jpg');
      expect(img.getAttribute('onerror')).toContain('is-img-error');
    });

    it('ligne réclamée : grisée (is-cart-item-claimed) et libellée "Déjà acheté"', () => {
      activateList();
      const claimedRow = dom.cartBody.querySelector('[data-item-id="i2"]');
      expect(claimedRow.classList.contains('is-cart-item-claimed')).toBe(true);
      expect(claimedRow.textContent).toContain('Déjà acheté');
    });

    it('chaque ligne disponible affiche son propre bouton "Acheter" ; jamais sur une ligne réclamée', () => {
      activateList(); // i1 disponible, i2 réclamé
      const buyBtn1 = dom.cartBody.querySelector('[data-item-id="i1"] .k-cart-item-buy');
      const buyBtn2 = dom.cartBody.querySelector('[data-item-id="i2"] .k-cart-item-buy');
      expect(buyBtn1).not.toBeNull();
      expect(buyBtn1.textContent.trim()).toBe('Acheter');
      expect(buyBtn2).toBeNull();
    });

    it('"Tout acheter" affiche la valeur totale des lignes disponibles (réclamées exclues)', () => {
      activateList(); // i1 disponible (6500), i2 réclamé (exclu du total)
      const buyAllBtn = findButtonByText('Tout acheter');
      expect(buyAllBtn).not.toBeNull();
      expect(buyAllBtn.textContent).toContain('6500 KMF');
      expect(buyAllBtn.disabled).toBeFalsy();
    });

    it('tout est réclamé → aucun bouton "Acheter" par ligne, "Tout acheter" absent', () => {
      activateList({ items: [
        { id: 'i1', product_id: 'p1', name: 'Riz', image: null, quantity: 1, unit_price_kmf: 6500, claimed: true },
      ] });
      expect(dom.cartBody.querySelector('.k-cart-item-buy')).toBeNull();
      expect(findButtonByText('Tout acheter')).toBeNull();
    });

    // Mandat §4 — une liste fermée est entièrement non opérationnelle :
    // aucun CTA d'achat, ni par ligne ni global, jamais laissé actif. Bug
    // réel trouvé en test Playwright contre un serveur/DB réel (invisible
    // aux tests jsdom précédents) : un CTA restait affiché et cliquable
    // sur une liste fermée.
    it('liste fermée (readOnly) → aucun bouton "Acheter" par ligne, "Tout acheter" absent, même avec des lignes disponibles', () => {
      activateList({
        isCreator: true,
        cart: { status: 'closed' },
        items: [
          { id: 'i1', product_id: 'p1', name: 'Riz', image: null, quantity: 1, unit_price_kmf: 6500, claimed: false },
        ],
      });
      expect(dom.cartBody.querySelector('.k-cart-item-buy')).toBeNull();
      expect(findButtonByText('Tout acheter')).toBeNull();
      expect(document.getElementById('k-cart-snap-closelist').textContent.trim()).toBe('Liste fermée');
    });

    it('participant (non organisateur) : lecture seule, aucun contrôle d\'édition, mais garde son bouton "Acheter" par ligne', () => {
      activateList({ isCreator: false });
      expect(byClass('k-cart-item-remove', dom.cartBody)).toHaveLength(0);
      expect(byClass('k-qty-btn', dom.cartBody)).toHaveLength(0);
      expect(dom.cartBody.querySelector('[data-item-id="i1"] .k-cart-item-buy')).not.toBeNull();
    });

    // Doctrine finale (2026-08) — plus de bascule "✎ Modifier / Terminer" :
    // les steppers quantité et le ✕ sont TOUJOURS visibles pour
    // l'organisateur sur les lignes disponibles, tant que la liste reste
    // ouverte. Rien à activer, rien à désactiver.
    it('organisateur : steppers quantité et ✕ toujours visibles sur les lignes disponibles, sans bascule Modifier/Terminer', () => {
      activateList({ isCreator: true });
      expect(findButtonByText('Modifier')).toBeNull();
      expect(findButtonByText('Terminer')).toBeNull();

      const removeButtons = byClass('k-cart-item-remove', dom.cartBody);
      const qtyGroups = byClass('k-cart-item-qty', dom.cartBody);
      expect(removeButtons).toHaveLength(1); // seulement i1 (disponible) ; i2 est réclamé
      expect(qtyGroups).toHaveLength(1);
      expect(removeButtons[0].dataset.itemId).toBe('i1');
    });

    it('ouvre la fiche produit canonique depuis une ligne de liste (bus modal:open)', () => {
      state.products = [{ id: 'p1', name: 'Riz' }];
      activateList();
      const busSpy = jest.spyOn(bus, 'emit');

      const openBtn = dom.cartBody.querySelector('.k-cart-snapshot-item-open[data-item-id="i1"]');
      expect(openBtn).not.toBeNull();
      openBtn.click();

      expect(busSpy).toHaveBeenCalledWith('modal:open', expect.objectContaining({
        id: 'p1', source: 'shared-list', sharedCartItemId: 'i1',
      }));
      busSpy.mockRestore();
    });

    // P0-C/§5 — doctrine finale : « liste active = LE panier ». Réouvrir le
    // drawer (avatar panier, CTA, etc.) pendant qu'une liste est active doit
    // continuer à montrer LA LISTE, jamais rebasculer silencieusement sur le
    // panier personnel comme surface concurrente. Inverse l'ancienne
    // assertion ('personal'), qui protégeait exactement le bug P0-C.
    it('fermeture puis réouverture du drawer mobile restent sur la liste active (jamais un retour implicite au panier personnel)', () => {
      isDesktop.mockReturnValue(false);
      activateList();
      expect(dom.cartDrawer.classList.contains('open')).toBe(true);

      closeCart();
      expect(dom.cartDrawer.classList.contains('open')).toBe(false);

      openCart();
      expect(dom.cartDrawer.classList.contains('open')).toBe(true);
      expect(state.cartSurface).toBe('shared-list');
    });

    it('panier personnel restauré après clearSharedListContext : plus aucune trace snapshot dans le chrome', () => {
      activateList();
      clearSharedListContext();
      state.cart = [{ product: { id: 1, name: 'Riz', price_kmf: 1000 }, qty: 1 }];

      renderCartBody();

      expect(state.cartSurface).toBe('personal');
      expect(dom.cartBody.querySelectorAll('.k-cart-snapshot-item')).toHaveLength(0);
      expect(dom.cartBody.querySelectorAll('.k-cart-item')).toHaveLength(1);
      expect(document.body.classList.contains('is-shared-list-context')).toBe(false);
    });

    // Mandat §13 — bug réel trouvé en test navigateur réel : le titre du
    // side cart desktop (.k-sc-title-label) restait bloqué sur le nom de
    // la liste ("Sync multi-client") après un retour au panier personnel,
    // alors que le reste du chrome (Vider, Commander, articles) affichait
    // déjà bien le panier personnel. Aucun pipeline panier personnel ne
    // réécrivait ce champ — seul le nettoyage snapshot devait le faire.
    it('le titre du side cart ("Mon panier") est restauré après clearSharedListContext, pas seulement le contenu', () => {
      activateList({ cart: { title: 'Sync multi-client' } });
      const titleLabel = document.getElementById('k-side-cart').querySelector('.k-sc-title-label');
      expect(titleLabel.textContent).toBe('Sync multi-client');

      clearSharedListContext();
      state.cart = [{ product: { id: 1, name: 'Riz', price_kmf: 1000 }, qty: 1 }];
      renderCartBody();

      expect(titleLabel.textContent).toBe('Mon panier');
    });

    it('preuve de non-régression : aucun panneau parallèle recréé', () => {
      activateList({ isCreator: true });
      expect(document.getElementById('k-shared-list-panel')).toBeNull();
      expect(document.querySelector('.k-shared-list-item')).toBeNull();
      expect(document.querySelector('.k-shared-list-header')).toBeNull();
      expect(document.querySelector('.k-shared-item-open')).toBeNull();
      expect(document.querySelector('.k-shared-item-qty-btn')).toBeNull();
    });

    /**
     * ── Résumé contributeurs (GAP-05, Lot 2) ────────────────────────────
     * context.contributors est déjà gaté côté backend (jamais peuplé pour
     * un participant, cf. shared-cart-reads.js) ; ces tests vérifient la
     * seconde barrière défensive côté rendu (contributorsSummaryText /
     * applySnapshotContributorsSummary), dans le chrome canonique du
     * drawer (#k-cart-header) et du side cart desktop (.k-sc-title-bar).
     */
    describe('Résumé contributeurs (GAP-05)', () => {
      // contributors est top-level dans le payload backend (cf.
      // shared-cart-reads.js : { cart, items, is_creator, contributors }),
      // jamais imbriqué dans `cart` — helper dédié pour refléter cette forme.
      function activateWithContributors({ isCreator, contributors, items }) {
        activateSharedListContext(
          {
            cart: { id: 'sc-1', token: 'tok-1', status: 'open', creator_first_name: 'Samsam' },
            items: items || [
              { id: 'i1', product_id: 'p1', name: 'Riz', image: null, quantity: 1, unit_price_kmf: 6500, claimed: true },
            ],
            is_creator: isCreator,
            contributors,
          },
          'tok-1',
        );
      }

      it('organisateur : affiche "Contributeurs : X · N articles" dans le drawer et le side cart', () => {
        activateWithContributors({ isCreator: true, contributors: [
          { first_name: 'Karim', items_count: 2 },
          { first_name: 'Fatima', items_count: 1 },
        ] });

        const drawerLine = document.getElementById('k-cart-header').querySelector('#k-cart-snapshot-contributors');
        const scLine = document.querySelector('.k-sc-title-bar')?.querySelector('#k-sc-snapshot-contributors');

        expect(drawerLine).not.toBeNull();
        expect(drawerLine.textContent).toBe('Contributeurs : Karim · 2 articles, Fatima · 1 article');
        expect(scLine).not.toBeNull();
        expect(scLine.textContent).toBe(drawerLine.textContent);
      });

      it('contributeur sans prénom exploitable → "Un participant"', () => {
        activateWithContributors({ isCreator: true, contributors: [
          { first_name: null, items_count: 1 },
        ] });

        const line = document.getElementById('k-cart-header').querySelector('#k-cart-snapshot-contributors');
        expect(line.textContent).toBe('Contributeurs : Un participant · 1 article');
      });

      it('aucune ligne réclamée (contributors vide) : aucune ligne de résumé insérée', () => {
        activateWithContributors({ isCreator: true, contributors: [] });
        expect(document.getElementById('k-cart-header').querySelector('#k-cart-snapshot-contributors')).toBeNull();
      });

      it('participant (non organisateur) : jamais de ligne de résumé, même si le payload contenait des contributeurs (défense en profondeur)', () => {
        activateWithContributors({
          isCreator: false,
          contributors: [{ first_name: 'Karim', items_count: 2 }],
          items: [{ id: 'i1', product_id: 'p1', name: 'Riz', image: null, quantity: 1, unit_price_kmf: 6500, claimed: true }],
        });
        expect(document.getElementById('k-cart-header').querySelector('#k-cart-snapshot-contributors')).toBeNull();
        expect(document.querySelector('.k-sc-title-bar')?.querySelector('#k-sc-snapshot-contributors')).toBeFalsy();
      });

      it('la ligne est retirée du DOM si un re-rendu ultérieur revient à contributors vide (jamais un élément fantôme)', () => {
        activateWithContributors({ isCreator: true, contributors: [
          { first_name: 'Karim', items_count: 2 },
        ] });
        expect(document.getElementById('k-cart-header').querySelector('#k-cart-snapshot-contributors')).not.toBeNull();

        activateWithContributors({ isCreator: true, contributors: [] });
        expect(document.getElementById('k-cart-header').querySelector('#k-cart-snapshot-contributors')).toBeNull();
      });
    });
  });
});
