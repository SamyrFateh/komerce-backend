'use strict';

/**
 * tests/unit/b-cart.test.js
 *
 * Module #2 du plan d'attaque frontend — js/b-cart.js (1562L), 0% → couverture
 * de la logique métier critique du panier (§7 CART INTERACTIONS + §10 CART
 * PANEL, hors partage WhatsApp / long-press stepper / fly animation détaillée
 * qui restent en dette assumée pour ce lot — cf. plan point 2).
 *
 * Périmètre couvert :
 *   - addToCart (nouvel article, incrément existant, feedback bouton, modal-add,
 *     buy-now, toast)
 *   - setQty (update, suppression si < 1, item introuvable)
 *   - removeFromCart
 *   - quickAdd / quickRemove
 *   - toggleFav
 *   - markAllCartButtons
 *   - openCart / closeCart / openCartWithHighlight (dont bascule desktop)
 *   - clearCart / pruneObsoleteCart
 *   - renderCartBody est exercée indirectement (appelée par setQty/removeFromCart/
 *     openCart) : on vérifie son rendu de surface (vide vs rempli) sans dupliquer
 *     tout le détail DOM déjà couvert ailleurs.
 *
 * state/dom viennent du vrai b-store.js (objets mutables partagés, pattern déjà
 * utilisé pour b-paypal.test.js / b-modal-cart.test.js). Les modules périphériques
 * lourds (réseau, scroll, catalogue, schéma catégories) sont mockés.
 */

jest.mock('../../js/b-catalog.js', () => ({
  scrollToCategorySection: jest.fn(),
}));

jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((s) => s),
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
  // b-nav.js appelle scrollPageToTop() lors d'un switchView déclenché par
  // renderGroupView (chaîne async post-loadSharedCart) ; non mocké, l'appel
  // réel plantait le process Node hors du cycle de vie du test (TypeError
  // non catchée après la fin du test 'apiGet en erreur').
  scrollPageToTop: jest.fn(),
}));

jest.mock('../../js/shop-schema.js', () => ({
  getCategoryIcon: jest.fn(),
  normalizeCategoryKey: jest.fn((k) => k),
}));

const { state, dom, scroll } = require('../../js/b-store.js');
const { showToast, updateCartBadge, saveCart, cartQty, saveFavs } =
  require('../../js/b-cart-core.js');
const { isDesktop, getScrollY, scrollToPosition } = require('../../js/b-scroll-owner.js');
const { bus } = require('../../js/b-bus.js');

const { apiGet } = require('../../js/b-utils.js');

const {
  addToCart, quickAdd, quickRemove, toggleFav, setQty,
  openCart, closeCart, openCartWithHighlight,
  renderCartBody, removeFromCart, markAllCartButtons,
  clearCart, pruneObsoleteCart,
  shareCartWhatsApp, showShareChoiceModal, loadSharedCart,
} = require('../../js/b-cart.js');

/**
 * Reconstruit les refs DOM minimales attendues par b-cart.js.
 * Pas de fixture HTML globale dans ce projet (contrairement à b-modal-cart) :
 * on peuple `dom` directement, comme le fait initDom() en prod.
 */
function resetDom() {
  // jsdom ne fournit pas scrollIntoView : b-cart.js l'appelle (highlight scroll,
  // clic image/nom → réouverture modal). Stub global sur Element.prototype.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = jest.fn();
  }
  dom.cartBody = document.createElement('div');
  dom.cartFooter = document.createElement('div');
  dom.cartHeaderTitle = document.createElement('div');
  dom.cartHeader = document.createElement('div');
  dom.cartOverlay = document.createElement('div');
  dom.cartDrawer = document.createElement('div');
  dom.cartTotalVal = document.createElement('div');
  dom.cartTotalConv = document.createElement('div');
  dom.cartBtn = document.createElement('button');
  dom.addCartBtn = document.createElement('button');
  document.body.innerHTML = '';
  document.body.classList.remove('cart-open', 'cart-empty');
}

function makeProduct(overrides) {
  return Object.assign({
    id: 1,
    name: 'Riz basmati 5kg',
    price_kmf: 5000,
    image_url: '',
  }, overrides);
}

describe('b-cart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDom();
    state.cart = [];
    state.favs = [];
    state.products = [];
    state.editSharedCart = null;
    scroll.savedY = 0;
    isDesktop.mockReturnValue(false);
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
      // Simule un item pré-existant retrouvé par id via product?.id ?? id → id doit matcher
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

      // Pas de feedback "grid" pour le bouton modal
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
      const gridBtn = document.createElement('button');
      gridBtn.className = 'k-card-add';
      gridBtn.dataset.add = '1';
      document.body.appendChild(gridBtn);

      addToCart(makeProduct({ id: 1 }));

      expect(gridBtn.classList.contains('in-cart')).toBe(true);
      expect(gridBtn.innerHTML).toContain('k-add-qty');
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
      const btn = document.createElement('button');
      btn.className = 'k-card-add';
      btn.dataset.add = '5';
      document.body.appendChild(btn);

      markAllCartButtons();

      expect(btn.classList.contains('in-cart')).toBe(true);
      expect(btn.innerHTML).toContain('k-add-qty">4');
    });

    it('remet le bouton "+" simple pour un produit absent du panier', () => {
      state.cart = [];
      const btn = document.createElement('button');
      btn.className = 'k-card-add';
      btn.classList.add('in-cart');
      btn.dataset.add = '5';
      document.body.appendChild(btn);

      markAllCartButtons();

      expect(btn.classList.contains('in-cart')).toBe(false);
      expect(btn.innerHTML).toContain('panier_tresse_vert.png');
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

    it('openCart (desktop) : n\'ouvre pas de drawer, émet checkout:open', () => {
      isDesktop.mockReturnValue(true);
      const busSpy = jest.spyOn(bus, 'emit');
      openCart();
      expect(busSpy).toHaveBeenCalledWith('checkout:open');
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

  describe('renderCartBody (rendu de surface)', () => {
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

  describe('shareCartWhatsApp / showShareChoiceModal (stubs deprecated PR-1)', () => {
    it('showShareChoiceModal est un no-op (flow géré par b-share-cart.js)', () => {
      expect(() => showShareChoiceModal()).not.toThrow();
    });

    it('shareCartWhatsApp est un no-op asynchrone', async () => {
      await expect(shareCartWhatsApp()).resolves.toBeUndefined();
    });
  });

  describe('loadSharedCart', () => {
    let originalLocation;

    beforeEach(() => {
      originalLocation = window.location;
    });

    afterEach(() => {
      window.history.replaceState({}, '', '/');
    });

    function setSearch(search) {
      window.history.replaceState({}, '', '/Komerce_Boutique.html' + search);
    }

    it('sans paramètre ?share ni ?cart → ne fait rien', () => {
      setSearch('');
      expect(() => loadSharedCart()).not.toThrow();
      expect(state.cart).toEqual([]);
    });

    it('?cart=id:qty légacy → peuple le panier une fois les produits chargés', () => {
      jest.useFakeTimers();
      setSearch('?cart=1:2,2:1');
      state.products = [];
      loadSharedCart();

      // Tant que state.products est vide, le setInterval ne fait rien
      jest.advanceTimersByTime(200);
      expect(state.cart).toEqual([]);

      // Les produits arrivent → le prochain tick du setInterval peuple le panier
      state.products = [
        { id: '1', name: 'Riz' },
        { id: '2', name: 'Huile' },
      ];
      jest.advanceTimersByTime(200);
      expect(state.cart).toHaveLength(2);

      jest.advanceTimersByTime(500);
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Panier partagé chargé'), 'success');
      jest.useRealTimers();
    });

    it('?cart= sans produits disponibles avant le timeout → toast d\'échec', () => {
      jest.useFakeTimers();
      setSearch('?cart=1:2');
      state.products = [];
      loadSharedCart();
      jest.advanceTimersByTime(10000);
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('introuvable'), 'error');
      jest.useRealTimers();
    });

    it('?share=token → appelle apiGet puis peuple le panier depuis la réponse', async () => {
      jest.useFakeTimers();
      setSearch('?share=abc123');
      apiGet.mockResolvedValue({
        sharer_name: 'Fatima',
        items: [{ product_id: '9', qty: 3 }],
      });
      state.products = [{ id: '9', name: 'Sucre' }];

      loadSharedCart();
      expect(state.shareToken).toBe('abc123');

      // Laisser la promesse apiGet se résoudre avant d'avancer les timers du setInterval
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(200);
      await Promise.resolve();

      expect(state.cart).toHaveLength(1);
      jest.advanceTimersByTime(500);
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Fatima'), 'success');
      jest.useRealTimers();
    });

    it('?share=token → apiGet en erreur → toast d\'échec, pas de throw', async () => {
      setSearch('?share=bad');
      apiGet.mockRejectedValue(new Error('réseau HS'));
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      loadSharedCart();
      await Promise.resolve();
      await Promise.resolve();
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Impossible de charger'), 'error');
      warnSpy.mockRestore();
    });
  });

  describe('renderCartBody — bandeau édition panier collectif (editSharedCart)', () => {
    beforeEach(() => {
      state.cart = [{ product: { id: 1, name: 'Riz', price_kmf: 1000 }, qty: 1 }];
      // dom.cartFooter (posé par resetDom) est un noeud détaché : le bandeau
      // d'édition y est injecté via appendChild, mais document.getElementById
      // ne peut le retrouver que si cartFooter fait partie du DOM réel.
      document.body.appendChild(dom.cartFooter);
    });

    afterEach(() => {
      // Le bandeau #k-cart-edit-bar n'est créé qu'une fois (guard !drawerEditBar
      // dans b-cart.js) : sans ce nettoyage, le bandeau + boutons d'un test
      // précédent restent dans le document et faussent les getElementById
      // des tests suivants (doublons d'id, listeners périmés).
      dom.cartFooter.remove();
    });

    it('editSharedCart actif → injecte le bandeau et masque checkout/share/clear', () => {
      const checkoutBtn = document.createElement('button');
      checkoutBtn.id = 'k-cart-checkout';
      const shareBtn = document.createElement('button');
      shareBtn.id = 'k-cart-share';
      const clearBtn = document.createElement('button');
      clearBtn.id = 'k-cart-clear';
      document.body.append(checkoutBtn, shareBtn, clearBtn);

      state.editSharedCart = { shared_cart_id: 42 };
      renderCartBody();

      expect(checkoutBtn.style.display).toBe('none');
      expect(shareBtn.style.display).toBe('none');
      expect(clearBtn.style.display).toBe('none');
      expect(document.getElementById('k-cart-edit-bar')).not.toBeNull();
    });

    it('bandeau édition "Annuler" → confirm accepté supprime le contexte et notifie', () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      state.editSharedCart = { shared_cart_id: 42 };
      renderCartBody();
      const cancelBtn = document.getElementById('k-cart-edit-cancel');
      cancelBtn.dispatchEvent(new Event('click', { bubbles: true }));
      expect(state.editSharedCart).toBeNull();
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('annulées'), 'success');
      window.confirm.mockRestore();
    });

    it('bandeau édition "Annuler" → confirm refusé ne modifie rien', () => {
      jest.spyOn(window, 'confirm').mockReturnValue(false);
      state.editSharedCart = { shared_cart_id: 42 };
      renderCartBody();
      const cancelBtn = document.getElementById('k-cart-edit-cancel');
      cancelBtn.dispatchEvent(new Event('click', { bubbles: true }));
      expect(state.editSharedCart).not.toBeNull();
      window.confirm.mockRestore();
    });

    it('editSharedCart devient null après un rendu précédent → retire le bandeau', () => {
      state.editSharedCart = { shared_cart_id: 42 };
      renderCartBody();
      expect(document.getElementById('k-cart-edit-bar')).not.toBeNull();

      state.editSharedCart = null;
      renderCartBody();
      expect(document.getElementById('k-cart-edit-bar')).toBeNull();
    });

    it('bandeau édition "Mettre à jour" → succès vide le panier et bascule vers Groupe', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      jest.mock('../../js/b-nav.js', () => ({ switchView: jest.fn() }), { virtual: true });
      state.editSharedCart = { shared_cart_id: 42 };
      renderCartBody();
      const updateBtn = document.getElementById('k-cart-edit-update');
      updateBtn.dispatchEvent(new Event('click', { bubbles: true }));

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/shared-carts/42/items',
        expect.objectContaining({ method: 'PUT' })
      );
      expect(state.editSharedCart).toBeNull();
      expect(state.cart).toHaveLength(0);
      delete global.fetch;
    });

    it('bandeau édition "Mettre à jour" → panier vide affiche une erreur sans appeler fetch', async () => {
      global.fetch = jest.fn();
      // Le bandeau n'est créé (avec son bouton et ses listeners) que si le
      // panier est non vide au moment du rendu (renderCartBody retourne tôt
      // sinon — cf. state.cart.length === 0 en tête de fonction). Le scénario
      // réel est : panier vidé APRÈS l'ouverture du bandeau, avant le clic —
      // c'est le handler de clic qui revalide l'état courant du panier.
      state.editSharedCart = { shared_cart_id: 42 };
      renderCartBody();
      state.cart = [];
      const updateBtn = document.getElementById('k-cart-edit-update');
      updateBtn.dispatchEvent(new Event('click', { bubbles: true }));
      await Promise.resolve();
      const errEl = document.getElementById('k-cart-edit-err');
      expect(errEl.textContent).toContain('vide');
      expect(global.fetch).not.toHaveBeenCalled();
      delete global.fetch;
    });

    it('bandeau édition "Mettre à jour" → échec réseau affiche le message d\'erreur', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false, status: 500, json: async () => ({ message: 'Erreur serveur' }),
      });
      state.editSharedCart = { shared_cart_id: 42 };
      renderCartBody();
      const updateBtn = document.getElementById('k-cart-edit-update');
      updateBtn.dispatchEvent(new Event('click', { bubbles: true }));

      // Chaîne : fetch() → .then(async r => { await r.json() → throw }) → await
      // dans le handler → catch. Chaque maillon consomme un microtask ; on
      // laisse la file se vider plutôt que de compter les ticks à la main.
      for (let i = 0; i < 8; i++) await Promise.resolve();

      const errEl = document.getElementById('k-cart-edit-err');
      expect(errEl.textContent).toBe('Erreur serveur');
      delete global.fetch;
    });
  });

  describe('renderSideCart (via bus "side-cart:render")', () => {
    function mountSideCart() {
      document.body.innerHTML = `
        <span id="k-bnav-cart-label"></span>
        <div id="k-side-cart">
          <span id="k-sc-total"></span>
          <span id="k-sc-count-inline"></span>
          <div id="k-sc-items"></div>
          <button id="k-sc-cta"></button>
          <button id="k-sc-checkout"></button>
          <button id="k-sc-share"></button>
          <span id="k-sc-shared-badge"></span>
          <button id="k-sc-clear"></button>
          <div class="k-sc-header"></div>
        </div>`;
      return document.getElementById('k-side-cart');
    }

    it('panier vide → aucune classe has-items, label bnav "Panier"', () => {
      mountSideCart();
      state.cart = [];
      bus.emit('side-cart:render');
      const sc = document.getElementById('k-side-cart');
      expect(sc.classList.contains('has-items')).toBe(false);
      expect(document.getElementById('k-bnav-cart-label').textContent).toBe('Panier');
    });

    it('panier rempli → has-items, un élément par article, total renseigné', () => {
      mountSideCart();
      state.cart = [
        { product: { id: 1, name: 'Riz', price_kmf: 1000, image_url: '' }, qty: 2 },
      ];
      bus.emit('side-cart:render');
      const sc = document.getElementById('k-side-cart');
      expect(sc.classList.contains('has-items')).toBe(true);
      expect(sc.querySelectorAll('.k-sc-item')).toHaveLength(1);
      expect(sc.querySelector('#k-sc-total').textContent).not.toBe('');
    });

    it('clic sur "Voir le panier" (#k-sc-cta) ouvre le tiroir complet', () => {
      mountSideCart();
      state.cart = [{ product: { id: 1, name: 'Riz', price_kmf: 1000 }, qty: 1 }];
      bus.emit('side-cart:render');
      document.getElementById('k-sc-cta').dispatchEvent(new Event('click', { bubbles: true }));
      expect(dom.cartOverlay.classList.contains('open')).toBe(true);
    });

    it('stepper minus/plus/remove dans #k-sc-items appelle setQty via délégation', () => {
      mountSideCart();
      state.cart = [{ product: { id: 5, name: 'X', price_kmf: 100 }, qty: 3 }];
      bus.emit('side-cart:render');
      const minus = document.querySelector('.k-sc-step-minus');
      minus.dispatchEvent(new Event('click', { bubbles: true }));
      expect(state.cart[0].qty).toBe(2);
    });

    it('editSharedCart actif → bandeau side-cart injecté, checkout/share masqués', () => {
      mountSideCart();
      state.cart = [{ product: { id: 1, name: 'Riz', price_kmf: 1000 }, qty: 1 }];
      state.editSharedCart = { shared_cart_id: 7 };
      bus.emit('side-cart:render');
      expect(document.getElementById('k-sc-edit-bar')).not.toBeNull();
      expect(document.getElementById('k-sc-checkout').style.display).toBe('none');
    });

    it('clic "Commander" (#k-sc-checkout) émet checkout:open', () => {
      mountSideCart();
      state.cart = [{ product: { id: 1, name: 'Riz', price_kmf: 1000 }, qty: 1 }];
      const busSpy = jest.spyOn(bus, 'emit');
      bus.emit('side-cart:render');
      document.getElementById('k-sc-checkout').dispatchEvent(new Event('click', { bubbles: true }));
      expect(busSpy).toHaveBeenCalledWith('checkout:open');
      busSpy.mockRestore();
    });

    it('clic "Vider" (#k-sc-clear) avec confirmation vide le panier', () => {
      mountSideCart();
      state.cart = [{ product: { id: 1, name: 'Riz', price_kmf: 1000 }, qty: 1 }];
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      bus.emit('side-cart:render');
      document.getElementById('k-sc-clear').dispatchEvent(new Event('click', { bubbles: true }));
      expect(state.cart).toHaveLength(0);
      window.confirm.mockRestore();
    });
  });
});
