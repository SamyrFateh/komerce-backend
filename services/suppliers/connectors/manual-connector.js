/**
 * KOMERCE — Manual Connector
 * ═══════════════════════════════════════════════════════════════════
 *
 * Connecteur fonctionnel : transforme une saisie manuelle (formulaire admin)
 * en NormalizedSupplierProduct[].
 *
 * L'admin saisit un ou plusieurs produits via le formulaire de la vue
 * Scanner. Le connecteur :
 *   - normalise les types
 *   - regroupe les dimensions
 *   - valide la structure (via partitionValid)
 *
 * Aucun parsing complexe : c'est juste une normalisation de formulaire.
 */

'use strict';

const { partitionValid } = require('../normalized-product');

/**
 * Normalise un item de formulaire en NormalizedSupplierProduct.
 *
 * @param {Object} item   — payload form (ex: { product_name, purchase_price, weight_kg, dim_l_cm, ... })
 * @param {string} supplierName
 * @returns {NormalizedSupplierProduct}
 */
function normalizeFormItem(item, supplierName) {
  const dimensions = {};
  if (item.dim_l_cm != null && item.dim_l_cm !== '') dimensions.l_cm = Number(item.dim_l_cm);
  if (item.dim_w_cm != null && item.dim_w_cm !== '') dimensions.w_cm = Number(item.dim_w_cm);
  if (item.dim_h_cm != null && item.dim_h_cm !== '') dimensions.h_cm = Number(item.dim_h_cm);

  // Si l'admin envoie déjà un objet 'dimensions', l'accepter aussi
  const finalDimensions = item.dimensions
    ? item.dimensions
    : (Object.keys(dimensions).length ? dimensions : null);

  return {
    supplier_name: supplierName,
    supplier_product_id: item.supplier_product_id || null,
    product_name: (item.product_name || '').trim(),
    supplier_category: item.supplier_category || null,
    purchase_price: item.purchase_price != null && item.purchase_price !== ''
      ? Number(item.purchase_price)
      : null,
    currency: (item.currency || 'AED').toUpperCase(),
    image_url: item.image_url || null,
    product_url: item.product_url || null,
    description: item.description || null,
    stock_available: item.stock_available != null && item.stock_available !== ''
      ? parseInt(item.stock_available, 10) : null,
    min_order_qty: item.min_order_qty != null && item.min_order_qty !== ''
      ? parseInt(item.min_order_qty, 10) : null,
    supplier_delay_days: item.supplier_delay_days != null && item.supplier_delay_days !== ''
      ? parseInt(item.supplier_delay_days, 10) : null,
    weight_kg: item.weight_kg != null && item.weight_kg !== ''
      ? Number(item.weight_kg) : null,
    dimensions: finalDimensions,
    raw_payload: { ...item },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// API CONNECTEUR
// ═══════════════════════════════════════════════════════════════════════

/**
 * Transforme une liste d'items du formulaire en NormalizedSupplierProduct[].
 *
 * @param {Object} input
 * @param {string} input.supplier_name
 * @param {Array<Object>} input.items   — items du formulaire
 *
 * @returns {{ products, invalid, total }}
 */
function fetchProducts(input) {
  const supplierName = (input?.supplier_name || '').trim();
  if (!supplierName) throw new Error('supplier_name requis');
  if (!Array.isArray(input.items) || !input.items.length) {
    throw new Error('items requis (tableau non vide)');
  }
  const normalized = input.items.map(it => normalizeFormItem(it, supplierName));
  const { valid, invalid } = partitionValid(normalized);
  return {
    products: valid,
    invalid,
    total: normalized.length,
  };
}

module.exports = {
  fetchProducts,
  normalizeFormItem,
};
