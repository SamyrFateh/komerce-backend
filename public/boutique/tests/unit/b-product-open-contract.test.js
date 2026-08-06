'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-product-open-contract.test.js
 *
 * Lot 4 du plan de couverture boutique — js/b-product-open-contract.js (189L).
 * Contrat unique d'ouverture produit depuis les surfaces panier (drawer mobile
 * + side-cart desktop) : résolution produit, fermeture des surfaces panier,
 * délégation image-only, et filet de sécurité bus modal:open.
 *
 * Périmètre couvert :
 *   - openProductFromCart : produit trouvé/introuvable, fermeture des surfaces
 *     panier, ouverture différée via requestAnimationFrame → openModal.
 *   - setupProductOpenContract : idempotence (_installed), listener click
 *     document (image panier drawer / side-cart → ouverture, contrôle
 *     interactif → ignoré), listener bus product:open-from-cart, filet de
 *     sécurité bus modal:open.
 *
 * state/dom viennent du vrai b-store.js. openModal et bus sont mockés
 * (bus reste le vrai module pour pouvoir bus.emit() dans les tests — seul
 * openModal du côté b-modal.js est stubé).
 */

jest.mock('../../js/b-modal.js', () => ({
  openModal: jest.fn(),
}));

const { trackDocumentListeners } = require('./helpers/boutiqueTestKit.js');

// requestAnimationFrame n'existe pas nativement dans jsdom : on le stub en
// exécution synchrone pour ne pas avoir à gérer un tick d'event loop dédié.
global.requestAnimationFrame = (cb) => { cb(); return 0; };

function makeProduct(overrides) {
  return Object.assign({ id: 1, name: 'Riz basmati 5kg' }, overrides);
}

describe('b-product-open-contract', () => {
  let state;
  let openModal;
  let bus;
  let openProductFromCart;
  let setupProductOpenContract;
  let restoreDocListeners;

  beforeEach(() => {
    // resetModules() avant chaque test : b-product-open-contract.js garde un
    // flag `_installed` non exporté (idempotence de setupProductOpenContract),
    // et bus.js garde des `_listeners` au niveau module — repartir d'un
    // registre frais est le seul moyen de tester chaque scénario isolément.
    // On ré-importe TOUT (state, openModal, bus, module cible) via require()
    // simple après reset, pour que toutes les références pointent vers la
    // même instance fraîche des modules partagés (pas de jest.isolateModules,
    // qui sandboxerait b-bus.js séparément de notre `bus` de test).
    //
    // Piège (cf. trackDocumentListeners dans boutiqueTestKit.js) : le
    // `document` réel de jsdom n'est PAS recréé par resetModules(). Chaque
    // setupProductOpenContract() pose un nouveau `document.addEventListener
    // ('click', _onDocumentClick, true)` fermé sur l'instance fraîche du
    // module — mais l'ancien listener d'un test précédent (fermé sur
    // l'ancien state/openModal mocké) reste attaché et se déclenche EN PLUS
    // du nouveau sur le même clic, en capture phase, AVANT le nouveau
    // (ordre d'ajout). Comme _onDocumentClick appelle stopImmediatePropagation()
    // dès qu'un productId est extrait (trouvé ou non), l'ancien listener
    // avale l'évènement et le vrai listener du test en cours ne voit jamais
    // le clic → openModal (mock du test courant) jamais appelé. On isole
    // donc les listeners posés sur `document` à chaque test et on les
    // retire en afterEach.
    restoreDocListeners = trackDocumentListeners();

    jest.resetModules();
    document.body.innerHTML = '';

    ({ state } = require('../../js/b-store.js'));
    ({ openModal } = require('../../js/b-modal.js'));
    ({ bus } = require('../../js/b-bus.js'));
    ({ openProductFromCart, setupProductOpenContract } =
      require('../../js/b-product-open-contract.js'));

    state.products = [];
    state.modalProduct = null;
  });

  afterEach(() => {
    restoreDocListeners();
  });

  describe('openProductFromCart', () => {
    it('produit trouvé : ferme les surfaces panier et ouvre la modal (via rAF)', () => {
      state.products = [makeProduct({ id: 42 })];
      document.body.innerHTML = `
        <div id="k-cart-overlay" class="open"></div>
        <div id="k-cart-drawer" class="open"></div>
        <div id="k-side-cart" class="is-attention"></div>
      `;
      document.body.classList.add('cart-open', 'cart-empty');

      const result = openProductFromCart(42);

      expect(result).toBe(true);
      expect(document.getElementById('k-cart-overlay').classList.contains('open')).toBe(false);
      expect(document.getElementById('k-cart-drawer').classList.contains('open')).toBe(false);
      expect(document.body.classList.contains('cart-open')).toBe(false);
      expect(document.body.classList.contains('cart-empty')).toBe(false);
      expect(document.getElementById('k-side-cart').classList.contains('is-attention')).toBe(false);
      expect(openModal).toHaveBeenCalledWith(42, false);
    });

    it('compare les ids en string (productId string vs id numérique en state)', () => {
      state.products = [makeProduct({ id: 42 })];
      const result = openProductFromCart('42');
      expect(result).toBe(true);
      expect(openModal).toHaveBeenCalledWith(42, false);
    });

    it('produit introuvable : ne ferme rien, ne throw pas, retourne false', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      state.products = [];
      const result = openProductFromCart(999);
      expect(result).toBe(false);
      expect(openModal).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('introuvable'), 999,
      );
      warnSpy.mockRestore();
    });

    it('side-cart absent du DOM : ne throw pas (optional chaining)', () => {
      state.products = [makeProduct({ id: 1 })];
      document.body.innerHTML = '';
      expect(() => openProductFromCart(1)).not.toThrow();
      expect(openModal).toHaveBeenCalledWith(1, false);
    });
  });

  describe('setupProductOpenContract', () => {
    it('est idempotent : un second appel ne réinstalle pas les listeners', () => {
      const addSpy = jest.spyOn(document, 'addEventListener');
      setupProductOpenContract();
      const callsAfterFirst = addSpy.mock.calls.length;
      setupProductOpenContract();
      expect(addSpy.mock.calls.length).toBe(callsAfterFirst);
      addSpy.mockRestore();
    });

    describe('listener click document (ouverture image panier)', () => {
      beforeEach(() => {
        setupProductOpenContract();
        state.products = [makeProduct({ id: 7 })];
      });

      it('clic sur image du panier drawer (.k-cart-item-img) : ouvre la fiche produit', () => {
        document.body.innerHTML = `
          <div class="k-cart-item" data-pid="7">
            <img class="k-cart-item-img" />
          </div>
        `;
        const img = document.querySelector('.k-cart-item-img');
        img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(openModal).toHaveBeenCalledWith(7, false);
      });

      it('utilise data-open-product en priorité sur data-pid si les deux sont présents', () => {
        state.products = [makeProduct({ id: 9 })];
        document.body.innerHTML = `
          <div class="k-cart-item" data-pid="7" data-open-product="9">
            <img class="k-cart-item-img" />
          </div>
        `;
        const img = document.querySelector('.k-cart-item-img');
        img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(openModal).toHaveBeenCalledWith(9, false);
      });

      it('clic sur image du side-cart desktop (#k-side-cart .k-sc-item img) : ouvre la fiche produit', () => {
        document.body.innerHTML = `
          <div id="k-side-cart">
            <div class="k-sc-item" data-product-id="7">
              <img />
            </div>
          </div>
        `;
        const img = document.querySelector('#k-side-cart img');
        img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(openModal).toHaveBeenCalledWith(7, false);
      });

      it('clic sur un contrôle interactif (bouton stepper) même dans une image parente : ignoré', () => {
        document.body.innerHTML = `
          <div class="k-cart-item" data-pid="7">
            <img class="k-cart-item-img" />
            <button class="k-qty-btn">+</button>
          </div>
        `;
        const btn = document.querySelector('.k-qty-btn');
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(openModal).not.toHaveBeenCalled();
      });

      it('clic hors zone image reconnue : ignoré, pas de crash', () => {
        document.body.innerHTML = `<div class="k-cart-item" data-pid="7"><span>Riz</span></div>`;
        const span = document.querySelector('span');
        expect(() => span.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true }),
        )).not.toThrow();
        expect(openModal).not.toHaveBeenCalled();
      });
    });

    describe('listener bus product:open-from-cart', () => {
      beforeEach(() => {
        setupProductOpenContract();
      });

      it('ouvre la fiche produit pour l\'id fourni', () => {
        state.products = [makeProduct({ id: 3 })];
        bus.emit('product:open-from-cart', { id: 3 });
        expect(openModal).toHaveBeenCalledWith(3, false);
      });

      it('id = 0 est un id valide (pas confondu avec absence de payload)', () => {
        state.products = [makeProduct({ id: 0 })];
        bus.emit('product:open-from-cart', { id: 0 });
        expect(openModal).toHaveBeenCalledWith(0, false);
      });

      it('payload sans id : ignoré, pas de crash', () => {
        expect(() => bus.emit('product:open-from-cart', {})).not.toThrow();
        expect(openModal).not.toHaveBeenCalled();
      });
    });

    describe('filet de sécurité bus modal:open', () => {
      beforeEach(() => {
        setupProductOpenContract();
      });

      it('produit trouvé et modalProduct déjà correct : ne rappelle pas openModal', () => {
        state.products = [makeProduct({ id: 5 })];
        state.modalProduct = { id: 5 };
        bus.emit('modal:open', { id: 5 });
        expect(openModal).not.toHaveBeenCalled();
      });

      it('produit trouvé et modalProduct différent/absent : corrige en rappelant openModal', () => {
        state.products = [makeProduct({ id: 5 })];
        state.modalProduct = null;
        bus.emit('modal:open', { id: 5 });
        expect(openModal).toHaveBeenCalledWith(5, false);
      });

      it('produit introuvable : ne rappelle pas openModal', () => {
        state.products = [];
        state.modalProduct = null;
        bus.emit('modal:open', { id: 999 });
        expect(openModal).not.toHaveBeenCalled();
      });

      it('payload sans id : ignoré, pas de crash', () => {
        expect(() => bus.emit('modal:open', {})).not.toThrow();
        expect(() => bus.emit('modal:open', null)).not.toThrow();
        expect(openModal).not.toHaveBeenCalled();
      });
    });
  });
});
