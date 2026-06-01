/**
 * KOMERCE — Store Credits — ⚠️ DEPRECATED (D5)
 *
 * Ce module est DEPRECATED. Utiliser services/wallet-service.js à la place.
 * Le système wallet est l'unique système d'avoir (décision D5).
 *
 * Ce fichier est conservé uniquement pour éviter les erreurs d'import
 * si un module legacy le référence encore. Toutes les fonctions lèvent
 * une erreur explicite pour forcer la migration vers le wallet.
 */

'use strict';

const log = require('../utils/logger').child({ module: 'store-credits' });

const DEPRECATED_MSG = 'store-credits.js est DEPRECATED (D5). Utiliser services/wallet-service.js à la place.';

async function createStoreCredit() {
  throw new Error(DEPRECATED_MSG);
}

async function getAvailableCredits() {
  log.warn('[DEPRECATED] ' + DEPRECATED_MSG);
  return { credits: [], total_kmf: 0 };
}

async function applyCredits() {
  throw new Error(DEPRECATED_MSG);
}

module.exports = { createStoreCredit, getAvailableCredits, applyCredits };
