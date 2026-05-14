/**
 * @module b-group-cart-flow
 * @brief Flux ultra court pour lancer un panier partagé.
 *
 * Panier → Payer à plusieurs → formulaire collectif public préchargé.
 */

import { state } from './b-store.js';
import { cartQty, cartTotal, showToast } from './b-cart-core.js';
import { fmt } from './b-utils.js';

let installed = false;
let lastClickAt = 0;

function ensureCss() {
  if (document.getElementById('kmrc-group-cart-flow-css')) return;
  const link = document.createElement('link');
  link.id = 'kmrc-group-cart-flow-css';
  link.rel = 'stylesheet';
  link.href = '/boutique/css/group-cart-flow.css?v=1';
  document.head.appendChild(link);
}

function closeFlow() {
  document.getElementById('k-group-flow-overlay')?.remove();
}

function shell(inner) {
  closeFlow();
  const ov = document.createElement('div');
  ov.id = 'k-group-flow-overlay';
  ov.className = 'k-group-flow-overlay';
  ov.innerHTML = `
    <div class="k-group-flow-sheet" role="dialog" aria-modal="true">
      <div class="k-group-flow-head">
        <p class="k-group-flow-title">Payer à plusieurs</p>
        <button type="button" class="k-group-flow-close" data-group-flow-close>×</button>
      </div>
      ${inner}
    </div>`;
  document.body.appendChild(ov);
}

function savePendingCartForEvent() {
  const items = state.cart.map(item => {
    const product = item.product || item;
    return {
      product_id: product.id || item.id,
      quantity: Number(item.qty) || 1,
      qty: Number(item.qty) || 1,
      name: product.name || item.name || 'Article',
      price_kmf: product.promo_price_kmf || product.price_kmf || item.price || 0,
      image_url: product.image_url || product.image || null
    };
  }).filter(item => item.product_id);

  sessionStorage.setItem('komerce_event_pending_cart', JSON.stringify(items));
  return items;
}

function openEventCreateForm() {
  if (!state.cart.length) {
    showToast('Panier vide', 'error');
    return;
  }

  const items = savePendingCartForEvent();
  if (!items.length) {
    showToast('Aucun article valide dans le panier', 'error');
    return;
  }

  const qty = cartQty();
  const total = cartTotal();

  shell(`
    <div class="k-group-flow-hero">
      <div class="k-group-flow-icon">👥</div>
      <p class="k-group-flow-big">Créer le panier partagé</p>
      <p class="k-group-flow-sub">On va ouvrir le vrai formulaire collectif avec votre panier préchargé.</p>
    </div>
    <div class="k-group-flow-stats">
      <div class="k-group-flow-stat"><b>${qty}</b><span>articles</span></div>
      <div class="k-group-flow-stat"><b>${fmt(total, 'KMF')}</b><span>panier</span></div>
      <div class="k-group-flow-stat"><b>🔗</b><span>lien public</span></div>
    </div>
    <div class="k-group-flow-actions">
      <button type="button" class="k-group-flow-btn k-group-flow-btn--primary" data-group-open-form>Continuer</button>
      <button type="button" class="k-group-flow-btn k-group-flow-btn--ghost" data-group-flow-close>Annuler</button>
    </div>`);

  const ov = document.getElementById('k-group-flow-overlay');
  ov?.querySelector('[data-group-open-form]')?.addEventListener('click', () => {
    window.location.href = '/boutique/event/create.html?from=cart';
  });
}

function shouldIntercept(target) {
  return Boolean(target.closest('#k-cart-event-btn, .k-cart-event-btn, #k-sc-group, .k-sc-btn-group'));
}

function onClick(e) {
  if (!shouldIntercept(e.target)) return;

  const now = Date.now();
  if (now - lastClickAt < 500) return;
  lastClickAt = now;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation?.();

  openEventCreateForm();
}

export function setupGroupCartFlow() {
  if (installed) return;
  installed = true;
  ensureCss();
  document.addEventListener('click', onClick, true);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-group-flow-close]')) closeFlow();
    if (e.target.id === 'k-group-flow-overlay') closeFlow();
  });
}
