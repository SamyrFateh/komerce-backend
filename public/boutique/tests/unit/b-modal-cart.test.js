'use strict';

/**
 * tests/unit/b-modal-cart.test.js
 *
 * Module #24 — js/b-modal-cart.js (89L)
 * Exports réels : `_syncModalQtyUI` ET `setupModalCart` (les deux, contrairement
 * à ce que listait le prompt initial qui ne mentionnait que `_syncModalQtyUI`).
 *
 * b-cart.js (addToCart/quickAdd/quickRemove) est mocké : module lourd, effets
 * DOM/réseau/state hors périmètre de ce module. state/dom viennent du vrai
 * b-store.js (objets mutables partagés, pattern déjà utilisé pour b-paypal.test.js).
 */

jest.mock('../../js/b-cart.js', () => ({
  addToCart: jest.fn(),
  quickAdd: jest.fn(),
  quickRemove: jest.fn(),
}));

const { state, dom } = require('../../js/b-store.js');
const { addToCart, quickAdd, quickRemove } = require('../../js/b-cart.js');
const { _syncModalQtyUI, setupModalCart } = require('../../js/b-modal-cart.js');

function resetDom() {
  dom.modalQtyVal = document.createElement('span');
  dom.addCartBtn = document.createElement('button');
  dom.qtyMinus = document.createElement('button');
  dom.qtyPlus = document.createElement('button');
}

describe('b-modal-cart', () => {
  beforeEach(() => {
    resetDom();
    state.modalProduct = null;
    state.modalQty = 0;
    state.cart = [];
  });

  describe('_syncModalQtyUI', () => {
    it('aucun produit ouvert (modalProduct null) → ne fait rien, ne throw pas', () => {
      expect(() => _syncModalQtyUI()).not.toThrow();
      expect(dom.modalQtyVal.textContent).toBe('');
    });

    it('produit ouvert, absent du panier → qty par défaut = 1, bouton "Ajouter"', () => {
      state.modalProduct = { id: 42 };
      state.cart = [];
      _syncModalQtyUI();
      expect(state.modalQty).toBe(1);
      expect(dom.modalQtyVal.textContent).toBe('1');
      expect(dom.addCartBtn.classList.contains('in-cart')).toBe(false);
      expect(dom.addCartBtn.innerHTML).toContain('Ajouter');
      expect(dom.addCartBtn.innerHTML).toContain('panier_tresse_vert.png');
    });

    it('produit ouvert, présent dans le panier avec qty 3 → reflète qty réelle, bouton "Dans le panier"', () => {
      state.modalProduct = { id: 42 };
      state.cart = [{ product: { id: 42 }, qty: 3 }];
      _syncModalQtyUI();
      expect(state.modalQty).toBe(3);
      expect(dom.modalQtyVal.textContent).toBe('3');
      expect(dom.addCartBtn.classList.contains('in-cart')).toBe(true);
      expect(dom.addCartBtn.innerHTML).toContain('Dans le panier (3)');
    });

    it('matching par id sous forme item.id (sans wrapper .product) fonctionne aussi', () => {
      state.modalProduct = { id: 7 };
      state.cart = [{ id: 7, qty: 2 }];
      _syncModalQtyUI();
      expect(state.modalQty).toBe(2);
      expect(dom.addCartBtn.classList.contains('in-cart')).toBe(true);
    });

    it('comparaison id en string (id numérique vs id string) → match malgré tout', () => {
      state.modalProduct = { id: 99 };
      state.cart = [{ product: { id: '99' }, qty: 5 }];
      _syncModalQtyUI();
      expect(state.modalQty).toBe(5);
    });

    it('dom.modalQtyVal absent → ne throw pas (garde défensive)', () => {
      state.modalProduct = { id: 1 };
      dom.modalQtyVal = null;
      expect(() => _syncModalQtyUI()).not.toThrow();
    });

    it('dom.addCartBtn absent → ne throw pas (garde défensive)', () => {
      state.modalProduct = { id: 1 };
      dom.addCartBtn = null;
      expect(() => _syncModalQtyUI()).not.toThrow();
    });
  });

  describe('setupModalCart', () => {
    it('câble les listeners sans throw', () => {
      expect(() => setupModalCart()).not.toThrow();
    });

    it('clic sur qtyPlus avec un produit ouvert → appelle quickAdd puis resynchronise l\'UI', () => {
      setupModalCart();
      state.modalProduct = { id: 11 };
      state.cart = [];
      dom.qtyPlus.dispatchEvent(new window.Event('click'));
      expect(quickAdd).toHaveBeenCalledWith('11', dom.qtyPlus);
      // _syncModalQtyUI a tourné → modalQtyVal mis à jour (1 par défaut, produit pas dans state.cart car quickAdd est mocké)
      expect(dom.modalQtyVal.textContent).toBe('1');
    });

    it('clic sur qtyMinus avec un produit ouvert → appelle quickRemove puis resynchronise l\'UI', () => {
      setupModalCart();
      state.modalProduct = { id: 22 };
      dom.qtyMinus.dispatchEvent(new window.Event('click'));
      expect(quickRemove).toHaveBeenCalledWith('22', dom.qtyMinus);
    });

    it('clic sur qtyPlus sans produit ouvert (modalProduct null) → ne fait rien', () => {
      setupModalCart();
      state.modalProduct = null;
      dom.qtyPlus.dispatchEvent(new window.Event('click'));
      expect(quickAdd).not.toHaveBeenCalled();
    });

    it('clic sur qtyMinus sans produit ouvert → ne fait rien', () => {
      setupModalCart();
      state.modalProduct = null;
      dom.qtyMinus.dispatchEvent(new window.Event('click'));
      expect(quickRemove).not.toHaveBeenCalled();
    });

    it('clic sur addCartBtn avec produit ouvert et bouton actif → appelle addToCart(product, 1, btn)', () => {
      setupModalCart();
      const product = { id: 33 };
      state.modalProduct = product;
      dom.addCartBtn.dispatchEvent(new window.Event('click'));
      expect(addToCart).toHaveBeenCalledWith(product, 1, dom.addCartBtn);
    });

    it('clic sur addCartBtn sans produit ouvert → addToCart non appelé', () => {
      setupModalCart();
      state.modalProduct = null;
      dom.addCartBtn.dispatchEvent(new window.Event('click'));
      expect(addToCart).not.toHaveBeenCalled();
    });

    it('clic sur addCartBtn désactivé (disabled) → addToCart non appelé', () => {
      setupModalCart();
      state.modalProduct = { id: 1 };
      dom.addCartBtn.disabled = true;
      dom.addCartBtn.dispatchEvent(new window.Event('click'));
      expect(addToCart).not.toHaveBeenCalled();
    });

    it('clic sur addCartBtn déjà "confirmed" (classe CSS) → addToCart non appelé', () => {
      setupModalCart();
      state.modalProduct = { id: 1 };
      dom.addCartBtn.classList.add('confirmed');
      dom.addCartBtn.dispatchEvent(new window.Event('click'));
      expect(addToCart).not.toHaveBeenCalled();
    });
  });
});
