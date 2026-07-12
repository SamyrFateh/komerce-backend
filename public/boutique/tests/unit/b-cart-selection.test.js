'use strict';

jest.mock('../../js/b-cart-core.js', () => ({
  saveCart: jest.fn(),
}));

const { state } = require('../../js/b-store.js');
const { saveCart } = require('../../js/b-cart-core.js');
const {
  normalizeCartCombo,
  comboSignature,
  findCartItemForSelection,
  setCartSelectionQty,
} = require('../../js/b-cart-selection.js');

describe('b-cart-selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    state.cart = [];
  });

  test('normalise les clés de combo dans un ordre déterministe', () => {
    expect(normalizeCartCombo({ Taille: 'M', Couleur: 'Marron' })).toEqual({
      Couleur: 'Marron',
      Taille: 'M',
    });
    expect(comboSignature({ Taille: 'M', Couleur: 'Marron' })).toBe(
      comboSignature({ Couleur: 'Marron', Taille: 'M' })
    );
  });

  test('null, tableau et combo vide partagent l’identité sans variante', () => {
    expect(normalizeCartCombo(null)).toBeNull();
    expect(normalizeCartCombo([])).toBeNull();
    expect(normalizeCartCombo({})).toBeNull();
    expect(comboSignature({})).toBe(comboSignature(null));
  });

  test('retrouve la ligne exacte parmi deux SKU du même produit', () => {
    const marron = {
      product: { id: 42 },
      qty: 2,
      variant_combo: { Couleur: 'Marron', Taille: 'M' },
    };
    const beige = {
      product: { id: 42 },
      qty: 5,
      variant_combo: { Taille: 'M', Couleur: 'Beige' },
    };
    state.cart = [marron, beige];

    expect(findCartItemForSelection('42', { Taille: 'M', Couleur: 'Beige' })).toBe(beige);
    expect(findCartItemForSelection(42, { Taille: 'M', Couleur: 'Marron' })).toBe(marron);
  });

  test('ne confond pas une autre combinaison du même produit', () => {
    state.cart = [{
      product: { id: 42 },
      qty: 2,
      variant_combo: { Couleur: 'Marron', Taille: 'M' },
    }];

    expect(findCartItemForSelection(42, { Couleur: 'Marron', Taille: 'L' })).toBeNull();
  });

  test('supporte une ligne legacy utilisant item.id sans wrapper product', () => {
    const item = { id: 7, qty: 1, variant_combo: null };
    state.cart = [item];
    expect(findCartItemForSelection('7', {})).toBe(item);
  });

  test('modifie uniquement la quantité de la combinaison exacte puis persiste', () => {
    const marron = {
      product: { id: 42 },
      qty: 2,
      variant_combo: { Couleur: 'Marron', Taille: 'M' },
    };
    const beige = {
      product: { id: 42 },
      qty: 5,
      variant_combo: { Couleur: 'Beige', Taille: 'M' },
    };
    state.cart = [marron, beige];

    expect(setCartSelectionQty(42, { Taille: 'M', Couleur: 'Beige' }, 6)).toBe(true);
    expect(marron.qty).toBe(2);
    expect(beige.qty).toBe(6);
    expect(saveCart).toHaveBeenCalledTimes(1);
  });

  test('retire uniquement la ligne exacte quand la quantité passe sous 1', () => {
    const marron = {
      product: { id: 42 },
      qty: 1,
      variant_combo: { Couleur: 'Marron', Taille: 'M' },
    };
    const beige = {
      product: { id: 42 },
      qty: 1,
      variant_combo: { Couleur: 'Beige', Taille: 'M' },
    };
    state.cart = [marron, beige];

    expect(setCartSelectionQty(42, marron.variant_combo, 0)).toBe(true);
    expect(state.cart).toEqual([beige]);
    expect(saveCart).toHaveBeenCalledTimes(1);
  });

  test('refuse une ligne absente ou une quantité non numérique sans persister', () => {
    state.cart = [{ product: { id: 42 }, qty: 1, variant_combo: null }];

    expect(setCartSelectionQty(99, null, 2)).toBe(false);
    expect(setCartSelectionQty(42, null, Number.NaN)).toBe(false);
    expect(saveCart).not.toHaveBeenCalled();
  });

  test('arrondit une quantité positive vers l’entier inférieur', () => {
    const item = { product: { id: 42 }, qty: 1, variant_combo: null };
    state.cart = [item];

    expect(setCartSelectionQty(42, null, 3.8)).toBe(true);
    expect(item.qty).toBe(3);
  });
});
