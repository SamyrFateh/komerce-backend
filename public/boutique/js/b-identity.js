/**
 * @komerce-arch
 * @role          boutique-client-identity
 * @domain        auth
 * @layer         ui-service
 * @criticality   high
 * @inputs        phone, name, otp_code, session_cookie
 * @outputs       client_identity, otp_modal_state, authenticated_session
 * @depends       b-phone.js, b-utils.js, routes/otp.js
 * @used-by       b-checkout.js, b-share-cart.js, group/group-side-cart.js
 * @doctrine      otp_une_fois, session_client_legere, premiere_commande_sans_friction
 * @impact-areas  checkout, shared-cart, tracking, auth, participant-flow
 * @version       2026-06
 */
'use strict';

/**
 * @module b-identity
 * @brief Identité légère Komerce — gate OTP réutilisable boutique/checkout/groupe.
 *
 * Doctrine :
 * - ne bloque pas la découverte ;
 * - se déclenche au dernier moment utile ;
 * - téléphone / WhatsApp vérifié = registre Komerce ;
 * - après OTP, le backend pose le cookie httpOnly kmrc_jwt.
 *
 * Flow (refonte 2026-06) :
 *   ┌─ utilisateur reconnu ──► step "recap"  → envoi auto → step "otp"
 *   └─ inconnu             ──► step "phone"              → step "otp"
 *
 * openKnownIdentityConfirm() supprimée — fusionnée dans openIdentityModal().
 */

import { state } from './b-store.js';
import { sanitize, showToast } from './b-utils.js';
import {
  PHONE_COUNTRIES,
  buildE164,
  digitsOnly,
  isValidLocalLength,
  makeIntlPhoneInput,
} from './b-phone.js';

// FIX BUG-L3 : styles dans identity.css — no-op.
function ensureStyles() {}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
  const name  = user.full_name || user.fullName || user.name || user.display_name || user.displayName || user.customer_name || '';
  const phone = toE164Safe(user.phone || user.whatsapp_phone || user.whatsapp || user.mobile || '');
  if (!name && !phone && !user.id) return null;
  return { ...user, name, full_name: name, phone };
}

function recapInitials(n) {
  return (String(n || '').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2) || '·').toUpperCase();
}

function maskPhone(phone) {
  const v = String(phone || '').trim();
  if (v.length <= 6) return v;
  return v.slice(0, 4) + '••••' + v.slice(-2);
}

function reasonText(reason) {
  if (/groupe|panier/i.test(reason || ''))   return 'Confirmez votre WhatsApp pour sécuriser votre panier groupe.';
  if (/commande|checkout/i.test(reason || '')) return 'Vous allez recevoir un code sur WhatsApp pour votre commande.';
  if (/particip/i.test(reason || ''))        return 'Confirmez votre WhatsApp pour retrouver votre participation.';
  return 'Confirmez votre WhatsApp pour continuer en sécurité.';
}

const overlayLifecycles = new WeakMap();

function closeOverlay(ov, { restoreFocus = true } = {}) {
  if (!ov) return;
  const lifecycle = overlayLifecycles.get(ov);
  if (lifecycle?.closed) return;
  if (lifecycle) {
    lifecycle.closed = true;
    lifecycle.background.forEach(({ el, hadInert, ariaHidden }) => {
      if (hadInert) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
      if (ariaHidden === null) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', ariaHidden);
    });
  }
  ov.classList.add('k-id-overlay--out');
  document.body.classList.remove('k-id-scroll-lock');
  setTimeout(() => {
    ov.remove();
    if (restoreFocus && lifecycle?.focusOrigin?.isConnected) lifecycle.focusOrigin.focus();
  }, 150);
}

function installDialogLifecycle(ov, focusOrigin) {
  const background = Array.from(document.body.children)
    .filter(el => el !== ov)
    .map(el => ({
      el,
      hadInert: el.hasAttribute('inert'),
      ariaHidden: el.getAttribute('aria-hidden'),
    }));
  background.forEach(({ el }) => {
    el.setAttribute('inert', '');
    el.setAttribute('aria-hidden', 'true');
  });
  overlayLifecycles.set(ov, { background, focusOrigin, closed: false });
}

function getDialogFocusable(ov) {
  return Array.from(ov.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(el => !el.hidden && !el.closest('[hidden]') && el.getAttribute('aria-hidden') !== 'true');
}

function readValidatedPhoneFromField(id) {
  const input      = document.getElementById(id);
  const countrySel = document.getElementById(id + '-country');
  if (!input || !countrySel) return '';
  const code = String(countrySel.value || '').trim();
  if (!PHONE_COUNTRIES.find(c => c.code === code)) return '';
  if (!isValidLocalLength(code, input.value)) return '';
  return buildE164(code, digitsOnly(input.value));
}

// ── Exports publics ──────────────────────────────────────────────────────────

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
    if (normalized) { state.user = normalized; return normalized; }
  } catch (_) {}
  return null;
}

// ── openIdentityModal ────────────────────────────────────────────────────────
//
// Steps :
//   'recap'  — utilisateur reconnu, recap + envoi auto immédiat
//   'phone'  — inconnu, saisie prénom + téléphone
//   'otp'    — cases 6 chiffres + timer
//
// La fonction openKnownIdentityConfirm() (ancienne) est supprimée :
// requireIdentity() appelle directement openIdentityModal(), qui gère
// le cas « utilisateur reconnu » via le step 'recap'.

export function openIdentityModal({ reason = 'continuer', title = 'Confirmer votre WhatsApp', phone = '', returnFocusTo = null } = {}) {
  ensureStyles();
  return new Promise(resolve => {

    // ── Données initiales ──────────────────────────────────────────────
    const initialPhone   = String(phone || '').trim();
    const hasKnownPhone  = initialPhone.length >= 8;
    const knownUser      = getCurrentIdentity();
    const recapName      = knownUser?.full_name || knownUser?.name || '';
    const recapPhone     = knownUser?.phone || initialPhone || '';
    const startWithRecap = hasKnownPhone && (recapName || recapPhone);

    const phoneData = { phone: initialPhone, name: '', lastName: '' };
    let sending      = false;
    let timerInterval = null;

    // ── DOM ────────────────────────────────────────────────────────────
    const ov = document.createElement('div');
    ov.className = 'k-id-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', sanitize(title));

    ov.innerHTML = `
      <div class="k-id-sheet">
        <div class="k-id-handle" aria-hidden="true"></div>
        <div class="k-id-head">
          <div>
            <span class="k-id-title" id="k-id-title">${sanitize(title)}</span>
            <span class="k-id-sub"   id="k-id-sub">${sanitize(reasonText(reason))}</span>
          </div>
          <button class="k-id-close" type="button" aria-label="Fermer">✕</button>
        </div>

        <!-- Step recap : utilisateur reconnu -->
        <div id="k-id-step-recap" class="k-id-step" hidden>
          <div class="k-id-recap" id="k-id-recap">
            <div class="k-id-recap-av" id="k-id-recap-av"></div>
            <div class="k-id-recap-info">
              <span class="k-id-recap-name"  id="k-id-recap-name"></span>
              <span class="k-id-recap-phone" id="k-id-recap-phone"></span>
            </div>
          </div>
          <div class="k-id-num-links">
            <button class="k-id-num-link" type="button" id="k-id-num-changed">Numéro changé&nbsp;?</button>
            <button class="k-id-num-link k-id-num-link--muted" type="button" id="k-id-not-you">Pas vous&nbsp;?</button>
          </div>
          <p class="k-id-error" id="k-id-err-recap" role="alert" aria-live="assertive" aria-atomic="true"></p>
          <button class="k-id-btn k-id-btn--sending" type="button" id="k-id-recap-cta" disabled aria-live="polite">
            <span class="k-id-sending-dot"></span>
            <span class="k-id-sending-dot"></span>
            <span class="k-id-sending-dot"></span>
          </button>
          <button class="k-id-btn k-id-secondary" type="button" id="k-id-recap-cancel">Annuler</button>
        </div>

        <!-- Step phone : inconnu -->
        <div id="k-id-step-phone" class="k-id-step" hidden>
          <div id="k-id-fields-host"></div>
          <p class="k-id-error" id="k-id-err-phone" role="alert" aria-live="assertive" aria-atomic="true"></p>
          <button class="k-id-btn k-id-btn--incomplete" type="button" id="k-id-phone-cta" aria-disabled="true">Recevoir le code</button>
          <button class="k-id-btn k-id-secondary" type="button" id="k-id-phone-cancel">Annuler</button>
        </div>

        <!-- Step OTP -->
        <div id="k-id-step-otp" class="k-id-step" hidden>
          <p class="k-id-sent" id="k-id-sent"></p>
          <div class="k-id-otp-boxes" id="k-id-otp-boxes">
            <input class="k-id-otp-box" type="text" inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="Chiffre 1">
            <input class="k-id-otp-box" type="text" inputmode="numeric" maxlength="1" aria-label="Chiffre 2">
            <input class="k-id-otp-box" type="text" inputmode="numeric" maxlength="1" aria-label="Chiffre 3">
            <input class="k-id-otp-box" type="text" inputmode="numeric" maxlength="1" aria-label="Chiffre 4">
            <input class="k-id-otp-box" type="text" inputmode="numeric" maxlength="1" aria-label="Chiffre 5">
            <input class="k-id-otp-box" type="text" inputmode="numeric" maxlength="1" aria-label="Chiffre 6">
          </div>
          <div class="k-id-resend-row" id="k-id-resend-row">
            <span id="k-id-timer-text">Renvoyer dans <strong id="k-id-timer-count">30</strong>s</span>
            <button class="k-id-resend-now" type="button" id="k-id-resend" style="display:none">Renvoyer maintenant</button>
          </div>
          <p class="k-id-error" id="k-id-err-otp" role="alert" aria-live="assertive" aria-atomic="true"></p>
          <button class="k-id-btn" type="button" id="k-id-otp-cta" disabled>Confirmer</button>
          <button class="k-id-btn k-id-secondary" type="button" id="k-id-otp-cancel">Annuler</button>
        </div>

      </div>`;

    // ── Refs DOM ───────────────────────────────────────────────────────
    const stepRecap = ov.querySelector('#k-id-step-recap');
    const stepPhone = ov.querySelector('#k-id-step-phone');
    const stepOtp   = ov.querySelector('#k-id-step-otp');

    const recapCta   = ov.querySelector('#k-id-recap-cta');
    const phoneCta   = ov.querySelector('#k-id-phone-cta');
    const otpCta     = ov.querySelector('#k-id-otp-cta');

    const errRecap   = ov.querySelector('#k-id-err-recap');
    const errPhone   = ov.querySelector('#k-id-err-phone');
    const errOtp     = ov.querySelector('#k-id-err-otp');

    const otpBoxes   = ov.querySelectorAll('.k-id-otp-box');
    const timerText  = ov.querySelector('#k-id-timer-text');
    const timerCount = ov.querySelector('#k-id-timer-count');
    const resendBtn  = ov.querySelector('#k-id-resend');
    const sentEl     = ov.querySelector('#k-id-sent');

    function clearPhoneFieldError(field) {
      if (!field || field.getAttribute('aria-describedby') !== 'k-id-err-phone') return;
      field.removeAttribute('aria-invalid');
      field.removeAttribute('aria-describedby');
      errPhone.textContent = '';
    }

    function setPhoneFieldError(message, fieldId = '') {
      ['k-id-name', 'k-id-lastname', 'k-id-phone'].forEach(id => {
        const field = ov.querySelector('#' + id);
        field?.removeAttribute('aria-invalid');
        field?.removeAttribute('aria-describedby');
      });
      errPhone.textContent = message;
      const field = fieldId ? ov.querySelector('#' + fieldId) : null;
      if (field) {
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('aria-describedby', 'k-id-err-phone');
        field.focus();
      }
    }

    function isPhoneStepComplete() {
      return Boolean(
        String(phoneData.name || '').trim() &&
        String(phoneData.lastName || '').trim() &&
        readValidatedPhoneFromField('k-id-phone')
      );
    }

    function syncPhoneCtaState() {
      const complete = isPhoneStepComplete();
      phoneCta.setAttribute('aria-disabled', String(!complete));
      phoneCta.classList.toggle('k-id-btn--incomplete', !complete);
    }

    // ── Step switcher ──────────────────────────────────────────────────
    function showStep(name) {
      stepRecap.hidden = (name !== 'recap');
      stepPhone.hidden = (name !== 'phone');
      stepOtp.hidden   = (name !== 'otp');
    }

    // ── Remplissage recap ──────────────────────────────────────────────
    function populateRecap(name, phone) {
      ov.querySelector('#k-id-recap-av').textContent    = recapInitials(name || phone);
      ov.querySelector('#k-id-recap-name').textContent  = name  || '';
      ov.querySelector('#k-id-recap-phone').textContent = phone || '';
      ov.querySelector('#k-id-recap-name').hidden       = !name;
    }

    // ── Timer ──────────────────────────────────────────────────────────
    function startTimer(seconds = 30) {
      clearInterval(timerInterval);
      let remaining = seconds;
      if (timerCount) timerCount.textContent = remaining;
      if (timerText)  timerText.style.display  = '';
      if (resendBtn)  resendBtn.style.display  = 'none';
      timerInterval = setInterval(() => {
        remaining--;
        if (timerCount) timerCount.textContent = remaining;
        if (remaining <= 0) {
          clearInterval(timerInterval);
          if (timerText) timerText.style.display = 'none';
          if (resendBtn) resendBtn.style.display  = '';
        }
      }, 1000);
    }

    // ── OTP boxes ──────────────────────────────────────────────────────
    function getOtpValue() {
      return Array.from(otpBoxes).map(b => b.value.replace(/\D/g, '')).join('');
    }
    function syncOtpCta() {
      const full = getOtpValue().length === 6;
      otpCta.disabled     = !full;
      otpCta.style.opacity = full ? '' : '.45';
    }
    function shakeBoxes() {
      otpBoxes.forEach(b => { b.classList.add('k-id-otp-shake'); setTimeout(() => b.classList.remove('k-id-otp-shake'), 350); });
    }
    function clearBoxes() {
      otpBoxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
      syncOtpCta();
    }

    otpBoxes.forEach((box, i) => {
      box.addEventListener('input', () => {
        box.value = box.value.replace(/\D/g, '').slice(-1);
        box.classList.toggle('filled', box.value.length > 0);
        if (box.value && i < otpBoxes.length - 1) otpBoxes[i + 1].focus();
        syncOtpCta();
        if (getOtpValue().length === 6) otpCta.click();
      });
      box.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !box.value && i > 0) {
          otpBoxes[i - 1].focus();
          otpBoxes[i - 1].value = '';
          otpBoxes[i - 1].classList.remove('filled');
          syncOtpCta();
        }
        if (e.key === 'ArrowLeft'  && i > 0)                { e.preventDefault(); otpBoxes[i - 1].focus(); }
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
        syncOtpCta();
        if (getOtpValue().length === 6) setTimeout(() => otpCta.click(), 50);
      });
    });

    // ── Transition vers le step OTP après envoi réussi ─────────────────
    function enterOtpStep(phoneValue) {
      if (sentEl) sentEl.textContent = 'Code envoyé au ' + maskPhone(phoneValue);
      showStep('otp');
      startTimer(30);
      setTimeout(() => otpBoxes[0]?.focus(), 50);
    }

    // ── requestCode ────────────────────────────────────────────────────
    async function requestCode(fromRecap = false) {
      const phoneValue = String(phoneData.phone || '').trim();
      const nameValue  = String(phoneData.name  || '').trim();
      const lastValue  = String(phoneData.lastName || '').trim();

      if (!fromRecap && !nameValue) { setPhoneFieldError('Indiquez votre prénom.', 'k-id-name'); return; }
      if (!fromRecap && !lastValue) { setPhoneFieldError('Indiquez votre nom.', 'k-id-lastname'); return; }
      if (phoneValue.length < 8)   {
        const errEl = fromRecap ? errRecap : errPhone;
        if (fromRecap) errEl.textContent = 'Numéro WhatsApp invalide.';
        else setPhoneFieldError('Numéro WhatsApp invalide.', 'k-id-phone');
        return;
      }

      sending = true;
      if (fromRecap) {
        errRecap.textContent = '';
        // bouton déjà en état sending dès le début — pas de changement visuel
      } else {
        errPhone.textContent = '';
        phoneCta.disabled    = true;
        phoneCta.classList.add('k-id-btn--sending');
        phoneCta.innerHTML   = '<span class="k-id-sending-dot"></span><span class="k-id-sending-dot"></span><span class="k-id-sending-dot"></span>';
      }

      try {
        const res = await fetch('/api/auth/otp/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ phone: phoneValue }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) throw new Error(data.error || 'Impossible d\u2019envoyer le code.');
        enterOtpStep(phoneValue);
      } catch (e) {
        if (fromRecap) {
          errRecap.textContent = e.message;
          recapCta.disabled    = false;
          recapCta.classList.remove('k-id-btn--sending');
          recapCta.textContent = 'Renvoyer le code';
        } else {
          errPhone.textContent = e.message;
          phoneCta.disabled    = false;
          phoneCta.classList.remove('k-id-btn--sending');
          phoneCta.textContent = 'Recevoir le code';
          syncPhoneCtaState();
        }
      } finally {
        sending = false;
      }
    }

    // ── verifyCode ─────────────────────────────────────────────────────
    async function verifyCode() {
      const phoneValue = String(phoneData.phone || '').trim();
      const code = getOtpValue();
      if (!/^\d{6}$/.test(code)) { errOtp.textContent = 'Code à 6 chiffres requis.'; return; }

      clearInterval(timerInterval);
      otpCta.disabled     = true;
      otpCta.textContent  = 'Vérification\u2026';
      errOtp.textContent  = '';

      try {
        const fullName = [phoneData.name, phoneData.lastName]
          .map(s => String(s || '').trim()).filter(Boolean).join(' ');
        const res = await fetch('/api/auth/otp/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ phone: phoneValue, code, name: fullName || undefined }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) throw new Error(data.error || 'Code invalide.');
        const user = normalizeUser(data.user);
        state.user = user;
        showToast('WhatsApp confirmé.', 'success');
        // BUGFIX point 6 : fermer + résoudre AVANT le restore. L'ancien
        // `await window.K.auth.restore()` pouvait ne jamais résoudre et
        // laissait la modal ouverte malgré un code correct. Le restore part
        // désormais en arrière-plan, sans bloquer la fermeture.
        closeOverlay(ov);
        resolve(user || data.user || { phone: phoneValue });
        if (window.K?.auth?.restore) {
          Promise.resolve().then(() => window.K.auth.restore()).catch(() => {});
        }
      } catch (e) {
        errOtp.textContent  = e.message;
        otpCta.disabled     = false;
        otpCta.textContent  = 'Confirmer';
        shakeBoxes();
        clearBoxes();
        setTimeout(() => otpBoxes[0]?.focus(), 50);
      }
    }

    // ── Listeners ─────────────────────────────────────────────────────

    // Step recap
    ov.querySelector('#k-id-num-changed')?.addEventListener('click', async () => {
      clearInterval(timerInterval);
      closeOverlay(ov, { restoreFocus: false });
      const newUser = await openIdentityModal({
        reason: 'changer de num\u00e9ro',
        title: 'Utiliser un autre num\u00e9ro',
        phone: '',
        returnFocusTo: overlayLifecycles.get(ov)?.focusOrigin || null,
      });
      resolve(newUser);
    });
    ov.querySelector('#k-id-not-you')?.addEventListener('click', async () => {
      clearInterval(timerInterval);
      closeOverlay(ov, { restoreFocus: false });
      const newUser = await openIdentityModal({
        reason: 'changer d\u2019identit\u00e9',
        title: 'Utiliser un autre num\u00e9ro',
        phone: '',
        returnFocusTo: overlayLifecycles.get(ov)?.focusOrigin || null,
      });
      resolve(newUser);
    });
    ov.querySelector('#k-id-recap-cancel')?.addEventListener('click', () => { clearInterval(timerInterval); closeOverlay(ov); resolve(null); });

    // Step phone
    if (!startWithRecap) {
      const host      = ov.querySelector('#k-id-fields-host');
      const nameField = document.createElement('div');
      nameField.className = 'k-id-field';
      nameField.innerHTML = '<label for="k-id-name">Votre pr\u00e9nom</label>'
        + '<input id="k-id-name" class="k-id-input" type="text" autocomplete="given-name" placeholder="Pr\u00e9nom">';
      host.appendChild(nameField);
      nameField.querySelector('#k-id-name').addEventListener('input', e => {
        phoneData.name = e.target.value.trim();
        clearPhoneFieldError(e.target);
        syncPhoneCtaState();
      });
      const lastNameField = document.createElement('div');
      lastNameField.className = 'k-id-field';
      lastNameField.innerHTML = '<label for="k-id-lastname">Votre nom</label>'
        + '<input id="k-id-lastname" class="k-id-input" type="text" autocomplete="family-name" placeholder="Nom">';
      host.appendChild(lastNameField);
      lastNameField.querySelector('#k-id-lastname').addEventListener('input', e => {
        phoneData.lastName = e.target.value.trim();
        clearPhoneFieldError(e.target);
        syncPhoneCtaState();
      });
      host.appendChild(makeIntlPhoneInput('k-id-phone', 'Votre WhatsApp', phoneData, 'phone'));
      ov.querySelector('#k-id-phone')?.addEventListener('input', e => {
        clearPhoneFieldError(e.target);
        syncPhoneCtaState();
      });
      ov.querySelector('#k-id-phone-country')?.addEventListener('change', syncPhoneCtaState);
      syncPhoneCtaState();
    }
    phoneCta.addEventListener('click', () => { if (!sending) requestCode(false); });
    ov.querySelector('#k-id-phone-cancel')?.addEventListener('click', () => { clearInterval(timerInterval); closeOverlay(ov); resolve(null); });

    // Step OTP
    otpCta.addEventListener('click', () => { if (!sending) verifyCode(); });
    resendBtn?.addEventListener('click', () => {
      clearBoxes();
      errOtp.textContent = '';
      requestCode(startWithRecap);
    });
    ov.querySelector('#k-id-otp-cancel')?.addEventListener('click', () => { clearInterval(timerInterval); closeOverlay(ov); resolve(null); });

    // Fermeture universelle
    ov.querySelector('.k-id-close')?.addEventListener('click', () => { clearInterval(timerInterval); closeOverlay(ov); resolve(null); });
    ov.addEventListener('click', e => { if (e.target === ov) { clearInterval(timerInterval); closeOverlay(ov); resolve(null); } });
    ov.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        clearInterval(timerInterval);
        closeOverlay(ov);
        resolve(null);
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = getDialogFocusable(ov);
      if (!focusable.length) { e.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || !ov.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !ov.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    });
    ov.addEventListener('keydown', e => { if (e.key === 'Enter' && !stepOtp.hidden) otpCta.click(); });

    // ── Mount ──────────────────────────────────────────────────────────
    const focusOrigin = returnFocusTo || document.activeElement;
    document.body.appendChild(ov);
    installDialogLifecycle(ov, focusOrigin);
    document.body.classList.add('k-id-scroll-lock');

    if (startWithRecap) {
      populateRecap(recapName, recapPhone);
      showStep('recap');
      // Envoi auto après 80ms — idem comportement précédent
      setTimeout(() => requestCode(true), 80);
    } else {
      showStep('phone');
      setTimeout(() => ov.querySelector('#k-id-name')?.focus(), 80);
    }
  });
}

// ── exports ──────────────────────────────────────────────────────────────────

export async function requireIdentity(options = {}) {
  const existing = await restoreIdentity();
  if (existing) return existing;
  return openIdentityModal(options);
}

export function bindChangeIdentity(el, selector, onChanged) {
  el?.querySelector(selector)?.addEventListener('click', async () => {
    const user = await openIdentityModal({ reason: 'changer d\u2019identit\u00e9', title: 'Utiliser un autre num\u00e9ro', phone: '' });
    if (user) onChanged?.(user);
  });
}
