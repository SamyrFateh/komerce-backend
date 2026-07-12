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
  modalProductSession,
  resetModalProductSession,
  setModalProductDetail,
  setModalProductSelection,
} = require('../../js/view-models/modal-product-session.js');
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

function skuSelection(overrides = {}) {
  setModalProductDetail({ inventory_model: 'SKU' });
  setModalProductSelection({
    selected_options: { Couleur: 'Marron', Taille: 'M' },
    selected_sku_id: 'sku-marron-m',
    ...overrides,
  });
}

function click(element) {
  element.dispatchEvent(new window.Event('click'));
}

describe('b-modal-cart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDom();
    resetModalProductSession();
    state.modalProduct = null;
    state.modalQty = 0;
    state.cart = [];
    findCartItemForSelection.mockReturnValue(null);
  });

  test('sync sans produit est un no-op', () => {
    _syncModalQtyUI();
    expect(dom.modalQtyVal.textContent).toBe('');
  });

  test('legacy absent du panier revient à qty 1 et Ajouter', () => {
    state.modalProduct = { id: 42 };
    _syncModalQtyUI();
    expect(state.modalQty).toBe(1);
    expect(dom.addCartBtn.innerHTML).toContain('Ajouter au panier');
    expect(dom.qtyMinus.disabled).toBe(false);
  });

  test('legacy retrouve aussi item.id en comparaison string', () => {
    state.modalProduct = { id: 7 };
    state.cart = [{ id: '7', qty: 3 }];
    _syncModalQtyUI();
    expect(state.modalQty).toBe(3);
    expect(dom.addCartBtn.textContent).toContain('Dans le panier (3)');
  });

  test('legacy tolère les refs d’affichage absentes', () => {
    state.modalProduct = { id: 1 };
    dom.modalQtyVal = null;
    dom.addCartBtn = null;
    expect(() => _syncModalQtyUI()).not.toThrow();
  });

  test('pending sans produit ne touche pas les boutons', () => {
    setModalTransactionPending(true);
    expect(dom.qtyPlus.disabled).toBe(false);
  });

  test('pending verrouille toutes les transactions puis false resynchronise', () => {
    state.modalProduct = { id: 42 };
    setModalTransactionPending(true);
    expect(dom.qtyMinus.disabled).toBe(true);
    expect(dom.qtyPlus.disabled).toBe(true);
    expect(dom.addCartBtn.disabled).toBe(true);
    expect(document.getElementById('k-buy-now-btn').disabled).toBe(true);
    expect(dom.addCartBtn.textContent).toContain('Chargement du produit');

    state.cart = [{ product: { id: 42 }, qty: 4 }];
    setModalTransactionPending(false);
    expect(state.modalQty).toBe(4);
  });

  test('pending tolère Ajouter et Acheter absents', () => {
    state.modalProduct = { id: 42 };
    dom.addCartBtn = null;
    document.getElementById('k-buy-now-btn').remove();
    expect(() => setModalTransactionPending(true)).not.toThrow();
  });

  test('session SKU sans reducer reste verrouillée en chargement', () => {
    state.modalProduct = { id: 42 };
    setModalProductDetail({ inventory_model: 'SKU' });
    _syncModalQtyUI();
    expect(dom.addCartBtn.disabled).toBe(true);
    expect(dom.addCartBtn.textContent).toBe('Chargement du produit…');
  });

  test('sélection SKU incomplète demande les options', () => {
    state.modalProduct = { id: 42 };
    skuSelection({ selected_options: { Couleur: 'Marron' }, selected_sku_id: null });
    _syncModalQtyUI();
    expect(dom.addCartBtn.disabled).toBe(true);
    expect(dom.addCartBtn.textContent).toBe('Choisissez vos options');
    expect(state.modalQty).toBe(1);
  });

  test('sélection complète utilise la ligne product+combo exacte', () => {
    state.modalProduct = { id: 42 };
    skuSelection();
    findCartItemForSelection.mockReturnValue({ qty: 5 });
    _syncModalQtyUI();
    expect(findCartItemForSelection).toHaveBeenCalledWith(42, {
      Couleur: 'Marron', Taille: 'M',
    });
    expect(state.modalQty).toBe(5);
    expect(dom.qtyMinus.disabled).toBe(false);
    expect(dom.addCartBtn.textContent).toContain('Dans le panier (5)');
  });

  test('sélection complète sans ligne active Ajouter/Acheter et désactive moins', () => {
    state.modalProduct = { id: 42 };
    skuSelection();
    _syncModalQtyUI();
    expect(dom.qtyMinus.disabled).toBe(true);
    expect(dom.qtyPlus.disabled).toBe(false);
    expect(dom.addCartBtn.disabled).toBe(false);
    expect(document.getElementById('k-buy-now-btn').disabled).toBe(false);
  });

  test('sync SKU complet tolère les refs d’affichage absentes', () => {
    state.modalProduct = { id: 42 };
    skuSelection();
    dom.modalQtyVal = null;
    dom.addCartBtn = null;
    expect(() => _syncModalQtyUI()).not.toThrow();
  });

  test('plus SKU sans ligne crée via addToCart, moins sans ligne ne fait rien', () => {
    state.modalProduct = { id: 42 };
    skuSelection();
    setupModalCart();
    click(dom.qtyPlus);
    click(dom.qtyMinus);
    expect(addToCart).toHaveBeenCalledWith(state.modalProduct, 1, dom.qtyPlus);
    expect(setCartSelectionQty).not.toHaveBeenCalled();
    expect(quickAdd).not.toHaveBeenCalled();
    expect(quickRemove).not.toHaveBeenCalled();
  });

  test('stepper SKU modifie uniquement la ligne exacte', () => {
    state.modalProduct = { id: 42 };
    skuSelection();
    findCartItemForSelection.mockReturnValue({ qty: 3 });
    setupModalCart();
    click(dom.qtyPlus);
    click(dom.qtyMinus);
    expect(setCartSelectionQty).toHaveBeenNthCalledWith(1, 42, {
      Couleur: 'Marron', Taille: 'M',
    }, 4);
    expect(setCartSelectionQty).toHaveBeenNthCalledWith(2, 42, {
      Couleur: 'Marron', Taille: 'M',
    }, 2);
  });

  test('SKU incomplet ne retombe jamais sur quickAdd même par événement programmatique', () => {
    state.modalProduct = { id: 42 };
    skuSelection({ selected_sku_id: null });
    setupModalCart();
    click(dom.qtyPlus);
    dom.addCartBtn.disabled = false;
    click(dom.addCartBtn);
    expect(addToCart).not.toHaveBeenCalled();
    expect(quickAdd).not.toHaveBeenCalled();
  });

  test('Ajouter SKU complet délègue au moteur panier existant', () => {
    state.modalProduct = { id: 42 };
    skuSelection();
    setupModalCart();
    click(dom.addCartBtn);
    expect(addToCart).toHaveBeenCalledWith(state.modalProduct, 1, dom.addCartBtn);
    expect(modalProductSession.selection.selected_sku_id).toBe('sku-marron-m');
  });

  test('listeners legacy gardent quickAdd / quickRemove', () => {
    state.modalProduct = { id: 22 };
    setupModalCart();
    click(dom.qtyPlus);
    click(dom.qtyMinus);
    expect(quickAdd).toHaveBeenCalledWith('22', dom.qtyPlus);
    expect(quickRemove).toHaveBeenCalledWith('22', dom.qtyMinus);
  });

  test('listeners sans produit restent passifs', () => {
    setupModalCart();
    click(dom.qtyPlus);
    click(dom.qtyMinus);
    click(dom.addCartBtn);
    expect(addToCart).not.toHaveBeenCalled();
    expect(quickAdd).not.toHaveBeenCalled();
    expect(quickRemove).not.toHaveBeenCalled();
  });

  test('Ajouter legacy actif fonctionne, disabled ou confirmed bloque', () => {
    state.modalProduct = { id: 33 };
    setupModalCart();
    click(dom.addCartBtn);
    expect(addToCart).toHaveBeenCalledTimes(1);

    dom.addCartBtn.disabled = true;
    click(dom.addCartBtn);
    dom.addCartBtn.disabled = false;
    dom.addCartBtn.classList.add('confirmed');
    click(dom.addCartBtn);
    expect(addToCart).toHaveBeenCalledTimes(1);
  });
});
