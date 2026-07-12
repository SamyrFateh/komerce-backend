/**
 * @komerce-arch
 * @role          boutique-cart-selection-identity
 * @domain        boutique
 * @layer         service
 * @criticality   high
 * @inputs        product_id, variant_combo, cart_state
 * @outputs       exact_cart_line, selected_line_quantity_mutation
 * @depends       b-store.js, b-cart-core.js
 * @used-by       b-modal-cart.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md
 * @impact-areas  cart, product-modal, sku-selection
 * @version       2026-07
 */

'use strict';

/**
 * Identité d'une ligne panier sélectionnée.
 *
 * `b-cart.js` sait déjà ajouter un snapshot `variant_combo`. PDC-4 a besoin de
 * retrouver et modifier LA ligne de la combinaison courante depuis la modal,
 * au lieu de prendre la première ligne ayant le même product_id.
 *
 * Ce module n'est pas un second moteur panier : il ne rend rien et délègue la
 * persistance/badges à `saveCart()`, owner existant de cette mutation.
 */

import { state } from './b-store.js';
import { saveCart } from './b-cart-core.js';

export function normalizeCartCombo(combo) {
  if (!combo || typeof combo !== 'object' || Array.isArray(combo)) return null;
  const keys = Object.keys(combo).sort();
  if (keys.length === 0) return null;

  const normalized = {};
  keys.forEach((key) => {
    normalized[key] = combo[key];
  });
  return normalized;
}

export function comboSignature(combo) {
  return JSON.stringify(normalizeCartCombo(combo));
}

export function findCartItemForSelection(productId, combo) {
  const productKey = String(productId);
  const signature = comboSignature(combo);

  return state.cart.find((item) =>
    String(item.product?.id ?? item.id) === productKey
    && comboSignature(item.variant_combo) === signature
  ) || null;
}

/**
 * Pose une quantité absolue sur la ligne exacte product+combo.
 * Renvoie false si la ligne n'existe pas : la création reste l'affaire de
 * `addToCart()`, qui possède déjà l'animation et le snapshot produit.
 */
export function setCartSelectionQty(productId, combo, quantity) {
  const item = findCartItemForSelection(productId, combo);
  if (!item) return false;

  const nextQty = Number(quantity);
  if (!Number.isFinite(nextQty)) return false;

  if (nextQty < 1) {
    const index = state.cart.indexOf(item);
    if (index >= 0) state.cart.splice(index, 1);
  } else {
    item.qty = Math.floor(nextQty);
  }

  saveCart();
  return true;
}
