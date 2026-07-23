/**
 * @komerce-arch-lite
 * @role          cart-product-summary
 * @domain        boutique
 * @layer         domain-helper
 * @owner         public/boutique/js/b-cart.js
 * @purpose       summarize every cart line belonging to one product without losing variant identity
 * @impact-areas  cart, catalog, recommendations, favorites
 * @version       2026-07
 */
'use strict';

/**
 * Retourne l'identifiant produit d'une ligne panier, quel que soit le format
 * historique de la ligne.
 * @param {Object|null|undefined} item
 * @returns {string}
 */
export function getCartItemProductId(item) {
  if (!item) return '';
  const value = item.product?.id ?? item.product_id ?? item.id;
  return value == null ? '' : String(value);
}

/**
 * Indique si une ligne transporte une identité de variante/SKU.
 * @param {Object|null|undefined} item
 * @returns {boolean}
 */
export function cartLineHasVariantIdentity(item) {
  if (!item) return false;
  const combo = item.variant_combo;
  const hasCombo = combo && typeof combo === 'object' && Object.keys(combo).length > 0;
  return Boolean(
    hasCombo ||
    item.variant_label ||
    item.sku_id ||
    item.skuId ||
    item.product_sku_id ||
    item.productSkuId ||
    item.sku ||
    item.reference
  );
}

/**
 * Synthétise toutes les lignes d'un même produit.
 *
 * Important : la quantité affichée sur une carte est la somme de toutes les
 * lignes. Une mutation rapide n'est autorisée que lorsqu'une seule ligne est
 * visée sans ambiguïté.
 *
 * @param {Array<Object>} cart
 * @param {string|number} productId
 * @returns {{
 *   productId: string,
 *   lines: Array<Object>,
 *   line: Object|null,
 *   lineCount: number,
 *   totalQty: number,
 *   hasVariantLines: boolean,
 *   isAmbiguous: boolean,
 *   canQuickAdjust: boolean
 * }}
 */
export function getProductCartSummary(cart, productId) {
  const pid = String(productId);
  const source = Array.isArray(cart) ? cart : [];
  const lines = source.filter((item) => getCartItemProductId(item) === pid);
  const totalQty = lines.reduce((sum, item) => {
    const qty = Number(item?.qty);
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
  }, 0);
  const lineCount = lines.length;
  const hasVariantLines = lines.some(cartLineHasVariantIdentity);
  const isAmbiguous = lineCount > 1;

  return {
    productId: pid,
    lines,
    line: lineCount === 1 ? lines[0] : null,
    lineCount,
    totalQty,
    hasVariantLines,
    isAmbiguous,
    canQuickAdjust: lineCount === 1,
  };
}
