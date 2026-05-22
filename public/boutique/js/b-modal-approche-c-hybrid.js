/**
 * @module b-modal-approche-c-hybrid
 * @brief Approche C hybride pour la PDP desktop Komerce.
 *
 * V2 : remonte les actions d'achat juste après le retrait relais, force une
 * quantité d'intention minimale à 1, rend le partage secondaire, et masque la
 * recherche interne en bas du panneau desktop.
 */

import { bus } from './b-bus.js';
import { state } from './b-store.js';
import { fmtPrice } from './b-utils.js';
import { isDesktop } from './b-scroll-owner.js';

'use strict';

let _installed = false;
let _styleInjected = false;
let _qtyGuardInstalled = false;
let _actionsHome = null;

function injectHybridStyles() {
  if (_styleInjected || typeof document === 'undefined') return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.id = 'k-approche-c-hybrid-style';
  style.textContent = `
@media (min-width: 900px) {
  #k-modal .k-modal-product-zone {
    grid-template-columns: minmax(0, 48%) minmax(0, 52%);
    background: radial-gradient(circle at 18% 12%, color-mix(in srgb, var(--sand-warm) 60%, transparent), transparent 28%), var(--white);
  }
  #k-modal .k-modal-product-zone .k-modal-img-wrap {
    background: radial-gradient(circle at 62% 20%, color-mix(in srgb, var(--ocean) 10%, transparent), transparent 30%), linear-gradient(135deg, var(--sand) 0%, var(--sand-warm) 100%);
  }
  #k-modal .k-modal-slide { padding: 22px 30px 22px 92px; }
  #k-modal .k-modal-product-zone .k-modal-details {
    background: linear-gradient(180deg, var(--white) 0%, color-mix(in srgb, var(--sand) 48%, var(--white)) 100%);
    padding: 0 clamp(28px, 4.4vw, 72px);
  }
  #k-modal .k-modal-product-zone .k-modal-info {
    max-width: 760px;
    padding-top: clamp(22px, 3vh, 42px);
    padding-bottom: 14px;
  }
  #k-modal .k-modal-info h2 {
    font-family: var(--font-display, var(--font));
    font-size: clamp(30px, 3vw, 46px);
    line-height: .98;
    font-weight: 700;
    letter-spacing: -.035em;
    color: var(--text);
    max-width: 760px;
  }
  #k-modal .k-modal-name-row { margin-top: 10px; align-items: flex-start; }
  #k-modal .k-modal-fav-btn { margin-top: 2px; }
  #k-modal .k-modal-price-row { margin-top: 18px; gap: 12px; }
  #k-modal .k-modal-price { font-size: clamp(34px, 4vw, 56px); letter-spacing: -.04em; color: var(--coral); }
  #k-modal .k-modal-price-unit { font-size: .34em; letter-spacing: .06em; }
  #k-modal .k-modal-old-price { font-size: 16px; opacity: .72; }
  #k-modal .k-modal-aed-price { margin-top: 8px; margin-bottom: 10px; }
  #k-modal .k-modal-eur-ref,
  #k-modal .k-modal-price-saving { font-size: 13px; }
  #k-modal .k-modal-flash-bar { display: none; }
  #k-modal .k-modal-desc {
    font-style: italic;
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-muted);
    margin-top: 8px;
    max-width: 680px;
  }
  #k-modal .k-modal-delivery,
  #k-modal .k-modal-payment {
    display: block;
    border-top: 0;
    margin-top: 18px;
    padding-top: 0;
  }
  #k-modal .k-buybox-relay-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    padding: 15px 16px;
    border-radius: 18px;
    border: 1px solid var(--border-ocean-14);
    background: linear-gradient(135deg, color-mix(in srgb, var(--ocean-bg-08) 78%, var(--white)) 0%, var(--white) 100%);
    box-shadow: 0 12px 28px var(--border-text-06);
  }
  #k-modal .k-buybox-relay-icon {
    width: 42px;
    height: 42px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    background: var(--ocean-bg-08);
    border: 1px solid var(--border-ocean-14);
    font-size: 22px;
  }
  #k-modal .k-buybox-relay-title {
    font-size: 14px;
    font-weight: 800;
    color: var(--text);
    line-height: 1.1;
  }
  #k-modal .k-buybox-relay-sub {
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-muted);
  }
  #k-modal .k-buybox-relay-free {
    font-size: 12px;
    font-weight: 800;
    color: var(--ocean-dark);
    background: var(--ocean-bg-08);
    border: 1px solid var(--border-ocean-14);
    border-radius: 999px;
    padding: 5px 10px;
    white-space: nowrap;
  }
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(180px, 1fr) minmax(210px, 1.15fr);
    align-items: center;
    gap: 12px;
    margin-top: 16px;
    padding: 14px 0 4px;
    background: transparent;
    border-top: 0;
    box-shadow: none;
  }
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline .k-qty,
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline .k-add-cart-btn,
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline .k-buy-now-btn {
    min-height: 50px;
    border-radius: 999px;
  }
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline .k-qty {
    background: var(--sand);
    box-shadow: inset 0 0 0 1px var(--border-text-06);
  }
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline .k-add-cart-btn {
    background: var(--white);
    font-size: 14px;
    font-weight: 850;
  }
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline .k-buy-now-btn {
    font-size: 15px;
    font-weight: 900;
    box-shadow: 0 14px 30px color-mix(in srgb, var(--ocean) 24%, transparent);
  }
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline .k-modal-subtotal {
    grid-column: 3;
    justify-self: center;
    margin-top: -2px;
    font-size: 12px;
    color: var(--text-muted);
  }
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline .k-modal-subtotal strong {
    color: var(--coral);
    font-size: 15px;
  }
  #k-modal .k-modal-payment .k-modal-section-title { margin-bottom: 9px; }
  #k-modal .k-buybox-payment-tabs {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;
  }
  #k-modal .k-buybox-payment-tab {
    height: 42px;
    border-radius: 13px;
    border: 1px solid var(--border);
    background: var(--white);
    color: var(--text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: border-color .16s var(--ease), background .16s var(--ease), color .16s var(--ease), box-shadow .16s var(--ease), transform .16s var(--ease);
  }
  #k-modal .k-buybox-payment-tab:hover {
    transform: translateY(-1px);
    border-color: var(--ocean-light);
    box-shadow: 0 8px 18px var(--border-text-06);
  }
  #k-modal .k-buybox-payment-tab.is-active {
    border-color: var(--ocean);
    background: var(--ocean-bg-08);
    color: var(--ocean-dark);
    box-shadow: inset 0 0 0 1px var(--border-ocean-14);
  }
  #k-modal .k-buybox-payment-detail {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    padding: 12px 14px;
    border-radius: 16px;
    background: var(--white);
    border: 1px solid var(--border);
    box-shadow: 0 8px 22px var(--border-text-06);
  }
  #k-modal .k-buybox-payment-check {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    border: 2px solid var(--ocean);
    position: relative;
  }
  #k-modal .k-buybox-payment-check::after {
    content: "";
    position: absolute;
    inset: 3px;
    border-radius: inherit;
    background: var(--ocean);
  }
  #k-modal .k-buybox-payment-icon { font-size: 18px; line-height: 1; }
  #k-modal .k-buybox-payment-copy { min-width: 0; }
  #k-modal .k-buybox-payment-copy strong {
    display: block;
    font-size: 14px;
    font-weight: 800;
    color: var(--text);
    line-height: 1.15;
  }
  #k-modal .k-buybox-payment-copy small {
    display: block;
    margin-top: 3px;
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #k-modal .k-buybox-payment-badge {
    font-size: 11px;
    font-weight: 800;
    padding: 4px 9px;
    border-radius: 8px;
    color: var(--violet-dark);
    background: var(--violet-light);
    border: 1px solid var(--violet-mid);
  }
  #k-modal .k-modal-trust {
    border-top: 0;
    margin-top: 12px;
    padding: 0;
    gap: 8px;
  }
  #k-modal .k-modal-trust-item {
    background: color-mix(in srgb, var(--sand) 76%, var(--white));
    border: 1px solid var(--border-text-06);
    min-height: 30px;
  }
  #k-modal .k-modal-share-row {
    border-top: 0;
    margin-top: 10px;
    padding-top: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: flex-start;
  }
  #k-modal .k-modal-share-row::before {
    content: 'Partager ce produit :';
    font-size: 12px;
    color: var(--text-muted);
    font-weight: 600;
  }
  #k-modal .k-modal-share-btn,
  #k-modal .k-modal-share-btn.k-modal-share-btn--wa {
    width: auto;
    min-height: 0;
    height: 30px;
    padding: 0 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--sand) 78%, var(--white));
    color: var(--text-muted);
    border: 1px solid var(--border-text-06);
    box-shadow: none;
    font-size: 12px;
    font-weight: 700;
  }
  #k-modal .k-modal-share-btn svg { width: 13px; height: 13px; }
  #k-modal .k-modal-share-btn.k-modal-share-btn--wa svg { fill: currentColor; }
  #k-modal .k-modal-details > .k-modal-inner-search { display: none !important; }
  #k-modal-suggestions.k-modal-suggestions--desktop-list {
    background: linear-gradient(180deg, var(--sand) 0%, var(--sand-warm) 100%);
    padding: 34px clamp(32px, 5vw, 72px) 56px;
  }
  #k-modal-suggestions.k-modal-suggestions--desktop-list .k-sug-title {
    border-bottom: 0;
    margin-bottom: 18px;
  }
  #k-modal-suggestions.k-modal-suggestions--desktop-list .k-sug-title-text {
    font-family: var(--font-display, var(--font));
    font-size: clamp(22px, 2vw, 30px);
    line-height: 1;
    letter-spacing: -.025em;
    color: var(--text);
  }
  #k-modal-suggestions.k-modal-suggestions--desktop-list .k-sug-grid,
  #k-modal-suggestions.k-modal-suggestions--desktop-list .k-sug-grid--same,
  #k-modal-suggestions.k-modal-suggestions--desktop-list .k-sug-grid--other {
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 18px;
  }
}
`;

  document.head.appendChild(style);
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

  const subtotal = document.querySelector('.k-modal-subtotal');
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
  const info = document.querySelector('#k-modal .k-modal-info');
  const delivery = document.getElementById('k-modal-delivery');
  const actions = document.querySelector('#k-modal .k-modal-actions');
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
  const actions = document.querySelector('#k-modal .k-modal-actions');
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
