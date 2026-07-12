/**
 * @komerce-arch
 * @role          hybrid-product-modal-flow
 * @domain        boutique
 * @layer         ui-experiment
 * @criticality   medium
 * @inputs        modal_context, cart_actions
 * @outputs       hybrid_modal_actions, share_entry, payment_composition
 * @depends       b-cart.js, b-share-cart.js, b-modal-core.js
 * @used-by       main.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  product-modal, cart, shared-cart-creation, checkout-entry
 * @version       2026-07
 */

'use strict';

/**
 * PDC-5 — Approche C limitée à la COMPOSITION desktop.
 *
 * La livraison et le sous-total produit ne sont plus calculés ici :
 * `b-modal-desktop-product.js` les rend depuis Product Detail + sélection SKU.
 * Ce module conserve le placement des actions, la quantité minimale d'intention
 * et l'entrée de paiement/partage existante.
 */

import { bus } from './b-bus.js';
import { state, modalZone } from './b-store.js';
import { isDesktop } from './b-scroll-owner.js';
import { closeModal } from './b-modal.js';
import { addToCart } from './b-cart.js';
import { startShareFlow } from './b-share-cart.js';

let _installed = false;
let _qtyGuardInstalled = false;
let _actionsHome = null;

function clearNode(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

function ensureIntentQty() {
  if (!state.modalProduct) return;
  if (!Number.isFinite(Number(state.modalQty)) || Number(state.modalQty) < 1) {
    state.modalQty = 1;
  }

  const qtyVal = document.getElementById('k-qty-val');
  if (qtyVal && Number(qtyVal.textContent || 0) < 1) qtyVal.textContent = '1';
}

function installQtyGuard() {
  if (_qtyGuardInstalled || typeof document === 'undefined') return;
  _qtyGuardInstalled = true;

  document.addEventListener('click', function(e) {
    const minus = e.target && e.target.closest ? e.target.closest('#k-qty-minus') : null;
    if (!minus || !isDesktop() || !state.modalProduct) return;

    const current = Number(state.modalQty || 0);
    if (current <= 1) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      state.modalQty = 1;
      const qtyVal = document.getElementById('k-qty-val');
      if (qtyVal) qtyVal.textContent = '1';
      ensureIntentQty();
    }
  }, true);
}

function moveActionsAfterDelivery() {
  const info = modalZone('.k-modal-info');
  const delivery = document.getElementById('k-modal-delivery');
  const actions = modalZone('.k-modal-actions');
  if (!info || !delivery || !actions) return;

  if (!_actionsHome && actions.parentElement) {
    _actionsHome = { parent: actions.parentElement, next: actions.nextSibling };
  }

  actions.classList.add('k-buybox-actions-inline');
  if (actions.parentElement !== info || delivery.nextElementSibling !== actions) {
    info.insertBefore(actions, delivery.nextSibling);
  }
}

function restoreActionsHome() {
  const actions = modalZone('.k-modal-actions');
  if (!actions || !_actionsHome || !_actionsHome.parent) return;
  actions.classList.remove('k-buybox-actions-inline');
  _actionsHome.parent.insertBefore(actions, _actionsHome.next || null);
  _actionsHome = null;
}

const PAYMENT_MODES = {
  stripe: { icon: '💳', tab: 'Carte', title: 'Carte bancaire', sub: 'Visa, Mastercard — Stripe sécurisé', badge: 'Stripe' },
  cash:   { icon: '💵', tab: 'Livraison', title: 'Paiement à la livraison', sub: 'En espèces à la réception', badge: 'Cash' },
  group:  { icon: '👥', tab: 'Partagé', title: 'Panier partagé', sub: 'Invitez des proches à contribuer', badge: 'Partage' },
  pot:    { icon: '🎁', tab: 'Cagnotte', title: 'Cagnotte collective', sub: 'Offrir ensemble, payer ensemble', badge: 'Collectif' },
};

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

function renderPayment() {
  const el = document.getElementById('k-modal-payment');
  if (!el) return;

  const active = state.modalPaymentMode || 'stripe';
  clearNode(el);

  const title = document.createElement('div');
  title.className = 'k-modal-section-title';
  title.textContent = 'Mode de paiement';

  const tabs = document.createElement('div');
  tabs.className = 'k-buybox-payment-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Mode de paiement');

  const wrap = document.createElement('div');
  wrap.className = 'k-buybox-payment-detail-wrap';

  Object.keys(PAYMENT_MODES).forEach(function(key) {
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

    tab.addEventListener('click', function() {
      if (key === 'group') {
        if (!state.modalProduct) return;
        addToCart(state.modalProduct, state.modalQty || 1, tab);
        closeModal();
        setTimeout(() => startShareFlow(), 250);
        return;
      }

      state.modalPaymentMode = key;
      tabs.querySelectorAll('.k-buybox-payment-tab').forEach(function(button) {
        const isActive = button === tab;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      clearNode(wrap);
      wrap.appendChild(buildPaymentDetail(key));
    });

    tabs.appendChild(tab);
  });

  wrap.appendChild(buildPaymentDetail(active));
  el.append(title, tabs, wrap);
}

function applyHybridPdp() {
  if (!isDesktop()) return;
  installQtyGuard();
  moveActionsAfterDelivery();
  ensureIntentQty();
  renderPayment();
}

export function setupApprocheCHybridPdp() {
  if (_installed) return;
  _installed = true;
  installQtyGuard();

  bus.on('modal:opened', function() {
    if (!isDesktop()) return;
    requestAnimationFrame(function() {
      requestAnimationFrame(applyHybridPdp);
    });
  });

  bus.on('modal:closed', restoreActionsHome);
}
