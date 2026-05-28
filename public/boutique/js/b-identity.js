/**
 * @module b-identity
 * @brief Identité légère Komerce — gate OTP réutilisable boutique/checkout/groupe.
 *
 * Doctrine :
 * - ne bloque pas la découverte ;
 * - se déclenche au dernier moment utile ;
 * - téléphone / WhatsApp vérifié = registre Komerce ;
 * - après OTP, le backend pose le cookie httpOnly kmrc_jwt.
 */

import { state } from './b-store.js';
import { showToast } from './b-cart-core.js';
import { sanitize } from './b-utils.js';
import { makeIntlPhoneInput } from './b-phone.js';

const STYLE_ID = 'k-identity-gate-styles';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
.k-id-overlay{position:fixed;inset:0;z-index:2400;background:rgba(18,22,18,.48);display:flex;align-items:flex-end;justify-content:center;animation:kIdFade .18s ease}
@keyframes kIdFade{from{opacity:0}to{opacity:1}}
@media(min-width:640px){.k-id-overlay{align-items:center}}
.k-id-sheet{width:100%;max-width:420px;background:var(--white,#fff);border-radius:22px 22px 0 0;padding:22px 18px calc(24px + env(safe-area-inset-bottom));box-shadow:0 24px 80px rgba(0,0,0,.22);animation:kIdUp .24s ease}
@media(min-width:640px){.k-id-sheet{border-radius:22px;padding:22px}}
@keyframes kIdUp{from{transform:translateY(28px);opacity:.9}to{transform:none;opacity:1}}
.k-id-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:12px}
.k-id-title{display:block;font-size:18px;font-weight:900;color:var(--text);line-height:1.2}
.k-id-sub{display:block;margin-top:4px;font-size:13px;line-height:1.35;color:var(--text-muted)}
.k-id-close{width:32px;height:32px;border:0;border-radius:999px;background:var(--sand,#f7f0e8);color:var(--text-muted);cursor:pointer;font-weight:900}
.k-id-trust{display:grid;gap:6px;background:rgba(239,125,95,.10);border:1px solid rgba(239,125,95,.22);border-radius:14px;padding:10px 12px;margin:0 0 14px;color:var(--text);font-size:12px;line-height:1.32}
.k-id-trust strong{font-size:13px;color:var(--text)}
.k-id-field{margin:0 0 12px}
.k-id-field label,.k-id-sheet .k-ck-label{display:block;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);margin-bottom:5px}
.k-id-sheet .k-ck-group{margin:0 0 12px}
.k-id-sheet .k-ck-phone-wrap{display:flex;gap:8px;align-items:stretch}
.k-id-sheet .k-ck-phone-select{flex:0 0 auto;min-height:42px;border:2px solid var(--border);border-radius:12px;background:#fff;color:var(--text);font-weight:700;padding:0 8px}
.k-id-sheet .k-ck-phone-input,.k-id-input{width:100%;min-height:42px;border:2px solid var(--border);border-radius:12px;padding:9px 12px;font-size:15px;box-sizing:border-box;outline:none;background:#fff;color:var(--text)}
.k-id-sheet .k-ck-phone-input:focus,.k-id-input:focus{border-color:var(--coral,#ef7d5f)}
.k-id-code-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end}
.k-id-link{border:0;background:transparent;color:var(--coral,#ef7d5f);font-size:12px;font-weight:900;padding:0 0 10px;cursor:pointer;white-space:nowrap}
.k-id-error{min-height:18px;margin:2px 0 8px;color:var(--red-danger-text,#b91c1c);font-size:12px;line-height:1.35}
.k-id-btn{width:100%;min-height:44px;border:0;border-radius:999px;background:var(--coral,#ef7d5f);color:#fff;font-size:15px;font-weight:900;cursor:pointer}
.k-id-btn:disabled{opacity:.58;cursor:not-allowed}
.k-id-secondary{margin-top:8px;background:var(--sand,#f7f0e8);color:var(--text)}
.k-id-known{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid rgba(31,122,84,.20);background:rgba(31,122,84,.08);border-radius:14px;padding:10px 12px;margin-bottom:12px}
.k-id-known strong{display:block;font-size:13px;color:var(--text)}
.k-id-known span{display:block;font-size:12px;color:var(--text-muted);margin-top:2px}
.k-id-known button{border:0;background:transparent;color:var(--coral,#ef7d5f);font-weight:900;cursor:pointer;font-size:12px}


/* ULTRA COMPACT — Identity OTP modal */
@media(min-width:640px){
  .k-id-sheet{
    max-width:380px!important;
    padding:16px!important;
    border-radius:18px!important;
  }
}

.k-id-sheet{
  padding-top:16px!important;
}

.k-id-head{
  margin-bottom:8px!important;
}

.k-id-title{
  font-size:16px!important;
  line-height:1.12!important;
}

.k-id-sub{
  margin-top:2px!important;
  font-size:11.8px!important;
  line-height:1.22!important;
}

.k-id-close{
  width:28px!important;
  height:28px!important;
  font-size:13px!important;
}

.k-id-trust{
  padding:7px 9px!important;
  margin:0 0 9px!important;
  border-radius:11px!important;
  gap:3px!important;
  font-size:10.8px!important;
  line-height:1.2!important;
}

.k-id-trust strong{
  font-size:11.8px!important;
}

.k-id-known{
  padding:7px 9px!important;
  margin-bottom:8px!important;
  border-radius:11px!important;
}

.k-id-known strong{
  font-size:11.8px!important;
}

.k-id-known span{
  font-size:10.8px!important;
  margin-top:1px!important;
}

.k-id-sheet .k-ck-group,
.k-id-field{
  margin-bottom:8px!important;
}

.k-id-field label,
.k-id-sheet .k-ck-label{
  font-size:10px!important;
  margin-bottom:3px!important;
}

.k-id-sheet .k-ck-phone-select,
.k-id-sheet .k-ck-phone-input,
.k-id-input{
  min-height:34px!important;
  padding:6px 8px!important;
  font-size:12px!important;
  border-radius:9px!important;
}

.k-id-code-row{
  gap:6px!important;
}

.k-id-link{
  font-size:10.8px!important;
  padding-bottom:8px!important;
}

.k-id-error{
  min-height:14px!important;
  margin:0 0 5px!important;
  font-size:10.8px!important;
}

.k-id-btn{
  min-height:36px!important;
  font-size:12.8px!important;
}

.k-id-secondary{
  margin-top:6px!important;
}
`;
  document.head.appendChild(s);
}

function normalizeUser(raw) {
  if (!raw) return null;
  const user = raw.user || raw;
  const name = user.full_name || user.fullName || user.name || user.display_name || user.displayName || user.customer_name || '';
  const phone = user.phone || user.whatsapp_phone || user.whatsapp || user.mobile || '';
  if (!name && !phone && !user.id) return null;
  return { ...user, name, full_name: name, phone };
}

export function getCurrentIdentity() {
  const kUser = normalizeUser(window.K?.auth?.getUser?.() || window.K?.getUser?.());
  if (kUser) return kUser;
  return normalizeUser(state.user || state.customer || state.client || state.profile || null);
}

export async function restoreIdentity() {
  const current = getCurrentIdentity();
  if (current) return current;
  try {
    const user = await window.K?.auth?.restore?.();
    const normalized = normalizeUser(user);
    if (normalized) {
      state.user = normalized;
      return normalized;
    }
  } catch (_) {}
  return null;
}

function closeOverlay(ov) {
  if (!ov) return;
  ov.style.animation = 'kIdFade .12s ease reverse';
  setTimeout(() => ov.remove(), 120);
}

function reasonText(reason) {
  if (/groupe|panier/i.test(reason || '')) return 'Confirmez votre WhatsApp pour sécuriser votre panier groupe.';
  if (/commande|checkout/i.test(reason || '')) return 'Confirmez votre WhatsApp pour sécuriser votre commande.';
  if (/particip/i.test(reason || '')) return 'Confirmez votre WhatsApp pour retrouver votre participation.';
  return 'Confirmez votre WhatsApp pour continuer en sécurité.';
}

function openIdentityModal({ reason = 'continuer', title = 'Confirmer votre WhatsApp' } = {}) {
  ensureStyles();
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'k-id-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');

    const phoneData = { phone: '' };
    ov.innerHTML = `
      <div class="k-id-sheet">
        <div class="k-id-head">
          <div>
            <span class="k-id-title">${sanitize(title)}</span>
            <span class="k-id-sub">${sanitize(reasonText(reason))}</span>
          </div>
          <button class="k-id-close" type="button" aria-label="Fermer">✕</button>
        </div>
        <div class="k-id-trust">
          <strong>Votre numéro devient votre registre Komerce.</strong>
          <span>On pourra retrouver vos paniers, engagements et commandes sans vous redemander les mêmes informations.</span>
        </div>
        <div id="k-id-phone-host"></div>
        <div class="k-id-code-row" id="k-id-code-row" hidden>
          <div class="k-id-field">
            <label for="k-id-code">Code reçu</label>
            <input id="k-id-code" class="k-id-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="123456">
          </div>
          <button class="k-id-link" type="button" id="k-id-resend">Renvoyer</button>
        </div>
        <p class="k-id-error" id="k-id-error"></p>
        <button class="k-id-btn" type="button" id="k-id-next">Recevoir le code</button>
        <button class="k-id-btn k-id-secondary" type="button" id="k-id-cancel">Annuler</button>
      </div>`;

    const host = ov.querySelector('#k-id-phone-host');
    const phoneGroup = makeIntlPhoneInput('k-id-phone', 'Votre numéro WhatsApp', phoneData, 'phone');
    host.appendChild(phoneGroup);

    const err = ov.querySelector('#k-id-error');
    const next = ov.querySelector('#k-id-next');
    const codeRow = ov.querySelector('#k-id-code-row');
    const codeInput = ov.querySelector('#k-id-code');
    let step = 'phone';
    let sending = false;

    const fail = (message) => { err.textContent = message || 'Erreur.'; };

    async function requestCode() {
      const phone = String(phoneData.phone || '').trim();
      if (phone.length < 8) { fail('Numéro WhatsApp invalide.'); return; }
      sending = true;
      next.disabled = true;
      next.textContent = 'Envoi du code…';
      err.textContent = '';
      try {
        const res = await fetch('/api/auth/otp/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ phone }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) throw new Error(data.error || 'Impossible d’envoyer le code.');
        step = 'code';
        codeRow.hidden = false;
        next.textContent = 'Confirmer';
        setTimeout(() => codeInput?.focus(), 50);
      } catch (e) {
        fail(e.message);
        next.textContent = 'Recevoir le code';
      } finally {
        sending = false;
        next.disabled = false;
      }
    }

    async function verifyCode() {
      const phone = String(phoneData.phone || '').trim();
      const code = String(codeInput?.value || '').replace(/\D/g, '');
      if (!/^\d{6}$/.test(code)) { fail('Code à 6 chiffres requis.'); return; }
      next.disabled = true;
      next.textContent = 'Vérification…';
      err.textContent = '';
      try {
        const res = await fetch('/api/auth/otp/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ phone, code }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) throw new Error(data.error || 'Code invalide.');
        const user = normalizeUser(data.user);
        state.user = user;
        if (window.K?.auth?.restore) {
          try { await window.K.auth.restore(); } catch (_) {}
        }
        showToast('WhatsApp confirmé.', 'success');
        closeOverlay(ov);
        resolve(user || data.user || { phone });
      } catch (e) {
        fail(e.message);
        next.disabled = false;
        next.textContent = 'Confirmer';
      }
    }

    next.addEventListener('click', () => {
      if (sending) return;
      if (step === 'phone') requestCode();
      else verifyCode();
    });
    ov.querySelector('#k-id-resend')?.addEventListener('click', requestCode);
    ov.querySelector('#k-id-cancel')?.addEventListener('click', () => { closeOverlay(ov); resolve(null); });
    ov.querySelector('.k-id-close')?.addEventListener('click', () => { closeOverlay(ov); resolve(null); });
    ov.addEventListener('click', e => { if (e.target === ov) { closeOverlay(ov); resolve(null); } });
    ov.addEventListener('keydown', e => { if (e.key === 'Enter') next.click(); });

    document.body.appendChild(ov);
    setTimeout(() => ov.querySelector('#k-id-phone')?.focus(), 80);
  });
}

/**
 * Affiche un écran léger "Vous êtes reconnu" quand une identité existe
 * et que allowOtherPhone:true est demandé.
 * Résout immédiatement si l'utilisateur confirme, ou ouvre le flow OTP
 * s'il veut utiliser un autre numéro. Résout null si l'overlay est fermé.
 */
function openKnownIdentityConfirm(user, options = {}) {
  ensureStyles();
  const { reason, title = 'Votre commande' } = options;
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'k-id-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');

    const displayName = sanitize(user.full_name || user.name || user.phone || '');
    const displayPhone = sanitize(user.phone || '');

    ov.innerHTML = `
      <div class="k-id-sheet">
        <div class="k-id-head">
          <div>
            <span class="k-id-title">${sanitize(title)}</span>
            <span class="k-id-sub">${sanitize(reasonText(reason))}</span>
          </div>
          <button class="k-id-close" type="button" aria-label="Fermer">✕</button>
        </div>
        <div class="k-id-known" role="status">
          <div>
            <strong>${displayName || displayPhone}</strong>
            ${displayName && displayPhone ? `<span>${displayPhone}</span>` : ''}
          </div>
          <button type="button" id="k-id-change-btn">Ce n'est pas vous ?</button>
        </div>
        <p class="k-id-error" id="k-id-error"></p>
        <button class="k-id-btn" type="button" id="k-id-confirm-btn">Continuer</button>
        <button class="k-id-btn k-id-secondary" type="button" id="k-id-cancel">Annuler</button>
      </div>`;

    const confirmBtn = ov.querySelector('#k-id-confirm-btn');
    const changeBtn  = ov.querySelector('#k-id-change-btn');

    confirmBtn.addEventListener('click', () => {
      closeOverlay(ov);
      resolve(user);
    });

    changeBtn.addEventListener('click', async () => {
      closeOverlay(ov);
      const newUser = await openIdentityModal({
        reason: 'changer d\'identité',
        title: 'Utiliser un autre numéro',
      });
      resolve(newUser); // null si fermé sans OTP
    });

    ov.querySelector('#k-id-cancel')?.addEventListener('click',  () => { closeOverlay(ov); resolve(null); });
    ov.querySelector('.k-id-close')?.addEventListener('click',   () => { closeOverlay(ov); resolve(null); });
    ov.addEventListener('click', e => { if (e.target === ov) { closeOverlay(ov); resolve(null); } });
    ov.addEventListener('keydown', e => { if (e.key === 'Enter') confirmBtn.click(); });

    document.body.appendChild(ov);
    setTimeout(() => confirmBtn?.focus(), 80);
  });
}

export async function requireIdentity(options = {}) {
  const { allowOtherPhone = false } = options;
  const existing = await restoreIdentity();
  if (existing) {
    if (allowOtherPhone) {
      // Doctrine §7 / §16 : si identité connue et allowOtherPhone, montrer le
      // bloc "Vous êtes reconnu · Ce n'est pas vous ?" avant de continuer.
      return openKnownIdentityConfirm(existing, options);
    }
    return existing;
  }
  return openIdentityModal(options);
}

export function bindChangeIdentity(el, selector, onChanged) {
  el?.querySelector(selector)?.addEventListener('click', async () => {
    const user = await openIdentityModal({ reason: 'changer d’identité', title: 'Utiliser un autre numéro' });
    if (user) onChanged?.(user);
  });
}
