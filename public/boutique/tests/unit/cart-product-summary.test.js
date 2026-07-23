'use strict';

const {
  getCartItemProductId,
  cartLineHasVariantIdentity,
  getProductCartSummary,
} = require('../../js/cart-product-summary.js');

describe('cart-product-summary', () => {
  it('normalise les formats historiques d’identifiant produit', () => {
    expect(getCartItemProductId({ product: { id: 7 } })).toBe('7');
    expect(getCartItemProductId({ product_id: '8' })).toBe('8');
    expect(getCartItemProductId({ id: 9 })).toBe('9');
  });

  it('additionne toutes les lignes variantes du même produit', () => {
    const cart = [
      { product: { id: 7 }, qty: 2, variant_combo: { taille: 'M' } },
      { product: { id: '7' }, qty: 3, variant_combo: { taille: 'L' } },
      { product: { id: 8 }, qty: 10 },
    ];

    const summary = getProductCartSummary(cart, 7);

    expect(summary.totalQty).toBe(5);
    expect(summary.lineCount).toBe(2);
    expect(summary.isAmbiguous).toBe(true);
    expect(summary.canQuickAdjust).toBe(false);
    expect(summary.line).toBeNull();
    expect(summary.hasVariantLines).toBe(true);
  });

  it('autorise l’ajustement rapide lorsqu’une seule ligne existe', () => {
    const line = { product: { id: 7 }, qty: 4 };
    const summary = getProductCartSummary([line], '7');

    expect(summary.totalQty).toBe(4);
    expect(summary.lineCount).toBe(1);
    expect(summary.canQuickAdjust).toBe(true);
    expect(summary.line).toBe(line);
  });

  it('détecte les identités de variante et SKU', () => {
    expect(cartLineHasVariantIdentity({ variant_combo: { couleur: 'Bleu' } })).toBe(true);
    expect(cartLineHasVariantIdentity({ sku_id: 12 })).toBe(true);
    expect(cartLineHasVariantIdentity({ variant_label: 'Bleu / 42' })).toBe(true);
    expect(cartLineHasVariantIdentity({ qty: 1 })).toBe(false);
  });
});
