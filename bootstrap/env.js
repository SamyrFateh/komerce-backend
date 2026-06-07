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
 *
 * RECOMMENDED — warn seulement (features dégradées mais app fonctionnelle) :
 *   STRIPE_SHARED_CART_WEBHOOK_SECRET (panier collectif)
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
  ];

  const recommendedEnv = [
    'STRIPE_SHARED_CART_WEBHOOK_SECRET',
  ];

  // Garde-fou supplémentaire : refuser explicitement un bypass OTP en prod
  if (process.env.NODE_ENV === 'production') {
    const otpBypass = process.env.OTP_TEST_MODE === 'true' || process.env.BOUTIQUE_TEST_OTP_BYPASS === 'true';
    if (otpBypass) {
      log.error('❌ FATAL: OTP_TEST_MODE/BOUTIQUE_TEST_OTP_BYPASS interdit en production — arrêt immédiat');
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
    log.warn(`⚠️  ${key} non défini — fonctionnalité panier collectif dégradée`);
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
