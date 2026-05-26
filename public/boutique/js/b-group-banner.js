/**
 * @module b-group-banner
 * @brief Bannière temporaire — rappel léger du panier groupe.
 *
 * Doctrine v4 — Mai 2026 :
 *   - la bannière ne porte pas le suivi ;
 *   - elle affiche seulement le nom de l’événement / panier partagé ;
 *   - elle disparaît automatiquement après 1 minute ;
 *   - le vrai suivi reste dans l’onglet Groupe.
 */

import { state } from './b-store.js';
import { sanitize } from './b-utils.js';

const BANNER_ID = 'k-group-banner';
const AUTO_HIDE_MS = 60_000;
let _hideTimer = null;

function r(n) { return Math.round(Number(n) || 0); }

function isClosedStatus(status) {
  return ['converted_to_order', 'finalized', 'cancelled', 'expired', 'refunded'].includes(status);
}

function ensureStyles() {
  if (document.getElementById('k-group-banner-v4-styles')) return;
  const s = document.createElement('style');
  s.id = 'k-group-banner-v4-styles';
  s.textContent = `
.k-group-banner .k-gbanner-inner{display:flex;align-items:center;gap:9px;transition:opacity .22s ease,transform .22s ease}
.k-group-banner .k-gbanner-text{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k-group-banner .k-gbanner-dot{flex:0 0 auto}`;
  document.head.appendChild(s);
}

function buildHTML(data = {}) {
  const title = sanitize(data.title || state.cartName || 'Panier groupe');
  return `
    <div class="k-gbanner-inner">
      <span class="k-gbanner-dot" aria-hidden="true"></span>
      <span class="k-gbanner-text"><strong>${title}</strong></span>
    </div>`;
}

function getOrCreateBanner() {
  let el = document.getElementById(BANNER_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = BANNER_ID;
    el.className = 'k-group-banner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    const header = document.getElementById('k-header') || document.querySelector('header');
    if (header) header.insertAdjacentElement('afterend', el);
    else document.body.prepend(el);
  }
  return el;
}

function stopTimers() {
  if (_hideTimer) {
    clearTimeout(_hideTimer);
    _hideTimer = null;
  }
}

function markDismissedForSession() {
  try { sessionStorage.setItem('kmrc_banner_dismissed', '1'); } catch (_) {}
}

export function showBanner(data) {
  if (!data || !state.shareToken) return;
  const status = data.status || state.shareStatus;
  if (isClosedStatus(status)) { hideBanner(); return; }

  try {
    if (sessionStorage.getItem('kmrc_banner_dismissed') === '1') return;
  } catch (_) {}

  ensureStyles();
  const el = getOrCreateBanner();
  el.innerHTML = buildHTML(data);
  el.classList.add('show');
  el.classList.remove('is-compact');

  stopTimers();
  _hideTimer = setTimeout(() => {
    markDismissedForSession();
    hideBanner();
  }, AUTO_HIDE_MS);
}

export function hideBanner() {
  stopTimers();
  const el = document.getElementById(BANNER_ID);
  if (el) el.classList.remove('show', 'is-compact');
}

export function refreshBanner() {
  if (!state.shareToken) { hideBanner(); return; }
  fetch(`/api/shared-carts/public/${state.shareToken}`, { credentials: 'include' })
    .then(rsp => rsp.ok ? rsp.json() : null)
    .then(data => {
      if (!data?.cart) { hideBanner(); return; }
      state.shareExpiry = data.cart.expires_at;
      state.shareStatus = data.cart.status;
      state.shareTotalKmf = r(data.cart.total_kmf_snapshot);
      state.shareContributedKmf = r(data.cart.contributed_kmf);
      state.shareRemainingKmf = r(data.cart.remaining_kmf);
      showBanner({
        title: data.cart.title,
        status: data.cart.status,
      });
    })
    .catch(() => {});
}
