/**
 * @module b-modal-approche-c-hybrid
 * @brief Approche C hybride pour la PDP desktop Komerce.
 *
 * V2 : remonte les actions d'achat juste après le retrait relais, force une
 * quantité d'intention minimale à 1, rend le partage secondaire, et masque la
 * recherche interne en bas du panneau desktop.
 */

import { bus } from './b-bus.js';
import { state, modalZone } from './b-store.js'; // S5 — hook DOM centralisé
import { fmtPrice } from './b-utils.js';
import { isDesktop } from './b-scroll-owner.js';
import { closeModal } from './b-modal.js';
import { addToCart } from './b-cart.js';
import { startShareFlow } from './b-share-cart.js';

'use strict';

let _installed = false;
let _styleInjected = false;
let _qtyGuardInstalled = false;
let _actionsHome = null;

function injectHybridStyles() {
  // Lot 4 — Tout le CSS structurel desktop a été rapatrié dans modal-product.css :
  //   zone produit, grille hybride, titre/prix, relay card, actions inline,
  //   onglets paiement, trust, partage, suggestions desktop-list.
  // Le JS conserve uniquement les comportements :
  //   déplacement DOM des actions, ajout .k-buybox-actions-inline,
  //   garde quantité minimale, rendu livraison/paiement.
  // _styleInjected conservé pour compatibilité des appelants.
  _styleInjected = true;
  return;
}

function clearNode(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

function appendText(parent, text) {
  parent.appendChild(document.createTextNode(text));
}

function renderDelivery() {
  const el = document.getElementById('k-modal-delivery');
  if (!el) return;

  clearNode(el);

  const card = document.createElement('div');
  card.className = 'k-buybox-relay-card';

  const icon = document.createElement('div');
  icon.className = 'k-buybox-relay-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '📦';

  const copy = document.createElement('div');
  copy.className = 'k-buybox-relay-copy';

  const title = document.createElement('div');
  title.className = 'k-buybox-relay-title';
  title.textContent = 'Retrait en relais';

  const sub = document.createElement('div');
  sub.className = 'k-buybox-relay-sub';
  sub.textContent = 'Grande Comore · Anjouan · Mohéli';

  const free = document.createElement('span');
  free.className = 'k-buybox-relay-free';
  free.textContent = 'Gratuit';

  copy.append(title, sub);
  card.append(icon, copy, free);
  el.appendChild(card);
}

function ensureIntentQty() {
  if (!state.modalProduct) return;
  if (!Number.isFinite(Number(state.modalQty)) || Number(state.modalQty) < 1) {
    state.modalQty = 1;
  }

  const qtyVal = document.getElementById('k-qty-val');
  if (qtyVal && Number(qtyVal.textContent || 0) < 1) qtyVal.textContent = '1';

  const subtotal = modalZone('.k-modal-subtotal');
  if (subtotal && state.modalProduct.price_kmf) {
    clearNode(subtotal);
    appendText(subtotal, 'Sous-total : ');
    const strong = document.createElement('strong');
    strong.textContent = fmtPrice(state.modalProduct.price_kmf * state.modalQty);
    subtotal.appendChild(strong);
  }
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
}

const PAYMENT_MODES = {
  stripe: { icon: '💳', tab: 'Carte', title: 'Carte bancaire', sub: 'Visa, Mastercard — Stripe sécurisé', badge: 'Stripe' },
  cash:   { icon: '💵', tab: 'Livraison', title: 'Paiement à la livraison', sub: 'En espèces à la réception', badge: 'Cash' },
  group:  { icon: '👥', tab: 'Partagé', title: 'Panier partagé', sub: 'Invitez des proches à contribuer', badge: 'Partage' },
  pot:    { icon: '🎁', tab: 'Cagnotte', title: 'Cagnotte collective', sub: 'Offrir ensemble, payer ensemble', badge: 'Collectif' },
};

function buildPaymentDetail(key) {
  const m = PAYMENT_MODES[key] || PAYMENT_MODES.stripe;
  const detail = document.createElement('div');
  detail.className = 'k-buybox-payment-detail';
  detail.dataset.payDetail = key;

  const check = document.createElement('span');
  check.className = 'k-buybox-payment-check';
  check.setAttribute('aria-hidden', 'true');

  const icon = document.createElement('span');
  icon.className = 'k-buybox-payment-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = m.icon;

  const copy = document.createElement('span');
  copy.className = 'k-buybox-payment-copy';

  const title = document.createElement('strong');
  title.textContent = m.title;

  const sub = document.createElement('small');
  sub.textContent = m.sub;

  const badge = document.createElement('span');
  badge.className = 'k-buybox-payment-badge';
  badge.textContent = m.badge;

  copy.append(title, sub);
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
    const m = PAYMENT_MODES[key];
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'k-buybox-payment-tab' + (key === active ? ' is-active' : '');
    tab.dataset.pay = key;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', key === active ? 'true' : 'false');

    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = m.icon;

    const label = document.createElement('span');
    label.textContent = m.tab;

    tab.append(icon, label);
    tab.addEventListener('click', function() {
      // ── Tab "Partagé" : ajouter au panier + lancer le flow groupe ──
      if (key === 'group') {
        if (!state.modalProduct) return;
        // Ajouter le produit au panier si pas encore dedans
        addToCart(state.modalProduct, state.modalQty || 1, tab);
        // Fermer la modal proprement avant le flow (évite l'empilement de couches)
        closeModal();
        // Laisser la fermeture s'animer (200ms) puis lancer le flow
        setTimeout(() => startShareFlow(), 250);
        return;
      }

      state.modalPaymentMode = key;
      tabs.querySelectorAll('.k-buybox-payment-tab').forEach(function(t) {
        const isActive = t === tab;
        t.classList.toggle('is-active', isActive);
        t.setAttribute('aria-selected', isActive ? 'true' : 'false');
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
  injectHybridStyles();
  installQtyGuard();
  renderDelivery();
  moveActionsAfterDelivery();
  ensureIntentQty();
  renderPayment();
}

export function setupApprocheCHybridPdp() {
  if (_installed) return;
  _installed = true;

  injectHybridStyles();
  installQtyGuard();

  bus.on('modal:opened', function() {
    if (!isDesktop()) return;
    requestAnimationFrame(function() {
      requestAnimationFrame(applyHybridPdp);
    });
  });

  bus.on('modal:closed', restoreActionsHome);
}
