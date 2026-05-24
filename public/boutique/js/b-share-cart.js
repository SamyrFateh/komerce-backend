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
const API_OTP_REQUEST = `${API_BASE}/api/auth/otp/request`;
const API_OTP_VERIFY  = `${API_BASE}/api/auth/otp/verify`;
const API_AUTH_ME     = `${API_BASE}/api/auth/me`;
const API_SHARED_CART = `${API_BASE}/api/shared-cart/from-cart-items`;

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
async function isAuthenticated() {
  try {
    const res = await fetch(API_AUTH_ME, { credentials: 'include' });
    return res.ok;
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

/* ── Étape B : Flow OTP ─────────────────────────────────────────── */
function promptOtp() {
  return new Promise(resolve => {
    ensureCss();
    let otpSent = false;
    let phone   = '';
    let resendTimeout = null;

    const overlay = createModal(`
      <div class="k-share-modal-head">
        <span class="k-share-modal-title">Votre identité</span>
        <button class="k-share-modal-close" aria-label="Fermer">✕</button>
      </div>
      <p class="k-share-modal-hint">Un code WhatsApp vous sera envoyé pour confirmer votre numéro.</p>
      <div id="k-share-otp-form">
        <div class="k-share-modal-field-group">
          <label class="k-share-modal-label" for="k-share-otp-name">Votre nom</label>
          <input id="k-share-otp-name" class="k-share-modal-input" type="text"
            placeholder="Prénom Nom" maxlength="80" autocomplete="name">
        </div>
        <div class="k-share-modal-field-group">
          <label class="k-share-modal-label" for="k-share-otp-phone">Téléphone</label>
          <input id="k-share-otp-phone" class="k-share-modal-input" type="tel"
            placeholder="+33 6 … ou +269 …" autocomplete="tel">
        </div>
        <p class="k-share-modal-error" id="k-share-otp-err1"></p>
        <button class="k-share-modal-btn" id="k-share-otp-send">
          Recevoir mon code WhatsApp
        </button>
      </div>
      <div id="k-share-otp-code-block" style="display:none">
        <div class="k-share-otp-sent" id="k-share-otp-sent-banner"></div>
        <div class="k-share-modal-field-group">
          <label class="k-share-modal-label" for="k-share-otp-code">Code à 6 chiffres</label>
          <input id="k-share-otp-code" class="k-share-modal-input k-otp-code-input" type="text"
            inputmode="numeric" pattern="[0-9]{6}" maxlength="6"
            placeholder="000000" autocomplete="one-time-code">
          <p class="k-share-modal-error" id="k-share-otp-err2"></p>
        </div>
        <button class="k-share-modal-btn" id="k-share-otp-verify">Vérifier</button>
        <div class="k-share-modal-divider">ou</div>
        <button class="k-share-modal-resend" id="k-share-otp-resend" disabled>
          Renvoyer le code (attendre 30s)
        </button>
      </div>
    `);

    const nameInput    = overlay.querySelector('#k-share-otp-name');
    const phoneInput   = overlay.querySelector('#k-share-otp-phone');
    const sendBtn      = overlay.querySelector('#k-share-otp-send');
    const err1         = overlay.querySelector('#k-share-otp-err1');
    const codeBlock    = overlay.querySelector('#k-share-otp-code-block');
    const formBlock    = overlay.querySelector('#k-share-otp-form');
    const codeInput    = overlay.querySelector('#k-share-otp-code');
    const verifyBtn    = overlay.querySelector('#k-share-otp-verify');
    const err2         = overlay.querySelector('#k-share-otp-err2');
    const resendBtn    = overlay.querySelector('#k-share-otp-resend');
    const sentBanner   = overlay.querySelector('#k-share-otp-sent-banner');
    const closeBtn     = overlay.querySelector('.k-share-modal-close');

    closeBtn.addEventListener('click', () => {
      clearTimeout(resendTimeout);
      closeModal(overlay);
      resolve(null);
    });

    /* --- Envoi OTP --- */
    sendBtn.addEventListener('click', async () => {
      err1.textContent = '';
      const name  = nameInput.value.trim();
      const tel   = phoneInput.value.trim().replace(/\s/g, '');
      if (!name)  { err1.textContent = 'Entrez votre nom.'; return; }
      if (!tel || tel.length < 8) { err1.textContent = 'Numéro invalide.'; return; }

      sendBtn.disabled    = true;
      sendBtn.textContent = 'Envoi en cours…';
      phone = tel;

      try {
        /* L'endpoint /otp/request est anti-énumération : n'envoie le code
           que si l'utilisateur existe. On passe d'abord par
           authenticateOrCreateGuest via from-cart-items si besoin.
           Ici on tente directement /otp/request — si le backend retourne
           une erreur 404/403, on affiche un message d'attente et on stoppe.
           TODO: si bloquant, documenter dans docs/_work/ et demander
           au mainteneur backend de gérer la création à la volée. */
        const res = await fetch(API_OTP_REQUEST, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ phone: tel, name }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          err1.textContent = body.message || 'Erreur envoi code. Réessayez.';
          sendBtn.disabled    = false;
          sendBtn.textContent = 'Recevoir mon code WhatsApp';
          return;
        }

        otpSent = true;
        formBlock.style.display   = 'none';
        codeBlock.style.display   = 'block';
        sentBanner.textContent    = `Code envoyé sur ${tel} via WhatsApp.`;
        requestAnimationFrame(() => codeInput.focus());

        // Resend countdown 30s
        let countdown = 30;
        resendBtn.disabled    = true;
        resendBtn.textContent = `Renvoyer le code (${countdown}s)`;
        resendTimeout = setInterval(() => {
          countdown--;
          if (countdown <= 0) {
            clearInterval(resendTimeout);
            resendBtn.disabled    = false;
            resendBtn.textContent = 'Renvoyer le code';
          } else {
            resendBtn.textContent = `Renvoyer le code (${countdown}s)`;
          }
        }, 1000);

      } catch (_) {
        err1.textContent        = 'Erreur réseau. Réessayez.';
        sendBtn.disabled        = false;
        sendBtn.textContent     = 'Recevoir mon code WhatsApp';
      }
    });

    /* --- Resend --- */
    resendBtn.addEventListener('click', async () => {
      resendBtn.disabled = true;
      try {
        await fetch(API_OTP_REQUEST, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ phone }),
        });
        sentBanner.textContent = `Nouveau code envoyé sur ${phone}.`;
      } catch (_) {}
      let countdown = 30;
      resendBtn.textContent = `Renvoyer le code (${countdown}s)`;
      resendTimeout = setInterval(() => {
        countdown--;
        if (countdown <= 0) {
          clearInterval(resendTimeout);
          resendBtn.disabled    = false;
          resendBtn.textContent = 'Renvoyer le code';
        } else {
          resendBtn.textContent = `Renvoyer le code (${countdown}s)`;
        }
      }, 1000);
    });

    /* --- Vérification code --- */
    verifyBtn.addEventListener('click', async () => {
      err2.textContent = '';
      const code = codeInput.value.trim();
      if (!/^\d{6}$/.test(code)) { err2.textContent = 'Code à 6 chiffres requis.'; return; }

      verifyBtn.disabled    = true;
      verifyBtn.textContent = 'Vérification…';

      try {
        const res = await fetch(API_OTP_VERIFY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ phone, code }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          err2.textContent      = body.message || 'Code incorrect. Réessayez.';
          verifyBtn.disabled    = false;
          verifyBtn.textContent = 'Vérifier';
          return;
        }

        clearTimeout(resendTimeout);
        closeModal(overlay);
        resolve(true); // identifié avec succès

      } catch (_) {
        err2.textContent      = 'Erreur réseau. Réessayez.';
        verifyBtn.disabled    = false;
        verifyBtn.textContent = 'Vérifier';
      }
    });

    codeInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') verifyBtn.click();
    });
  });
}

/* ── Étape C : Création shared-cart ─────────────────────────────── */
async function createSharedCart(cartName) {
  const items = state.cart.map(it => ({
    product_id: it.product?.id || it.id,
    quantity:   Number(it.qty) || 1,
  })).filter(it => it.product_id);

  const res = await fetch(API_SHARED_CART, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ title: cartName, items }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Erreur API (${res.status})`);
  }

  return await res.json();
  // Réponse attendue : { id, token, public_url } ou similaire
}

/* ── Étape D : Partage WhatsApp + clipboard ─────────────────────── */
function shareViaWhatsApp(cartName, shareToken) {
  const host = window.location.origin;
  const link = `${host}/?p=${shareToken}`;
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
  const authed = await isAuthenticated();
  if (!authed) {
    const ok = await promptOtp();
    if (!ok) return; // annulé ou échec
  }

  /* ─── Étape C : Création API ────────────────────────────────── */
  let shareData;
  try {
    shareData = await createSharedCart(cartName);
  } catch (err) {
    showToast(`Erreur : ${err.message}`, 'error');
    return;
  }

  // Le backend peut retourner { token, id } ou { share_token, id } — normaliser
  const token = shareData.token || shareData.share_token;
  const id    = shareData.id;

  if (!token) {
    showToast('Erreur : token manquant dans la réponse', 'error');
    return;
  }

  state.cart.shareToken = token;
  state.cart.shareId    = id;
  saveShareState();
  refreshSharedBadges(true);

  /* ─── Étape D : WhatsApp ────────────────────────────────────── */
  shareViaWhatsApp(cartName, token);
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
  if (mobileShare)  mobileShare.textContent = isShared ? 'Re-partager' : 'Partager';

  // Side-cart desktop
  const desktopBadge  = document.getElementById('k-sc-shared-badge');
  const desktopShare  = document.getElementById('k-sc-share');
  if (desktopBadge) desktopBadge.hidden = !isShared;
  if (desktopShare) {
    const label = desktopShare.querySelector('.k-sc-btn-share-label');
    if (label) label.textContent = isShared ? 'Re-partager' : 'Partager';
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

  // Bouton "Partager" — drawer mobile
  document.getElementById('k-cart-share')?.addEventListener('click', () => {
    const isReshare = !!state.cart.shareToken;
    startShareFlow({ reshare: isReshare });
  });

  // Bouton "Partager" — side-cart desktop
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
