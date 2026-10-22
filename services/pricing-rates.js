/**
 * @komerce-arch
 * @role          economic-engine-pricing-rates
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/rates.js
 * @used-by       routes/pricing.js
 * @db-read       exchange_rates
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Service taux de change pricing (REFACTO-R1)
 *
 * Extraction iso-comportement depuis routes/pricing.js :
 *   GET /api/pricing/rates → getCurrentRates()
 *   PUT /api/pricing/rates → RETIRÉ (410) : observation EUR/USD à deux personnes
 *
 * Source de vérité : services/fx-authority.js (pivot EUR).
 * `exchange_rates` reste un historique pur (cf. utils/rates.js).
 */

const db = require('../db');
const { getRates } = require('../utils/rates');

/**
 * Retourne les taux courants (finance_config) + les 5 derniers
 * enregistrements d'historique (exchange_rates).
 * @returns {Promise<{ current: { eur_kmf: number, aed_kmf: number }, history: object[] }>}
 */
async function getCurrentRates() {
  // Taux courants = autorité FX (pivot EUR) ; finance_config n'est plus une source de taux.
  const current = (await getRates()).toJSON();
  const { rows: history } = await db.query(
    'SELECT eur_kmf, aed_kmf, valid_from FROM exchange_rates ORDER BY valid_from DESC LIMIT 5'
  );
  return {
    current: { eur_kmf: current.eur_kmf, aed_kmf: current.aed_kmf },
    history,
  };
}

/**
 * RETIRÉ (PR-D) : les taux ne s'éditent plus dans finance_config. EUR/KMF = parité fixe ; EUR/USD = observation
 * saisie puis approuvée par deux personnes (POST /api/admin/finance-config/fx-observations). exchange_rates reste un
 * journal historique en lecture seule.
 */
async function updateRates() {
  const err = new Error('Edition des taux retirée : utiliser l\'observation EUR/USD à deux personnes (/api/admin/finance-config/fx-observations).');
  err.code = 'fx_rate_editor_retired';
  err.statusCode = 410;
  throw err;
}

module.exports = { getCurrentRates, updateRates };
