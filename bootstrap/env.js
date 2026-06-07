'use strict';

// Fix FRESH-010 — voir commentaire ci-dessous
const log = require('../utils/logger').child({ module: 'env' });

/**
 * H1E — Environment bootstrap.
 *
 * Centralise dotenv + validation des variables d'environnement critiques.
 * Toutes les variables ci-dessous sont bloquantes au démarrage (SEC-2) :
 *   - DATABASE_URL, JWT_SECRET                 → infrastructure de base
 *   - STRIPE_SECRET_KEY                        → paiements
 *   - STRIPE_WEBHOOK_SECRET                    → webhook Stripe paiements individuels
 *   - STRIPE_SHARED_CART_WEBHOOK_SECRET        → webhook Stripe paniers partagés
 *   - STRIPE_COLLECTIVE_WEBHOOK_SECRET         → webhook Stripe réparations collectives
 *   - QR_SECRET                                → signature tokens QR relais (SEC-QR)
 *
 * ADMIN_PASSWORD reste recommandé (peut être généré au premier démarrage).
 *
 * Fix FRESH-010 : régressé lors du refacto H1E — les 4 secrets Stripe/QR
 * n'étaient plus bloquants alors que scripts/validate-required-env.js
 * les listait correctement.
 */

function loadAndValidateEnv({ exitOnMissing = true } = {}) {
  require('dotenv').config();

  const requiredEnv = [
    'DATABASE_URL',
    'JWT_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_SHARED_CART_WEBHOOK_SECRET',
    'STRIPE_COLLECTIVE_WEBHOOK_SECRET',
    'QR_SECRET',
  ];
  const recommendedEnv = ['ADMIN_PASSWORD', 'META_WA_APP_SECRET'];

  const missingRequired = requiredEnv.filter(key => !process.env[key]);
  const missingRecommended = recommendedEnv.filter(key => !process.env[key]);

  for (const key of missingRequired) {
    log.error(`❌ FATAL: ${key} manquant — impossible de démarrer`);
  }

  if (missingRequired.length && exitOnMissing) {
    process.exit(1);
  }

  for (const key of missingRecommended) {
    log.warn(`⚠️  ${key} non défini — valeur par défaut utilisée (à configurer avant la prod)`);
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
