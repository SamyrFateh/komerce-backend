/**
 * @module b-share-cart
 * @brief Flow "Payer en groupe" — côté créateur.
 *
 * Doctrine boutique-first — Mai 2026 :
 *   - un panier partagé actif n'empêche pas d'en créer un autre.
 *   - /mine restaure le dernier panier actif seulement comme raccourci de suivi.
 *   - "Voir le groupe" = consulter le panier actif, pas verrouiller le panier courant.
 *   - le backend reste source de vérité pour la limite de paniers actifs.
 */

import { state } from './b-store.js';
import { showToast } from './b-cart-core.js';
import { refreshGroupBadge } from './b-group-view.js';
import { showBanner, hideBanner, refreshBanner } from './b-group-banner.js';

const API_CREATE = '/api/shared-carts/from-cart-items';
const API_MINE = '/api/shared-carts/mine';
const ACTIVE_STATUSES = new Set(['active', 'partially_funded', 'fully_funded']);

/* ── Helpers ───────────────────────────────────────────────────── */
function r(n) { return Math.round(Number(n) || 0); }

function pct(contributed, total) {
  const t = r(total);
  if (!t) return 0;
  return Math.max(0, Math.min(100, Math.round((r(contributed) / t) * 100)));
}

function timeRemaining(expiresAt) {
  if (!expiresAt) return 'actif';
  const diffMs = new Date(expiresAt) - Date.now();
  if (diffMs <= 0) return 'expiré';
  const h = Math.floor(diffMs / 3_600_000);
  const m = Math.floor((diffMs % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)}j restants`;
  if (h >= 1) return `${h}h${m > 0 ? m + 'min' : ''} restantes`;
  return `${Math.max(1, m)}min restantes`;
}

function isActiveCart(cart) {
  return cart && ACTIVE_STATUSES.has(cart.status) && (!cart.expires_at || new Date(cart.expires_at) > new Date());
}

function pickActiveCart(carts = []) {
  return [...carts]
    .filter(isActiveCart)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null;
}

function applyCartToState(cart) {
  if (!cart) return null;
  state.shareToken = cart.token || null;
  state.shareId = cart.id || null;
  state.shareExpiry = cart.expires_at || null;
  state.cartName = cart.title || 'Panier groupe';
  state.shareStatus = cart.status || null;
  state.shareTotalKmf = r(cart.total_kmf_snapshot);
  state.shareContributedKmf = r(cart.contributed_kmf);
  state.shareRemainingKmf = r(cart.remaining_kmf);
  state.shareUrl = cart.share_url || (cart.token ? `${window.location.origin}/cart/shared/${cart.token}` : null);
  saveShareState();
  return cart;
}

/* ── Persistance session : cache uniquement ─────────────────────── */
function loadShareState() {
  try {
    const raw = sessionStorage.getItem('kmrc_share');
    if (!raw) return;
    const s = JSON.parse(raw);
    state.shareToken = s.token || null;
    state.shareId = s.id || null;
    state.shareExpiry = s.expiry || null;
    state.cartName = s.name || '';
    state.shareStatus = s.status || null;
    state.shareTotalKmf = r(s.total_kmf);
    state.shareContributedKmf = r(s.contributed_kmf);
    state.shareRemainingKmf = r(s.remaining_kmf);
    state.shareUrl = s.share_url || null;
  } catch (_) {}
}

function saveShareState() {
  try {
    sessionStorage.setItem('kmrc_share', JSON.stringify({
      token: state.shareToken,
      id: state.shareId,
      expiry: state.shareExpiry,
      name: state.cartName,
      status: state.shareStatus,
      total_kmf: state.shareTotalKmf,
      contributed_kmf: state.shareContributedKmf,
      remaining_kmf: state.shareRemainingKmf,
      share_url: state.shareUrl,
    }));
  } catch (_) {}
}

function clearLocalShareState() {
  state.shareToken = null;
  state.shareId = null;
  state.shareExpiry = null;
  state.cartName = '';
  state.shareStatus = null;
  state.shareTotalKmf = 0;
  state.shareContributedKmf = 0;
  state.shareRemainingKmf = 0;
  state.shareUrl = null;
  try {
    sessionStorage.removeItem('kmrc_share');
    sessionStorage.removeItem('kmrc_banner_dismissed');
  } catch (_) {}
}

export function clearShareState() {
  clearLocalShareState();
  refreshGroupBadge();
  hideBanner();
  refreshSharedBadges(false);
}

/* ── Restauration backend : source de vérité P0 ─────────────────── */
export async function restoreSharedCartFromBackend({ silent = true } = {}) {
  try {
    const res = await fetch(API_MINE, { credentials: 'include' });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return null;
      throw new Error(`GET /mine ${res.status}`);
    }
    const data = await res.json().catch(() => ({}));
    const cart = pickActiveCart(data.carts || []);

    if (!cart) {
      clearLocalShareState();
      refreshSharedBadges(false);
      hideBanner();
      refreshGroupBadge();
      return null;
    }

    applyCartToState(cart);
    refreshSharedBadges(true, cart);
    refreshGroupBadge();
    showBanner({
      title: cart.title,
      expires_at: cart.expires_at,
      status: cart.status,
      contributed_kmf: cart.contributed_kmf,
      total_kmf_snapshot: cart.total_kmf_snapshot,
    });
    return cart;
  } catch (err) {
    if (!silent) showToast(`Panier groupe non restauré : ${err.message}`, 'error');
    return null;
  }
}

/* ── Détection session ──────────────────────────────────────────── */
function isConnected() {
  return window.K?.isConnected?.() || false;
}

/* ── Sidebar / badges ───────────────────────────────────────────── */
function ensureSidebarStyles() {
  if (document.getElementById('k-share-sidebar-p0-styles')) return;
  const s = document.createElement('style');
  s.id = 'k-share-sidebar-p0-styles';
  s.textContent = `
.k-sc-shared-badge{padding:10px 12px;border:1px solid rgba(31,122,84,.18);border-radius:14px;background:rgba(31,122,84,.07);margin-top:10px}
.k-sc-shared-summary{display:flex;gap:9px;align-items:flex-start;margin-bottom:9px;min-width:0}
.k-sc-shared-dot{width:9px;height:9px;border-radius:999px;background:#1f7a54;box-shadow:0 0 0 4px rgba(31,122,84,.10);margin-top:5px;flex:0 0 auto}
.k-sc-shared-text{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.k-sc-shared-text strong{font-size:13px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.k-sc-shared-text span{font-size:12px;color:var(--text-muted);margin-top:2px}
.k-sc-shared-badge.is-funded{background:rgba(31,122,84,.12);border-color:rgba(31,122,84,.30)}
.k-sc-shared-badge.is-urgent{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.34)}
.k-sc-group-view-btn{width:100%;border:none;border-radius:999px;padding:9px 12px;background:var(--text);color:var(--white);font-weight:800;font-size:13px;cursor:pointer}
.k-sc-group-view-btn:hover{transform:translateY(-1px)}
.k-sc-reshare-btn{display:none!important}`;
  document.head.appendChild(s);
}

function renderSidebarSummary(cart = {}) {
  const desktopBadge = document.getElementById('k-sc-shared-badge');
  if (!desktopBadge) return;
  ensureSidebarStyles();

  const title = cart.title || state.cartName || 'Panier groupe';
  const status = cart.status || state.shareStatus;
  const total = cart.total_kmf_snapshot ?? state.shareTotalKmf;
  const contributed = cart.contributed_kmf ?? state.shareContributedKmf;
  const p = pct(contributed, total);
  const remaining = timeRemaining(cart.expires_at || state.shareExpiry);
  const urgent = (cart.expires_at || state.shareExpiry) && new Date(cart.expires_at || state.shareExpiry) - Date.now() < 2 * 3_600_000;

  desktopBadge.classList.toggle('is-funded', status === 'fully_funded');
  desktopBadge.classList.toggle('is-urgent', !!urgent && status !== 'fully_funded');
  desktopBadge.innerHTML = `
    <div class="k-sc-shared-summary">
      <span class="k-sc-shared-dot" aria-hidden="true"></span>
      <div class="k-sc-shared-text">
        <strong id="k-sc-shared-title">${title}</strong>
        <span id="k-sc-shared-meta">${status === 'fully_funded' ? 'Financé !' : `${p}% · ${remaining}`}</span>
      </div>
    </div>
    <button id="k-sc-group-view" class="k-sc-group-view-btn" type="button">Voir le suivi →</button>`;

  desktopBadge.querySelector('#k-sc-group-view')?.addEventListener('click', switchToGroup);
}

export function refreshSharedBadges(isShared, cart = null) {
  const mobileBadge = document.getElementById('k-share-badge-row');
  const mobileShare = document.getElementById('k-cart-share');
  if (mobileBadge) mobileBadge.hidden = !isShared;
  if (mobileShare) mobileShare.textContent = isShared ? 'Groupe actif' : 'Payer en groupe';

  const desktopBadge = document.getElementById('k-sc-shared-badge');
  const desktopShare = document.getElementById('k-sc-share');
  if (desktopBadge) desktopBadge.hidden = !isShared;
  if (desktopShare) {
    desktopShare.hidden = false;
    desktopShare.textContent = isShared ? 'Nouveau groupe' : 'Payer en groupe';
  }
  if (isShared) renderSidebarSummary(cart || {});

  refreshGroupBadge();
}

/* ── Modal générique ────────────────────────────────────────────── */
function ensureStyles() {
  if (document.getElementById('k-share-modal-styles')) return;
  const s = document.createElement('style');
  s.id = 'k-share-modal-styles';
  s.textContent = `
.k-share-modal-overlay{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.45);
  display:flex;align-items:flex-end;justify-content:center;animation:kSMFadeIn .2s ease}
@keyframes kSMFadeIn{from{opacity:0}to{opacity:1}}
@media(min-width:600px){.k-share-modal-overlay{align-items:center}}
.k-share-modal-sheet{background:var(--white);border-radius:20px 20px 0 0;
  padding:28px 20px calc(32px + env(safe-area-inset-bottom));width:100%;max-width:420px;
  animation:kSMSlideUp .28s var(--ease)}
@media(min-width:600px){.k-share-modal-sheet{border-radius:16px;padding-bottom:28px}}
@keyframes kSMSlideUp{from{transform:translateY(48px);opacity:0}to{transform:none;opacity:1}}
.k-sm-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
.k-sm-title{font-size:17px;font-weight:800;color:var(--text)}
.k-sm-close{width:32px;height:32px;border:none;background:var(--sand);border-radius:50%;
  font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-muted)}
.k-sm-close:hover{background:var(--sand-dark)}
.k-sm-label{display:block;font-size:12px;font-weight:600;color:var(--text-muted);
  margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em}
.k-sm-input{width:100%;padding:11px 14px;border:2px solid var(--border);border-radius:var(--radius-sm);
  font-size:15px;font-family:var(--font);color:var(--text);background:var(--white);
  outline:none;box-sizing:border-box;transition:border-color .2s}
.k-sm-input:focus{border-color:var(--violet)}
.k-sm-field{margin-bottom:12px}
.k-sm-hint{font-size:12px;color:var(--text-muted);margin-bottom:14px;line-height:1.5}
.k-sm-err{font-size:12px;color:var(--red-danger-text);min-height:18px;margin-top:4px}
.k-sm-btn{width:100%;padding:14px;margin-top:14px;background:var(--violet);color:var(--white);
  border:none;border-radius:50px;font-size:15px;font-weight:700;font-family:var(--font);cursor:pointer;transition:all .15s}
.k-sm-btn:hover{background:var(--violet-dark);transform:translateY(-1px)}
.k-sm-btn:disabled{background:var(--sand-dark);color:var(--text-light);cursor:not-allowed;transform:none}
.k-sm-choice{display:flex;flex-direction:column;gap:10px;margin-top:12px}
.k-sm-btn-secondary{background:var(--sand);color:var(--text)}
.k-sm-btn-secondary:hover{background:var(--sand-dark)}
.k-sm-btn-ghost{background:transparent;color:var(--text-muted);border:1px solid var(--border)}
.k-sm-btn-ghost:hover{background:var(--sand);color:var(--text)}}`;
  document.head.appendChild(s);
}

function openModal(content) {
  ensureStyles();
  const ov = document.createElement('div');
  ov.className = 'k-share-modal-overlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.innerHTML = `<div class="k-share-modal-sheet">${content}</div>`;
  ov.addEventListener('click', e => { if (e.target === ov) closeModal(ov); });
  document.body.appendChild(ov);
  return ov;
}

function closeModal(ov) {
  ov.style.animation = 'kSMFadeIn .15s ease reverse';
  setTimeout(() => ov.remove(), 150);
}

function promptExistingCartChoice() {
  return new Promise(resolve => {
    const ov = openModal(`
      <div class="k-sm-head">
        <span class="k-sm-title">👥 Panier groupe actif</span>
        <button class="k-sm-close" aria-label="Fermer">✕</button>
      </div>
      <p class="k-sm-hint">Vous avez déjà un panier partagé en cours. Vous pouvez le suivre, ou créer un nouveau panier partagé avec le panier actuel.</p>
      <div class="k-sm-choice">
        <button class="k-sm-btn" id="k-sm-view-group">Voir le groupe actif</button>
        <button class="k-sm-btn k-sm-btn-secondary" id="k-sm-create-new">Créer un nouveau groupe</button>
        <button class="k-sm-btn k-sm-btn-ghost" id="k-sm-cancel-choice">Annuler</button>
      </div>`);

    ov.querySelector('#k-sm-view-group')?.addEventListener('click', () => { closeModal(ov); resolve('view'); });
    ov.querySelector('#k-sm-create-new')?.addEventListener('click', () => { closeModal(ov); resolve('create'); });
    ov.querySelector('#k-sm-cancel-choice')?.addEventListener('click', () => { closeModal(ov); resolve(null); });
    ov.querySelector('.k-sm-close')?.addEventListener('click', () => { closeModal(ov); resolve(null); });
  });
}

/* ── Étape A : formulaire init ──────────────────────────────────── */
function promptInit(needsAuth) {
  return new Promise(resolve => {
    const ov = openModal(`
      <div class="k-sm-head">
        <span class="k-sm-title">🛒 Payer en groupe</span>
        <button class="k-sm-close" aria-label="Fermer">✕</button>
      </div>
      <p class="k-sm-hint">Créez un panier collectif et partagez le lien par WhatsApp. Chacun contribue librement, jusqu'au total du panier.</p>
      <div class="k-sm-field">
        <label class="k-sm-label" for="k-sm-title-f">Nom du panier (optionnel)</label>
        <input id="k-sm-title-f" class="k-sm-input" type="text"
          placeholder="Ex : Cadeau mariage Aïcha" maxlength="80" autocomplete="off">
      </div>
      ${needsAuth ? `
      <div class="k-sm-field">
        <label class="k-sm-label" for="k-sm-name-f">Votre prénom</label>
        <input id="k-sm-name-f" class="k-sm-input" type="text" placeholder="Ex : Fatima" maxlength="60" autocomplete="given-name">
      </div>
      <div class="k-sm-field">
        <label class="k-sm-label" for="k-sm-phone-f">Votre numéro WhatsApp</label>
        <input id="k-sm-phone-f" class="k-sm-input" type="tel" placeholder="+269… ou +33…" maxlength="20" autocomplete="tel">
      </div>` : ''}
      <p class="k-sm-err" id="k-sm-err"></p>
      <button class="k-sm-btn" id="k-sm-submit">Créer le panier →</button>`);

    const errEl = ov.querySelector('#k-sm-err');
    const btn = ov.querySelector('#k-sm-submit');

    btn.addEventListener('click', () => {
      const title = (ov.querySelector('#k-sm-title-f')?.value || '').trim();
      const name = (ov.querySelector('#k-sm-name-f')?.value || '').trim();
      const phone = (ov.querySelector('#k-sm-phone-f')?.value || '').trim();

      if (needsAuth) {
        if (!name) { errEl.textContent = 'Prénom requis.'; return; }
        if (!phone || !/^\+?[\d\s\-]{8,20}$/.test(phone)) {
          errEl.textContent = 'Numéro invalide (ex: +26932…)'; return;
        }
      }
      closeModal(ov);
      resolve({ title, name, phone });
    });

    ov.querySelector('.k-sm-close').addEventListener('click', () => { closeModal(ov); resolve(null); });
    ov.querySelector('#k-sm-title-f')?.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
  });
}

/* ── Étape B : appel API ────────────────────────────────────────── */
async function createSharedCart(opts) {
  const cartItems = state.cart
    .map(it => ({ product_id: it.product?.id || it.id, quantity: Number(it.qty) || 1 }))
    .filter(it => it.product_id);

  const body = { cart_items: cartItems };
  if (opts.title) body.title = opts.title;
  if (opts.phone) body.tracking_phone = opts.phone;
  if (opts.name) body.recipient_name = opts.name;

  const res = await fetch(API_CREATE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Erreur API (${res.status})`);
  }
  return res.json();
}

/* ── Étape C : WhatsApp + switch groupe ─────────────────────────── */
function openWhatsApp(title, shareUrl) {
  const msg = `Salut ! J'ai créé un panier commun sur Komerce : "${title || 'Panier groupe'}". Contribue ici : ${shareUrl}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  navigator.clipboard?.writeText(shareUrl).catch(() => {});
}

function switchToGroup() {
  import('./b-nav.js').then(({ switchView }) => {
    import('./b-group-view.js').then(({ renderGroupView }) => {
      document.querySelectorAll('.k-bnav-item, .k-header-nav-btn')
        .forEach(i => i.classList.toggle('active', i.dataset.tab === 'group'));
      renderGroupView();
      switchView('group');
    });
  });
}

/* ── Flow principal ─────────────────────────────────────────────── */
export async function startShareFlow(opts = {}) {
  const { reshare = false } = opts;

  if (!state.cart?.length) {
    showToast("Ajoutez d'abord des produits au panier.", 'error');
    return;
  }

  if (reshare && state.shareToken) {
    const shareUrl = state.shareUrl || `${window.location.origin}/cart/shared/${state.shareToken}`;
    openWhatsApp(state.cartName, shareUrl);
    return;
  }

  const needsAuth = !isConnected();
  const formData = await promptInit(needsAuth);
  if (!formData) return;

  const btn = document.getElementById('k-cart-share') || document.getElementById('k-sc-share');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Création…'; }

  try {
    const data = await createSharedCart(formData);

    const title = formData.title || 'Panier groupe';
    const cart = {
      id: data.shared_cart_id,
      token: data.token,
      share_url: data.share_url || `${window.location.origin}/cart/shared/${data.token}`,
      title,
      status: 'active',
      total_kmf_snapshot: data.total_kmf,
      contributed_kmf: 0,
      remaining_kmf: data.total_kmf,
      expires_at: data.expires_at,
      created_at: new Date().toISOString(),
    };

    applyCartToState(cart);
    refreshSharedBadges(true, cart);
    showBanner({
      title,
      expires_at: data.expires_at,
      status: 'active',
      contributed_kmf: 0,
      total_kmf_snapshot: data.total_kmf,
    });
    openWhatsApp(title, cart.share_url);

    setTimeout(switchToGroup, 600);
  } catch (err) {
    showToast(`Erreur : ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = state.shareToken ? 'Groupe actif' : 'Payer en groupe'; }
  }
}

async function handleShareClick() {
  if (!state.shareToken) {
    return startShareFlow({ reshare: false });
  }
  const choice = await promptExistingCartChoice();
  if (choice === 'view') return switchToGroup();
  if (choice === 'create') return startShareFlow({ reshare: false });
}

/* ── Installation ───────────────────────────────────────────────── */
let _installed = false;

export function install() {
  if (_installed) return;
  _installed = true;

  loadShareState();

  if (state.shareToken) {
    refreshSharedBadges(true);
    refreshBanner();
  }

  restoreSharedCartFromBackend({ silent: true });

  document.getElementById('k-cart-share')?.addEventListener('click', handleShareClick);

  document.getElementById('k-sc-share')?.addEventListener('click', handleShareClick);

  document.getElementById('k-cart-reshare')?.addEventListener('click', () =>
    startShareFlow({ reshare: true }));

  document.getElementById('k-sc-reshare')?.addEventListener('click', () =>
    startShareFlow({ reshare: true }));

  document.getElementById('k-sc-group-view')?.addEventListener('click', switchToGroup);

  document.addEventListener('cart:cleared', () => {
    clearShareState();
    refreshSharedBadges(false);
  });
}
