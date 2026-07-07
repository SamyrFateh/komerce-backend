/**
 * @komerce-arch
 * @role          bootstrap-env
 * @domain        infrastructure
 * @layer         bootstrap
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       utils/logger.js
 * @db-write      none
 * @db-read      none
 * @used-by       server.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  bootstrap
 * @version       2026-06
 */

'use strict';

const log = require('../utils/logger').child({ module: 'env' });

/**
 * H1E — Environment bootstrap.
 *
 * Centralise dotenv + validation des variables d'environnement critiques.
 * Règle SEC-2 / FRESH-010 : toute variable dont l'absence provoque un
 * comportement silencieusement incorrect en prod doit être dans requiredEnv.
 *
 * REQUIRED — bloque le démarrage si absent :
 *   DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, QR_SECRET
 *   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID  (migration 079)
 *
 * RECOMMENDED — warn seulement (features dégradées mais app fonctionnelle) :
 *   STRIPE_SHARED_CART_WEBHOOK_SECRET (panier collectif)
 *   STRIPE_PUBLISHABLE_KEY (sans elle, /api/payments/config renvoie 500 — GOV-04)
 *   PAYPAL_ENV (défaut: 'sandbox' — explicite pour prod)
 */

function loadAndValidateEnv({ exitOnMissing = true } = {}) {
  require('dotenv').config();

  const requiredEnv = [
    'DATABASE_URL',
    'JWT_SECRET',
    'ADMIN_PASSWORD',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'QR_SECRET',
    'AUTHKEY_API_KEY',          // provider notifications actif — toutes les notifs WhatsApp passent par Authkey
    // PayPal — migration 079, diaspora France
    'PAYPAL_CLIENT_ID',
    'PAYPAL_CLIENT_SECRET',
    'PAYPAL_WEBHOOK_ID',
    // P4-2 : routes/meta-whatsapp.js vérifiait la signature HMAC seulement si
    // cette variable était présente, avec fail-open silencieux (juste un warn)
    // sinon — un webhook prod sans la variable acceptait n'importe quel POST
    // non signé. Suit désormais la même doctrine que les autres secrets de
    // webhook (STRIPE_WEBHOOK_SECRET, PAYPAL_WEBHOOK_ID) : requis au boot.
    'META_WA_APP_SECRET',
  ];

  const recommendedEnv = [
    'STRIPE_SHARED_CART_WEBHOOK_SECRET',
    'STRIPE_PUBLISHABLE_KEY', // sans elle, /api/payments/config renvoie 500 (GOV-04)
    'PAYPAL_ENV', // sandbox | production — défaut sandbox côté code
    'TRANSITAIRE_PASSWORD', // compte opérationnel agent_transitaire — skip seeding si absent
    'AUTHKEY_WEBHOOK_SECRET', // token webhook Authkey — requis en prod, fail-closed si absent
  ];

  // Garde-fou supplémentaire : refuser explicitement un bypass OTP en prod
  if (process.env.NODE_ENV === 'production') {
    const otpBypass = process.env.OTP_TEST_MODE === 'true' || process.env.BOUTIQUE_TEST_OTP_BYPASS === 'true';
    if (otpBypass) {
      log.error('❌ FATAL: OTP_TEST_MODE/BOUTIQUE_TEST_OTP_BYPASS interdit en production — arrêt immédiat');
      if (exitOnMissing) process.exit(1);
    }

    // Garde-fou PayPal : refuser le démarrage prod sur sandbox (config humaine douteuse).
    // Si PAYPAL_ENV est absent ou 'sandbox' en prod, on bloque pour forcer la décision explicite.
    if (process.env.PAYPAL_ENV !== 'production') {
      log.error(`❌ FATAL: PAYPAL_ENV=${process.env.PAYPAL_ENV || '(absent)'} en production — devrait être 'production'`);
      if (exitOnMissing) process.exit(1);
    }
  }

  const missingRequired = requiredEnv.filter(key => !process.env[key]);
  const missingRecommended = recommendedEnv.filter(key => !process.env[key]);

  for (const key of missingRequired) {
    log.error(`❌ FATAL: ${key} manquant — impossible de démarrer`);
  }

  if (missingRequired.length && exitOnMissing) {
    process.exit(1);
  }

  for (const key of missingRecommended) {
    log.warn(`⚠️  ${key} non défini — fonctionnalité dégradée`);
  }

  return {
    ok: missingRequired.length === 0,
    requiredEnv,
    recommendedEnv,
    missingRequired,
    missingRecommended,
  };
}

module.exports = {
  loadAndValidateEnv,
};
