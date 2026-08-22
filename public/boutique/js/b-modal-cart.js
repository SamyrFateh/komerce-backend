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
import { addToCart, quickAdd, quickRemove, setQty } from './b-cart.js';
import {
  buildModalCartProduct,
  isModalPurchaseReady,
} from './view-models/modal-cart-product-model.js';

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
  const desktop = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(min-width: 900px)').matches;

  button.replaceChildren(document.createTextNode(
    desktop ? '✓ Ajouté' : `🧺 Dans le panier (${qty})`
  ));
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
 * Retourne uniquement la ligne correspondant à la sélection courante. Un produit
 * SKU ne doit jamais réutiliser la première ligne du même product.id : deux
 * couleurs/tailles du même produit sont deux intentions panier distinctes.
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

/* Reset de l'état transitoire du bouton Ajouter à chaque ouverture produit. */
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
  const inventoryModel = state.modalProductDetail?.inventory_model;
  const purchaseReady = isModalPurchaseReady(
    state.modalProduct,
    state.modalProductDetail,
    state.modalSelection
  );
  const canUseExactLineStepper = purchaseReady && Boolean(item);

  // Le stepper n'apparait qu'après ajout et cible toujours la ligne exacte
  // résolue par currentModalCartItem(). Pour un SKU, cette résolution repose
  // sur sku_id puis variant_combo : aucune autre couleur/taille ne peut être
  // mutée par un contrôle affiché dans la modal courante.
  state.modalQty = item ? item.qty : 1;
  if (dom.modalQtyVal) dom.modalQtyVal.textContent = state.modalQty;

  const actions = dom.addCartBtn?.closest('.k-modal-actions') || null;
  if (actions) {
    actions.dataset.inventoryModel = inventoryModel || 'UNKNOWN';
    actions.classList.toggle(
      'k-modal-actions--filled',
      canUseExactLineStepper
    );
  }

  [dom.qtyMinus, dom.qtyPlus].forEach((control) => {
    if (control) control.disabled = !canUseExactLineStepper;
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
 * une option et ne repassent pas par le bootstrap. Cette délégation document
 * réconcilie l'owner panier juste après le handler du renderer, y compris quand
 * le bouton cliqué a été remplacé par le rerender.
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
    const item = currentModalCartItem();
    if (item) setQty(pid, item.qty - 1, item);
    else quickRemove(pid, dom.qtyMinus);
    _syncModalQtyUI();
  });

  dom.qtyPlus.addEventListener('click', () => {
    if (!state.modalProduct) return;
    const pid = String(state.modalProduct.id);
    const item = currentModalCartItem();
    if (item) setQty(pid, item.qty + 1, item);
    else quickAdd(pid, dom.qtyPlus);
    _syncModalQtyUI();
  });

  dom.addCartBtn.addEventListener('click', () => {
    if (!state.modalProduct || dom.addCartBtn.disabled || dom.addCartBtn.classList.contains('confirmed')) return;
    if (!isModalPurchaseReady(
      state.modalProduct,
      state.modalProductDetail,
      state.modalSelection
    )) {
      // À minima : renvoyer le focus vers la première variante plutôt
      // qu'un clic silencieux sans aucun signal (bug signalé 22-08-2026).
      // [data-axis-key] est le conteneur de chaque axe (couleur/taille/...),
      // rendu identiquement en desktop (b-modal-desktop-product.js) et
      // mobile (b-modal-mobile-product.js) — un seul correctif couvre les
      // deux. Le premier bouton d'option à l'intérieur est nativement
      // focusable (button natif), scrollIntoView le rend visible même si
      // la modale a défilé au-delà.
      focusFirstVariantOption();
      return;
    }
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

/**
 * Renvoie le focus vers le premier bouton d'option de variante affiché
 * dans la modale — seul signal donné aujourd'hui à un clic "Ajouter"
 * bloqué par une sélection incomplète (couleur/taille non choisie).
 * Cherche dans dom.modalOverlay (racine commune desktop/mobile) plutôt
 * qu'un sélecteur global pour ne jamais capturer un axe d'une autre
 * modale/instance restée dans le DOM.
 */
function focusFirstVariantOption() {
  const root = dom.modalOverlay || document;
  const firstAxis = root.querySelector('[data-axis-key]');
  const firstButton = firstAxis?.querySelector('button');
  if (!firstButton) return;
  firstButton.scrollIntoView({ block: 'center', behavior: 'smooth' });
  firstButton.focus({ preventScroll: true });
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
