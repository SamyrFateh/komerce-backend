'use strict';

jest.mock('../../js/b-cart.js', () => ({
  addToCart: jest.fn(),
  quickAdd: jest.fn(),
  quickRemove: jest.fn(),
}));

jest.mock('../../js/b-cart-selection.js', () => ({
  findCartItemForSelection: jest.fn(),
  setCartSelectionQty: jest.fn(),
}));

const { state, dom } = require('../../js/b-store.js');
const { addToCart, quickAdd, quickRemove } = require('../../js/b-cart.js');
const {
  findCartItemForSelection,
  setCartSelectionQty,
} = require('../../js/b-cart-selection.js');
const {
  _syncModalQtyUI,
  setModalTransactionPending,
  setupModalCart,
} = require('../../js/b-modal-cart.js');

function resetDom() {
  document.body.innerHTML = '<button id="k-buy-now-btn">Acheter</button>';
  dom.modalQtyVal = document.createElement('span');
  dom.addCartBtn = document.createElement('button');
  dom.qtyMinus = document.createElement('button');
  dom.qtyPlus = document.createElement('button');
}

function setSkuSelection(overrides = {}) {
  state.modalProductDetail = { inventory_model: 'SKU' };
  state.modalSelection = {
    selection_supported: true,
    selected_options: { Couleur: 'Marron', Taille: 'M' },
    selected_sku_id: 'sku-marron-m',
    ...overrides,
  };
}

describe('b-modal-cart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDom();
    state.modalProduct = null;
    state.modalProductDetail = null;
    state.modalSelection = null;
    state.modalQty = 0;
    state.modalVariantCombo = {};
    state.cart = [];
    findCartItemForSelection.mockReturnValue(null);
  });

  describe('_syncModalQtyUI legacy', () => {
    it('aucun produit ouvert → ne fait rien', () => {
      expect(() => _syncModalQtyUI()).not.toThrow();
      expect(dom.modalQtyVal.textContent).toBe('');
    });

    it('produit absent du panier → qty 1 et bouton Ajouter', () => {
      state.modalProduct = { id: 42 };
      _syncModalQtyUI();
      expect(state.modalQty).toBe(1);
      expect(dom.modalQtyVal.textContent).toBe('1');
      expect(dom.addCartBtn.classList.contains('in-cart')).toBe(false);
      expect(dom.addCartBtn.innerHTML).toContain('Ajouter au panier');
    });

    it('produit présent qty 3 → reflète la quantité réelle', () => {
      state.modalProduct = { id: 42 };
      state.cart = [{ product: { id: 42 }, qty: 3 }];
      _syncModalQtyUI();
      expect(state.modalQty).toBe(3);
      expect(dom.addCartBtn.innerHTML).toContain('Dans le panier (3)');
    });

    it('matching item.id et comparaison string restent compatibles', () => {
      state.modalProduct = { id: 7 };
      state.cart = [{ id: '7', qty: 2 }];
      _syncModalQtyUI();
      expect(state.modalQty).toBe(2);
    });

    it('refs DOM optionnelles absentes → ne throw pas', () => {
      state.modalProduct = { id: 1 };
      dom.modalQtyVal = null;
      dom.addCartBtn = null;
      expect(() => _syncModalQtyUI()).not.toThrow();
    });
  });

  describe('PDC-4 SKU selection', () => {
    beforeEach(() => {
      state.modalProduct = { id: 42 };
    });

    it('setModalTransactionPending sans produit ne touche pas les contrôles', () => {
      state.modalProduct = null;
      setModalTransactionPending(true);

      expect(dom.qtyMinus.disabled).toBe(false);
      expect(dom.qtyPlus.disabled).toBe(false);
      expect(dom.addCartBtn.disabled).toBe(false);
    });

    it('pending=false repasse par la synchronisation normale', () => {
      state.cart = [{ product: { id: 42 }, qty: 4 }];
      setModalTransactionPending(false);

      expect(state.modalQty).toBe(4);
      expect(dom.modalQtyVal.textContent).toBe('4');
      expect(dom.addCartBtn.textContent).toContain('Dans le panier (4)');
    });

    it('verrouille stepper + Ajouter + Acheter pendant le chargement détail', () => {
      setModalTransactionPending(true);

      expect(dom.qtyMinus.disabled).toBe(true);
      expect(dom.qtyPlus.disabled).toBe(true);
      expect(dom.addCartBtn.disabled).toBe(true);
      expect(document.getElementById('k-buy-now-btn').disabled).toBe(true);
      expect(dom.addCartBtn.textContent).toContain('Chargement du produit');
    });

    it('le verrou tolère le bouton Ajouter absent', () => {
      dom.addCartBtn = null;
      expect(() => setModalTransactionPending(true)).not.toThrow();
      expect(dom.qtyMinus.disabled).toBe(true);
      expect(dom.qtyPlus.disabled).toBe(true);
    });

    it('détail SKU chargé sans reducer reste verrouillé en mode chargement', () => {
      state.modalProductDetail = { inventory_model: 'SKU' };
      state.modalSelection = null;
      _syncModalQtyUI();

      expect(dom.addCartBtn.disabled).toBe(true);
      expect(dom.addCartBtn.textContent).toBe('Chargement du produit…');
    });

    it('sélection SKU incomplète reste verrouillée et demande les options', () => {
      setSkuSelection({ selected_sku_id: null, selected_options: { Couleur: 'Marron' } });
      _syncModalQtyUI();

      expect(dom.addCartBtn.disabled).toBe(true);
      expect(document.getElementById('k-buy-now-btn').disabled).toBe(true);
      expect(dom.addCartBtn.textContent).toBe('Choisissez vos options');
      expect(state.modalQty).toBe(1);
    });

    it('sélection complète absente du panier active Ajouter/Acheter mais garde moins désactivé', () => {
      setSkuSelection();
      _syncModalQtyUI();

      expect(findCartItemForSelection).toHaveBeenCalledWith(42, {
        Couleur: 'Marron', Taille: 'M',
      });
      expect(dom.qtyMinus.disabled).toBe(true);
      expect(dom.qtyPlus.disabled).toBe(false);
      expect(dom.addCartBtn.disabled).toBe(false);
      expect(document.getElementById('k-buy-now-btn').disabled).toBe(false);
      expect(dom.addCartBtn.innerHTML).toContain('Ajouter au panier');
    });

    it('sélection complète tolère les refs d’affichage optionnelles absentes', () => {
      setSkuSelection();
      dom.modalQtyVal = null;
      dom.addCartBtn = null;

      expect(() => _syncModalQtyUI()).not.toThrow();
      expect(findCartItemForSelection).toHaveBeenCalledWith(42, {
        Couleur: 'Marron', Taille: 'M',
      });
    });

    it('reflète la quantité de la combinaison exacte, pas une autre ligne du produit', () => {
      setSkuSelection();
      findCartItemForSelection.mockReturnValue({ qty: 5 });
      _syncModalQtyUI();

      expect(state.modalQty).toBe(5);
      expect(dom.modalQtyVal.textContent).toBe('5');
      expect(dom.addCartBtn.innerHTML).toContain('Dans le panier (5)');
      expect(dom.qtyMinus.disabled).toBe(false);
    });

    it('qtyPlus sur sélection complète absente crée la ligne via addToCart', () => {
      setupModalCart();
      setSkuSelection();
      dom.qtyPlus.dispatchEvent(new window.Event('click'));

      expect(addToCart).toHaveBeenCalledWith(state.modalProduct, 1, dom.qtyPlus);
      expect(quickAdd).not.toHaveBeenCalled();
    });

    it('qtyMinus sans ligne exacte ne crée rien et ne retombe pas sur legacy', () => {
      setupModalCart();
      setSkuSelection();
      dom.qtyMinus.dispatchEvent(new window.Event('click'));

      expect(addToCart).not.toHaveBeenCalled();
      expect(setCartSelectionQty).not.toHaveBeenCalled();
      expect(quickRemove).not.toHaveBeenCalled();
    });

    it('qtyPlus sur ligne exacte incrémente seulement cette sélection', () => {
      setupModalCart();
      setSkuSelection();
      findCartItemForSelection.mockReturnValue({ qty: 3 });
      dom.qtyPlus.dispatchEvent(new window.Event('click'));

      expect(setCartSelectionQty).toHaveBeenCalledWith(
        42,
        { Couleur: 'Marron', Taille: 'M' },
        4
      );
      expect(quickAdd).not.toHaveBeenCalled();
    });

    it('qtyMinus décrémente la ligne exacte', () => {
      setupModalCart();
      setSkuSelection();
      findCartItemForSelection.mockReturnValue({ qty: 2 });
      dom.qtyMinus.dispatchEvent(new window.Event('click'));

      expect(setCartSelectionQty).toHaveBeenCalledWith(
        42,
        { Couleur: 'Marron', Taille: 'M' },
        1
      );
      expect(quickRemove).not.toHaveBeenCalled();
    });

    it('événement programmatique sur plus pendant sélection incomplète ne retombe pas sur quickAdd legacy', () => {
      setupModalCart();
      setSkuSelection({ selected_sku_id: null, selected_options: { Couleur: 'Marron' } });
      dom.qtyPlus.dispatchEvent(new window.Event('click'));

      expect(addToCart).not.toHaveBeenCalled();
      expect(quickAdd).not.toHaveBeenCalled();
      expect(setCartSelectionQty).not.toHaveBeenCalled();
    });

    it('Ajouter transmet le produit au moteur panier seulement quand le SKU est complet', () => {
      setupModalCart();
      setSkuSelection();
      dom.addCartBtn.dispatchEvent(new window.Event('click'));
      expect(addToCart).toHaveBeenCalledWith(state.modalProduct, 1, dom.addCartBtn);
    });

    it('Ajouter ne passe pas avec sélection SKU incomplète même par dispatch programmatique', () => {
      setupModalCart();
      setSkuSelection({ selected_sku_id: null });
      dom.addCartBtn.disabled = false;
      dom.addCartBtn.dispatchEvent(new window.Event('click'));
      expect(addToCart).not.toHaveBeenCalled();
    });
  });

  describe('setupModalCart legacy', () => {
    it('qtyPlus appelle quickAdd', () => {
      setupModalCart();
      state.modalProduct = { id: 11 };
      dom.qtyPlus.dispatchEvent(new window.Event('click'));
      expect(quickAdd).toHaveBeenCalledWith('11', dom.qtyPlus);
    });

    it('qtyMinus appelle quickRemove', () => {
      setupModalCart();
      state.modalProduct = { id: 22 };
      dom.qtyMinus.dispatchEvent(new window.Event('click'));
      expect(quickRemove).toHaveBeenCalledWith('22', dom.qtyMinus);
    });

    it('sans produit ouvert les steppers ne font rien', () => {
      setupModalCart();
      dom.qtyPlus.dispatchEvent(new window.Event('click'));
      dom.qtyMinus.dispatchEvent(new window.Event('click'));
      expect(quickAdd).not.toHaveBeenCalled();
      expect(quickRemove).not.toHaveBeenCalled();
    });

    it('Ajouter actif appelle addToCart', () => {
      setupModalCart();
      const product = { id: 33 };
      state.modalProduct = product;
      dom.addCartBtn.dispatchEvent(new window.Event('click'));
      expect(addToCart).toHaveBeenCalledWith(product, 1, dom.addCartBtn);
    });

    it('Ajouter sans produit, désactivé ou confirmé ne mutile pas le panier', () => {
      setupModalCart();
      dom.addCartBtn.dispatchEvent(new window.Event('click'));
      state.modalProduct = { id: 1 };
      dom.addCartBtn.disabled = true;
      dom.addCartBtn.dispatchEvent(new window.Event('click'));
      dom.addCartBtn.disabled = false;
      dom.addCartBtn.classList.add('confirmed');
      dom.addCartBtn.dispatchEvent(new window.Event('click'));
      expect(addToCart).not.toHaveBeenCalled();
    });
  });
});
