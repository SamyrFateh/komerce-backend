/**
 * @komerce-arch-lite
 * @role          boutique-b-modal-cart
 * @domain        shared-cart-modal
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

import { bus } from './b-bus.js';
import { state, dom, getRequestedTransportRail } from './b-store.js';
import { addToCart, quickAdd, quickRemove } from './b-cart.js';
import { buildModalCartProduct } from './view-models/modal-cart-product-model.js';

let _selectionReconcileInstalled = false;
let _detailReadyReconcileInstalled = false;

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

function paintInCartButton(button, qty) {
  button.replaceChildren(document.createTextNode(`ðŸ§º Dans le panier (${qty})`));
}

function paintAddButton(button) {
  const image = document.createElement('img');
  image.src = '/images/panier_tresse.png';
  image.width = 20;
  image.height = 20;
  image.alt = '';
  image.style.pointerEvents = 'none';
  image.style.flexShrink = '0';
  button.replaceChildren(image, document.createTextNode(' Ajouter'));
}

/**
 * Retourne uniquement la ligne correspondant Ã  la sÃ©lection courante. Un produit
 * SKU ne doit jamais rÃ©utiliser la premiÃ¨re ligne du mÃªme product.id : deux
 * couleurs/tailles du mÃªme produit sont deux intentions panier distinctes.
 */
function currentModalCartItem() {
  if (!state.modalProduct) return null;
  const pid = String(state.modalProduct.id);
  const currentRail = getRequestedTransportRail();
  const candidates = (state.cart || []).filter(
    (item) =>
      String(itemProductId(item)) === pid
      && (item.requested_transport_rail ?? null) === currentRail
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

/* Reset de l'Ã©tat transitoire du bouton Ajouter Ã  chaque ouverture produit. */
function resetAddCartButtonState() {
  if (!dom.addCartBtn) return;
  dom.addCartBtn.disabled = false;
  dom.addCartBtn.onclick = null;
  dom.addCartBtn.classList.remove('added', 'in-cart', 'confirmed');
}

/** Synchronise quantitÃ©, Ã©tat SKU et reprÃ©sentation bouton/stepper. */
function _syncModalQtyUI() {
  if (!state.modalProduct) return;

  const item = currentModalCartItem();
  const inventoryModel = state.modalProductDetail?.inventory_model;
  const isSku = inventoryModel === 'SKU';
  const canUseProductStepper = Boolean(inventoryModel) && !isSku;

  // Pour un SKU, le stepper est interdit : l'intention d'un clic CTA reste donc
  // toujours une unitÃ©. Avant rÃ©solution du contrat, le chemin reste fail-closed.
  state.modalQty = isSku ? 1 : (item ? item.qty : 1);
  if (dom.modalQtyVal) dom.modalQtyVal.textContent = state.modalQty;

  const actions = dom.addCartBtn?.closest('.k-modal-actions') || null;
  if (actions) {
    actions.dataset.inventoryModel = inventoryModel || 'UNKNOWN';
    actions.classList.toggle(
      'k-modal-actions--filled',
      Boolean(item) && canUseProductStepper
    );
  }

  [dom.qtyMinus, dom.qtyPlus].forEach((control) => {
    if (control) control.disabled = !canUseProductStepper;
  });

  if (!dom.addCartBtn) return;
  if (item) {
    dom.addCartBtn.classList.add('in-cart');
    paintInCartButton(dom.addCartBtn, item.qty);
  } else {
    dom.addCartBtn.classList.remove('in-cart');
    paintAddButton(dom.addCartBtn);
  }
}

/**
 * Les renderers PDC rerendent directement leur composition lors d'un clic sur
 * une option et ne repassent pas par le bootstrap. Cette dÃ©lÃ©gation document
 * rÃ©concilie l'owner panier juste aprÃ¨s le handler du renderer, y compris quand
 * le bouton cliquÃ© a Ã©tÃ© remplacÃ© par le rerender.
 */
function installSelectionReconcile() {
  if (_selectionReconcileInstalled) return;
  _selectionReconcileInstalled = true;

  document.addEventListener('click', (event) => {
    const target = event.target;
    const option = target?.closest?.('[data-option-value]');
    if (!option || !option.closest('#k-modal')) return;
    Promise.resolve().then(_syncModalQtyUI);
  });
}

function installDetailReadyReconcile() {
  if (_detailReadyReconcileInstalled) return;
  _detailReadyReconcileInstalled = true;
  bus.on('modal:detail-ready', _syncModalQtyUI);
}

function setupModalCart() {
  installSelectionReconcile();
  installDetailReadyReconcile();

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
    addToCart(cartProduct, 1, dom.addCartBtn, {
      requested_transport_rail: getRequestedTransportRail(),
    });
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
  paintInCartButton,
  paintAddButton,
});