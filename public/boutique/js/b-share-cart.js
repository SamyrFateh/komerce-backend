/**
 * @module b-share-cart
 * @owner sélecteurs .k-share-* — déclaré dans BOUTIQUE_SOURCE_OF_TRUTH.md §2A
 * @brief Flow partage panier (côté créateur uniquement)
 *
 * Étapes :
 *   A — Nom du panier (si absent ou < 3 chars)
 *   B — Auth légère nom + téléphone (si pas de session connue)
 *   C — POST /api/shared-carts/from-cart-items → token + share_url
 *   D — Ouverture WhatsApp + switch onglet Groupe
 *
 * Aucun stockage dans kmrc_group_carts_v1. Le token est posé dans
 * state.shareToken — lu par b-group-view.js.
 */

import { state }       from './b-store.js';
import { showToast }   from './b-cart-core.js';
import { refreshGroupBadge } from './b-group-view.js';

/* ── Config ────────────────────────────────────────────────────── */
const API_SHARED_CART = '/api/shared-carts/from-cart-items';

/* ── State partagé (stocké dans state.cart) ─────────────────────
   Initialisé depuis sessionStorage à la session courante.
   On ne persiste pas en localStorage pour éviter de montrer un
   panier partagé expiré à la prochaine visite. */
function loadShareState() {
  try {
    const raw = sessionStorage.getItem('kmrc_share');
    if (raw) {
      const s = JSON.parse(raw);
      state.shareToken = s.token || null;
      state.shareId    = s.id    || null;
      state.cartName   = s.name  || '';
    }
  } catch (_) {}
}

function saveShareState() {
  try {
    sessionStorage.setItem('kmrc_share', JSON.stringify({
      token: state.shareToken || null,
      id:    state.shareId    || null,
      name:  state.cartName   || '',
    }));
  } catch (_) {}
}

function clearShareState() {
  state.shareToken = null;
  state.shareId    = null;
  state.cartName   = '';
  try { sessionStorage.removeItem('kmrc_share'); } catch (_) {}
}

/* ── Détection session ──────────────────────────────────────────── */
function isAuthenticated() {
  try { return !!localStorage.getItem('komerce_session'); } catch (_) { return false; }
}

/* ── Modal générique ────────────────────────────────────────────── */
function ensureStyles() {
  if (document.getElementById('k-share-modal-styles')) return;
  const s = document.createElement('style');
  s.id = 'k-share-modal-styles';
  s.textContent = `
.k-share-modal-overlay{position:fixed;inset:0;z-index:2000;background:var(--overlay-dark);
  display:flex;align-items:flex-end;justify-content:center;animation:kShareFadeIn .2s ease}
@keyframes kShareFadeIn{from{opacity:0}to{opacity:1}}
@media(min-width:600px){.k-share-modal-overlay{align-items:center}}
.k-share-modal-sheet{background:var(--white);border-radius:20px 20px 0 0;
  padding:28px 20px calc(32px + env(safe-area-inset-bottom));width:100%;max-width:420px;
  animation:kShareSlideUp .28s var(--ease)}
@media(min-width:600px){.k-share-modal-sheet{border-radius:16px;padding-bottom:28px}}
@keyframes kShareSlideUp{from{transform:translateY(48px);opacity:0}to{transform:translateY(0);opacity:1}}
.k-share-modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
.k-share-modal-title{font-size:17px;font-weight:800;color:var(--text)}
.k-share-modal-close{width:32px;height:32px;border:none;background:var(--sand);border-radius:50%;
  font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;
  color:var(--text-muted);transition:background .15s}
.k-share-modal-close:hover{background:var(--sand-dark)}
.k-share-modal-label{display:block;font-size:12px;font-weight:600;color:var(--text-muted);
  margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em}
.k-share-modal-input{width:100%;padding:12px 14px;border:2px solid var(--border);
  border-radius:var(--radius-sm);font-size:15px;font-family:var(--font);color:var(--text);
  background:var(--white);outline:none;box-sizing:border-box;transition:border-color .2s}
.k-share-modal-input:focus{border-color:var(--violet)}
.k-share-modal-input::placeholder{color:var(--text-light)}
.k-share-modal-error{font-size:12px;color:var(--red-danger-text);margin-top:6px;min-height:18px}
.k-share-modal-btn{width:100%;padding:14px;margin-top:16px;background:var(--violet);
  color:var(--white);border:none;border-radius:50px;font-size:15px;font-weight:700;
  font-family:var(--font);cursor:pointer;transition:all .15s}
.k-share-modal-btn:hover{background:var(--violet-dark);transform:translateY(-1px)}
.k-share-modal-btn:active{transform:scale(.97)}
.k-share-modal-btn:disabled{background:var(--sand-dark);color:var(--text-light);
  cursor:not-allowed;transform:none}
.k-share-modal-hint{font-size:13px;color:var(--text-muted);line-height:1.5;margin-bottom:14px}
.k-share-modal-field-group{margin-bottom:14px}`;
  document.head.appendChild(s);
}

function createModal(content) {
  ensureStyles();
  const overlay = document.createElement('div');
  overlay.className = 'k-share-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `<div class="k-share-modal-sheet">${content}</div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay); });
  document.body.appendChild(overlay);
  return overlay;
}

function closeModal(overlay) {
  overlay.style.animation = 'kShareFadeIn .15s ease reverse';
  setTimeout(() => overlay.remove(), 150);
}

/* ── Étape A : Nom du panier ────────────────────────────────────── */
function promptCartName(current) {
  return new Promise(resolve => {
    const overlay = createModal(`
      <div class="k-share-modal-head">
        <span class="k-share-modal-title">Nommer le panier</span>
        <button class="k-share-modal-close" aria-label="Fermer">✕</button>
      </div>
      <div class="k-share-modal-field-group">
        <label class="k-share-modal-label" for="k-sn-field">Nom du panier</label>
        <input id="k-sn-field" class="k-share-modal-input" type="text"
          placeholder="Ex: Cadeau Aïcha pour son mariage"
          value="${current || ''}" maxlength="80" autocomplete="off">
        <p class="k-share-modal-error" id="k-sn-err"></p>
      </div>
      <button class="k-share-modal-btn" id="k-sn-btn">Continuer →</button>`);

    const input = overlay.querySelector('#k-sn-field');
    const btn   = overlay.querySelector('#k-sn-btn');
    const err   = overlay.querySelector('#k-sn-err');

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
    input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
    overlay.querySelector('.k-share-modal-close').addEventListener('click', () => {
      closeModal(overlay); resolve(null);
    });
  });
}

/* ── Étape B : Identification légère ───────────────────────────── */
function promptPhone(prefilledName) {
  return new Promise(resolve => {
    const overlay = createModal(`
      <div class="k-share-modal-head">
        <span class="k-share-modal-title">Qui partage ce panier ?</span>
        <button class="k-share-modal-close" aria-label="Fermer">✕</button>
      </div>
      <p class="k-share-modal-hint">Votre numéro nous permet de rattacher ce panier partagé à votre compte.</p>
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
      <button class="k-share-modal-btn" id="k-sph-btn">Continuer →</button>`);

    const nameEl = overlay.querySelector('#k-sph-name');
    const telEl  = overlay.querySelector('#k-sph-tel');
    const err    = overlay.querySelector('#k-sph-err');
    const btn    = overlay.querySelector('#k-sph-btn');

    requestAnimationFrame(() => (nameEl.value ? telEl.focus() : nameEl.focus()));

    function validate() {
      const name = nameEl.value.trim();
      const tel  = telEl.value.trim();
      if (!name) { err.textContent = 'Votre prénom est requis.'; return null; }
      if (!tel)  { err.textContent = 'Votre numéro est requis.'; return null; }
      if (!/^\+?[\d\s\-]{8,20}$/.test(tel)) {
        err.textContent = 'Format invalide (ex: +26932… ou +33699…)';
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
    overlay.querySelector('.k-share-modal-close').addEventListener('click', () => {
      closeModal(overlay); resolve(null);
    });
    [nameEl, telEl].forEach(el => {
      el.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
    });
  });
}

/* ── Étape C : Création via API ─────────────────────────────────── */
async function createSharedCart(cartName, opts = {}) {
  const cart_items = state.cart
    .map(it => ({ product_id: it.product?.id || it.id, quantity: Number(it.qty) || 1 }))
    .filter(it => it.product_id);

  const body = { title: cartName, cart_items };
  if (opts.phone) body.tracking_phone = opts.phone;
  if (opts.name)  body.recipient_name = opts.name;

  const res = await fetch(API_SHARED_CART, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || e.message || `Erreur API (${res.status})`);
  }

  const data = await res.json();
  try { localStorage.setItem('komerce_session', '1'); } catch (_) {}
  return data;
  // Réponse : { shared_cart_id, token, share_url, total_kmf, expires_at, items_count }
}

/* ── Étape D : WhatsApp ─────────────────────────────────────────── */
function openWhatsApp(cartName, shareUrl) {
  const msg = `Salut ! J'ai préparé un panier sur Komerce : "${cartName}".\nVous pouvez participer ici : ${shareUrl}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');

  try {
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast('Lien copié dans le presse-papiers', 'success');
    });
  } catch (_) {}
}

/* ── Synchronisation champ nom ──────────────────────────────────── */
function getSyncedName() {
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

/* ── Badge partagé ──────────────────────────────────────────────── */
function refreshSharedBadges(isShared) {
  const mobileBadge = document.getElementById('k-share-badge-row');
  const mobileBtn   = document.getElementById('k-cart-share');
  if (mobileBadge) mobileBadge.hidden = !isShared;
  if (mobileBtn)   mobileBtn.textContent = isShared ? 'Re-partager' : 'Payer à plusieurs';

  const desktopBadge = document.getElementById('k-sc-shared-badge');
  const desktopBtn   = document.getElementById('k-sc-share');   // "Payer à plusieurs"
  if (desktopBadge) desktopBadge.hidden = !isShared;
  if (desktopBtn)   desktopBtn.hidden   =  isShared;            // masqué quand badge actif

  refreshGroupBadge();
}

/* ── Flow principal ─────────────────────────────────────────────── */
export async function startShareFlow(opts = {}) {
  const { reshare = false } = opts;

  // Re-partage : token déjà connu → ouvrir directement WhatsApp
  if (reshare && state.shareToken) {
    const host     = window.location.origin;
    const shareUrl = `${host}/cart/shared/${state.shareToken}`;
    openWhatsApp(state.cartName || 'Panier Komerce', shareUrl);
    return;
  }

  if (!state.cart?.length) {
    showToast('Ajoutez d\'abord des produits', 'error');
    return;
  }

  /* A — Nom */
  let cartName = state.cartName || getSyncedName();
  if (!cartName || cartName.trim().length < 3) {
    cartName = await promptCartName(cartName);
    if (!cartName) return;
  }
  state.cartName = cartName;
  syncNameInputs(cartName);

  /* B — Auth */
  let phoneOpts = {};
  if (!isAuthenticated()) {
    const info = await promptPhone(cartName);
    if (!info) return;
    phoneOpts = { name: info.name, phone: info.phone };
  }

  /* C — API */
  let shareData;
  try {
    shareData = await createSharedCart(cartName, phoneOpts);
  } catch (err) {
    showToast(`Erreur : ${err.message}`, 'error');
    return;
  }

  const token    = shareData.token || shareData.share_token;
  const id       = shareData.shared_cart_id || shareData.id;
  const host     = window.location.origin;
  const shareUrl = shareData.share_url || `${host}/cart/shared/${token}`;

  if (!token) {
    showToast('Erreur : token manquant dans la réponse', 'error');
    return;
  }

  state.shareToken = token;
  state.shareId    = id;
  saveShareState();
  refreshSharedBadges(true);

  /* D — WhatsApp */
  openWhatsApp(cartName, shareUrl);

  // Switcher automatiquement vers l'onglet Groupe après un court délai
  // (laisser WhatsApp s'ouvrir d'abord)
  setTimeout(() => {
    // Import dynamique pour éviter la dépendance circulaire b-nav ↔ b-share-cart
    import('./b-nav.js').then(({ switchView }) => {
      // Activer le bouton bnav groupe
      document.querySelectorAll('.k-bnav-item, .k-header-nav-btn').forEach(i => {
        i.classList.toggle('active', i.dataset.tab === 'group');
      });
      import('./b-group-view.js').then(({ renderGroupView }) => {
        renderGroupView();
        switchView('group');
      });
    });
  }, 800);
}

/* ── Installation ───────────────────────────────────────────────── */
let _installed = false;

export function install() {
  if (_installed) return;
  _installed = true;

  loadShareState();
  if (state.shareToken) refreshSharedBadges(true);

  ['k-cart-name-input', 'k-sc-name-input'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', e => {
      state.cartName = e.target.value;
      syncNameInputs(e.target.value);
    });
  });

  document.getElementById('k-cart-share')?.addEventListener('click', () => {
    startShareFlow({ reshare: !!state.shareToken });
  });

  document.getElementById('k-sc-share')?.addEventListener('click', () => {
    startShareFlow({ reshare: !!state.shareToken });
  });

  document.getElementById('k-cart-reshare')?.addEventListener('click', () => {
    startShareFlow({ reshare: true });
  });

  document.getElementById('k-sc-reshare')?.addEventListener('click', () => {
    startShareFlow({ reshare: true });
  });

  document.getElementById('k-sc-group-view')?.addEventListener('click', () => {
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

  document.addEventListener('cart:cleared', () => {
    clearShareState();
    refreshSharedBadges(false);
    syncNameInputs('');
  });
}
