'use strict';

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

  const actions = document.createElement('div');
  actions.className = 'k-modal-actions';
  actions.append(dom.qtyMinus, dom.modalQtyVal, dom.qtyPlus, dom.addCartBtn);
  document.body.innerHTML = '';
  document.body.appendChild(actions);
}

describe('b-modal-cart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDom();
    state.modalProduct = null;
    state.modalProductDetail = null;
    state.modalSelection = null;
    state.modalQty = 0;
    state.cart = [];
  });

  describe('_syncModalQtyUI', () => {
    it('aucun produit ouvert → ne fait rien', () => {
      expect(() => _syncModalQtyUI()).not.toThrow();
      expect(dom.modalQtyVal.textContent).toBe('');
    });

    it('produit legacy absent du panier → qty 1 et bouton Ajouter', () => {
      state.modalProduct = { id: 42 };
      _syncModalQtyUI();
      expect(state.modalQty).toBe(1);
      expect(dom.modalQtyVal.textContent).toBe('1');
      expect(dom.addCartBtn.classList.contains('in-cart')).toBe(false);
      expect(dom.addCartBtn.innerHTML).toContain('Ajouter');
    });

    it('produit legacy au panier → reflète la quantité et affiche le stepper', () => {
      state.modalProduct = { id: 42 };
      state.cart = [{ product: { id: 42 }, qty: 3 }];
      _syncModalQtyUI();
      expect(state.modalQty).toBe(3);
      expect(dom.addCartBtn.innerHTML).toContain('Dans le panier (3)');
      expect(dom.addCartBtn.closest('.k-modal-actions').classList.contains('k-modal-actions--filled')).toBe(true);
    });

    it('produit SKU déjà au panier → n’agrège pas par product.id et garde Ajouter visible', () => {
      state.modalProduct = { id: 42 };
      state.modalProductDetail = { inventory_model: 'SKU' };
      state.modalSelection = { selected_sku_id: 'sku-red' };
      state.cart = [{
        product: { id: 42 },
        sku_id: 'sku-blue',
        qty: 4,
        variant_combo: { color: 'Blue' },
      }];
      const actions = dom.addCartBtn.closest('.k-modal-actions');
      actions.classList.add('k-modal-actions--filled');
      dom.addCartBtn.classList.add('in-cart');

      _syncModalQtyUI();

      expect(state.modalQty).toBe(1);
      expect(dom.modalQtyVal.textContent).toBe('1');
      expect(actions.classList.contains('k-modal-actions--filled')).toBe(false);
      expect(dom.addCartBtn.classList.contains('in-cart')).toBe(false);
      expect(dom.addCartBtn.innerHTML).toContain('Ajouter');
    });

    it('matching legacy via item.id fonctionne', () => {
      state.modalProduct = { id: 7 };
      state.cart = [{ id: 7, qty: 2 }];
      _syncModalQtyUI();
      expect(state.modalQty).toBe(2);
      expect(dom.addCartBtn.classList.contains('in-cart')).toBe(true);
    });

    it('dom optionnel absent → ne throw pas', () => {
      state.modalProduct = { id: 1 };
      dom.modalQtyVal = null;
      dom.addCartBtn = null;
      expect(() => _syncModalQtyUI()).not.toThrow();
    });
  });

  describe('setupModalCart', () => {
    it('câble les listeners sans throw', () => {
      expect(() => setupModalCart()).not.toThrow();
    });

    it('qtyPlus appelle quickAdd puis resynchronise', () => {
      setupModalCart();
      state.modalProduct = { id: 11 };
      dom.qtyPlus.dispatchEvent(new window.Event('click'));
      expect(quickAdd).toHaveBeenCalledWith('11', dom.qtyPlus);
      expect(dom.modalQtyVal.textContent).toBe('1');
    });

    it('qtyMinus appelle quickRemove', () => {
      setupModalCart();
      state.modalProduct = { id: 22 };
      dom.qtyMinus.dispatchEvent(new window.Event('click'));
      expect(quickRemove).toHaveBeenCalledWith('22', dom.qtyMinus);
    });

    it('steppers sans produit ne mutent rien', () => {
      setupModalCart();
      dom.qtyPlus.dispatchEvent(new window.Event('click'));
      dom.qtyMinus.dispatchEvent(new window.Event('click'));
      expect(quickAdd).not.toHaveBeenCalled();
      expect(quickRemove).not.toHaveBeenCalled();
    });

    it('Ajouter appelle addToCart avec quantité unitaire', () => {
      setupModalCart();
      const product = { id: 33 };
      state.modalProduct = product;
      dom.addCartBtn.dispatchEvent(new window.Event('click'));
      expect(addToCart).toHaveBeenCalledWith(product, 1, dom.addCartBtn);
    });

    it('Ajouter ne fait rien sans produit, désactivé ou confirmé', () => {
      setupModalCart();
      dom.addCartBtn.dispatchEvent(new window.Event('click'));
      expect(addToCart).not.toHaveBeenCalled();

      state.modalProduct = { id: 1 };
      dom.addCartBtn.disabled = true;
      dom.addCartBtn.dispatchEvent(new window.Event('click'));
      expect(addToCart).not.toHaveBeenCalled();

      dom.addCartBtn.disabled = false;
      dom.addCartBtn.classList.add('confirmed');
      dom.addCartBtn.dispatchEvent(new window.Event('click'));
      expect(addToCart).not.toHaveBeenCalled();
    });
  });
});
