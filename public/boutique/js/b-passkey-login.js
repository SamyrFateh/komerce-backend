/**
 * @komerce-arch
 * @role          boutique-passkey-login
 * @domain        auth-passkey
 * @layer         ui-service
 * @criticality   high
 * @inputs        WebAuthn authentication options, user gesture
 * @outputs       authenticated_user, kmrc_jwt_session_cookie
 * @depends       routes/auth-passkey.js, browser WebAuthn API, b-passkey-enrollment.js
 * @used-by       b-identity.js
 * @doctrine      auth4_passkey_nominal, otp_fallback_only, no_secret_in_js_storage
 * @impact-areas  auth, checkout, shared-cart, account
 * @version       2026-08
 */
'use strict';

import { base64urlToBytes, bytesToBase64url } from './b-passkey-enrollment.js';

const OVERLAY_SELECTOR = '.k-passkey-login-overlay';

export function isPasskeyLoginSupported() {
  return typeof window !== 'undefined'
    && typeof window.PublicKeyCredential !== 'undefined'
    && Boolean(window.navigator?.credentials?.get);
}

export function parseRequestOptions(options) {
  if (typeof window.PublicKeyCredential?.parseRequestOptionsFromJSON === 'function') {
    return window.PublicKeyCredential.parseRequestOptionsFromJSON(options);
  }

  return {
    ...options,
    challenge: base64urlToBytes(options.challenge),
    allowCredentials: (options.allowCredentials || []).map(credential => ({
      ...credential,
      id: base64urlToBytes(credential.id),
    })),
  };
}

export function serializeAuthenticationCredential(credential) {
  if (credential && typeof credential.toJSON === 'function') {
    return credential.toJSON();
  }

  const response = credential?.response;
  if (!credential || !response) throw new Error('Réponse WebAuthn absente.');

  return {
    id: credential.id,
    rawId: bytesToBase64url(credential.rawId),
    type: credential.type || 'public-key',
    authenticatorAttachment: credential.authenticatorAttachment || undefined,
    clientExtensionResults: typeof credential.getClientExtensionResults === 'function'
      ? credential.getClientExtensionResults()
      : {},
    response: {
      clientDataJSON: bytesToBase64url(response.clientDataJSON),
      authenticatorData: bytesToBase64url(response.authenticatorData),
      signature: bytesToBase64url(response.signature),
      userHandle: response.userHandle ? bytesToBase64url(response.userHandle) : undefined,
    },
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Opération impossible.');
    error.status = response.status;
    error.reason = data.reason;
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

function reasonText(reason) {
  if (/groupe|panier/i.test(reason || '')) return 'Identifiez-vous pour continuer avec votre panier groupe.';
  if (/commande|checkout/i.test(reason || '')) return 'Identifiez-vous pour continuer votre commande.';
  if (/particip/i.test(reason || '')) return 'Identifiez-vous pour retrouver votre participation.';
  return 'Utilisez la sécurité de votre téléphone ou ordinateur.';
}

export function openPasskeyLogin({ reason = 'continuer', returnFocusTo = null } = {}) {
  if (!isPasskeyLoginSupported()) return Promise.resolve({ outcome: 'fallback' });
  if (document.querySelector(OVERLAY_SELECTOR)) return Promise.resolve({ outcome: 'cancelled' });

  return new Promise(resolve => {
    const focusOrigin = returnFocusTo || document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'k-id-overlay k-passkey-login-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'k-passkey-login-title');
    overlay.setAttribute('aria-describedby', 'k-passkey-login-sub');
    overlay.innerHTML = `
      <div class="k-id-sheet">
        <div class="k-id-handle" aria-hidden="true"></div>
        <div class="k-id-head">
          <div>
            <span class="k-id-title" id="k-passkey-login-title">Se connecter avec une passkey</span>
            <span class="k-id-sub" id="k-passkey-login-sub">${reasonText(reason)}</span>
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
          <p class="k-id-error" id="k-passkey-login-error" role="alert" aria-live="assertive" aria-atomic="true"></p>
          <button class="k-id-btn" type="button" id="k-passkey-login-cta" disabled>Préparation…</button>
          <button class="k-id-btn k-id-secondary" type="button" id="k-passkey-login-whatsapp">Utiliser WhatsApp</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    const background = makeBackgroundInert(overlay);
    document.body.classList.add('k-id-scroll-lock');

    const cta = overlay.querySelector('#k-passkey-login-cta');
    const whatsapp = overlay.querySelector('#k-passkey-login-whatsapp');
    const close = overlay.querySelector('.k-id-close');
    const error = overlay.querySelector('#k-passkey-login-error');
    let requestOptions = null;
    let busy = false;
    let settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      overlay.classList.add('k-id-overlay--out');
      document.body.classList.remove('k-id-scroll-lock');
      restoreBackground(background);
      window.setTimeout(() => {
        overlay.remove();
        if (focusOrigin?.isConnected) focusOrigin.focus();
        resolve(result);
      }, 150);
    }

    whatsapp.addEventListener('click', () => finish({ outcome: 'fallback' }));
    close.addEventListener('click', () => finish({ outcome: 'cancelled' }));
    overlay.addEventListener('click', event => {
      if (event.target === overlay) finish({ outcome: 'cancelled' });
    });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish({ outcome: 'cancelled' });
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

    // Discoverable login: aucun numéro envoyé. Le serveur et l'authenticator
    // déterminent la credential, puis le serveur remonte au compte lié.
    fetchJson('/api/auth/passkey/login/options', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).then(options => {
      if (!overlay.isConnected || settled) return;
      requestOptions = options;
      cta.disabled = false;
      cta.textContent = 'Continuer avec ma passkey';
      cta.focus();
    }).catch(() => {
      if (!overlay.isConnected || settled) return;
      error.textContent = 'La connexion par passkey est indisponible. Utilisez WhatsApp.';
      cta.textContent = 'Passkey indisponible';
      whatsapp.focus();
    });

    cta.addEventListener('click', async () => {
      if (busy || !requestOptions) return;
      busy = true;
      error.textContent = '';
      cta.disabled = true;
      cta.textContent = 'Vérification…';

      try {
        const publicKey = parseRequestOptions(requestOptions);
        const credential = await window.navigator.credentials.get({ publicKey });
        if (!credential) throw new Error('Connexion annulée.');

        const payload = serializeAuthenticationCredential(credential);
        const result = await fetchJson('/api/auth/passkey/login/verify', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!result.verified || !result.user) throw new Error('Authentification refusée.');
        finish({ outcome: 'authenticated', user: result.user });
      } catch (err) {
        busy = false;
        if (err?.name === 'NotAllowedError' || /annul/i.test(String(err?.message || ''))) {
          error.textContent = 'Connexion annulée. Réessayez ou utilisez WhatsApp.';
        } else if (err?.status === 401) {
          error.textContent = 'Cette passkey n’est plus utilisable. Utilisez WhatsApp pour récupérer votre compte.';
        } else {
          error.textContent = 'La passkey n’a pas pu être vérifiée. Réessayez ou utilisez WhatsApp.';
        }
        cta.disabled = false;
        cta.textContent = 'Réessayer';
      }
    });

    window.setTimeout(() => whatsapp.focus(), 0);
  });
}
