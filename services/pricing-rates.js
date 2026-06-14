'use strict';

/**
 * KOMERCE — Service taux de change pricing (REFACTO-R1)
 *
 * Extraction iso-comportement depuis routes/pricing.js :
 *   GET /api/pricing/rates → getCurrentRates()
 *   PUT /api/pricing/rates → updateRates({ eur_kmf, aed_kmf }, userId)
 *
 * Source de vérité : `finance_config` (singleton id=1).
 * `exchange_rates` reste un historique pur (cf. utils/rates.js).
 */

const db = require('../db');
const { invalidateCache } = require('../utils/rates');

/**
 * Retourne les taux courants (finance_config) + les 5 derniers
 * enregistrements d'historique (exchange_rates).
 * @returns {Promise<{ current: { eur_kmf: number, aed_kmf: number }, history: object[] }>}
 */
async function getCurrentRates() {
  const { rows } = await db.query(
    'SELECT taux_change_eur_kmf, taux_aed_kmf FROM finance_config WHERE id = 1'
  );
  const fc = rows[0];
  const { rows: history } = await db.query(
    'SELECT eur_kmf, aed_kmf, valid_from FROM exchange_rates ORDER BY valid_from DESC LIMIT 5'
  );
  return {
    current: { eur_kmf: Number(fc?.taux_change_eur_kmf) || 492, aed_kmf: Number(fc?.taux_aed_kmf) || 138 },
    history,
  };
}

/**
 * Met à jour finance_config (taux courants) et journalise dans
 * exchange_rates, puis invalide le cache utils/rates.
 *
 * @param {{ eur_kmf: number|string, aed_kmf: number|string }} data
 * @param {string|null} userId
 * @returns {Promise<{ message: string, rate: { eur_kmf, aed_kmf } }>}
 */
async function updateRates({ eur_kmf, aed_kmf }, userId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE finance_config
          SET taux_change_eur_kmf = $1, taux_aed_kmf = $2,
              updated_at = NOW(), updated_by = $3
        WHERE id = 1`,
      [eur_kmf, aed_kmf, userId || null]
    );
    await client.query(
      'INSERT INTO exchange_rates (eur_kmf, aed_kmf, valid_from) VALUES ($1, $2, CURRENT_DATE)',
      [eur_kmf, aed_kmf]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  try { invalidateCache(); } catch (_) { /* best-effort */ }

  return { message: 'Taux mis à jour dans finance_config + log historique', rate: { eur_kmf, aed_kmf } };
}

module.exports = { getCurrentRates, updateRates };
