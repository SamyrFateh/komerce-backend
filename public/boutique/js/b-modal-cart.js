/**
 * @komerce-arch-lite
 * @role          boutique-b-modal-cart
 * @domain        boutique
 * @layer         ui-component
 * @owner         public/boutique/js/b-modal-core.js
 * @purpose       supports public/boutique/js/b-modal-core.js
 * @impact-areas  boutique
 * @version       2026-07
 */
'use strict';

/**
 * @module b-modal-cart
 * @brief Interactions panier de la fiche produit : stepper, ajout et sync UI.
 */

import { state, dom } from './b-store.js';
import { addToCart, quickAdd, quickRemove } from './b-cart.js';
import { buildModalCartProduct } from './view-models/modal-cart-product-model.js';

function normalizedCombo(combo) {
  if (!combo || typeof combo !== 'object') return '';
  return Object.keys(combo)
    .sort()
    .map((key) => `${key}:${String(combo[key])}`)
    .join('|');
}

function itemProductId(item) {
  return item?.product?.id ?? item?.id ?? null;
}

function itemSkuId(item) {
  return item?.sku_id
    ?? item?.product?.sku_id
    ?? item?.product?.selected_sku_id
    ?? null;
}

/**
 * Retourne uniquement la ligne correspondant a la selection courante. Un produit
 * SKU ne doit jamais reutiliser la premiere ligne du meme product.id : deux
 * couleurs/tailles du meme produit sont deux intentions panier distinctes.
 */
function currentModalCartItem() {
  if (!state.modalProduct) return null;
  const pid = String(state.modalProduct.id);
  const candidates = (state.cart || []).filter(
    (item) => String(itemProductId(item)) === pid
  );

  const isSku = state.modalProductDetail?.inventory_model === 'SKU';
  if (!isSku) return candidates[0] || null;

  const selectedSkuId = state.modalSelection?.selected_sku_id;
  if (!selectedSkuId) return null;

  const bySku = candidates.find((item) => {
    const skuId = itemSkuId(item);
    return skuId != null && String(skuId) === String(selectedSkuId);
  });
  if (bySku) return bySku;

  const selectedCombo = normalizedCombo(state.modalSelection?.selected_options);
  if (!selectedCombo) return null;
  return candidates.find(
    (item) => normalizedCombo(item.variant_combo) === selectedCombo
  ) || null;
}

/* Reset de l'etat transitoire du bouton Ajouter a chaque ouverture produit. */
function resetAddCartButtonState() {
  if (!dom.addCartBtn) return;
  dom.addCartBtn.disabled = false;
  dom.addCartBtn.onclick = null;
  dom.addCartBtn.classList.remove('added', 'in-cart', 'confirmed');
}

/** Synchronise quantité, état SKU et représentation bouton/stepper. */
function _syncModalQtyUI() {
  if (!state.modalProduct) return;

  const item = currentModalCartItem();
  state.modalQty = item ? item.qty : 1;
  if (dom.modalQtyVal) dom.modalQtyVal.textContent = state.modalQty;

  const isSku = state.modalProductDetail?.inventory_model === 'SKU';
  const actions = dom.addCartBtn?.closest('.k-modal-actions') || null;
  if (actions) {
    actions.dataset.inventoryModel = isSku ? 'SKU' : 'LEGACY';
    actions.classList.toggle('k-modal-actions--filled', Boolean(item) && !isSku);
  }

  // Le stepper historique mute encore par product.id : il reste interdit aux SKU.
  [dom.qtyMinus, dom.qtyPlus].forEach((control) => {
    if (control) control.disabled = isSku;
  });

  if (!dom.addCartBtn) return;
  if (item) {
    dom.addCartBtn.classList.add('in-cart');
    dom.addCartBtn.innerHTML = '🧺 Dans le panier (' + state.modalQty + ')';
  } else {
    dom.addCartBtn.classList.remove('in-cart');
    dom.addCartBtn.innerHTML = '<img src="/images/panier_tresse_vert.png" width="20" height="20" alt="" style="pointer-events:none;flex-shrink:0"> Ajouter';
  }
}

function setupModalCart() {
  dom.qtyMinus.addEventListener('click', () => {
    if (!state.modalProduct) return;
    const pid = String(state.modalProduct.id);
    quickRemove(pid, dom.qtyMinus);
    _syncModalQtyUI();
  });

  dom.qtyPlus.addEventListener('click', () => {
    if (!state.modalProduct) return;
    const pid = String(state.modalProduct.id);
    quickAdd(pid, dom.qtyPlus);
    _syncModalQtyUI();
  });

  dom.addCartBtn.addEventListener('click', () => {
    if (!state.modalProduct || dom.addCartBtn.disabled || dom.addCartBtn.classList.contains('confirmed')) return;
    const cartProduct = buildModalCartProduct(
      state.modalProduct,
      state.modalProductDetail,
      state.modalSelection
    );
    addToCart(cartProduct, 1, dom.addCartBtn);
    _syncModalQtyUI();
  });
}

export {
  _syncModalQtyUI,
  setupModalCart,
  resetAddCartButtonState,
};

export const _modalCartTestApi = Object.freeze({
  currentModalCartItem,
  normalizedCombo,
});
