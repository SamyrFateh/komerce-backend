/**
 * @komerce-arch
 * @role          shared-cart-status-banner
 * @domain        shared-cart
 * @layer         ui-component
 * @criticality   medium
 * @inputs        shared_cart_state, expiry, contribution_state
 * @outputs       banner_visibility, banner_content, group_shortcut
 * @depends       b-store.js, b-utils.js
 * @used-by       b-share-cart.js, b-group-view.js, boutique.js
 * @doctrine      suivi_panier_visible, panier_ouvert_ferme, participant_peut_verifier
 * @impact-areas  shared-cart, participant-flow, creator-flow, navigation
 * @version       2026-06
 */

/**
 * @module b-group-banner
 * @brief Bannière permanente — rappel panier groupe en cours.
 *
 * P0 UX/state — Mai 2026 :
 *   - active/partially_funded : résumé discret avec pourcentage.
 *   - fully_funded : signal fort "Financé ! Validez".
 *   - expiration < 2h : urgence ambre.
 *   - statuts fermés : bannière masquée.
 *   - auto-collapse : visible au boot, puis compacte pour ne pas polluer l'UX.
 */

import { state } from './b-store.js';
import { sanitize } from './b-utils.js';

const BANNER_ID = 'k-group-banner';
const TICK_MS = 60_000;
const AUTO_COLLAPSE_MS = 12_000;
let _tickTimer = null;
let _collapseTimer = null;

function r(n) { return Math.round(Number(n) || 0); }

function pct(contributed, total) {
  const t = r(total);
  if (!t) return 0;
  return Math.max(0, Math.min(100, Math.round((r(contributed) / t) * 100)));
}

function timeRemaining(expiresAt) {
  if (!expiresAt) return null;
  const diffMs = new Date(expiresAt) - Date.now();
  if (diffMs <= 0) return 'expiré';
  const h = Math.floor(diffMs / 3_600_000);
  const m = Math.floor((diffMs % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)}j`;
  if (h >= 1) return `${h}h${m > 0 ? m + 'min' : ''}`;
  return `${Math.max(1, m)}min`;
}

function isClosedStatus(status) {
  return ['converted_to_order', 'finalized', 'cancelled', 'expired', 'refunded'].includes(status);
}

// ensureStyles() supprimé (L3-S8) — CSS géré par group-cart-flow.css
function ensureStyles() {}

function buildHTML(data) {
  const status = data.status || state.shareStatus || 'active';
  const title = sanitize(data.title || state.cartName || 'Panier groupe');
  const expiresAt = data.expires_at || state.shareExpiry;
  const remaining = timeRemaining(expiresAt);
  const total = data.total_kmf_snapshot ?? state.shareTotalKmf;
  const contributed = data.contributed_kmf ?? state.shareContributedKmf;
  const p = pct(contributed, total);
  const funded = status === 'fully_funded' || (r(total) > 0 && p >= 100);
  const urgent = !funded && remaining && remaining !== 'expiré'
    && new Date(expiresAt) - Date.now() < 2 * 3_600_000;

  const mainText = funded
    ? `✅ <strong>${title}</strong> · Financé !`
    : `<strong>Panier groupe</strong> « ${title} » · ${p}%`;

  const timerText = remaining
    ? remaining === 'expiré'
      ? '⚠️ expiré'
      : `expire dans ${remaining}`
    : '';

  return `
    <div class="k-gbanner-inner ${funded ? 'is-funded' : ''} ${urgent ? 'is-urgent' : ''}">
      <span class="k-gbanner-dot" aria-hidden="true"></span>
      <span class="k-gbanner-text">
        ${mainText}
        ${timerText ? `· <span class="k-gbanner-timer ${urgent ? 'is-urgent' : ''}">${timerText}</span>` : ''}
      </span>
      <button class="k-gbanner-cta ${funded ? 'is-funded' : ''}" id="k-gbanner-cta" type="button">
        ${funded ? 'Validez →' : 'Voir le suivi →'}
      </button>
      <button class="k-gbanner-close" id="k-gbanner-close" type="button" aria-label="Fermer">✕</button>
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

function bindBanner(el) {
  el.querySelector('#k-gbanner-cta')?.addEventListener('click', () => {
    expandBanner(el);
    import('./b-nav.js').then(({ switchView }) => {
      import('./b-group-view.js').then(({ renderGroupView }) => {
        document.querySelectorAll('.k-bnav-item, .k-header-nav-btn').forEach(i => {
          i.classList.toggle('active', i.dataset.tab === 'group');
        });
        renderGroupView();
        switchView('group');
      });
    });
  });

  el.querySelector('#k-gbanner-close')?.addEventListener('click', () => {
    el.classList.remove('show');
    stopTimers();
    try { sessionStorage.setItem('kmrc_banner_dismissed', '1'); } catch (_) {}
  });

  el.addEventListener('mouseenter', () => expandBanner(el), { once: false });
  el.addEventListener('focusin', () => expandBanner(el), { once: false });
}

function expandBanner(el) {
  el.classList.remove('is-compact');
  scheduleCollapse(el);
}

function shouldAutoCollapse(data) {
  const status = data.status || state.shareStatus || 'active';
  const expiresAt = data.expires_at || state.shareExpiry;
  const funded = status === 'fully_funded';
  const urgent = expiresAt && new Date(expiresAt) - Date.now() < 2 * 3_600_000;
  return !funded && !urgent;
}

function scheduleCollapse(el, data = {}) {
  if (_collapseTimer) clearTimeout(_collapseTimer);
  if (!shouldAutoCollapse(data)) return;
  _collapseTimer = setTimeout(() => {
    el.classList.add('is-compact');
  }, AUTO_COLLAPSE_MS);
}

function startTick(el, data) {
  if (_tickTimer) clearInterval(_tickTimer);
  _tickTimer = setInterval(() => {
    const remaining = timeRemaining(data.expires_at || state.shareExpiry);
    if (remaining === 'expiré') { hideBanner(); return; }
    const wasCompact = el.classList.contains('is-compact');
    el.innerHTML = buildHTML(data);
    bindBanner(el);
    if (wasCompact && shouldAutoCollapse(data)) el.classList.add('is-compact');
  }, TICK_MS);
}

function stopTimers() {
  if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
  if (_collapseTimer) { clearTimeout(_collapseTimer); _collapseTimer = null; }
}

export function showBanner(data) {
  // Doctrine cockpit Groupe — mai 2026 :
  // la bannière globale panier groupe est supprimée pour éviter de polluer la boutique.
  // L'information active vit désormais dans l'onglet Groupe + badge header.
  hideBanner();
  return;
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
      if (!data?.cart) {
        hideBanner();
        // FIX — le panier n'existe plus en DB (supprimé ou expiré) :
        // purger le sessionStorage pour ne pas réafficher la bannière au prochain boot.
        try {
          sessionStorage.removeItem('kmrc_share');
          sessionStorage.removeItem('kmrc_banner_dismissed');
        } catch (_) {}
        return;
      }
      state.shareExpiry = data.cart.expires_at;
      state.shareStatus = data.cart.status;
      state.shareTotalKmf = r(data.cart.total_kmf_snapshot);
      state.shareContributedKmf = r(data.cart.contributed_kmf);
      state.shareRemainingKmf = r(data.cart.remaining_kmf);
      showBanner({
        title: data.cart.title,
        expires_at: data.cart.expires_at,
        status: data.cart.status,
        contributed_kmf: data.cart.contributed_kmf,
        total_kmf_snapshot: data.cart.total_kmf_snapshot,
      });
    })
    .catch(() => {});
}
