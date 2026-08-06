'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
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
    // Amendement V2 §A — isolation entre tests : group-side-cart.js (réel,
    // non mocké dans cette suite) partage state.sharedListContext/
    // sharedListSelection/cartSurface avec b-cart.js.
    state.sharedListContext = {
      sharedCartId: null, token: null, status: 'open', isCreator: false,
      creatorFirstName: null, title: null, message: null, items: [],
    };
    state.sharedListSelection = new Set();
    state.cartSurface = 'personal';
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
      addToCart(product, 1); // pas d'options → rail null
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

  describe('Amendement V2 §A — avatar/action panier personnel force cartSurface="personal"', () => {
    function activateBackgroundList() {
      activateSharedListContext(
        {
          cart: { id: 'sc-1', token: 'tok-1', status: 'open', creator_first_name: 'Samsam' },
          items: [{ id: 'i1', product_id: 'p1', name: 'Riz', image: null, quantity: 1, unit_price_kmf: 6500, claimed: false }],
          is_creator: false,
        },
        'tok-1',
      );
    }

    it("openCart() bascule cartSurface sur 'personal' même si une liste est active en arrière-plan", () => {
      activateBackgroundList();
      expect(state.cartSurface).toBe('shared-list');

      openCart();

      expect(state.cartSurface).toBe('personal');
      expect(state.sharedListContext.token).toBe('tok-1'); // contexte conservé
    });

    it("openCartWithHighlight() bascule cartSurface sur 'personal'", () => {
      activateBackgroundList();
      state.cart = [{ product: { id: 9, price_kmf: 100 }, qty: 1 }];

      openCartWithHighlight(9);

      expect(state.cartSurface).toBe('personal');
      expect(state.sharedListContext.token).toBe('tok-1');
    });

    it("renderCartBody() rend le panier personnel quand cartSurface='personal', même contexte liste actif (coexistence)", () => {
      activateBackgroundList();
      state.cartSurface = 'personal';
      state.cart = [{ product: { id: 1, name: 'Riz', price_kmf: 1000 }, qty: 1 }];

      renderCartBody();

      expect(dom.cartBody.querySelectorAll('.k-cart-item')).toHaveLength(1);
      expect(dom.cartBody.querySelector('.k-shared-list-header')).toBeNull();
    });

    it("renderCartBody() rend la liste quand cartSurface='shared-list' et laisse state.cart intact", () => {
      const personalCart = [{ product: { id: 1, name: 'Riz', price_kmf: 1000 }, qty: 1 }];
      state.cart = personalCart;
      activateBackgroundList(); // force cartSurface='shared-list'

      renderCartBody();

      expect(dom.cartBody.querySelector('.k-shared-list-header')).not.toBeNull();
      expect(state.cart).toBe(personalCart);
    });

    it("quitter le contexte (clearSharedListContext) puis ouvrir le panier reste cohérent", () => {
      activateBackgroundList();
      clearSharedListContext();
      state.cart = [{ product: { id: 1, name: 'Riz', price_kmf: 1000 }, qty: 1 }];

      openCart();
      renderCartBody();

      expect(state.cartSurface).toBe('personal');
      expect(dom.cartBody.querySelector('.k-shared-list-header')).toBeNull();
      expect(dom.cartBody.querySelectorAll('.k-cart-item')).toHaveLength(1);
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
});
