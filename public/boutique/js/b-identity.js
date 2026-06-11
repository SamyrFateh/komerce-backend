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

/**
 * Normalise un numéro brut vers E.164 minimal (préfixe '+' garanti).
 * Les numéros stockés côté backend peuvent manquer le '+' initial.
 */
function toE164Safe(phone) {
  const p = String(phone || '').trim();
  if (!p) return '';
  if (p.startsWith('+')) return p;
  const d = digitsOnly(p);
  return d ? '+' + d : '';
}

function normalizeUser(raw) {
  if (!raw) return null;
  const user = raw.user || raw;
  const name = user.full_name || user.fullName || user.name || user.display_name || user.displayName || user.customer_name || '';
  const phone = toE164Safe(user.phone || user.whatsapp_phone || user.whatsapp || user.mobile || '');
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
  document.body.style.overflow = '';
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

    const initialPhone = String(phone || '').trim();
    const hasKnownPhone = initialPhone.length >= 8;
    const phoneData = { phone: initialPhone, name: '' };

    // Récupère l'identité connue pour le recap
    const knownUser = getCurrentIdentity();
    const recapName  = knownUser?.full_name || knownUser?.name || '';
    const recapPhone = knownUser?.phone || initialPhone || '';
    function recapInitials(n) {
      return (String(n || '').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2) || '·').toUpperCase();
    }
    const showRecap = hasKnownPhone && (recapName || recapPhone);

    ov.innerHTML = `
      <div class="k-id-sheet">
        <div class="k-id-handle" aria-hidden="true"></div>
        <div class="k-id-head">
          <div>
            <span class="k-id-title">${sanitize(title)}</span>
            <span class="k-id-sub">${sanitize(reasonText(reason))}</span>
          </div>
          <button class="k-id-close" type="button" aria-label="Fermer">✕</button>
        </div>
        <div id="k-id-fields-host" ${hasKnownPhone ? 'hidden' : ''}></div>
        <p class="k-id-sent" id="k-id-sent" ${hasKnownPhone ? '' : 'hidden'}></p>
        ${showRecap ? `
        <div class="k-id-user-recap" id="k-id-user-recap">
          <div class="k-id-user-recap-avatar">${sanitize(recapInitials(recapName || recapPhone))}</div>
          <div class="k-id-user-recap-info">
            ${recapName ? `<span class="k-id-user-recap-name">${sanitize(recapName)}</span>` : ''}
            ${recapPhone ? `<span class="k-id-user-recap-phone">${sanitize(recapPhone)}</span>` : ''}
          </div>
        </div>
        <div class="k-id-num-links" id="k-id-num-links">
          <button class="k-id-num-link" type="button" id="k-id-num-changed">Numéro changé&nbsp;?</button>
          <button class="k-id-num-link k-id-num-link--muted" type="button" id="k-id-not-you">Pas vous&nbsp;?</button>
        </div>` : ''}
        <div id="k-id-code-section" hidden>
          <div class="k-id-otp-boxes" id="k-id-otp-boxes">
            <input class="k-id-otp-box" type="text" inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="Chiffre 1">
            <input class="k-id-otp-box" type="text" inputmode="numeric" maxlength="1" aria-label="Chiffre 2">
            <input class="k-id-otp-box" type="text" inputmode="numeric" maxlength="1" aria-label="Chiffre 3">
            <input class="k-id-otp-box" type="text" inputmode="numeric" maxlength="1" aria-label="Chiffre 4">
            <input class="k-id-otp-box" type="text" inputmode="numeric" maxlength="1" aria-label="Chiffre 5">
            <input class="k-id-otp-box" type="text" inputmode="numeric" maxlength="1" aria-label="Chiffre 6">
          </div>
          <div class="k-id-resend-row" id="k-id-resend-row">
            <span id="k-id-timer-text">Renvoyer dans <strong id="k-id-timer-count">60</strong>s</span>
            <button class="k-id-resend-now" type="button" id="k-id-resend" style="display:none">Renvoyer maintenant</button>
          </div>
        </div>
        <p class="k-id-error" id="k-id-error"></p>
        <button class="k-id-btn" type="button" id="k-id-next" ${hasKnownPhone ? '' : ''}>${hasKnownPhone ? 'Envoi du code…' : 'Recevoir le code'}</button>
        <button class="k-id-btn k-id-secondary" type="button" id="k-id-cancel">Annuler</button>
      </div>`;

    const host     = ov.querySelector('#k-id-fields-host');
    const err      = ov.querySelector('#k-id-error');
    const next     = ov.querySelector('#k-id-next');
    const sent     = ov.querySelector('#k-id-sent');
    const codeSection = ov.querySelector('#k-id-code-section');
    const otpBoxes = ov.querySelectorAll('.k-id-otp-box');
    const timerText  = ov.querySelector('#k-id-timer-text');
    const timerCount = ov.querySelector('#k-id-timer-count');
    const resendBtn  = ov.querySelector('#k-id-resend');

    let step = hasKnownPhone ? 'sending' : 'phone';
    let sending = false;
    let timerInterval = null;

    // ── Champs prénom + téléphone (quand numéro inconnu) ──────────────
    if (!hasKnownPhone) {
      const nameField = document.createElement('div');
      nameField.className = 'k-id-field';
      nameField.innerHTML = '<label for="k-id-name">Votre prénom</label>'
        + '<input id="k-id-name" class="k-id-input" type="text" autocomplete="given-name" placeholder="Prénom">';
      host.appendChild(nameField);
      nameField.querySelector('#k-id-name').addEventListener('input', e => {
        phoneData.name = e.target.value.trim();
      });
      const phoneGroup = makeIntlPhoneInput('k-id-phone', 'Votre WhatsApp', phoneData, 'phone');
      host.appendChild(phoneGroup);
    }

    // ── 6 cases OTP — navigation auto-focus ──────────────────────────
    function getOtpValue() {
      return Array.from(otpBoxes).map(b => b.value.replace(/\D/g, '')).join('');
    }
    function updateConfirmState() {
      const full = getOtpValue().length === 6;
      next.disabled = !full;
      next.style.opacity = full ? '' : '.5';
    }
    function startTimer(seconds = 60) {
      clearInterval(timerInterval);
      let remaining = seconds;
      timerCount && (timerCount.textContent = remaining);
      timerText  && (timerText.style.display  = '');
      resendBtn  && (resendBtn.style.display  = 'none');
      timerInterval = setInterval(() => {
        remaining--;
        if (timerCount) timerCount.textContent = remaining;
        if (remaining <= 0) {
          clearInterval(timerInterval);
          if (timerText)  timerText.style.display  = 'none';
          if (resendBtn)  resendBtn.style.display  = '';
        }
      }, 1000);
    }

    otpBoxes.forEach((box, i) => {
      box.addEventListener('input', () => {
        const val = box.value.replace(/\D/g, '');
        box.value = val.slice(-1);
        box.classList.toggle('filled', box.value.length > 0);
        if (box.value && i < otpBoxes.length - 1) otpBoxes[i + 1].focus();
        updateConfirmState();
        if (getOtpValue().length === 6) next.click();
      });
      box.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !box.value && i > 0) {
          otpBoxes[i - 1].focus();
          otpBoxes[i - 1].value = '';
          otpBoxes[i - 1].classList.remove('filled');
          updateConfirmState();
        }
        if (e.key === 'ArrowLeft'  && i > 0) { e.preventDefault(); otpBoxes[i - 1].focus(); }
        if (e.key === 'ArrowRight' && i < otpBoxes.length - 1) { e.preventDefault(); otpBoxes[i + 1].focus(); }
      });
      box.addEventListener('paste', e => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        [...pasted.slice(0, 6)].forEach((ch, j) => {
          if (otpBoxes[j]) { otpBoxes[j].value = ch; otpBoxes[j].classList.add('filled'); }
        });
        const nextEmpty = [...otpBoxes].findIndex(b => !b.value);
        (nextEmpty >= 0 ? otpBoxes[nextEmpty] : otpBoxes[5]).focus();
        updateConfirmState();
        if (getOtpValue().length === 6) setTimeout(() => next.click(), 50);
      });
    });

    const fail = (message) => {
      err.textContent = message || 'Erreur.';
      otpBoxes.forEach(b => b.classList.add('k-id-otp-shake'));
      setTimeout(() => otpBoxes.forEach(b => b.classList.remove('k-id-otp-shake')), 350);
    };

    // ── Liens num changé / pas vous ──────────────────────────────────
    ov.querySelector('#k-id-num-changed')?.addEventListener('click', async () => {
      clearInterval(timerInterval);
      closeOverlay(ov);
      const newUser = await openIdentityModal({ reason: 'changer de numéro', title: 'Utiliser un autre numéro', phone: '' });
      resolve(newUser);
    });
    ov.querySelector('#k-id-not-you')?.addEventListener('click', async () => {
      clearInterval(timerInterval);
      closeOverlay(ov);
      const newUser = await openIdentityModal({ reason: 'changer d\'identité', title: 'Utiliser un autre numéro', phone: '' });
      resolve(newUser);
    });

    async function requestCode() {
      const phoneValue = String(phoneData.phone || '').trim();
      const nameValue  = String(phoneData.name  || '').trim();
      if (!hasKnownPhone && !nameValue) { fail('Indiquez votre prénom.'); return; }
      if (phoneValue.length < 8) { fail('Numéro WhatsApp invalide.'); return; }
      sending = true;
      next.disabled = true;
      err.textContent = '';

      next.classList.add('k-id-sending');
      next.innerHTML = '<span class="k-id-sending-dot"></span><span class="k-id-sending-dot"></span><span class="k-id-sending-dot"></span>';

      try {
        const res = await fetch('/api/auth/otp/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ phone: phoneValue }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) throw new Error(data.error || 'Impossible d\u2019envoyer le code.');
        step = 'code';
        // Afficher les cases + timer
        codeSection.hidden = false;
        if (sent) { sent.hidden = false; sent.textContent = 'Code envoy\u00e9 au ' + maskPhone(phoneValue); }
        // Masquer les champs saisie
        if (host && !hasKnownPhone) host.hidden = true;
        next.classList.remove('k-id-sending');
        next.textContent = 'Confirmer';
        next.disabled = true;
        next.style.opacity = '.5';
        startTimer(60);
        setTimeout(() => otpBoxes[0]?.focus(), 50);
      } catch (e) {
        fail(e.message);
        step = 'phone';
        next.classList.remove('k-id-sending');
        next.textContent = 'Recevoir le code';
        next.disabled = false;
        next.style.opacity = '';
      } finally {
        sending = false;
      }
    }

    async function verifyCode() {
      const phoneValue = String(phoneData.phone || '').trim();
      const code = getOtpValue();
      if (!/^\d{6}$/.test(code)) { fail('Code à 6 chiffres requis.'); return; }
      clearInterval(timerInterval);
      next.disabled = true;
      next.textContent = 'Vérification…';
      err.textContent = '';
      try {
        const res = await fetch('/api/auth/otp/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ phone: phoneValue, code, name: phoneData.name || undefined }),
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
        otpBoxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
        updateConfirmState();
        setTimeout(() => otpBoxes[0]?.focus(), 50);
      }
    }

    next.addEventListener('click', () => {
      if (sending) return;
      if (step === 'phone') requestCode();
      else verifyCode();
    });
    resendBtn?.addEventListener('click', requestCode);
    ov.querySelector('#k-id-cancel')?.addEventListener('click', () => { clearInterval(timerInterval); closeOverlay(ov); resolve(null); });
    ov.querySelector('.k-id-close')?.addEventListener('click',  () => { clearInterval(timerInterval); closeOverlay(ov); resolve(null); });
    ov.addEventListener('click', e => { if (e.target === ov) { clearInterval(timerInterval); closeOverlay(ov); resolve(null); } });
    ov.addEventListener('keydown', e => { if (e.key === 'Enter' && step !== 'code') next.click(); });

    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
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
        <div class="k-id-handle" aria-hidden="true"></div>
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
    document.body.style.overflow = 'hidden';
    setTimeout(() => confirmBtn?.focus(), 80);
  });
}

export async function requireIdentity(options = {}) {
  // Cookie kmrc_jwt validé côté backend → session prouvée → on passe sans modale.
  // Le changement de numéro est géré en amont via le bouton "Ce n'est pas vous ?"
  // dans la carte identité du checkout (k-ck-id-change / k-ck-id-modify),
  // pas sur le chemin critique du bouton Confirmer.
  const existing = await restoreIdentity();
  if (existing) return existing;
  return openIdentityModal(options);
}

export function bindChangeIdentity(el, selector, onChanged) {
  el?.querySelector(selector)?.addEventListener('click', async () => {
    const user = await openIdentityModal({ reason: 'changer d’identité', title: 'Utiliser un autre numéro', phone: '' });
    if (user) onChanged?.(user);
  });
}
