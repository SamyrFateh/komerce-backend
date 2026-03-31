/**
 * KOMERCE — Taux de change partagés
 * Utilitaire centralisé — remplace les fonctions getRates() dupliquées
 * dans ceremony.js, modules.js, pricing.js, pilotage.js, baskets.js
 */

const db = require('../db');

const RATES_FALLBACK = { eur_kmf: 495, aed_kmf: 139 };

/**
 * Retourne les taux de change actifs depuis exchange_rates.
 * Fallback sur des valeurs par défaut si la table est vide.
 * @returns {Promise<{ eur_kmf: number, aed_kmf: number }>}
 */
async function getRates() {
  const { rows } = await db.query(
    'SELECT eur_kmf, aed_kmf FROM exchange_rates ORDER BY valid_from DESC LIMIT 1'
  );
  return rows[0] || RATES_FALLBACK;
}

module.exports = { getRates, RATES_FALLBACK };
