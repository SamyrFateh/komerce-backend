/**
 * KOMERCE — Taux de change partagés
 * Utilitaire centralisé — remplace les fonctions getRates() dupliquées
 * dans modules.js, pricing.js, pilotage.js, baskets.js, ceremony.js (orphelin)
 */

const db = require('../db');
const { getRuleNumber } = require('./rules');

// Fallback harmonisé avec business_rules (EUR_KMF_FALLBACK=492, AED_KMF_FALLBACK=138)
const RATES_FALLBACK = { eur_kmf: 492, aed_kmf: 138 };

/**
 * Retourne les taux de change actifs depuis exchange_rates.
 * Fallback sur les valeurs de business_rules (elles-mêmes avec fallback hardcodé).
 * @returns {Promise<{ eur_kmf: number, aed_kmf: number }>}
 */
async function getRates() {
  const { rows } = await db.query(
    'SELECT eur_kmf, aed_kmf FROM exchange_rates ORDER BY valid_from DESC LIMIT 1'
  );
  if (rows[0]) return rows[0];
  // Fallback : utiliser les valeurs de business_rules (elles-mêmes avec fallback hardcodé)
  return {
    eur_kmf: await getRuleNumber('EUR_KMF_FALLBACK', 492),
    aed_kmf: await getRuleNumber('AED_KMF_FALLBACK', 138),
  };
}

module.exports = { getRates, RATES_FALLBACK };
