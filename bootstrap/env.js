'use strict';

/**
 * H1E — Environment bootstrap.
 *
 * Centralise dotenv + validation des variables d'environnement critiques.
 * Garde volontairement le même comportement que l'ancien server.js :
 * - DATABASE_URL et JWT_SECRET sont bloquants ;
 * - ADMIN_PASSWORD et STRIPE_SECRET_KEY restent recommandés.
 */

function loadAndValidateEnv({ exitOnMissing = true } = {}) {
  require('dotenv').config();

  const requiredEnv = ['DATABASE_URL', 'JWT_SECRET'];
  const recommendedEnv = ['ADMIN_PASSWORD', 'STRIPE_SECRET_KEY'];

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
