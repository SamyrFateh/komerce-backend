/**
 * @module b-share-cart
 * @brief Flow "Payer en groupe" — côté créateur.
 *
 * Doctrine boutique-first — Mai 2026 :
 *   - un panier partagé actif n'empêche pas d'en créer un autre.
 *   - /mine restaure le dernier panier actif seulement comme raccourci de suivi.
 *   - le checkout/sidebar reste le panier courant : pas d'état ni suivi groupe.
 *   - le backend reste source de vérité pour la limite de paniers actifs.
 */

import { state } from './b-store.js';
import { showToast } from './b-cart-core.js';
import { clearCart } from './b-cart.js';  // Doctrine v4.2 — N4-CLEAR
import { refreshGroupBadge } from './b-group-view.js';
import { showBanner, hideBanner, refreshBanner } from './b-group-banner.js';
import {
  PHONE_COUNTRIES,
  buildPhoneSelect,
  isValidLocalLength,
  buildE164,
  digitsOnly,
  prettifyLocal,
} from './b-phone.js';
// FIX UX — Réutiliser les helpers checkout pour un style uniforme (padding, indicatifs)
import { makeInput, makeIntlPhoneInput } from './b-checkout.js';
import { requireIdentity } from './b-identity.js';

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
  state.shareUrl = cart.share_url || (cart.token ? `${window.location.origin}/boutique/?p=${cart.token}` : null);
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
      // FIX S2-05 — utilisateur non connecté : ne pas effacer l'état local chargé
      // depuis sessionStorage. Le shareToken restera valide pour startShareFlow().
      if (res.status === 401 || res.status === 403) return null;
      throw new Error(`GET /mine ${res.status}`);
    }
    const data = await res.json().catch(() => ({}));
    const cart = pickActiveCart(data.carts || []);

    if (!cart) {
      // FIX S2-05 — effacer uniquement si le backend confirme qu'il n'y a pas de
      // panier actif (réponse 200 + liste vide). Ne jamais effacer sur erreur réseau.
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
.k-sc-shared-badge{display:none!important}
.k-sc-reshare-btn{display:none!important}`;
  document.head.appendChild(s);
}

function renderSidebarSummary(cart = {}) {
  const desktopBadge = document.getElementById('k-sc-shared-badge');
  if (!desktopBadge) return;
  ensureSidebarStyles();
  desktopBadge.hidden = true;
  desktopBadge.innerHTML = '';
}

export function refreshSharedBadges(isShared, cart = null) {
  const mobileBadge = document.getElementById('k-share-badge-row');
  const mobileShare = document.getElementById('k-cart-share');
  if (mobileBadge) mobileBadge.hidden = !isShared;
  if (mobileShare) mobileShare.textContent = 'Payer en groupe';

  const desktopBadge = document.getElementById('k-sc-shared-badge');
  const desktopShare = document.getElementById('k-sc-share');
  if (desktopBadge) {
    desktopBadge.hidden = true;
    desktopBadge.innerHTML = '';
  }
  if (desktopShare) {
    desktopShare.hidden = false;
    desktopShare.textContent = 'Payer en groupe';
  }

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
.k-sm-btn-ghost:hover{background:var(--sand);color:var(--text)}}
/* Phone block inside modal */
.k-sm-phone-row{display:flex;gap:8px;align-items:stretch}
.k-sm-phone-sel{flex:0 0 auto;padding:11px 8px 11px 10px;border:2px solid var(--border);
  border-radius:var(--radius-sm);font-size:14px;font-family:var(--font);color:var(--text);
  background:var(--white);outline:none;cursor:pointer;transition:border-color .2s;
  appearance:none;-webkit-appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23999'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 8px center;padding-right:24px}
.k-sm-phone-sel:focus{border-color:var(--violet)}
.k-sm-phone-input{flex:1 1 auto;padding:11px 14px;border:2px solid var(--border);
  border-radius:var(--radius-sm);font-size:15px;font-family:var(--font);color:var(--text);
  background:var(--white);outline:none;box-sizing:border-box;transition:border-color .2s;
  min-width:0}
.k-sm-phone-input:focus{border-color:var(--violet)}
.k-sm-phone-input.k-valid{border-color:#22c55e}
.k-sm-phone-input.k-invalid{border-color:var(--red-danger-text)}
.k-sm-name-input:not(:placeholder-shown):invalid{border-color:var(--red-danger-text)}`;
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
// FIX UX — Rewritten to use checkout DOM builders (makeInput / makeIntlPhoneInput)
// so padding, labels and phone selector match the checkout UX exactly.
function promptInit(needsAuth) {
  return new Promise(resolve => {
    ensureStyles();
    const ov = document.createElement('div');
    ov.className = 'k-share-modal-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');

    const sheet = document.createElement('div');
    sheet.className = 'k-share-modal-sheet';

    // ── Header ────────────────────────────────────────────────────
    const head = document.createElement('div');
    head.className = 'k-sm-head';
    head.innerHTML =
      '<span class="k-sm-title">🛒 Payer en groupe</span>' +
      '<button class="k-sm-close" aria-label="Fermer">✕</button>';
    sheet.appendChild(head);

    const hint = document.createElement('p');
    hint.className = 'k-sm-hint';
    hint.textContent = 'Créez un panier collectif et partagez le lien par WhatsApp. Chacun contribue librement.';
    sheet.appendChild(hint);

    // ── Champ titre (même style que k-ck-group du checkout) ────────
    const titleData = { title: '' };
    const titleGroup = makeInput('k-sm-title-f', 'Nom du panier (optionnel)', 'text', 'Ex : Cadeau mariage Aïcha', titleData, 'title');
    titleGroup.querySelector('input')?.setAttribute('maxlength', '80');
    titleGroup.querySelector('input')?.setAttribute('autocomplete', 'off');
    sheet.appendChild(titleGroup);

    // ── Champs auth (prénom + téléphone avec indicatif) ───────────
    const nameData = { name: '' };
    let phoneData  = { phone: '' };
    let nameInput  = null;

    if (needsAuth) {
      // FIX UX — "Nom et prénom" (full_name en DB) plutôt que juste "prénom"
      const nameGroup = makeInput('k-sm-name-f', 'Votre nom et prénom *', 'text', 'Ex : Fatima Ali', nameData, 'name');
      const ni = nameGroup.querySelector('input');
      if (ni) {
        ni.setAttribute('maxlength', '60');
        ni.setAttribute('autocomplete', 'name');
      }
      nameInput = ni;
      sheet.appendChild(nameGroup);

      // makeIntlPhoneInput génère les classes k-ck-* du checkout — on les remplace
      // par les classes k-sm-* du modal pour un rendu cohérent (padding, border, focus).
      const phoneGroup = makeIntlPhoneInput('k-sm-ph', 'Votre numéro WhatsApp *', phoneData, 'phone');
      phoneGroup.classList.replace('k-ck-group', 'k-sm-field');
      phoneGroup.querySelector('label')?.classList.replace('k-ck-label', 'k-sm-label');
      const phoneWrap = phoneGroup.querySelector('.k-ck-phone-wrap');
      if (phoneWrap) phoneWrap.className = 'k-sm-phone-row';
      phoneGroup.querySelector('.k-ck-phone-select')?.classList.replace('k-ck-phone-select', 'k-sm-phone-sel');
      phoneGroup.querySelector('.k-ck-phone-input')?.classList.replace('k-ck-phone-input', 'k-sm-phone-input');
      sheet.appendChild(phoneGroup);
    }

    // ── Erreur + bouton ────────────────────────────────────────────
    const errEl = document.createElement('p');
    errEl.className = 'k-sm-err';
    errEl.id = 'k-sm-err';
    sheet.appendChild(errEl);

    const btn = document.createElement('button');
    btn.className = 'k-sm-btn';
    btn.id = 'k-sm-submit';
    btn.textContent = 'Créer le panier →';
    btn.disabled = !!needsAuth; // activé seulement quand les champs obligatoires sont valides
    sheet.appendChild(btn);

    ov.appendChild(sheet);
    ov.addEventListener('click', e => { if (e.target === ov) { closeModal(ov); resolve(null); } });
    document.body.appendChild(ov);

    // ── Validation live (needsAuth uniquement) ─────────────────────
    function updateSubmit() {
      if (!needsAuth) { btn.disabled = false; return; }
      const nameOk  = nameData.name?.trim().length >= 3;
      const phoneOk = (phoneData.phone || '').length >= 8;
      btn.disabled  = !(nameOk && phoneOk);
    }

    if (needsAuth) {
      // Écouter les mutations de nameData via l'input
      nameInput?.addEventListener('input', () => {
        nameData.name = nameInput.value;
        updateSubmit();
        if (nameInput.value.trim().length > 0) errEl.textContent = '';
      });
      // makeIntlPhoneInput écrit directement dans phoneData.phone à chaque frappe
      // On observe via MutationObserver ou simplement via input sur le champ généré
      const phoneInput = sheet.querySelector('#k-sm-ph');
      phoneInput?.addEventListener('input', () => { updateSubmit(); errEl.textContent = ''; });
    }

    // ── Soumission ─────────────────────────────────────────────────
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const title = titleData.title.trim();
      const name  = nameData.name.trim();
      const phone = phoneData.phone || '';

      if (needsAuth) {
        if (name.length < 3) {
          errEl.textContent = 'Nom invalide (3 caractères minimum).';
          nameInput?.focus();
          return;
        }
        if (phone.length < 8) {
          errEl.textContent = 'Numéro de téléphone invalide.';
          sheet.querySelector('#k-sm-ph')?.focus();
          return;
        }
      }

      // Cohérence avec le flow participant : requireIdentity au moment du Confirmer,
      // pas à l ouverture du formulaire.
      btn.disabled = true;
      btn.textContent = '🔐 Vérification…';
      errEl.textContent = '';

      try {
        const identity = await requireIdentity({
          reason: 'créer un panier groupe',
          title: 'Sécuriser votre panier groupe',
        });

        if (!identity) {
          btn.disabled = false;
          btn.textContent = 'Créer le panier →';
          return;
        }

        closeModal(ov);
        resolve({ title, name, phone: phone || null });
      } catch (err) {
        errEl.textContent = err?.message || 'Erreur de vérification.';
        btn.disabled = false;
        btn.textContent = 'Créer le panier →';
      }
    });

    head.querySelector('.k-sm-close').addEventListener('click', () => { closeModal(ov); resolve(null); });
    sheet.querySelector('#k-sm-title-f')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !btn.disabled) btn.click();
    });

    // Focus initial
    setTimeout(() => (sheet.querySelector('#k-sm-title-f') || nameInput)?.focus(), 80);
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

/* ── S2-05 — Modale panier actif détecté ─────────────────────── */
function promptActiveCartChoice(cartName) {
  return new Promise(resolve => {
    ensureStyles();
    const ov = openModal(`
      <div class="k-sm-head">
        <span class="k-sm-title">👥 Panier groupe actif</span>
        <button class="k-sm-close" aria-label="Fermer">✕</button>
      </div>
      <p class="k-sm-hint">
        Vous avez déjà un panier groupe actif :
        <strong>${String(cartName || 'Panier groupe').replace(/</g,'&lt;')}</strong>.
      </p>
      <div class="k-sm-choice">
        <button class="k-sm-btn" id="k-sm-view-group">👥 Voir mon groupe actif</button>
        <button class="k-sm-btn k-sm-btn-secondary" id="k-sm-new-group">+ Créer un nouveau groupe</button>
        <button class="k-sm-btn k-sm-btn-ghost" id="k-sm-cancel-choice">Annuler</button>
      </div>`);

    ov.querySelector('#k-sm-view-group').addEventListener('click', () => {
      closeModal(ov); resolve('view');
    });
    ov.querySelector('#k-sm-new-group').addEventListener('click', () => {
      closeModal(ov); resolve('new');
    });
    ov.querySelector('#k-sm-cancel-choice').addEventListener('click', () => {
      closeModal(ov); resolve(null);
    });
    ov.querySelector('.k-sm-close').addEventListener('click', () => {
      closeModal(ov); resolve(null);
    });
  });
}

/* ── Flow principal ─────────────────────────────────────────────── */
export async function startShareFlow(opts = {}) {
  const { reshare = false } = opts;

  // FIX S2-05 — attendre la restauration backend avant d'utiliser state.shareToken
  // Évite la race condition : clic rapide → shareToken null car restore pas fini
  if (_restorePromise) {
    await _restorePromise;
    _restorePromise = null;
  }

  if (!state.cart?.length) {
    showToast("Ajoutez d'abord des produits au panier.", 'error');
    return;
  }

  if (reshare && state.shareToken) {
    const shareUrl = state.shareUrl || `${window.location.origin}/boutique/?p=${state.shareToken}`;
    openWhatsApp(state.cartName, shareUrl);
    return;
  }

  // S2-05 — Si un panier actif existe déjà, proposer deux options
  if (!reshare && state.shareToken) {
    const choice = await promptActiveCartChoice(state.cartName);
    if (!choice) return;
    if (choice === 'view') {
      switchToGroup();
      return;
    }
    // choice === 'new' → on continue vers promptInit
  }

  // Doctrine identité Komerce — cohérence avec le flow participant :
  // requireIdentity() se déclenche au clic "Confirmer" dans promptInit,
  // pas à l'ouverture du formulaire.
  const formData = await promptInit(false);
  if (!formData) return;

  const btn = document.getElementById('k-cart-share') || document.getElementById('k-sc-share');
  if (btn) { btn.disabled = true; btn.textContent = 'â³ Création…'; }

  try {
    const data = await createSharedCart(formData);

    const title = formData.title || 'Panier groupe';
    const cart = {
      id: data.shared_cart_id,
      token: data.token,
      share_url: data.share_url || `${window.location.origin}/boutique/?p=${data.token}`,
      title,
      status: 'active',
      total_kmf_snapshot: data.total_kmf,
      contributed_kmf: 0,
      remaining_kmf: data.total_kmf,
      expires_at: data.expires_at,
      created_at: new Date().toISOString(),
    };

    // Doctrine v4.2 — N4-CLEAR (ordre critique)
    // 1. Poser l'état groupe EN PREMIER — showBanner() vérifie state.shareToken.
    // 2. Vider le panier EN SECOND, avec guard pour que cart:cleared ne détruise pas
    //    le shareToken qu'on vient de poser.
    applyCartToState(cart);
    refreshSharedBadges(true, cart);
    showBanner({
      title,
      expires_at: data.expires_at,
      status: 'active',
      contributed_kmf: 0,
      total_kmf_snapshot: data.total_kmf,
    });

    showToast('Panier groupe créé. Vérifiez le suivi puis partagez le lien quand vous êtes prêt.', 'success');

    _skipClearShareOnCartCleared = true;
    clearCart();
    _skipClearShareOnCartCleared = false;

    switchToGroup();
  } catch (err) {
    showToast(`Erreur : ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Payer en groupe'; }
  }
}

async function handleShareClick() {
  return startShareFlow({ reshare: false });
}

/* ── Installation ───────────────────────────────────────────────── */
let _installed = false;
let _restorePromise = null; // FIX S2-05 — permet d'attendre la restauration dans startShareFlow
let _skipClearShareOnCartCleared = false; // FIX N4-CLEAR — évite que clearCart() efface shareToken juste posé

export function install() {
  if (_installed) return;
  _installed = true;

  loadShareState();

  if (state.shareToken) {
    refreshSharedBadges(true);
    refreshBanner();
  }

  _restorePromise = restoreSharedCartFromBackend({ silent: true });

  document.getElementById('k-cart-share')?.addEventListener('click', handleShareClick);

  document.getElementById('k-sc-share')?.addEventListener('click', handleShareClick);

  document.getElementById('k-cart-reshare')?.addEventListener('click', () =>
    startShareFlow({ reshare: true }));

  document.getElementById('k-sc-reshare')?.addEventListener('click', () =>
    startShareFlow({ reshare: true }));

  document.getElementById('k-sc-group-view')?.addEventListener('click', switchToGroup);

  document.addEventListener('cart:cleared', () => {
    if (_skipClearShareOnCartCleared) return; // N4-CLEAR — vidage intentionnel post-création groupe
    clearShareState();
    refreshSharedBadges(false);
  });
}

