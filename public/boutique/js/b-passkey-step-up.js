/**
 * @komerce-arch
 * @role          boutique-passkey-step-up
 * @domain        auth-passkey
 * @layer         ui-service
 * @criticality   high
 * @inputs        428 step_up_required, WebAuthn step-up options
 * @outputs       refreshed_same-account_session, retried_sensitive_operation
 * @depends       b-passkey-login.js, browser WebAuthn API
 * @used-by       b-passkey-security.js, b-komerce.js
 * @doctrine      auth7_step_up, same_account_only, no_secret_in_js_storage
 * @impact-areas  account-security, pickup-authorization
 * @version       2026-08
 */
'use strict';

import {
  isPasskeyLoginSupported,
  parseRequestOptions,
  serializeAuthenticationCredential,
} from './b-passkey-login.js';

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Opération impossible.');
    error.status = response.status;
    error.code = data.code || null;
    error.reason = data.reason || null;
    throw error;
  }
  return data;
}

export function isStepUpRequiredError(error) {
  return error?.status === 428 && error?.code === 'step_up_required';
}

export async function performPasskeyStepUp() {
  if (!isPasskeyLoginSupported()) {
    return { outcome: 'reauth_required', method: 'otp' };
  }

  let options;
  try {
    options = await fetchJson('/api/auth/passkey/step-up/options', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch (error) {
    if (error.status === 409 || error.status === 404) {
      return { outcome: 'reauth_required', method: 'otp' };
    }
    throw error;
  }

  try {
    const publicKey = parseRequestOptions(options);
    const credential = await window.navigator.credentials.get({ publicKey });
    if (!credential) return { outcome: 'cancelled' };

    const payload = serializeAuthenticationCredential(credential);
    const result = await fetchJson('/api/auth/passkey/step-up/verify', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return result.verified
      ? { outcome: 'stepped_up', method: 'passkey' }
      : { outcome: 'failed' };
  } catch (error) {
    if (error?.name === 'NotAllowedError' || /annul/i.test(String(error?.message || ''))) {
      return { outcome: 'cancelled' };
    }
    if (error.status === 401 || error.status === 409) {
      return { outcome: 'reauth_required', method: 'otp' };
    }
    throw error;
  }
}

/**
 * Exécute une mutation sensible, effectue UN step-up Passkey sur 428 puis
 * rejoue exactement une fois. Jamais de boucle de retry silencieuse.
 */
export async function withStepUpRetry(operation) {
  try {
    return await operation();
  } catch (error) {
    if (!isStepUpRequiredError(error)) throw error;

    const stepUp = await performPasskeyStepUp();
    if (stepUp.outcome === 'stepped_up') {
      return operation();
    }

    const out = new Error(
      stepUp.outcome === 'reauth_required'
        ? 'Reconnectez-vous avec WhatsApp pour confirmer cette opération.'
        : 'Confirmation de sécurité annulée.'
    );
    out.code = stepUp.outcome === 'reauth_required'
      ? 'step_up_reauth_required'
      : 'step_up_cancelled';
    throw out;
  }
}
