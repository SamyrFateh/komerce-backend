/**
 * @komerce-arch
 * @role          catalog-normalized-product
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  catalog, product-discovery
 * @version       2026-06
 */

/**
 * KOMERCE — Format pivot NormalizedSupplierProduct
 * ═══════════════════════════════════════════════════════════════════
 *
 * Tous les connecteurs (CSV, manuel, API) doivent retourner des
 * objets dans ce format. Le scanner ne connaît AUCUNE spécificité
 * fournisseur — il consomme uniquement ce format pivot.
 *
 * Architecture cible :
 *   ┌─────────┐   ┌──────────┐   ┌──────────────────────┐
 *   │   CSV   │──▶│ csv      │──▶│                      │
 *   ├─────────┤   ├──────────┤   │   NormalizedSupplier │
 *   │ Manual  │──▶│ manual   │──▶│        Product[]     │──▶ scanner
 *   ├─────────┤   ├──────────┤   │                      │
 *   │   API   │──▶│ api/noon │──▶│                      │
 *   └─────────┘   └──────────┘   └──────────────────────┘
 *
 * @typedef {Object} NormalizedSupplierProduct
 * @property {string}  supplier_name        Identifiant fournisseur (ex: 'Noon', 'Manual', 'Dragon Mart')
 * @property {string} [supplier_product_id] Référence interne fournisseur (SKU, ASIN…)
 * @property {string}  product_name         Nom du produit
 * @property {string} [supplier_category]   Catégorie selon le fournisseur (texte libre)
 * @property {number} [purchase_price]      Prix d'achat
 * @property {string} [currency]            'AED' | 'EUR' | 'USD' | 'KMF'
 * @property {string} [image_url]
 * @property {string} [product_url]
 * @property {string} [description]
 * @property {number} [stock_available]
 * @property {number} [min_order_qty]
 * @property {number} [supplier_delay_days]
 * @property {number} [weight_kg]           Poids fourni si disponible
 * @property {Object} [dimensions]          { l_cm, w_cm, h_cm }
 * @property {Object} [raw_payload]         Payload brut original (pour debug / re-traitement)
 */

'use strict';

/**
 * Valide qu'un objet ressemble à un NormalizedSupplierProduct.
 * Utilisé par tous les connecteurs avant de retourner leurs résultats.
 *
 * @param {Object} obj
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateNormalizedProduct(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['Objet invalide'] };
  }
  if (!obj.product_name || typeof obj.product_name !== 'string' || !obj.product_name.trim()) {
    errors.push('product_name requis');
  }
  if (!obj.supplier_name || typeof obj.supplier_name !== 'string' || !obj.supplier_name.trim()) {
    errors.push('supplier_name requis');
  }
  if (obj.purchase_price != null && (isNaN(Number(obj.purchase_price)) || Number(obj.purchase_price) < 0)) {
    errors.push('purchase_price doit être un nombre positif');
  }
  if (obj.currency && !['AED', 'EUR', 'USD', 'KMF'].includes(obj.currency)) {
    errors.push('currency doit être AED, EUR, USD ou KMF');
  }
  if (obj.weight_kg != null && (isNaN(Number(obj.weight_kg)) || Number(obj.weight_kg) < 0)) {
    errors.push('weight_kg doit être un nombre positif');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Filtre une liste pour ne garder que les produits valides.
 * Retourne aussi les invalides séparément avec leurs erreurs.
 *
 * @param {Array<Object>} products
 * @returns {{ valid: Array, invalid: Array<{ product, errors }> }}
 */
function partitionValid(products) {
  const valid = [];
  const invalid = [];
  for (const p of products || []) {
    const v = validateNormalizedProduct(p);
    if (v.valid) valid.push(p);
    else invalid.push({ product: p, errors: v.errors });
  }
  return { valid, invalid };
}

module.exports = {
  validateNormalizedProduct,
  partitionValid,
};
