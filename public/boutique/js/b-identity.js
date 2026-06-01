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
import {
  PHONE_COUNTRIES,
  buildE164,
  digitsOnly,
  isValidLocalLength,
  makeIntlPhoneInput,
} from './b-phone.js';

const STYLE_ID = 'k-identity-gate-styles';

// FIX BUG-L3 : styles migrés vers css/identity.css (bundle components).
// La fonction ensureStyles() est supprimée — plus d'injection CSS depuis le JS.
function ensureStyles() { /* no-op — styles dans identity.css */ }

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
  if (/commande|checkout/i.test(reason || '')) return 'Vous allez recevoir un code sur WhatsApp pour votre première commande.';
  if (/particip/i.test(reason || '')) return 'Confirmez votre WhatsApp pour retrouver votre participation.';
  return 'Confirmez votre WhatsApp pour continuer en sécurité.';
}

function readValidatedPhoneFromField(id) {
  const input = document.getElementById(id);
  const countrySel = document.getElementById(id + '-country');
  if (!input || !countrySel) return '';

  const code = String(countrySel.value || '').trim();
  const country = PHONE_COUNTRIES.find(c => c.code === code);
  if (!country || !isValidLocalLength(code, input.value)) return '';

  return buildE164(code, digitsOnly(input.value));
}

function getCheckoutPhone() {
  return readValidatedPhoneFromField('of-beneficiary-phone')
      || readValidatedPhoneFromField('of-sender-phone')
      || '';
}

function maskPhone(phone) {
  const value = String(phone || '').trim();
  if (value.length <= 6) return value;
  return value.slice(0, 4) + '••••' + value.slice(-2);
}

function openIdentityModal({ reason = 'continuer', title = 'Confirmer votre WhatsApp', phone = '' } = {}) {
  ensureStyles();
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'k-id-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');

    const initialPhone = String(phone || getCheckoutPhone() || '').trim();
    const hasKnownPhone = initialPhone.length >= 8;
    const phoneData = { phone: initialPhone };

    ov.innerHTML = `
      <div class="k-id-sheet">
        <div class="k-id-head">
          <div>
            <span class="k-id-title">${sanitize(title)}</span>
            <span class="k-id-sub">${sanitize(reasonText(reason))}</span>
          </div>
          <button class="k-id-close" type="button" aria-label="Fermer">✕</button>
        </div>
        <div id="k-id-phone-host" ${hasKnownPhone ? 'hidden' : ''}></div>
        <p class="k-id-sent" id="k-id-sent" ${hasKnownPhone ? '' : 'hidden'}></p>
        <div class="k-id-code-row" id="k-id-code-row" hidden>
          <div class="k-id-field">
            <label for="k-id-code">Code reçu</label>
            <input id="k-id-code" class="k-id-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 chiffres">
          </div>
          <button class="k-id-link" type="button" id="k-id-resend">Renvoyer</button>
        </div>
        <p class="k-id-error" id="k-id-error"></p>
        <button class="k-id-btn" type="button" id="k-id-next">${hasKnownPhone ? 'Envoi du code…' : 'Recevoir le code'}</button>
        <button class="k-id-btn k-id-secondary" type="button" id="k-id-cancel">Annuler</button>
      </div>`;

    const host = ov.querySelector('#k-id-phone-host');
    if (!hasKnownPhone) {
      const phoneGroup = makeIntlPhoneInput('k-id-phone', 'Votre numéro WhatsApp', phoneData, 'phone');
      host.appendChild(phoneGroup);
    }

    const err = ov.querySelector('#k-id-error');
    const next = ov.querySelector('#k-id-next');
    const sent = ov.querySelector('#k-id-sent');
    const codeRow = ov.querySelector('#k-id-code-row');
    const codeInput = ov.querySelector('#k-id-code');
    let step = hasKnownPhone ? 'sending' : 'phone';
    let sending = false;

    const fail = (message) => { err.textContent = message || 'Erreur.'; };

    async function requestCode() {
      const phoneValue = String(phoneData.phone || '').trim();
      if (phoneValue.length < 8) { fail('Numéro WhatsApp invalide.'); return; }
      sending = true;
      next.disabled = true;
      next.textContent = 'Envoi du code…';
      err.textContent = '';
      try {
        const res = await fetch('/api/auth/otp/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ phone: phoneValue }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) throw new Error(data.error || 'Impossible d’envoyer le code.');
        step = 'code';
        codeRow.hidden = false;
        if (sent) {
          sent.hidden = false;
          sent.textContent = 'Code envoyé au ' + maskPhone(phoneValue);
        }
        next.textContent = 'Confirmer';
        setTimeout(() => codeInput?.focus(), 50);
      } catch (e) {
        fail(e.message);
        step = 'phone';
        next.textContent = 'Recevoir le code';
      } finally {
        sending = false;
        next.disabled = false;
      }
    }

    async function verifyCode() {
      const phoneValue = String(phoneData.phone || '').trim();
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
          body: JSON.stringify({ phone: phoneValue, code }),
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
        resolve(user || data.user || { phone: phoneValue });
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
    if (hasKnownPhone) setTimeout(requestCode, 80);
    else setTimeout(() => ov.querySelector('#k-id-phone')?.focus(), 80);
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
        phone: '',
      });
      resolve(newUser);
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
    const user = await openIdentityModal({ reason: 'changer d’identité', title: 'Utiliser un autre numéro', phone: '' });
    if (user) onChanged?.(user);
  });
}
