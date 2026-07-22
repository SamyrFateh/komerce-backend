/**
 * @komerce-arch
 * @role          product-modal-buybox-shared-logic
 * @domain        catalog
 * @layer         view-model
 * @criticality   high
 * @inputs        product_detail_v1, modal_selection_state, modal_qty, modal_payment_mode
 * @outputs       buybox_price_projection, buybox_payment_dom
 * @depends       b-utils.js, b-modal.js, b-cart.js, b-share-cart.js, view-models/modal-cart-product-model.js
 * @used-by       b-modal-mobile-product.js, b-modal-desktop-product.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  product-modal, mobile, desktop, sku-selection, checkout-entry
 * @version       2026-07
 */

'use strict';

import { fmtPrice } from './b-utils.js';
import { closeModal } from './b-modal.js';
import { addToCart, openCart } from './b-cart.js';
import { startShareFlow } from './b-share-cart.js';
import { state } from './b-store.js';
import { buildModalCartProduct } from './view-models/modal-cart-product-model.js';

function currentCartProduct(product = state.modalProduct) {
  return buildModalCartProduct(
    product,
    state.modalProductDetail,
    state.modalSelection
  );
}

/** Câblage idempotent du bouton Acheter maintenant. */
export function wireBuyNowButton(buyNowBtn) {
  if (!buyNowBtn) return;
  buyNowBtn.onclick = () => {
    if (!state.modalProduct) return;

    const originalContent = buyNowBtn.innerHTML;
    buyNowBtn.innerHTML = '<span style="display:flex;align-items:center;gap:8px;justify-content:center"><span>✓</span><span>Ajouté au panier !</span></span>';
    buyNowBtn.disabled = true;
    buyNowBtn.classList.add('buy-confirmed');

    addToCart(currentCartProduct(), state.modalQty, buyNowBtn);

    setTimeout(() => {
      buyNowBtn.innerHTML = originalContent;
      buyNowBtn.disabled = false;
      buyNowBtn.classList.remove('buy-confirmed');
      closeModal();
      setTimeout(openCart, 400);
    }, 1200);
  };
}

/** Prix courant issu du SKU sélectionné, sinon du prix produit du contrat. */
export function getCurrentPrice(detail, selection) {
  const unit = (detail?.sellable_units || [])
    .find((candidate) => candidate.sku_id === selection?.selected_sku_id) || null;
  return unit?.price_kmf ?? detail?.pricing?.price_kmf ?? null;
}

export function computeSubtotal(detail, selection, qty) {
  const price = getCurrentPrice(detail, selection);
  if (price == null) return null;
  const safeQty = Math.max(1, Number(qty) || 1);
  return price * safeQty;
}

export function renderSubtotalInto(el, detail, selection, qty) {
  if (!el) return;
  const total = computeSubtotal(detail, selection, qty);
  if (total == null) {
    el.textContent = '';
    return;
  }
  el.textContent = 'Sous-total : ';
  const strong = document.createElement('strong');
  strong.textContent = fmtPrice(total);
  el.appendChild(strong);
}

export const PAYMENT_MODES = Object.freeze({
  stripe: { icon: '💳', tab: 'Carte', title: 'Carte bancaire', sub: 'Visa, Mastercard — Stripe sécurisé', badge: 'Stripe' },
  cash:   { icon: '💵', tab: 'Livraison', title: 'Paiement à la livraison', sub: 'En espèces à la réception', badge: 'Cash' },
  group:  { icon: '👥', tab: 'Partagé', title: 'Panier partagé', sub: 'Invitez des proches à contribuer', badge: 'Partage' },
  pot:    { icon: '🎁', tab: 'Cagnotte', title: 'Cagnotte collective', sub: 'Offrir ensemble, payer ensemble', badge: 'Collectif' },
});

function buildPaymentDetail(key) {
  const mode = PAYMENT_MODES[key] || PAYMENT_MODES.stripe;
  const detail = document.createElement('div');
  detail.className = 'k-buybox-payment-detail';
  detail.dataset.payDetail = key;

  const check = document.createElement('span');
  check.className = 'k-buybox-payment-check';
  check.setAttribute('aria-hidden', 'true');

  const icon = document.createElement('span');
  icon.className = 'k-buybox-payment-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = mode.icon;

  const copy = document.createElement('span');
  copy.className = 'k-buybox-payment-copy';
  const title = document.createElement('strong');
  title.textContent = mode.title;
  const sub = document.createElement('small');
  sub.textContent = mode.sub;
  copy.append(title, sub);

  const badge = document.createElement('span');
  badge.className = 'k-buybox-payment-badge';
  badge.textContent = mode.badge;

  detail.append(check, icon, copy, badge);
  return detail;
}

/** Démarre le parcours panier partagé avec le snapshot SKU courant. */
export function startGroupCartFlow(product, qty, sourceEl) {
  if (!product) return;
  addToCart(currentCartProduct(product), qty || 1, sourceEl);
  closeModal();
  setTimeout(() => startShareFlow(), 250);
}

export function renderPaymentModes(el, { activeMode, onModeChange, onGroupSelect } = {}) {
  if (!el) return;
  const active = (activeMode && PAYMENT_MODES[activeMode]) ? activeMode : 'stripe';

  while (el.firstChild) el.removeChild(el.firstChild);

  const title = document.createElement('div');
  title.className = 'k-modal-section-title';
  title.textContent = 'Mode de paiement';

  const tabs = document.createElement('div');
  tabs.className = 'k-buybox-payment-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Mode de paiement');

  const wrap = document.createElement('div');
  wrap.className = 'k-buybox-payment-detail-wrap';

  Object.keys(PAYMENT_MODES).forEach((key) => {
    const mode = PAYMENT_MODES[key];
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'k-buybox-payment-tab' + (key === active ? ' is-active' : '');
    tab.dataset.pay = key;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', key === active ? 'true' : 'false');

    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = mode.icon;
    const label = document.createElement('span');
    label.textContent = mode.tab;
    tab.append(icon, label);

    tab.addEventListener('click', () => {
      if (key === 'group') {
        onGroupSelect && onGroupSelect(tab);
        return;
      }

      tabs.querySelectorAll('.k-buybox-payment-tab').forEach((button) => {
        const isActive = button === tab;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      wrap.appendChild(buildPaymentDetail(key));
      onModeChange && onModeChange(key);
    });

    tabs.appendChild(tab);
  });

  wrap.appendChild(buildPaymentDetail(active));
  el.append(title, tabs, wrap);
}

export const _buyboxSharedTestApi = Object.freeze({
  buildPaymentDetail,
  currentCartProduct,
});
