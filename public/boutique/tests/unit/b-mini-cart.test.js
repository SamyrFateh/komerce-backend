'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-mini-cart.test.js
 *
 * Lot 4 du plan de couverture boutique — js/b-mini-cart.js (420L).
 * Pastille panier flottante mobile (draggable → pill expansible). Desktop :
 * no-op total (side-cart actif).
 *
 * AUD-06 (bug confirmé, fixé dans ce lot) : setupMiniCart() faisait
 * `bus.on('cart:update', _onCartUpdate)` sans jamais importer `bus` depuis
 * b-bus.js → ReferenceError au premier appel. La fonction n'était par
 * ailleurs invoquée nulle part dans le code (grep js/ : aucun appel à
 * setupMiniCart). Fix : ajout de l'import manquant. Ce fichier teste le
 * module comme fonctionnel (comportement confirmé une fois le bug corrigé),
 * pas seulement le crash.
 *
 * Périmètre couvert :
 *   - setupMiniCart : no-op desktop (>=900px), construction DOM + position
 *     initiale (défaut / restaurée depuis localStorage) + rendu initial en
 *     mobile.
 *   - Rendu (_render, via bus 'cart:update') : badge, thumbs (cap MAX_THUMBS
 *     + compteur "+N"), total formaté, count singulier/pluriel.
 *   - Hook bus 'cart:update' : ajout (bump + expand + auto-collapse
 *     programmé) vs vidage à 0 (collapse forcé) ; no-op si desktop.
 *   - Toggle tap (mousedown/mouseup sans mouvement) : ouvre/ferme, sauf
 *     panier vide.
 *   - CTA (.kmc__cta) : stopPropagation + ouverture du tiroir existant
 *     (#k-cart-btn.click()) + collapse.
 *   - Outside click : ferme le panel après le délai d'armement (setTimeout
 *     80ms dans _bindOutsideClick).
 *   - Drag : mouvement sous le seuil → toggle (pas de snap) ; mouvement
 *     au-delà du seuil → déplacement + collapse si expanded + snap sur bord
 *     à la fin (+ persistance localStorage).
 *   - resize : desktop → collapse + display:none ; mobile → réaffiche,
 *     snap, re-render.
 *
 * state.cart / dom viennent des vrais b-store.js / b-cart-core.js (cartQty,
 * cartTotal ne sont pas mockés : ce sont de pures réductions sur state.cart,
 * aucun intérêt à les stubber). bus vient du vrai b-bus.js pour permettre
 * bus.emit('cart:update', ...) comme le fait updateCartBadge() en prod.
 */

const {
  resetState,
  resetLocalStorage,
  trackWindowListeners,
} = require('./helpers/boutiqueTestKit.js');

const ORIGINAL_INNER_WIDTH  = window.innerWidth;
const ORIGINAL_INNER_HEIGHT = window.innerHeight;

function setViewport(width, height = 800) {
  Object.defineProperty(window, 'innerWidth',  { value: width,  writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, writable: true, configurable: true });
}

/**
 * Isole les listeners posés sur `window` par le module sous test (resize,
 * mousemove/mouseup/touchmove/touchend posés par _onDragStart sur
 * `document`). Même piège que trackDocumentListeners (kit) mais pour
 * `window` : setupMiniCart() n'a aucun guard d'idempotence et repose un
 * listener 'resize' à chaque appel, qui resterait sinon attaché au `window`
 * réel de jsdom (jamais recréé par jest.resetModules()) et fuirait vers les
 * tests suivants. Désormais centralisé dans boutiqueTestKit.js.
 */

function cartItem(overrides = {}) {
  return Object.assign({
    id: 1,
    qty: 1,
    product: { id: 1, name: 'Riz basmati 5kg', price_kmf: 5000, image_url: '' },
  }, overrides);
}

describe('b-mini-cart', () => {
  let state;
  let bus;
  let setupMiniCart;
  let restoreWindowListeners;

  beforeEach(() => {
    // jest.resetModules() : setupMiniCart n'a pas de flag `_installed`
    // (contrairement à b-product-open-contract.js) — chaque test repart
    // d'une instance fraîche du module pour ne pas accumuler ses propres
    // listeners internes (_el, _expanded, _autoTimer sont au niveau module).
    restoreWindowListeners = trackWindowListeners();
    jest.resetModules();
    jest.useFakeTimers();
    setViewport(500); // mobile par défaut, chaque test override si besoin

    document.body.innerHTML = '';
    resetLocalStorage();

    ({ state } = require('../../js/b-store.js'));
    ({ bus } = require('../../js/b-bus.js'));
    ({ setupMiniCart } = require('../../js/b-mini-cart.js'));

    resetState(state);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    restoreWindowListeners();
    Object.defineProperty(window, 'innerWidth',  { value: ORIGINAL_INNER_WIDTH,  writable: true, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: ORIGINAL_INNER_HEIGHT, writable: true, configurable: true });
  });

  describe('setupMiniCart', () => {
    it('desktop (>=900px) : no-op total, aucun élément .kmc créé', () => {
      setViewport(1200);
      setupMiniCart();
      expect(document.querySelector('.kmc')).toBeNull();
    });

    it('mobile : construit le DOM .kmc et l\'attache au body', () => {
      setupMiniCart();
      const el = document.querySelector('.kmc');
      expect(el).not.toBeNull();
      expect(el.classList.contains('is-collapsed')).toBe(true);
      expect(el.getAttribute('data-empty')).toBe('true');
    });

    it('position par défaut (aucune position sauvegardée) : bas-droite au-dessus de la bnav', () => {
      setupMiniCart();
      const el = document.querySelector('.kmc');
      expect(el.style.left).not.toBe('');
      expect(el.style.top).not.toBe('');
      expect(el.style.right).toBe('');
      expect(el.style.bottom).toBe('');
    });

    it('restaure la position sauvegardée en localStorage (bornée au viewport)', () => {
      localStorage.setItem('kmrc_minicart_pos', JSON.stringify({ left: 50, top: 200 }));
      setupMiniCart();
      const el = document.querySelector('.kmc');
      expect(el.style.left).toBe('50px');
      expect(el.style.top).toBe('200px');
    });

    it('rendu initial panier vide : badge/total/count neutres', () => {
      setupMiniCart();
      const el = document.querySelector('.kmc');
      expect(el.querySelector('.kmc__badge').textContent).toBe('');
      expect(el.querySelector('.kmc__total').textContent).toBe('0 KMF');
      expect(el.querySelector('.kmc__count').textContent).toBe('0 articles');
    });
  });

  describe('rendu via bus cart:update', () => {
    it('affiche qty/total/thumbs pour un panier non vide', () => {
      setupMiniCart();
      state.cart = [cartItem({ id: 1, qty: 2, product: { id: 1, name: 'Riz', price_kmf: 5000 } })];
      bus.emit('cart:update');

      const el = document.querySelector('.kmc');
      expect(el.getAttribute('data-empty')).toBe('false');
      expect(el.querySelector('.kmc__badge').textContent).toBe('2');
      expect(el.querySelector('.kmc__total').textContent).toBe('10 000 KMF');
      expect(el.querySelector('.kmc__count').textContent).toBe('2 articles');
      expect(el.querySelector('.kmc__cta-badge').textContent).toBe('2');
    });

    it('count au singulier pour qty = 1', () => {
      setupMiniCart();
      state.cart = [cartItem({ qty: 1 })];
      bus.emit('cart:update');
      expect(document.querySelector('.kmc__count').textContent).toBe('1 article');
    });

    it('plafonne les thumbs à MAX_THUMBS (3) et affiche le compteur "+N"', () => {
      setupMiniCart();
      state.cart = [1, 2, 3, 4, 5].map((id) =>
        cartItem({ id, qty: 1, product: { id, name: `P${id}`, price_kmf: 1000 } }));
      bus.emit('cart:update');

      const thumbsEl = document.querySelector('.kmc__thumbs');
      expect(thumbsEl.querySelectorAll('.kmc__thumb').length).toBe(4); // 3 + le "+N"
      expect(thumbsEl.textContent).toContain('+2');
    });

    it('image absente : rend un placeholder plutôt qu\'un <img>', () => {
      setupMiniCart();
      state.cart = [cartItem({ product: { id: 1, name: 'X', price_kmf: 1000, image_url: '' } })];
      bus.emit('cart:update');

      const thumb = document.querySelector('.kmc__thumb');
      expect(thumb.classList.contains('kmc__thumb--placeholder')).toBe(true);
      expect(thumb.querySelector('img')).toBeNull();
    });

    it('no-op en desktop (ne throw pas, DOM inchangé)', () => {
      setViewport(1200);
      setupMiniCart(); // no-op, _el jamais créé
      state.cart = [cartItem()];
      expect(() => bus.emit('cart:update')).not.toThrow();
      expect(document.querySelector('.kmc')).toBeNull();
    });
  });

  describe('hook cart:update — expand/bump/auto-collapse', () => {
    it('ajout au panier (qty augmente) : bump + expand + planifie un auto-collapse', () => {
      setupMiniCart();
      const el = document.querySelector('.kmc');

      state.cart = [cartItem({ qty: 1 })];
      bus.emit('cart:update');

      expect(el.classList.contains('is-bump')).toBe(true);
      expect(el.classList.contains('is-expanded')).toBe(true);
      expect(el.querySelector('.kmc__panel').hasAttribute('aria-hidden')).toBe(false);

      jest.advanceTimersByTime(500);
      expect(el.classList.contains('is-bump')).toBe(false);

      jest.advanceTimersByTime(2500);
      expect(el.classList.contains('is-expanded')).toBe(false);
    });

    it('panier vidé (qty passe à 0) alors que le panel est ouvert : collapse forcé', () => {
      setupMiniCart();
      const el = document.querySelector('.kmc');

      state.cart = [cartItem({ qty: 1 })];
      bus.emit('cart:update'); // ouvre le panel (ajout)

      state.cart = [];
      bus.emit('cart:update'); // qty 0

      expect(el.classList.contains('is-expanded')).toBe(false);
      expect(el.querySelector('.kmc__panel').getAttribute('aria-hidden')).toBe('true');
    });

    it('un deuxième ajout réarme le timer d\'auto-collapse (ne ferme pas prématurément)', () => {
      setupMiniCart();
      const el = document.querySelector('.kmc');

      state.cart = [cartItem({ qty: 1 })];
      bus.emit('cart:update');

      jest.advanceTimersByTime(2000); // avant l'auto-collapse (2500ms)
      state.cart = [cartItem({ qty: 2 })];
      bus.emit('cart:update'); // réarme le timer

      jest.advanceTimersByTime(2000); // total 4000ms depuis le 1er ajout, mais < 2500ms depuis le 2e
      expect(el.classList.contains('is-expanded')).toBe(true);

      jest.advanceTimersByTime(500); // complète les 2500ms depuis le 2e ajout
      expect(el.classList.contains('is-expanded')).toBe(false);
    });
  });

  describe('toggle par tap (mousedown/mouseup sans déplacement)', () => {
    function tap(el) {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 10, clientY: 10 }));
    }

    it('panier non vide : un tap ouvre le panel, un second le referme', () => {
      setupMiniCart();
      const el = document.querySelector('.kmc');
      state.cart = [cartItem({ qty: 1 })];
      bus.emit('cart:update');
      jest.advanceTimersByTime(2500); // laisse l'auto-collapse de l'ajout se terminer
      expect(el.classList.contains('is-expanded')).toBe(false);

      tap(el);
      expect(el.classList.contains('is-expanded')).toBe(true);

      tap(el);
      expect(el.classList.contains('is-expanded')).toBe(false);
    });

    it('panier vide : un tap n\'ouvre pas le panel', () => {
      setupMiniCart();
      const el = document.querySelector('.kmc');
      tap(el);
      expect(el.classList.contains('is-expanded')).toBe(false);
    });
  });

  describe('CTA (.kmc__cta)', () => {
    it('clic sur la CTA : stoppe la propagation, collapse et ouvre le tiroir existant (#k-cart-btn)', () => {
      document.body.insertAdjacentHTML('beforeend', '<button id="k-cart-btn"></button>');
      const cartBtn = document.getElementById('k-cart-btn');
      cartBtn.click = jest.fn();

      setupMiniCart();
      const el = document.querySelector('.kmc');
      state.cart = [cartItem({ qty: 1 })];
      bus.emit('cart:update'); // expand via l'ajout

      el.querySelector('.kmc__cta')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(cartBtn.click).toHaveBeenCalledTimes(1);
      expect(el.classList.contains('is-expanded')).toBe(false);
    });

    it('#k-cart-btn absent du DOM : ne throw pas', () => {
      setupMiniCart();
      const el = document.querySelector('.kmc');
      expect(() => el.querySelector('.kmc__cta')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).not.toThrow();
    });

    it('mousedown sur la CTA ne déclenche pas le drag (garde .closest(\'.kmc__cta\'))', () => {
      setupMiniCart();
      const el = document.querySelector('.kmc');
      state.cart = [cartItem({ qty: 1 })];
      bus.emit('cart:update');
      jest.advanceTimersByTime(2500);

      const cta = el.querySelector('.kmc__cta');
      cta.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 10 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      // Ni drag (snap) ni toggle : le mousedown sur la CTA est ignoré par
      // _onDragStart (return anticipé), donc aucun des deux listeners
      // document (mousemove/mouseup) n'a été attaché.
      expect(el.classList.contains('is-expanded')).toBe(false);
    });
  });

  describe('outside click', () => {
    it('un clic hors de la pastille referme le panel une fois le délai d\'armement écoulé', () => {
      setupMiniCart();
      const el = document.querySelector('.kmc');
      state.cart = [cartItem({ qty: 1 })];
      bus.emit('cart:update'); // expand

      jest.advanceTimersByTime(80); // arme le listener outside-click (_bindOutsideClick)
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(el.classList.contains('is-expanded')).toBe(false);
    });

    it('un clic hors de la pastille AVANT le délai d\'armement n\'a aucun effet', () => {
      setupMiniCart();
      const el = document.querySelector('.kmc');
      state.cart = [cartItem({ qty: 1 })];
      bus.emit('cart:update'); // expand

      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })); // avant les 80ms
      expect(el.classList.contains('is-expanded')).toBe(true);
    });

    it('un clic à l\'intérieur de la pastille ne referme pas le panel', () => {
      setupMiniCart();
      const el = document.querySelector('.kmc');
      state.cart = [cartItem({ qty: 1 })];
      bus.emit('cart:update');
      jest.advanceTimersByTime(80);

      el.querySelector('.kmc__panel')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(el.classList.contains('is-expanded')).toBe(true);
    });
  });

  describe('drag', () => {
    it('mouvement sous le seuil (6px) : traité comme un tap, pas de snap', () => {
      setupMiniCart();
      const el = document.querySelector('.kmc');

      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 102, clientY: 100 })); // 2px < seuil
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      // Panier vide → le tap ne devrait rien ouvrir, mais surtout aucune
      // sauvegarde de position (snap) n'a dû être déclenchée.
      expect(localStorage.getItem('kmrc_minicart_pos')).toBeNull();
    });

    it('mouvement au-delà du seuil : déplace la pastille, ferme le panel si ouvert, puis snap au relâchement', () => {
      setupMiniCart();
      const el = document.querySelector('.kmc');
      state.cart = [cartItem({ qty: 1 })];
      bus.emit('cart:update'); // expand
      jest.advanceTimersByTime(0);

      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 160, clientY: 100 })); // 60px > seuil

      expect(el.classList.contains('is-expanded')).toBe(false); // collapse déclenché par le drag

      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      jest.advanceTimersByTime(260); // fin de la transition de _snapToEdge

      expect(localStorage.getItem('kmrc_minicart_pos')).not.toBeNull();
      const saved = JSON.parse(localStorage.getItem('kmrc_minicart_pos'));
      expect(typeof saved.left).toBe('number');
      expect(typeof saved.top).toBe('number');
    });
  });

  describe('resize', () => {
    it('passage en desktop : collapse + masque la pastille', () => {
      setupMiniCart();
      const el = document.querySelector('.kmc');
      state.cart = [cartItem({ qty: 1 })];
      bus.emit('cart:update'); // expand

      setViewport(1200);
      window.dispatchEvent(new Event('resize'));

      expect(el.classList.contains('is-expanded')).toBe(false);
      expect(el.style.display).toBe('none');
    });

    it('retour en mobile : réaffiche, snap et re-render', () => {
      setupMiniCart();
      const el = document.querySelector('.kmc');

      setViewport(1200);
      window.dispatchEvent(new Event('resize'));
      expect(el.style.display).toBe('none');

      setViewport(500);
      state.cart = [cartItem({ qty: 3, product: { id: 1, name: 'X', price_kmf: 1000 } })];
      window.dispatchEvent(new Event('resize'));

      expect(el.style.display).toBe('');
      expect(el.querySelector('.kmc__badge').textContent).toBe('3');
    });
  });
});
