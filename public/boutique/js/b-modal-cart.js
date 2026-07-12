/**
 * @komerce-arch
 * @role          product-modal-cart-controls
 * @domain        boutique
 * @layer         ui-component
 * @criticality   high
 * @inputs        modal_product, modal_product_session, cart_state
 * @outputs       modal_quantity_ui, selected_cart_line_mutations, add_to_cart_action
 * @depends       b-store.js, b-cart.js, b-cart-selection.js, view-models/modal-product-session.js
 * @used-by       b-modal-core.js, b-modal-product-detail-mobile.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  product-modal, cart, sku-selection
 * @version       2026-07
 */

'use strict';

/**
 * Interactions panier de la fiche produit.
 *
 * PDC-4 : le chemin SKU travaille sur l'identité exacte
 * `product_id + selected_options`. Le chemin LEGACY_VARIANTS garde les helpers
 * historiques par product_id jusqu'à l'extinction legacy.
 */

import { state, dom } from './b-store.js';
import { addToCart, quickAdd, quickRemove } from './b-cart.js';
import {
  findCartItemForSelection,
  setCartSelectionQty,
} from './b-cart-selection.js';
import { modalProductSession } from './view-models/modal-product-session.js';

function isSkuDetailPath() {
  return modalProductSession.detail?.inventory_model === 'SKU';
}

function currentSkuSelection() {
  return isSkuDetailPath() ? modalProductSession.selection : null;
}

function setButtonDisabled(button, disabled) {
  if (!button) return;
  button.disabled = disabled;
  button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
}

function setTransactionControlsDisabled(disabled) {
  setButtonDisabled(dom.qtyMinus, disabled);
  setButtonDisabled(dom.qtyPlus, disabled);
  setButtonDisabled(dom.addCartBtn, disabled);
  setButtonDisabled(document.getElementById('k-buy-now-btn'), disabled);
}

function addButtonLabel(html) {
  if (!dom.addCartBtn) return;
  dom.addCartBtn.innerHTML = html;
}

function selectedCombo() {
  return modalProductSession.selection?.selected_options || {};
}

/**
 * Verrou transitoire pendant le fetch du Product Detail Contract.
 * Sans ce verrou, un utilisateur très rapide pourrait ajouter un produit à
 * variantes pendant que la modal legacy est encore visible quelques ms.
 */
function setModalTransactionPending(pending) {
  if (!state.modalProduct) return;
  if (!pending) {
    _syncModalQtyUI();
    return;
  }

  state.modalQty = 1;
  if (dom.modalQtyVal) dom.modalQtyVal.textContent = '1';
  setTransactionControlsDisabled(true);
  dom.addCartBtn?.classList.remove('in-cart');
  addButtonLabel('Chargement du produit…');
}

function syncSkuSelectionUI(selection) {
  const selectionReady = Boolean(selection?.selected_sku_id);

  if (!selectionReady) {
    state.modalQty = 1;
    if (dom.modalQtyVal) dom.modalQtyVal.textContent = '1';
    setTransactionControlsDisabled(true);
    dom.addCartBtn?.classList.remove('in-cart');
    addButtonLabel(selection
      ? 'Choisissez vos options'
      : 'Chargement du produit…');
    return;
  }

  const item = findCartItemForSelection(state.modalProduct.id, selectedCombo());
  state.modalQty = item ? item.qty : 1;
  if (dom.modalQtyVal) dom.modalQtyVal.textContent = String(state.modalQty);

  setButtonDisabled(dom.qtyMinus, !item);
  setButtonDisabled(dom.qtyPlus, false);
  setButtonDisabled(dom.addCartBtn, false);
  setButtonDisabled(document.getElementById('k-buy-now-btn'), false);

  if (!dom.addCartBtn) return;
  if (item) {
    dom.addCartBtn.classList.add('in-cart');
    addButtonLabel('🧺 Dans le panier (' + state.modalQty + ')');
  } else {
    dom.addCartBtn.classList.remove('in-cart');
    addButtonLabel('<img src="/images/panier_tresse_vert.png" width="20" height="20" alt="" style="pointer-events:none;flex-shrink:0"> Ajouter au panier');
  }
}

/**
 * Synchronise stepper + CTA avec le panier réel.
 *
 * SKU : match exact product + combo sélectionnée.
 * Legacy : comportement historique par product_id.
 */
function _syncModalQtyUI() {
  if (!state.modalProduct) return;

  if (isSkuDetailPath()) {
    syncSkuSelectionUI(currentSkuSelection());
    return;
  }

  const pid = String(state.modalProduct.id);
  const item = state.cart.find((cartItem) => String(cartItem.product?.id ?? cartItem.id) === pid);
  state.modalQty = item ? item.qty : 1;
  if (dom.modalQtyVal) dom.modalQtyVal.textContent = String(state.modalQty);

  setButtonDisabled(dom.qtyMinus, false);
  setButtonDisabled(dom.qtyPlus, false);
  setButtonDisabled(dom.addCartBtn, false);
  setButtonDisabled(document.getElementById('k-buy-now-btn'), false);

  if (!dom.addCartBtn) return;
  if (item) {
    dom.addCartBtn.classList.add('in-cart');
    addButtonLabel('🧺 Dans le panier (' + state.modalQty + ')');
  } else {
    dom.addCartBtn.classList.remove('in-cart');
    addButtonLabel('<img src="/images/panier_tresse_vert.png" width="20" height="20" alt="" style="pointer-events:none;flex-shrink:0"> Ajouter au panier');
  }
}

function changeSelectedSkuQty(delta, sourceButton) {
  const selection = currentSkuSelection();
  if (!selection?.selected_sku_id || !state.modalProduct) return;

  const combo = selectedCombo();
  const item = findCartItemForSelection(state.modalProduct.id, combo);

  if (!item) {
    if (delta > 0) addToCart(state.modalProduct, 1, sourceButton);
    _syncModalQtyUI();
    return;
  }

  setCartSelectionQty(state.modalProduct.id, combo, item.qty + delta);
  _syncModalQtyUI();
}

/** Câble le stepper −/+ et « Ajouter au panier ». */
function setupModalCart() {
  dom.qtyMinus.addEventListener('click', () => {
    if (!state.modalProduct) return;

    if (isSkuDetailPath()) {
      changeSelectedSkuQty(-1, dom.qtyMinus);
      return;
    }

    quickRemove(String(state.modalProduct.id), dom.qtyMinus);
    _syncModalQtyUI();
  });

  dom.qtyPlus.addEventListener('click', () => {
    if (!state.modalProduct) return;

    if (isSkuDetailPath()) {
      changeSelectedSkuQty(1, dom.qtyPlus);
      return;
    }

    quickAdd(String(state.modalProduct.id), dom.qtyPlus);
    _syncModalQtyUI();
  });

  dom.addCartBtn.addEventListener('click', () => {
    if (!state.modalProduct || dom.addCartBtn.disabled || dom.addCartBtn.classList.contains('confirmed')) return;

    const selection = currentSkuSelection();
    if (isSkuDetailPath() && !selection?.selected_sku_id) return;

    addToCart(state.modalProduct, 1, dom.addCartBtn);
    _syncModalQtyUI();
  });
}

export { _syncModalQtyUI, setModalTransactionPending, setupModalCart };
