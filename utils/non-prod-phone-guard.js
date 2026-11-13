/**
 * @komerce-arch
 * @role          non-prod-phone-guard
 * @domain        notification
 * @layer         util
 * @criticality   high
 * @inputs        env AUTHKEY_ALLOWED_PHONES, runtime environment, recipient_phone
 * @outputs       allowed_boolean
 * @depends       middleware/require-non-production.js
 * @db-write      none
 * @db-read       none
 * @used-by       services/authkey-client.js, services/whatsapp-meta.js
 * @doctrine      no_external_send_outside_production, fail_safe_empty_allowlist
 * @impact-areas  whatsapp, notifications, shared-cart
 * @version       2026-11
 */

'use strict';

const { resolveRuntimeEnvironment } = require('../middleware/require-non-production');

// Hors production, un message WhatsApp ne part que vers les numéros listés dans
// AUTHKEY_ALLOWED_PHONES (séparés par virgule). Liste vide ou absente : AUCUN envoi (fail-safe).
// Production : pas de filtre. Évalué au chargement du module (comportement historique d'authkey-client).
const IS_PRODUCTION = resolveRuntimeEnvironment().env === 'production';
const _allowedPhones = IS_PRODUCTION
  ? null
  : new Set(
      (process.env.AUTHKEY_ALLOWED_PHONES || '')
        .split(',')
        .map(p => p.trim().replace(/\D/g, ''))
        .filter(Boolean)
    );

/** Normalise en digits purs ; correspondance par suffixe (ex. "3301234" matche "+2693301234"). */
function isNonProdPhoneAllowed(rawPhone) {
  if (IS_PRODUCTION) return true;
  if (!_allowedPhones || _allowedPhones.size === 0) return false;
  const digits = String(rawPhone || '').replace(/\D/g, '');
  for (const allowed of _allowedPhones) {
    if (allowed.endsWith(digits) || digits.endsWith(allowed)) return true;
  }
  return false;
}

module.exports = { isNonProdPhoneAllowed, IS_PRODUCTION };
