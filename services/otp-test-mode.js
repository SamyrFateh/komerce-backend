/**
 * @komerce-arch
 * @role          auth-otp-test-mode
 * @domain        auth-identity
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       none
 * @used-by       routes/otp.js
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  auth
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — services/otp-test-mode.js
 * ════════════════════════════════════════════════════════════════════
 * Mode test déterministe pour le flow OTP WhatsApp (E2E / manuel).
 *
 * OBJECTIF
 *   Permettre aux tests bout-en-bout de "passer l'OTP à tous les coups"
 *   SANS jamais envoyer de message WhatsApp réel et SANS deviner le code
 *   aléatoire généré côté serveur.
 *
 * GARDE-FOU PRODUCTION (non négociable)
 *   isOtpTestMode() renvoie TOUJOURS false si NODE_ENV === 'production',
 *   même si OTP_TEST_MODE=true est présent dans l'env. Impossible donc
 *   d'activer par erreur un bypass d'auth en prod.
 *
 * ACTIVATION (hors production uniquement)
 *   OTP_TEST_MODE=true            → active le mode test
 *   OTP_TEST_CODE=424242          → (optionnel) code maître, défaut 424242
 *
 * UTILISATION
 *   - En mode test, le endpoint /verify accepte le code maître pour
 *     n'importe quel numéro → création/connexion immédiate.
 *   - /request renvoie aussi le vrai code généré dans `_dev.code`
 *     (utile si un test veut vérifier le chemin réel bcrypt).
 */

const DEFAULT_MASTER_CODE = '424242';

let _warned = false;

/**
 * Le mode test est-il actif ?
 * → JAMAIS en production, quel que soit l'env.
 */
function isOtpTestMode() {
  if (process.env.NODE_ENV === 'production') {
    if (process.env.OTP_TEST_MODE === 'true' && !_warned) {
      _warned = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[otp-test-mode] OTP_TEST_MODE=true IGNORÉ : interdit en production.'
      );
    }
    return false;
  }
  return process.env.OTP_TEST_MODE === 'true';
}

/**
 * Code maître déterministe (6 chiffres).
 * Configurable via OTP_TEST_CODE, sinon 424242.
 */
function getMasterCode() {
  const raw = String(process.env.OTP_TEST_CODE || DEFAULT_MASTER_CODE).trim();
  return /^\d{6}$/.test(raw) ? raw : DEFAULT_MASTER_CODE;
}

/**
 * Le code soumis correspond-il au code maître de test ?
 * (toujours false hors mode test)
 */
function isMasterCode(code) {
  if (!isOtpTestMode()) return false;
  return String(code || '').trim() === getMasterCode();
}

module.exports = { isOtpTestMode, getMasterCode, isMasterCode };
