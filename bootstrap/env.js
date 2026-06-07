'use strict';

const log = require('../utils/logger').child({ module: 'env' });

/**
 * H1E — Environment bootstrap.
 *
 * Centralise dotenv + validation des variables d'environnement critiques.
 * - DATABASE_URL, JWT_SECRET et ADMIN_PASSWORD sont bloquants (SEC-2) ;
 * - STRIPE_SECRET_KEY reste recommandé.
 */

function loadAndValidateEnv({ exitOnMissing = true } = {}) {
  require('dotenv').config();

  const requiredEnv = ['DATABASE_URL', 'JWT_SECRET', 'ADMIN_PASSWORD'];
  const recommendedEnv = ['STRIPE_SECRET_KEY'];

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
