/**
 * @komerce-arch
 * @role          fx-engine-rates
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        finance_config_row
 * @outputs       finance_row_with_authority_rates
 * @depends       utils/rates.js, services/fx-authority.js
 * @used-by       services/pricing-cdr.js, services/pricing-recommend.js, services/cost-allocation/allocate.js, services/economic-config.js
 * @db-read       currency_parities, fx_rate_observations, fx_pegs
 * @db-write      none
 * @db-txn        none
 * @doctrine      eur_is_the_pivot, single_conversion_authority, finance_config_is_not_an_fx_authority
 * @impact-areas  economic-engine, pricing, sourcing
 * @version       2026-10
 */
'use strict';

const { getRates } = require('../utils/rates');

/**
 * Superpose sur une ligne finance_config les taux issus de l'autorité FX (jamais les colonnes taux_* stockées).
 * Les paramètres économiques (marges, coûts fixes, etc.) restent ceux de finance_config.
 * Un taux indisponible laisse le champ absent (null) : sa lecture par resolveFxRates() lève fx_rate_unavailable.
 */
async function withAuthorityRates(financeRow) {
  const rates = await getRates();
  const json = rates.toJSON();
  return {
    ...(financeRow || {}),
    taux_change_eur_kmf: json.eur_kmf,
    taux_aed_kmf: json.aed_kmf,
    taux_usd_kmf: json.usd_kmf,
  };
}

module.exports = { withAuthorityRates };
