/**
 * @komerce-arch
 * @role          boutique-passkey-step-up
 * @domain        auth-passkey
 * @layer         ui-service
 * @criticality   high
 * @inputs        428 step_up_required, WebAuthn step-up options
 * @outputs       refreshed_same-account_session, retried_sensitive_operation
 * @depends       b-passkey-login.js, b-identity.js, browser WebAuthn API
 * @used-by       b-passkey-security.js, b-komerce.js
 * @doctrine      auth7_step_up, same_account_only, otp_fallback_then_optional_enrollment, no_secret_in_js_storage
 * @impact-areas  account-security, pickup-authorization
 * @version       2026-08
 */
'use strict';

import {
  shouldOfferPasskeyLogin,
  parseRequestOptions,
  serializeAuthenticationCredential,
} from './b-passkey-login.js';
import { getCurrentIdentity, openIdentityModal } from './b-identity.js';

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
  // Même règle UX que le login : WebAuthn disponible ne suffit pas. Sur ce
  // navigateur, Komerce ne déclenche un prompt Passkey que si une Passkey y a
  // déjà été réellement enrôlée ou utilisée avec succès.
  if (!shouldOfferPasskeyLogin()) {
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

function sameIdentity(before, after) {
  if (!before || !after) return false;
  if (before.id != null && after.id != null) return String(before.id) === String(after.id);
  if (before.phone && after.phone) return String(before.phone) === String(after.phone);
  return false;
}

async function performOtpStepUp({
  reason = 'confirmer cette opération sensible',
  title = 'Confirmer avec WhatsApp',
  returnFocusTo = null,
} = {}) {
  const current = getCurrentIdentity();
  // Un step-up confirme le compte courant ; il ne sert jamais à choisir ou
  // créer une autre identité. Sans identité courante exploitable, on refuse.
  if (!current?.phone || (current?.id == null && !current?.phone)) {
    return { outcome: 'failed', reason: 'current_identity_unknown' };
  }

  const pending = openIdentityModal({
    reason,
    title,
    phone: current.phone,
    returnFocusTo,
    // Ce purpose reste un contexte UI/événement. L'OTP serveur renouvelle la
    // session avec amr=otp/auth_time frais ; aucune Passkey n'est créée ici.
    purpose: 'sensitive-step-up',
  });

  // Le modal d'identité générique sait normalement changer de compte. Pour un
  // step-up, ces sorties sont incohérentes : on les retire du parcours. Le
  // contrôle `sameIdentity` ci-dessous reste la défense fonctionnelle finale.
  const overlay = document.querySelector('.k-id-overlay');
  overlay?.querySelector('#k-id-num-changed')?.remove();
  overlay?.querySelector('#k-id-not-you')?.remove();

  const user = await pending;
  if (!user) return { outcome: 'cancelled' };
  if (!sameIdentity(current, user)) return { outcome: 'failed', reason: 'account_mismatch' };

  return { outcome: 'stepped_up', method: 'otp', user };
}

function signalSensitiveOperationCompleted({ method, reason } = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('komerce:sensitive-operation-confirmed', {
    detail: {
      method,
      reason: reason || 'sensitive-operation',
      sensitive: true,
      completed: true,
    },
  }));
}

function stepUpError(outcome) {
  const cancelled = outcome === 'cancelled';
  const error = new Error(
    cancelled
      ? 'Confirmation de sécurité annulée.'
      : 'Impossible de confirmer cette opération.'
  );
  error.code = cancelled ? 'step_up_cancelled' : 'step_up_failed';
  return error;
}

/**
 * Exécute une opération sensible et ne la rejoue qu'une seule fois :
 * - Passkey seulement si ce navigateur l'a déjà réellement prouvée ;
 * - sinon OTP WhatsApp frais sur le MÊME compte ;
 * - après succès par OTP, l'opération est déjà accomplie AVANT toute offre
 *   facultative d'enrôlement Passkey.
 *
 * `offerEnrollmentAfterOtp=false` permet aux opérations où une proposition
 * serait incohérente (ex. révocation volontaire d'une Passkey) de l'interdire.
 */
export async function withStepUpRetry(operation, {
  reason = 'confirmer cette opération sensible',
  title = 'Confirmer avec WhatsApp',
  returnFocusTo = null,
  offerEnrollmentAfterOtp = true,
} = {}) {
  try {
    return await operation();
  } catch (error) {
    if (!isStepUpRequiredError(error)) throw error;

    let method = null;
    const passkey = await performPasskeyStepUp();

    if (passkey.outcome === 'stepped_up') {
      method = 'passkey';
    } else if (passkey.outcome === 'reauth_required') {
      const otp = await performOtpStepUp({ reason, title, returnFocusTo });
      if (otp.outcome !== 'stepped_up') throw stepUpError(otp.outcome);
      method = 'otp';
    } else {
      throw stepUpError(passkey.outcome);
    }

    // Un seul retry : si le backend refuse encore, l'erreur remonte telle
    // quelle. Aucune boucle d'authentification silencieuse.
    const result = await operation();

    // Doctrine UX : on ne propose la Passkey qu'après que l'utilisateur a
    // réellement obtenu le résultat de son opération sensible par OTP.
    if (method === 'otp' && offerEnrollmentAfterOtp) {
      signalSensitiveOperationCompleted({ method, reason });
    }

    return result;
  }
}
