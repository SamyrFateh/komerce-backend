/**
 * @module b-group-banner
 * @brief Bannière discrète permanente — rappel panier groupe en cours.
 *
 * Injectée sous le header, visible sur toutes les vues tant qu'un
 * panier partagé actif existe dans state.shareToken.
 *
 * Affiche :
 *   - Nom du panier (title)
 *   - Temps restant avant expiration
 *   - Lien → onglet Groupe
 *
 * Mise à jour :
 *   - À l'init (si token présent)
 *   - Toutes les 60s (countdown)
 *   - Sur events 'group:activated' / 'group:cleared'
 *
 * Aucun style inline — tout dans boutique-desktop.css + cart.css.
 */

import { state }   from './b-store.js';
import { sanitize } from './b-utils.js';

const BANNER_ID   = 'k-group-banner';
const TICK_MS     = 60_000; // mise à jour countdown toutes les 60s
let   _tickTimer  = null;

/* ── Calcul temps restant ──────────────────────────────────────── */
function timeRemaining(expiresAt) {
  if (!expiresAt) return null;
  const diffMs = new Date(expiresAt) - Date.now();
  if (diffMs <= 0) return 'expiré';
  const h = Math.floor(diffMs / 3_600_000);
  const m = Math.floor((diffMs % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)}j`;
  if (h >= 1)  return `${h}h${m > 0 ? m + 'min' : ''}`;
  return `${m}min`;
}

/* ── Rendu HTML ────────────────────────────────────────────────── */
function buildHTML(data) {
  const title     = sanitize(data.title || 'Panier groupe');
  const remaining = timeRemaining(data.expires_at);
  const urgency   = remaining && remaining !== 'expiré'
    && new Date(data.expires_at) - Date.now() < 2 * 3_600_000; // < 2h

  return `
    <div class="k-gbanner-inner ${urgency ? 'is-urgent' : ''}">
      <span class="k-gbanner-dot" aria-hidden="true"></span>
      <span class="k-gbanner-text">
        <strong>Panier groupe</strong> « ${title} »
        ${remaining ? `· <span class="k-gbanner-timer ${urgency ? 'is-urgent' : ''}">${remaining === 'expiré' ? '⚠️ expiré' : `expire dans ${remaining}`}</span>` : ''}
      </span>
      <button class="k-gbanner-cta" id="k-gbanner-cta" type="button">
        Voir le suivi →
      </button>
      <button class="k-gbanner-close" id="k-gbanner-close" type="button" aria-label="Fermer">✕</button>
    </div>`;
}

/* ── Injection DOM ─────────────────────────────────────────────── */
function getOrCreateBanner() {
  let el = document.getElementById(BANNER_ID);
  if (!el) {
    el = document.createElement('div');
    el.id        = BANNER_ID;
    el.className = 'k-group-banner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    // Injecter juste après le header
    const header = document.getElementById('k-header') || document.querySelector('header');
    if (header) {
      header.insertAdjacentElement('afterend', el);
    } else {
      document.body.prepend(el);
    }
  }
  return el;
}

/* ── Bind actions ──────────────────────────────────────────────── */
function bindBanner(el) {
  el.querySelector('#k-gbanner-cta')?.addEventListener('click', () => {
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
    // Fermeture temporaire (session) — ne supprime pas le state
    el.classList.remove('show');
    stopTick();
    try { sessionStorage.setItem('kmrc_banner_dismissed', '1'); } catch (_) {}
  });
}

/* ── Tick ──────────────────────────────────────────────────────── */
function startTick(el, data) {
  stopTick();
  _tickTimer = setInterval(() => {
    const inner = el.querySelector('.k-gbanner-inner');
    if (inner) inner.outerHTML = buildHTML(data).trim().replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '');
    // Re-build complet si expiré
    const remaining = timeRemaining(data.expires_at);
    if (remaining === 'expiré') { stopTick(); hideBanner(); }
  }, TICK_MS);
}

function stopTick() {
  if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
}

/* ── API publique ──────────────────────────────────────────────── */

export function showBanner(data) {
  // data = { title, expires_at }
  if (!data || !state.shareToken) return;
  // Respect fermeture volontaire (session)
  try {
    if (sessionStorage.getItem('kmrc_banner_dismissed') === '1') return;
  } catch (_) {}

  const el = getOrCreateBanner();
  el.innerHTML = buildHTML(data);
  el.classList.add('show');
  bindBanner(el);
  startTick(el, data);
}

export function hideBanner() {
  stopTick();
  const el = document.getElementById(BANNER_ID);
  if (el) el.classList.remove('show');
}

export function refreshBanner() {
  if (!state.shareToken) { hideBanner(); return; }
  // Recharger les données depuis le backend
  fetch(`/api/shared-carts/public/${state.shareToken}`, { credentials: 'include' })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data?.cart) {
        state.shareExpiry = data.cart.expires_at;
        showBanner({ title: data.cart.title, expires_at: data.cart.expires_at });
      } else {
        hideBanner();
      }
    })
    .catch(() => {}); // best-effort
}
