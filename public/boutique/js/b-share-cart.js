/**
 * @module b-share-cart
 * @owner sélecteurs .k-share-* (overlay, sheet, OTP) — déclaré dans BOUTIQUE_SOURCE_OF_TRUTH.md §2A
 * @brief Flow partage panier (côté créateur uniquement — PR 1)
 *
 * Étapes :
 *   A — Nom du panier (si absent ou < 3 chars)
 *   B — Identification OTP WhatsApp (si pas de cookie kmrc_jwt valide)
 *   C — Création shared-cart via POST /api/shared-cart/from-cart-items
 *   D — Ouverture WhatsApp + copie clipboard
 *
 * Stockage : state.cart.shareToken + state.cart.shareId + state.cart.cartName
 * Pas de pages dédiées. Tout vit dans le drawer/side-cart.
 */

import { state } from './b-store.js';
import { showToast } from './b-cart-core.js';

/* ── Config ────────────────────────────────────────────────────── */
const API_BASE        = '';  // même origine
const API_SHARED_CART = `${API_BASE}/api/shared-carts/from-cart-items`;

/* ── State partagé (stocké dans state.cart) ─────────────────────
   On étend l'objet state.cart existant sans créer de deuxième source.
   Initialisé depuis localStorage si présent. */
function loadShareState() {
  try {
    const raw = localStorage.getItem('kmrc_share');
    if (raw) {
      const s = JSON.parse(raw);
      state.cart.shareToken = s.token  || null;
      state.cart.shareId    = s.id     || null;
      state.cart.cartName   = s.name   || '';
    }
  } catch (_) {}
}

function saveShareState() {
  try {
    localStorage.setItem('kmrc_share', JSON.stringify({
      token: state.cart.shareToken || null,
      id:    state.cart.shareId    || null,
      name:  state.cart.cartName   || '',
    }));
  } catch (_) {}
}

function clearShareState() {
  state.cart.shareToken = null;
  state.cart.shareId    = null;
  try { localStorage.removeItem('kmrc_share'); } catch (_) {}
}

/* ── Helpers UI ─────────────────────────────────────────────────── */

/** Injecte le CSS du module une seule fois. */
function ensureCss() {
  if (document.getElementById('k-share-cart-css')) return;
  const link = document.createElement('link');
  link.id   = 'k-share-cart-css';
  link.rel  = 'stylesheet';
  link.href = '/boutique/css/dist/components.css'; // bundlé avec cart.css
  // Note : les styles .k-share-modal-* sont ajoutés inline ci-dessous
  // pour éviter un fichier CSS orphelin hors bundle.
  injectInlineStyles();
}

function injectInlineStyles() {
  if (document.getElementById('k-share-modal-styles')) return;
  const style = document.createElement('style');
  style.id = 'k-share-modal-styles';
  style.textContent = `
.k-share-modal-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: var(--overlay-dark);
  display: flex; align-items: flex-end; justify-content: center;
  animation: kShareFadeIn .2s ease;
}
@keyframes kShareFadeIn { from { opacity: 0; } to { opacity: 1; } }
@media (min-width: 600px) {
  .k-share-modal-overlay { align-items: center; }
}
.k-share-modal-sheet {
  background: var(--white);
  border-radius: 20px 20px 0 0;
  padding: 28px 20px calc(32px + env(safe-area-inset-bottom));
  width: 100%; max-width: 420px;
  animation: kShareSlideUp .28s var(--ease);
}
@media (min-width: 600px) {
  .k-share-modal-sheet { border-radius: 16px; padding-bottom: 28px; }
}
@keyframes kShareSlideUp {
  from { transform: translateY(48px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}
.k-share-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 20px;
}
.k-share-modal-title {
  font-size: 17px; font-weight: 800; color: var(--text);
}
.k-share-modal-close {
  width: 32px; height: 32px; border: none; background: var(--sand);
  border-radius: 50%; font-size: 16px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-muted); transition: background .15s;
}
.k-share-modal-close:hover { background: var(--sand-dark); }
.k-share-modal-label {
  display: block; font-size: 12px; font-weight: 600;
  color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase;
  letter-spacing: .04em;
}
.k-share-modal-input {
  width: 100%; padding: 12px 14px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm); font-size: 15px;
  font-family: var(--font); color: var(--text);
  background: var(--white); outline: none;
  box-sizing: border-box; transition: border-color .2s;
}
.k-share-modal-input:focus { border-color: var(--violet); }
.k-share-modal-input::placeholder { color: var(--text-light); }
.k-share-modal-error {
  font-size: 12px; color: var(--red-danger-text);
  margin-top: 6px; min-height: 18px;
}
.k-share-modal-btn {
  width: 100%; padding: 14px; margin-top: 16px;
  background: var(--violet); color: var(--white);
  border: none; border-radius: 50px;
  font-size: 15px; font-weight: 700; font-family: var(--font);
  cursor: pointer; transition: all .15s;
}
.k-share-modal-btn:hover { background: var(--violet-dark); transform: translateY(-1px); }
.k-share-modal-btn:active { transform: scale(.97); }
.k-share-modal-btn:disabled {
  background: var(--sand-dark); color: var(--text-light);
  cursor: not-allowed; transform: none;
}
.k-share-modal-hint {
  font-size: 13px; color: var(--text-muted); line-height: 1.5;
  margin-bottom: 14px;
}
.k-share-otp-sent {
  background: var(--green-bg); border-left: 3px solid var(--green-success);
  border-radius: 0 8px 8px 0; padding: 10px 14px;
  font-size: 13px; color: var(--text); margin-bottom: 14px; line-height: 1.5;
}
.k-share-modal-divider {
  display: flex; align-items: center; gap: 10px;
  margin: 14px 0; color: var(--text-muted); font-size: 12px;
}
.k-share-modal-divider::before,
.k-share-modal-divider::after {
  content: ''; flex: 1; height: 1px; background: var(--border);
}
.k-share-modal-resend {
  background: none; border: none; color: var(--violet);
  font-size: 13px; font-weight: 600; cursor: pointer; padding: 0;
  text-decoration: underline; text-decoration-color: transparent;
  transition: text-decoration-color .15s;
}
.k-share-modal-resend:hover { text-decoration-color: var(--violet); }
.k-share-modal-resend:disabled { color: var(--text-muted); cursor: not-allowed; }
.k-share-modal-field-group { margin-bottom: 14px; }
  `;
  document.head.appendChild(style);
}

/* ── Vérification auth ──────────────────────────────────────────── */
function isAuthenticated() {
  // On évite un fetch /api/auth/me qui peut être 404 selon la config backend.
  // Le cookie kmrc_jwt est httpOnly (illisible depuis JS), mais le backend le pose
  // aussi dans localStorage via 'komerce_session' (signal proxy — cf. auth-guest.js).
  try {
    return !!localStorage.getItem('komerce_session');
  } catch (_) {
    return false;
  }
}

/* ── Modal générique (overlay + sheet) ──────────────────────────── */
function createModal(content) {
  const overlay = document.createElement('div');
  overlay.className = 'k-share-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="k-share-modal-sheet">
      ${content}
    </div>`;
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay);
  });
  document.body.appendChild(overlay);
  return overlay;
}

function closeModal(overlay) {
  overlay.style.animation = 'kShareFadeIn .15s ease reverse';
  setTimeout(() => overlay.remove(), 150);
}

/* ── Étape A : Saisie du nom ────────────────────────────────────── */
function promptCartName(currentName) {
  return new Promise(resolve => {
    ensureCss();
    const overlay = createModal(`
      <div class="k-share-modal-head">
        <span class="k-share-modal-title">Nommer le panier</span>
        <button class="k-share-modal-close" aria-label="Fermer">✕</button>
      </div>
      <div class="k-share-modal-field-group">
        <label class="k-share-modal-label" for="k-share-name-field">Nom du panier</label>
        <input id="k-share-name-field" class="k-share-modal-input" type="text"
          placeholder="Ex: Cadeau Aïcha pour son mariage"
          value="${currentName || ''}" maxlength="80" autocomplete="off">
        <p class="k-share-modal-error" id="k-share-name-err"></p>
      </div>
      <button class="k-share-modal-btn" id="k-share-name-btn">Continuer →</button>
    `);

    const input  = overlay.querySelector('#k-share-name-field');
    const btn    = overlay.querySelector('#k-share-name-btn');
    const err    = overlay.querySelector('#k-share-name-err');
    const closeBtn = overlay.querySelector('.k-share-modal-close');

    requestAnimationFrame(() => input.focus());

    function validate() {
      const v = input.value.trim();
      if (v.length < 3)  { err.textContent = 'Minimum 3 caractères.'; return null; }
      if (v.length > 80) { err.textContent = 'Maximum 80 caractères.'; return null; }
      err.textContent = '';
      return v;
    }

    btn.addEventListener('click', () => {
      const name = validate();
      if (!name) return;
      closeModal(overlay);
      resolve(name);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') btn.click();
    });

    closeBtn.addEventListener('click', () => {
      closeModal(overlay);
      resolve(null); // annulé
    });
  });
}

/* ── Étape B : Identification légère (phone + nom) ──────────────── */
// Pas d'OTP : authenticateOrCreateGuest crée/retrouve le user côté backend
// sur la base de tracking_phone. Simple, rapide.
function promptPhone(prefilledName) {
  return new Promise(resolve => {
    ensureCss();
    const overlay = createModal(`
      <div class="k-share-modal-head">
        <span class="k-share-modal-title">Qui partage ce panier ?</span>
        <button class="k-share-modal-close" aria-label="Fermer">✕</button>
      </div>
      <p class="k-share-modal-hint">Votre numéro nous permet de vous rattacher le panier partagé.</p>
      <div class="k-share-modal-field-group">
        <label class="k-share-modal-label" for="k-sph-name">Votre prénom</label>
        <input id="k-sph-name" class="k-share-modal-input" type="text"
          placeholder="Ex : Fatima" maxlength="60" value="${prefilledName || ''}" autocomplete="given-name">
      </div>
      <div class="k-share-modal-field-group">
        <label class="k-share-modal-label" for="k-sph-tel">Votre numéro WhatsApp</label>
        <input id="k-sph-tel" class="k-share-modal-input" type="tel"
          placeholder="+269… ou +33…" maxlength="20" autocomplete="tel">
        <p class="k-share-modal-error" id="k-sph-err"></p>
      </div>
      <button class="k-share-modal-btn" id="k-sph-continue">Continuer →</button>
    `);

    const nameEl = overlay.querySelector('#k-sph-name');
    const telEl  = overlay.querySelector('#k-sph-tel');
    const err    = overlay.querySelector('#k-sph-err');
    const btn    = overlay.querySelector('#k-sph-continue');
    const closeBtn = overlay.querySelector('.k-share-modal-close');

    requestAnimationFrame(() => (nameEl.value ? telEl.focus() : nameEl.focus()));

    function validate() {
      const name = nameEl.value.trim();
      const tel  = telEl.value.trim();
      if (!name) { err.textContent = 'Votre prénom est requis.'; return null; }
      if (!tel)  { err.textContent = 'Votre numéro est requis.'; return null; }
      if (!/^\+?[\d\s\-]{8,20}$/.test(tel)) {
        err.textContent = 'Format invalide (ex: +269321… ou +33699…)';
        return null;
      }
      return { name, phone: tel };
    }

    btn.addEventListener('click', () => {
      err.textContent = '';
      const result = validate();
      if (!result) return;
      closeModal(overlay);
      resolve(result);
    });

    closeBtn.addEventListener('click', () => {
      closeModal(overlay);
      resolve(null);
    });

    [nameEl, telEl].forEach(el => {
      el.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
    });
  });
}

/* ── Étape C : Création shared-cart ─────────────────────────────── */
async function createSharedCart(cartName, opts = {}) {
  // Le backend attend 'cart_items' (pas 'items') — cf. routes/shared-cart.js
  const cart_items = state.cart.map(it => ({
    product_id: it.product?.id || it.id,
    quantity:   Number(it.qty) || 1,
  })).filter(it => it.product_id);

  // tracking_phone + recipient_name → utilisés par authenticateOrCreateGuest
  // pour créer ou retrouver l'utilisateur côté backend (pas d'OTP requis).
  const body = {
    title: cartName,
    cart_items,
  };
  if (opts.phone) body.tracking_phone = opts.phone;
  if (opts.name)  body.recipient_name  = opts.name;

  const res = await fetch(API_SHARED_CART, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || errBody.message || `Erreur API (${res.status})`);
  }

  const data = await res.json();
  // Poser le signal proxy pour les prochains clics (token JWT posé en cookie httpOnly)
  try { localStorage.setItem('komerce_session', '1'); } catch (_) {}
  return data;
  // Réponse : { shared_cart_id, token, share_url, total_kmf, expires_at, items_count }
}

/* ── Étape D : Partage WhatsApp + clipboard ─────────────────────── */
function shareViaWhatsApp(cartName, shareToken, overrideUrl = null) {
  const host = window.location.origin;
  // Si le backend a fourni une share_url canonique, on l'utilise ; sinon on reconstruit
  const link = overrideUrl || `${host}/cart/shared/${shareToken}`;
  const msg  = `Salut ! J'ai préparé un panier sur Komerce : "${cartName}".\nVous pouvez participer ici : ${link}`;
  const waUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`;

  window.open(waUrl, '_blank', 'noopener');

  try {
    navigator.clipboard.writeText(link).then(() => {
      showToast('Lien copié dans le presse-papiers', 'success');
    });
  } catch (_) {
    // clipboard non disponible (http ou ancien navigateur) — pas bloquant
  }
}

/* ── Flow principal ─────────────────────────────────────────────── */
export async function startShareFlow(opts = {}) {
  const { reshare = false } = opts;

  // Cas re-partage : on a déjà un token, ouvrir directement WhatsApp
  if (reshare && state.cart.shareToken) {
    shareViaWhatsApp(state.cart.cartName || 'Panier Komerce', state.cart.shareToken);
    return;
  }

  // Panier vide ?
  if (!state.cart?.length) {
    showToast('Ajoutez d\'abord des produits', 'error');
    return;
  }

  /* ─── Étape A : Nom ─────────────────────────────────────────── */
  let cartName = state.cart.cartName || getSyncedNameFromInputs();

  if (!cartName || cartName.trim().length < 3) {
    cartName = await promptCartName(cartName);
    if (!cartName) return; // annulé
  }

  // Synchroniser le nom dans le state et les inputs
  state.cart.cartName = cartName;
  syncNameInputs(cartName);

  /* ─── Étape B : Auth ────────────────────────────────────────── */
  // Si déjà authentifié (cookie kmrc_jwt connu), on passe directement.
  // Sinon, on demande nom + téléphone — le backend crée le guest à la volée.
  let phoneOpts = {};
  if (!isAuthenticated()) {
    const info = await promptPhone(state.cart.cartName);
    if (!info) return; // annulé
    phoneOpts = { name: info.name, phone: info.phone };
  }

  /* ─── Étape C : Création API ────────────────────────────────── */
  let shareData;
  try {
    shareData = await createSharedCart(cartName, phoneOpts);
  } catch (err) {
    showToast(`Erreur : ${err.message}`, 'error');
    return;
  }

  // Le backend retourne { shared_cart_id, token, share_url, total_kmf, ... }
  const token = shareData.token || shareData.share_token;
  const id    = shareData.shared_cart_id || shareData.id;

  if (!token) {
    showToast('Erreur : token manquant dans la réponse', 'error');
    return;
  }

  state.cart.shareToken = token;
  state.cart.shareId    = id;
  saveShareState();
  refreshSharedBadges(true);

  /* ─── Enregistrement dans kmrc_group_carts_v1 (lu par b-tracking.js) ── */
  try {
    const host = window.location.origin;
    const shareUrl = shareData.share_url || `${host}/cart/shared/${token}`;
    const entry = {
      id:           id,
      token:        token,
      title:        cartName,
      url:          shareUrl,
      total:        shareData.total_kmf || 0,
      status:       'open',
      created_at:   new Date().toISOString(),
      participants: [],
      items:        state.cart.map(it => ({
        product_id: it.product?.id || it.id,
        name:       it.name || it.product?.name || '',
        qty:        Number(it.qty) || 1,
        price:      Number(it.price) || 0,
      })),
    };
    const raw    = localStorage.getItem('kmrc_group_carts_v1');
    const groups = raw ? JSON.parse(raw) : [];
    // Éviter les doublons si re-partage
    const deduped = groups.filter(g => String(g.id) !== String(id));
    deduped.unshift(entry);
    localStorage.setItem('kmrc_group_carts_v1', JSON.stringify(deduped.slice(0, 20)));
  } catch (_) {}

  /* ─── Étape D : WhatsApp + notification Suivi ───────────────── */
  const shareUrl = shareData.share_url || `${window.location.origin}/cart/shared/${token}`;
  shareViaWhatsApp(cartName, token, shareUrl);

  // Informer le créateur qu'un événement l'attend dans l'onglet Suivi
  setTimeout(() => {
    showToast('📋 Ton panier partagé t'attend dans l'onglet Suivi', 'info', 5000);
    // Pulser l'onglet Suivi pour attirer l'œil
    const trackTab = document.querySelector('[data-tab="suivi"], [data-view="tracking"], #k-nav-suivi, .k-nav-suivi');
    if (trackTab) {
      trackTab.classList.add('k-tab-pulse');
      setTimeout(() => trackTab.classList.remove('k-tab-pulse'), 4000);
    }
  }, 1200); // délai court — laisser WhatsApp s'ouvrir d'abord
}

/* ── Synchronisation champs nom (drawer + side-cart) ────────────── */

function getSyncedNameFromInputs() {
  const a = document.getElementById('k-cart-name-input');
  const b = document.getElementById('k-sc-name-input');
  return (a?.value || b?.value || '').trim();
}

function syncNameInputs(name) {
  ['k-cart-name-input', 'k-sc-name-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value !== name) el.value = name;
  });
}

/* ── Badge "Partagé" ─────────────────────────────────────────────── */

function refreshSharedBadges(isShared) {
  // Drawer mobile
  const mobileBadge  = document.getElementById('k-share-badge-row');
  const mobileShare  = document.getElementById('k-cart-share');
  if (mobileBadge)  mobileBadge.hidden  = !isShared;
  if (mobileShare)  mobileShare.textContent = isShared ? 'Re-partager' : 'Payer à plusieurs';

  // Side-cart desktop
  const desktopBadge  = document.getElementById('k-sc-shared-badge');
  const desktopShare  = document.getElementById('k-sc-share');
  if (desktopBadge) desktopBadge.hidden = !isShared;
  if (desktopShare) {
    const label = desktopShare.querySelector('.k-sc-btn-share-label');
    if (label) label.textContent = isShared ? 'Re-partager' : 'Payer à plusieurs';
  }
}

/* ── Installation des handlers ──────────────────────────────────── */

let _installed = false;

export function install() {
  if (_installed) return;
  _installed = true;

  loadShareState();
  if (state.cart.shareToken) refreshSharedBadges(true);

  // Synchro live des champs nom (drawer ↔ side-cart)
  ['k-cart-name-input', 'k-sc-name-input'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', e => {
      state.cart.cartName = e.target.value;
      syncNameInputs(e.target.value);
    });
  });

  // Bouton "Payer à plusieurs" — drawer mobile
  document.getElementById('k-cart-share')?.addEventListener('click', () => {
    const isReshare = !!state.cart.shareToken;
    startShareFlow({ reshare: isReshare });
  });

  // Bouton "Payer à plusieurs" — side-cart desktop
  document.getElementById('k-sc-share')?.addEventListener('click', () => {
    const isReshare = !!state.cart.shareToken;
    startShareFlow({ reshare: isReshare });
  });

  // Bouton "Re-partager" — drawer mobile (dédié)
  document.getElementById('k-cart-reshare')?.addEventListener('click', () => {
    startShareFlow({ reshare: true });
  });

  // Bouton "Re-partager" — side-cart desktop (dédié)
  document.getElementById('k-sc-reshare')?.addEventListener('click', () => {
    startShareFlow({ reshare: true });
  });

  // Quand le panier est vidé, effacer le state de partage
  document.addEventListener('cart:cleared', () => {
    clearShareState();
    refreshSharedBadges(false);
    syncNameInputs('');
    state.cart.cartName = '';
  });
}
