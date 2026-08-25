/**
 * @komerce-arch-lite
 * @role          boutique-b-modal-cart
 * @domain        shared-cart-modal
 * @layer         ui-component
 * @owner         public/boutique/js/b-modal-core.js
 * @purpose       supports public/boutique/js/b-modal-core.js
 * @impact-areas  boutique
 * @version       2026-08
 */
'use strict';

/**
 * @module b-modal-cart
 * @brief Interactions panier de la fiche produit : stepper, ajout et sync UI.
 */

import { bus } from './b-bus.js';
import { state, dom, getRequestedTransportRail } from './b-store.js';
import { addToCart, quickAdd, quickRemove, setQty } from './b-cart.js';
import { OPTION_STATE } from './view-models/modal-selection-model.js';
import {
  buildModalCartProduct,
  isModalPurchaseReady,
} from './view-models/modal-cart-product-model.js';

let _selectionReconcileInstalled = false;
let _detailReadyReconcileInstalled = false;
let _purchaseIntentFeedbackInstalled = false;

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

function modalRoot() {
  return dom.modalOverlay?.querySelector?.('#k-modal')
    || document.getElementById('k-modal')
    || dom.modalOverlay
    || document;
}

function animateShake(element, { focus = false } = {}) {
  if (!element) return;
  if (typeof element.animate === 'function') {
    element.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-6px)' },
        { transform: 'translateX(6px)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 280, easing: 'ease-out' }
    );
  }
  if (focus && typeof element.focus === 'function') {
    element.focus({ preventScroll: true });
  }
}

function pulseSelectionMessage(message) {
  if (!message || typeof message.animate !== 'function') return;
  message.animate(
    [
      { opacity: 0.45, transform: 'translateY(-2px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    { duration: 240, easing: 'ease-out' }
  );
}

function optionReason(optionState) {
  if (optionState === OPTION_STATE.OUT_OF_STOCK) return 'Rupture de stock';
  if (optionState === OPTION_STATE.INCOMPATIBLE) return 'Combinaison non proposée';
  return '';
}

/**
 * Projection accessibilité + disponibilité partagée desktop/mobile.
 *
 * Important : on n'utilise volontairement PAS l'attribut natif `disabled`
 * sur une variante indisponible. Le clic doit rester capturable afin de dire
 * explicitement POURQUOI le choix n'est pas appliqué (rupture / combinaison
 * non proposée), plutôt que de donner l'impression d'un bouton cassé.
 */
function reconcileVariantAvailabilityUI() {
  const root = modalRoot();
  root.querySelectorAll?.('[data-option-value][data-option-state]').forEach((button) => {
    const optionState = button.dataset.optionState;
    const unavailable = optionState !== OPTION_STATE.AVAILABLE;
    button.classList.toggle('k-vp--out', unavailable);
    if (unavailable) {
      button.setAttribute('aria-disabled', 'true');
      button.dataset.optionUnavailable = 'true';
      const reason = optionReason(optionState);
      if (reason) button.dataset.optionUnavailableReason = reason;
    } else {
      button.removeAttribute('aria-disabled');
      delete button.dataset.optionUnavailable;
      delete button.dataset.optionUnavailableReason;
    }
  });
}

function firstMissingAxis() {
  const axes = state.modalProductDetail?.option_axes || [];
  const selected = state.modalSelection?.selected_options || {};
  return axes.find((axis) => !Object.prototype.hasOwnProperty.call(selected, axis.key))
    || axes[axes.length - 1]
    || null;
}

function ensureSelectionMessage(text) {
  const root = modalRoot();
  const message = root.querySelector?.('#k-modal-selection-message');
  if (!message) return null;
  message.textContent = text || '';
  message.hidden = !message.textContent;
  if (message.textContent) {
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    pulseSelectionMessage(message);
  }
  return message;
}

/**
 * Feedback transactionnel quand l'utilisateur tente Ajouter/Acheter sans SKU
 * résolu. Le CTA reste visuellement bloqué via aria-disabled mais cliquable :
 * le clic ne mute rien et sert uniquement à guider vers l'axe manquant.
 */
function signalMissingVariantSelection() {
  const axis = firstMissingAxis();
  const root = modalRoot();
  if (!axis) {
    ensureSelectionMessage('Cette combinaison n’est pas disponible. Choisissez une autre option.');
    return;
  }

  const selected = state.modalSelection?.selected_options || {};
  const actuallyMissing = !Object.prototype.hasOwnProperty.call(selected, axis.key);
  const label = axis.display_name || axis.key || 'option';
  const message = actuallyMissing
    ? `Choisissez « ${label} » pour continuer.`
    : 'Cette combinaison n’est pas disponible. Choisissez une autre option.';
  ensureSelectionMessage(message);

  const axisElement = Array.from(root.querySelectorAll?.('[data-axis-key]') || [])
    .find((element) => element.dataset.axisKey === axis.key);
  if (!axisElement) return;

  animateShake(axisElement);
  const firstAvailable = axisElement.querySelector('[data-option-state="AVAILABLE"]')
    || axisElement.querySelector('button');
  if (firstAvailable) {
    firstAvailable.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    firstAvailable.focus?.({ preventScroll: true });
  }
}

/**
 * Après le rerender déclenché par selectModalOption(), fait trembler la valeur
 * que le modèle a refusée et expose son message canonique. L'ancienne cible du
 * clic a été remplacée dans le DOM, donc on la retrouve par axe + valeur.
 */
function signalUnavailableOption(axisKey, optionValue, optionState) {
  const root = modalRoot();
  const axisElement = Array.from(root.querySelectorAll?.('[data-axis-key]') || [])
    .find((element) => element.dataset.axisKey === axisKey);
  const option = Array.from(axisElement?.querySelectorAll?.('[data-option-value]') || [])
    .find((button) => button.dataset.optionValue === optionValue);

  const canonicalMessage = String(state.modalSelection?.selection_message || '').trim();
  const fallback = optionReason(optionState);
  ensureSelectionMessage(canonicalMessage || `${optionValue} indisponible — ${fallback.toLowerCase()}`);

  animateShake(option, { focus: true });
  if (option) option.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
}

function purchaseIntentButtons() {
  return [
    dom.addCartBtn,
    document.getElementById('k-buy-now-btn'),
  ].filter(Boolean);
}

/**
 * Un SKU incomplet ne doit PAS être un bouton natif disabled : sinon le clic
 * n'atteint jamais le guard et l'utilisateur ne reçoit aucun feedback.
 * `aria-disabled=true` conserve la sémantique visuelle/accessibilité tandis que
 * le handler garantit qu'aucune mutation panier/checkout n'est possible.
 */
function reconcilePurchaseIntentButtons(purchaseReady, inventoryModel) {
  const buttons = purchaseIntentButtons();
  buttons.forEach((button) => {
    button.classList.remove('k-purchase-intent--blocked');
    button.removeAttribute('aria-disabled');
  });

  if (inventoryModel !== 'SKU') return;

  buttons.forEach((button) => {
    if (!purchaseReady) {
      if (!button.classList.contains('confirmed') && !button.classList.contains('buy-confirmed')) {
        button.disabled = false;
      }
      button.classList.add('k-purchase-intent--blocked');
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('aria-describedby', 'k-modal-selection-message');
      return;
    }

    if (!button.classList.contains('confirmed') && !button.classList.contains('buy-confirmed')) {
      button.disabled = false;
    }
    button.removeAttribute('aria-describedby');
  });
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
  dom.addCartBtn.classList.remove('added', 'in-cart', 'confirmed', 'k-purchase-intent--blocked');
  dom.addCartBtn.removeAttribute('aria-disabled');
  dom.addCartBtn.removeAttribute('aria-describedby');
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

  reconcileVariantAvailabilityUI();
  reconcilePurchaseIntentButtons(purchaseReady, inventoryModel);

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

    const axisKey = option.closest('[data-axis-key]')?.dataset.axisKey || '';
    const optionValue = option.dataset.optionValue || '';
    const optionState = option.dataset.optionState || OPTION_STATE.AVAILABLE;
    const unavailable = optionState !== OPTION_STATE.AVAILABLE;

    Promise.resolve().then(() => {
      _syncModalQtyUI();
      if (unavailable) signalUnavailableOption(axisKey, optionValue, optionState);
    });
  });
}

/**
 * Capture Ajouter/Acheter avant leurs handlers propres. Pour un SKU incomplet,
 * aucune mutation n'est exécutée : on transforme seulement le clic en guidage
 * explicite vers la variante manquante. Le listener capture couvre également
 * le bouton Acheter dont l'owner vit dans b-modal-buybox-shared.js.
 */
function installPurchaseIntentFeedback() {
  if (_purchaseIntentFeedbackInstalled) return;
  _purchaseIntentFeedbackInstalled = true;

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('button');
    if (!button || !button.closest('#k-modal')) return;
    const isPurchaseIntent = button === dom.addCartBtn || button.id === 'k-buy-now-btn';
    if (!isPurchaseIntent) return;
    if (state.modalProductDetail?.inventory_model !== 'SKU') return;

    const ready = isModalPurchaseReady(
      state.modalProduct,
      state.modalProductDetail,
      state.modalSelection
    );
    if (ready) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    signalMissingVariantSelection();
  }, true);
}

function installDetailReadyReconcile() {
  if (_detailReadyReconcileInstalled) return;
  _detailReadyReconcileInstalled = true;
  bus.on('modal:detail-ready', _syncModalQtyUI);
}

function setupModalCart() {
  installSelectionReconcile();
  installPurchaseIntentFeedback();
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
    if (!state.modalProduct || dom.addCartBtn.classList.contains('confirmed')) return;
    if (!isModalPurchaseReady(
      state.modalProduct,
      state.modalProductDetail,
      state.modalSelection
    )) {
      signalMissingVariantSelection();
      return;
    }
    if (dom.addCartBtn.disabled) return;

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
  reconcileVariantAvailabilityUI,
  reconcilePurchaseIntentButtons,
  signalMissingVariantSelection,
  signalUnavailableOption,
});
