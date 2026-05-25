/**
 * @module b-share-cart
 * @brief Flow "Payer en groupe" — côté créateur.
 *
 * Étapes :
 *   A — Mini-formulaire : titre du panier (optionnel) + identification
 *       si session absente (prénom + téléphone)
 *   B — POST /api/shared-carts/from-cart-items → token + share_url + expires_at
 *   C — WhatsApp + switch onglet Groupe
 *
 * state.shareToken / state.shareId / state.shareExpiry persiste en sessionStorage
 * (kmrc_share) — expire à la fermeture du navigateur.
 * Aucun localStorage group carts. Aucun polling ici.
 */

import { state }          from './b-store.js';
import { showToast }      from './b-cart-core.js';
import { refreshGroupBadge } from './b-group-view.js';
import { showBanner, hideBanner, refreshBanner } from './b-group-banner.js';

const API_CREATE = '/api/shared-carts/from-cart-items';

/* ── Persistance session ────────────────────────────────────────── */
function loadShareState() {
  try {
    const raw = sessionStorage.getItem('kmrc_share');
    if (!raw) return;
    const s = JSON.parse(raw);
    state.shareToken  = s.token  || null;
    state.shareId     = s.id     || null;
    state.shareExpiry = s.expiry || null;
    state.cartName    = s.name   || '';
  } catch (_) {}
}

function saveShareState() {
  try {
    sessionStorage.setItem('kmrc_share', JSON.stringify({
      token:  state.shareToken,
      id:     state.shareId,
      expiry: state.shareExpiry,
      name:   state.cartName,
    }));
  } catch (_) {}
}

export function clearShareState() {
  state.shareToken  = null;
  state.shareId     = null;
  state.shareExpiry = null;
  state.cartName    = '';
  try {
    sessionStorage.removeItem('kmrc_share');
    sessionStorage.removeItem('kmrc_banner_dismissed');
  } catch (_) {}
  refreshGroupBadge();
  hideBanner();
  refreshSharedBadges(false);
}

/* ── Détection session ──────────────────────────────────────────── */
function isConnected() {
  return window.K?.isConnected?.() || false;
}

/* ── Badges sidebar ─────────────────────────────────────────────── */
export function refreshSharedBadges(isShared) {
  // Mobile drawer
  const mobileBadge = document.getElementById('k-share-badge-row');
  const mobileShare = document.getElementById('k-cart-share');
  if (mobileBadge) mobileBadge.hidden = !isShared;
  if (mobileShare) mobileShare.textContent = isShared ? 'Re-partager' : 'Payer en groupe';

  // Desktop sidebar
  const desktopBadge = document.getElementById('k-sc-shared-badge');
  const desktopShare = document.getElementById('k-sc-share');
  if (desktopBadge) desktopBadge.hidden = !isShared;
  if (desktopShare) desktopShare.hidden  = isShared;  // masqué quand badge actif

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
.k-sm-btn:disabled{background:var(--sand-dark);color:var(--text-light);cursor:not-allowed;transform:none}`;
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

/* ── Étape A : formulaire init ──────────────────────────────────── */
function promptInit(needsAuth) {
  return new Promise(resolve => {
    const ov = openModal(`
      <div class="k-sm-head">
        <span class="k-sm-title">🛒 Payer en groupe</span>
        <button class="k-sm-close" aria-label="Fermer">✕</button>
      </div>
      <p class="k-sm-hint">Créez un panier collectif et partagez le lien par WhatsApp. Chacun contribue à sa part.</p>
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
    const btn   = ov.querySelector('#k-sm-submit');

    btn.addEventListener('click', () => {
      const title = (ov.querySelector('#k-sm-title-f')?.value || '').trim();
      const name  = (ov.querySelector('#k-sm-name-f')?.value  || '').trim();
      const phone = (ov.querySelector('#k-sm-phone-f')?.value || '').trim();

      if (needsAuth) {
        if (!name)  { errEl.textContent = 'Prénom requis.'; return; }
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
  if (opts.title)  body.title            = opts.title;
  if (opts.phone)  body.tracking_phone   = opts.phone;
  if (opts.name)   body.recipient_name   = opts.name;

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
  // { shared_cart_id, token, share_url, total_kmf, expires_at, items_count }
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

  // Re-partage d'un panier déjà créé
  if (reshare && state.shareToken) {
    const shareUrl = `${window.location.origin}/cart/shared/${state.shareToken}`;
    openWhatsApp(state.cartName, shareUrl);
    return;
  }

  // Formulaire init
  const needsAuth = !isConnected();
  const formData  = await promptInit(needsAuth);
  if (!formData) return;

  const btn = document.getElementById('k-cart-share') || document.getElementById('k-sc-share');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Création…'; }

  try {
    const data = await createSharedCart(formData);

    const token    = data.token;
    const id       = data.shared_cart_id;
    const shareUrl = data.share_url || `${window.location.origin}/cart/shared/${token}`;
    const title    = formData.title || 'Panier groupe';

    state.shareToken  = token;
    state.shareId     = id;
    state.shareExpiry = data.expires_at;
    state.cartName    = title;
    saveShareState();

    refreshSharedBadges(true);
    showBanner({ title, expires_at: data.expires_at });
    openWhatsApp(title, shareUrl);

    // Délai pour laisser WhatsApp s'ouvrir, puis switch onglet
    setTimeout(switchToGroup, 600);

  } catch (err) {
    showToast(`Erreur : ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Payer en groupe'; }
  }
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

  // Boutons créer/re-partager
  document.getElementById('k-cart-share')?.addEventListener('click', () =>
    startShareFlow({ reshare: !!state.shareToken }));

  document.getElementById('k-sc-share')?.addEventListener('click', () =>
    startShareFlow({ reshare: !!state.shareToken }));

  document.getElementById('k-cart-reshare')?.addEventListener('click', () =>
    startShareFlow({ reshare: true }));

  document.getElementById('k-sc-reshare')?.addEventListener('click', () =>
    startShareFlow({ reshare: true }));

  // Voir les participations (sidebar desktop)
  document.getElementById('k-sc-group-view')?.addEventListener('click', switchToGroup);

  // Vidage panier = reset panier partagé
  document.addEventListener('cart:cleared', () => {
    clearShareState();
    refreshSharedBadges(false);
  });
}
