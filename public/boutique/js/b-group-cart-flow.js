/**
 * @module b-group-cart-flow
 * @brief Flux ultra court pour créer un panier collectif.
 *
 * Panier → Payer à plusieurs → lien prêt → copier / WhatsApp.
 */

import { state } from './b-store.js';
import { cartQty, cartTotal, showToast } from './b-cart-core.js';
import { apiPost, fmt } from './b-utils.js';

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

function loading() {
  shell('<div class="k-group-flow-loading"><span class="k-group-flow-spin"></span><span>Création du lien…</span></div>');
}

function shareUrlWhatsApp(url) {
  const text = 'Voici le panier Komerce à payer ensemble 👥 ' + url;
  return 'https://wa.me/?text=' + encodeURIComponent(text);
}

async function copyLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    showToast('Lien copié', 'success');
  } catch (_) {
    showToast('Copie impossible', 'error');
  }
}

function ready(url) {
  const qty = cartQty();
  const total = cartTotal();
  shell(`
    <div class="k-group-flow-hero">
      <div class="k-group-flow-icon">✅</div>
      <p class="k-group-flow-big">Groupe prêt</p>
      <p class="k-group-flow-sub">Envoyez le lien. Chacun paie sa part.</p>
    </div>
    <div class="k-group-flow-stats">
      <div class="k-group-flow-stat"><b>${qty}</b><span>articles</span></div>
      <div class="k-group-flow-stat"><b>${fmt(total, 'KMF')}</b><span>panier</span></div>
      <div class="k-group-flow-stat"><b>👥</b><span>partage</span></div>
    </div>
    <div class="k-group-flow-link"><span>${url}</span></div>
    <div class="k-group-flow-actions">
      <button type="button" class="k-group-flow-btn k-group-flow-btn--primary" data-group-copy>Copier</button>
      <button type="button" class="k-group-flow-btn k-group-flow-btn--wa" data-group-wa>WhatsApp</button>
      <button type="button" class="k-group-flow-btn k-group-flow-btn--ghost" data-group-flow-close>Voir mon panier</button>
    </div>`);

  const ov = document.getElementById('k-group-flow-overlay');
  ov?.querySelector('[data-group-copy]')?.addEventListener('click', () => copyLink(url));
  ov?.querySelector('[data-group-wa]')?.addEventListener('click', () => {
    window.open(shareUrlWhatsApp(url), '_blank', 'noopener');
  });
}

function fallbackUrl() {
  const items = state.cart.map(item => item.product.id + ':' + item.qty).join(',');
  return window.location.origin + '/Komerce_Boutique.html?cart=' + encodeURIComponent(items);
}

async function createGroupCart() {
  if (!state.cart.length) {
    showToast('Panier vide', 'error');
    return;
  }

  loading();

  const payload = {
    cart_items: state.cart.map(item => ({
      product_id: item.product.id,
      qty: item.qty,
      price_kmf: item.product.promo_price_kmf || item.product.price_kmf || 0
    })),
    type: 'event',
    event_label: 'Panier collectif',
    sharer_name: null
  };

  let url;
  try {
    const res = await apiPost('/api/shares', payload);
    url = res?.url || res?.share_url;
  } catch (err) {
    console.warn('[group-cart-flow] API share indisponible, fallback local', err);
  }

  if (!url) url = fallbackUrl();

  window.dispatchEvent(new CustomEvent('kmrc:group-cart-created', {
    detail: { label: 'Panier collectif', url }
  }));

  ready(url);
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

  createGroupCart();
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
