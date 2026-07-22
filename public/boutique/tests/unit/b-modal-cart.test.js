'use strict';

jest.mock('../../js/b-cart.js', () => ({
  addToCart: jest.fn(),
  quickAdd: jest.fn(),
  quickRemove: jest.fn(),
}));

const { state, dom } = require('../../js/b-store.js');
const { addToCart, quickAdd, quickRemove } = require('../../js/b-cart.js');
const {
  _syncModalQtyUI,
  setupModalCart,
  _modalCartTestApi,
} = require('../../js/b-modal-cart.js');

function resetDom() {
  document.body.innerHTML = '';
  const actions = document.createElement('div');
  actions.className = 'k-modal-actions';

  dom.modalQtyVal = document.createElement('span');
  dom.addCartBtn = document.createElement('button');
  dom.qtyMinus = document.createElement('button');
  dom.qtyPlus = document.createElement('button');

  actions.append(dom.qtyMinus, dom.modalQtyVal, dom.qtyPlus, dom.addCartBtn);
  document.body.appendChild(actions);
  return actions;
}

describe('b-modal-cart', () => {
  let actions;

  beforeEach(() => {
    jest.clearAllMocks();
    actions = resetDom();
    state.modalProduct = null;
    state.modalProductDetail = null;
    state.modalSelection = null;
    state.modalVariantCombo = {};
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
      expect(actions.dataset.inventoryModel).toBe('LEGACY');
      expect(actions.classList.contains('k-modal-actions--filled')).toBe(false);
    });

    it('produit legacy présent → reflète qty et active le stepper filled', () => {
      state.modalProduct = { id: 42 };
      state.cart = [{ product: { id: 42 }, qty: 3 }];
      _syncModalQtyUI();

      expect(state.modalQty).toBe(3);
      expect(dom.addCartBtn.innerHTML).toContain('Dans le panier (3)');
      expect(actions.classList.contains('k-modal-actions--filled')).toBe(true);
      expect(dom.qtyMinus.disabled).toBe(false);
      expect(dom.qtyPlus.disabled).toBe(false);
    });

    it('SKU : cible uniquement la variante sélectionnée et interdit le stepper', () => {
      state.modalProduct = { id: 42 };
      state.modalProductDetail = { inventory_model: 'SKU' };
      state.modalSelection = {
        selected_sku_id: 'sku-red',
        selected_options: { color: 'Rouge', size: 'L' },
      };
      state.cart = [
        { product: { id: 42, sku_id: 'sku-blue' }, variant_combo: { color: 'Bleu', size: 'L' }, qty: 5 },
        { product: { id: 42, sku_id: 'sku-red' }, variant_combo: { color: 'Rouge', size: 'L' }, qty: 2 },
      ];

      _syncModalQtyUI();

      expect(state.modalQty).toBe(2);
      expect(dom.addCartBtn.innerHTML).toContain('Dans le panier (2)');
      expect(actions.dataset.inventoryModel).toBe('SKU');
      expect(actions.classList.contains('k-modal-actions--filled')).toBe(false);
      expect(dom.qtyMinus.disabled).toBe(true);
      expect(dom.qtyPlus.disabled).toBe(true);
    });

    it('SKU : une autre variante au panier ne masque pas Ajouter pour la sélection courante', () => {
      state.modalProduct = { id: 42 };
      state.modalProductDetail = { inventory_model: 'SKU' };
      state.modalSelection = {
        selected_sku_id: 'sku-red',
        selected_options: { color: 'Rouge', size: 'L' },
      };
      state.cart = [
        { product: { id: 42, sku_id: 'sku-blue' }, variant_combo: { color: 'Bleu', size: 'L' }, qty: 5 },
      ];

      _syncModalQtyUI();

      expect(state.modalQty).toBe(1);
      expect(dom.addCartBtn.classList.contains('in-cart')).toBe(false);
      expect(dom.addCartBtn.innerHTML).toContain('Ajouter');
    });

    it('SKU ancien sans sku_id : fallback sur variant_combo canonique', () => {
      state.modalProduct = { id: 42 };
      state.modalProductDetail = { inventory_model: 'SKU' };
      state.modalSelection = {
        selected_sku_id: 'sku-red',
        selected_options: { size: 'L', color: 'Rouge' },
      };
      state.cart = [
        { product: { id: 42 }, variant_combo: { color: 'Rouge', size: 'L' }, qty: 4 },
      ];

      expect(_modalCartTestApi.currentModalCartItem().qty).toBe(4);
    });

    it('matching item.id sans wrapper product fonctionne', () => {
      state.modalProduct = { id: 7 };
      state.cart = [{ id: 7, qty: 2 }];
      _syncModalQtyUI();
      expect(state.modalQty).toBe(2);
    });

    it('garde défensive sur DOM absent', () => {
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

    it('qtyPlus legacy appelle quickAdd puis resynchronise', () => {
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

    it('stepper sans produit ne mute rien', () => {
      setupModalCart();
      dom.qtyPlus.dispatchEvent(new window.Event('click'));
      dom.qtyMinus.dispatchEvent(new window.Event('click'));
      expect(quickAdd).not.toHaveBeenCalled();
      expect(quickRemove).not.toHaveBeenCalled();
    });

    it('Ajouter legacy transmet le produit d origine', () => {
      setupModalCart();
      const product = { id: 33 };
      state.modalProduct = product;
      dom.addCartBtn.dispatchEvent(new window.Event('click'));
      expect(addToCart).toHaveBeenCalledWith(product, 1, dom.addCartBtn);
    });

    it('Ajouter SKU transmet un snapshot au prix et média de l unité sélectionnée', () => {
      setupModalCart();
      state.modalProduct = { id: 33, name: 'Thermos', price_kmf: 5000, image_url: '/base.jpg' };
      state.modalProductDetail = {
        inventory_model: 'SKU',
        pricing: { price_kmf: 5500 },
        sellable_units: [{ sku_id: 'sku-red', sku: 'THERMOS-RED', price_kmf: 7200 }],
      };
      state.modalSelection = {
        selected_sku_id: 'sku-red',
        selected_options: { color: 'Rouge' },
        selected_media: [{ url: '/red.jpg' }],
      };

      dom.addCartBtn.dispatchEvent(new window.Event('click'));

      expect(addToCart).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 33,
          price_kmf: 7200,
          sku_id: 'sku-red',
          sku: 'THERMOS-RED',
          image_url: '/red.jpg',
        }),
        1,
        dom.addCartBtn
      );
    });

    it('Ajouter sans produit, désactivé ou confirmed ne fait rien', () => {
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
