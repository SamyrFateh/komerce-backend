/**
 * @komerce-arch
 * @role          boutique-passkey-enrollment
 * @domain        auth-passkey
 * @layer         ui-service
 * @criticality   high
 * @inputs        komerce:sensitive-operation-confirmed, WebAuthn registration options
 * @outputs       webauthn_registration_response, passkey_enrollment_state
 * @depends       routes/auth-passkey.js, browser WebAuthn API
 * @used-by       public/boutique/js/main.js
 * @doctrine      post_sensitive_otp_enrollment, no_secret_in_js_storage, user_opt_in
 * @impact-areas  auth, account-security
 * @version       2026-08
 */
'use strict';

const OFFER_SEEN_KEY = 'komerce_passkey_offer_seen';
const OVERLAY_SELECTOR = '.k-passkey-enroll-overlay';
let installed = false;
let offerQueued = false;

function storageGet(key) {
  try { return window.sessionStorage?.getItem(key); } catch (_) { return null; }
}

function storageSet(key, value) {
  try { window.sessionStorage?.setItem(key, value); } catch (_) {}
}

export function isPasskeySupported() {
  return typeof window !== 'undefined'
    && typeof window.PublicKeyCredential !== 'undefined'
    && Boolean(window.navigator?.credentials?.create);
}

export function base64urlToBytes(value) {
  const input = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  const binary = window.atob(padded);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

export function bytesToBase64url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || new ArrayBuffer(0));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function parseCreationOptions(options) {
  if (typeof window.PublicKeyCredential?.parseCreationOptionsFromJSON === 'function') {
    return window.PublicKeyCredential.parseCreationOptionsFromJSON(options);
  }

  return {
    ...options,
    challenge: base64urlToBytes(options.challenge),
    user: {
      ...options.user,
      id: base64urlToBytes(options.user?.id),
    },
    excludeCredentials: (options.excludeCredentials || []).map(credential => ({
      ...credential,
      id: base64urlToBytes(credential.id),
    })),
  };
}

export function serializeRegistrationCredential(credential) {
  if (credential && typeof credential.toJSON === 'function') {
    return credential.toJSON();
  }

  const response = credential?.response;
  if (!credential || !response) throw new Error('Réponse WebAuthn absente.');

  const serializedResponse = {
    clientDataJSON: bytesToBase64url(response.clientDataJSON),
    attestationObject: bytesToBase64url(response.attestationObject),
    transports: typeof response.getTransports === 'function' ? response.getTransports() : [],
  };

  if (typeof response.getAuthenticatorData === 'function') {
    const authenticatorData = response.getAuthenticatorData();
    if (authenticatorData) serializedResponse.authenticatorData = bytesToBase64url(authenticatorData);
  }
  if (typeof response.getPublicKey === 'function') {
    const publicKey = response.getPublicKey();
    if (publicKey) serializedResponse.publicKey = bytesToBase64url(publicKey);
  }
  if (typeof response.getPublicKeyAlgorithm === 'function') {
    serializedResponse.publicKeyAlgorithm = response.getPublicKeyAlgorithm();
  }

  return {
    id: credential.id,
    rawId: bytesToBase64url(credential.rawId),
    type: credential.type || 'public-key',
    authenticatorAttachment: credential.authenticatorAttachment || undefined,
    clientExtensionResults: typeof credential.getClientExtensionResults === 'function'
      ? credential.getClientExtensionResults()
      : {},
    response: serializedResponse,
  };
}

function deviceLabel() {
  const platform = String(window.navigator?.userAgentData?.platform || window.navigator?.platform || '').trim();
  return platform ? `Passkey ${platform}`.slice(0, 80) : 'Passkey de cet appareil';
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Opération impossible.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function getFocusable(root) {
  return Array.from(root.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter(el => !el.hidden && el.getAttribute('aria-hidden') !== 'true');
}

function makeBackgroundInert(overlay) {
  return Array.from(document.body.children)
    .filter(el => el !== overlay)
    .map(el => ({ el, hadInert: el.hasAttribute('inert'), ariaHidden: el.getAttribute('aria-hidden') }))
    .map(record => {
      record.el.setAttribute('inert', '');
      record.el.setAttribute('aria-hidden', 'true');
      return record;
    });
}

function restoreBackground(records) {
  records.forEach(({ el, hadInert, ariaHidden }) => {
    if (!el?.isConnected) return;
    if (hadInert) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
    if (ariaHidden === null) el.removeAttribute('aria-hidden');
    else el.setAttribute('aria-hidden', ariaHidden);
  });
}

function closePrompt(overlay, background, focusOrigin) {
  if (!overlay?.isConnected) return;
  overlay.classList.add('k-id-overlay--out');
  document.body.classList.remove('k-id-scroll-lock');
  restoreBackground(background);
  window.setTimeout(() => {
    overlay.remove();
    if (focusOrigin?.isConnected) focusOrigin.focus();
  }, 150);
}

function mountPrompt({ purpose = 'sensitive' } = {}) {
  const recovery = purpose === 'recovery';
  const focusOrigin = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'k-id-overlay k-passkey-enroll-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'k-passkey-title');
  overlay.setAttribute('aria-describedby', 'k-passkey-sub');
  overlay.innerHTML = `
    <div class="k-id-sheet">
      <div class="k-id-handle" aria-hidden="true"></div>
      <div class="k-id-head">
        <div>
          <span class="k-id-title" id="k-passkey-title">${recovery ? 'Créer une nouvelle passkey' : 'Valider plus vite la prochaine fois'}</span>
          <span class="k-id-sub" id="k-passkey-sub">${recovery ? 'Votre compte est récupéré. Créez une nouvelle passkey pour vos prochaines validations.' : 'Pour vos prochaines opérations sensibles, utilisez la sécurité de votre téléphone ou ordinateur au lieu d’un code WhatsApp.'}</span>
        </div>
        <button class="k-id-close" type="button" aria-label="Fermer">✕</button>
      </div>
      <div class="k-id-step">
        <div class="k-id-recap">
          <div class="k-id-recap-av" aria-hidden="true">K</div>
          <div class="k-id-recap-info">
            <span class="k-id-recap-name">Passkey Komerce</span>
            <span class="k-id-recap-phone">Face ID, empreinte ou code de l’appareil</span>
          </div>
        </div>
        <p class="k-id-sub">Votre biométrie ne quitte jamais votre appareil. Komerce enregistre uniquement une clé publique.</p>
        <p class="k-id-error" id="k-passkey-error" role="alert" aria-live="assertive" aria-atomic="true"></p>
        <button class="k-id-btn" type="button" id="k-passkey-enable" disabled>Préparation…</button>
        <button class="k-id-btn k-id-secondary" type="button" id="k-passkey-later">Plus tard</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  const background = makeBackgroundInert(overlay);
  document.body.classList.add('k-id-scroll-lock');

  const enable = overlay.querySelector('#k-passkey-enable');
  const later = overlay.querySelector('#k-passkey-later');
  const close = overlay.querySelector('.k-id-close');
  const error = overlay.querySelector('#k-passkey-error');

  let registrationOptions = null;
  let busy = false;

  const dismiss = () => closePrompt(overlay, background, focusOrigin);

  later.addEventListener('click', dismiss);
  close.addEventListener('click', dismiss);
  overlay.addEventListener('click', event => { if (event.target === overlay) dismiss(); });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getFocusable(overlay);
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // Le challenge est préparé avant le clic : le geste utilisateur déclenche
  // directement navigator.credentials.create(), sans attendre un aller-retour réseau.
  fetchJson('/api/auth/passkey/register/options', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).then(options => {
    if (!overlay.isConnected) return;
    registrationOptions = options;
    enable.disabled = false;
    enable.textContent = 'Activer ma passkey';
    enable.focus();
  }).catch(err => {
    if (!overlay.isConnected) return;
    if (err.status === 401) {
      dismiss();
      return;
    }
    error.textContent = 'Impossible de préparer la passkey. Vous pourrez réessayer plus tard.';
    enable.textContent = 'Indisponible';
  });

  enable.addEventListener('click', async () => {
    if (busy || !registrationOptions) return;
    busy = true;
    error.textContent = '';
    enable.disabled = true;
    enable.textContent = 'Validation…';

    try {
      const publicKey = parseCreationOptions(registrationOptions);
      const credential = await window.navigator.credentials.create({ publicKey });
      if (!credential) throw new Error('Création de passkey annulée.');

      const payload = serializeRegistrationCredential(credential);
      payload.deviceLabel = deviceLabel();

      const result = await fetchJson('/api/auth/passkey/register/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!result.verified) throw new Error('Enregistrement de la passkey refusé.');

      enable.textContent = 'Passkey activée ✓';
      window.dispatchEvent(new CustomEvent('komerce:passkey-enrolled'));
      window.setTimeout(dismiss, 650);
    } catch (err) {
      busy = false;
      if (err?.name === 'NotAllowedError' || /annul/i.test(String(err?.message || ''))) {
        error.textContent = 'Création annulée. Vous pourrez réessayer quand vous voulez.';
      } else {
        error.textContent = 'La passkey n’a pas pu être créée. Réessayez ou choisissez « Plus tard ».';
      }
      enable.disabled = false;
      enable.textContent = 'Réessayer';
    }
  });

  window.setTimeout(() => later.focus(), 0);
  return overlay;
}

export async function offerPasskeyEnrollment({ purpose = 'sensitive' } = {}) {
  if (!isPasskeySupported()) return false;
  const recovery = purpose === 'recovery';
  if (!recovery && storageGet(OFFER_SEEN_KEY) === '1') return false;
  if (document.querySelector(OVERLAY_SELECTOR)) return false;

  // Marque seulement l'offre UX, jamais une preuve d'authentification.
  // sessionStorage ne contient ni JWT, ni challenge, ni credential.
  storageSet(OFFER_SEEN_KEY, '1');
  mountPrompt({ purpose });
  return true;
}

function queuePostSensitiveOtpOffer(attempt = 0, context = {}) {
  if (offerQueued) return;
  offerQueued = true;

  const run = () => {
    const blockingDialog = document.querySelector('[aria-modal="true"]');
    if (blockingDialog && attempt < 40) {
      offerQueued = false;
      window.setTimeout(() => queuePostSensitiveOtpOffer(attempt + 1, context), 250);
      return;
    }
    offerQueued = false;
    if (!blockingDialog) offerPasskeyEnrollment(context).catch(() => {});
  };

  window.setTimeout(run, attempt === 0 ? 250 : 0);
}

export function setupPasskeyEnrollment() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Doctrine 2026-08 : un OTP d'identification simple (partage, checkout,
  // ouverture de compte...) termine l'action et ne déclenche RIEN derrière.
  // L'offre Passkey n'arrive qu'après une opération sensible réellement
  // accomplie grâce à un OTP de step-up.
  window.addEventListener('komerce:sensitive-operation-confirmed', event => {
    const detail = event?.detail || {};
    if (detail.method !== 'otp' || detail.sensitive !== true || detail.completed !== true) return;
    queuePostSensitiveOtpOffer(0, { purpose: 'sensitive' });
  });
}
