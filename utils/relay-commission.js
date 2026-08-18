/**
 * @komerce-arch
 * @role          relay-commission-resolver
 * @domain        economic-engine
 * @layer         util
 * @criticality   high
 * @inputs        cost_components, finance_config
 * @outputs       canonical_relay_commission
 * @depends       none
 * @db-read       none
 * @db-write      none
 * @used-by       services/cost-allocation/allocate.js
 * @doctrine      lot1a_relay_commission_one_runtime_truth
 * @impact-areas  economic-engine, relay, costing
 * @version       2026-08
 */

'use strict';

/**
 * LOT 1A-3 — priorité CURRENT de la commission relais.
 *
 * Autorité nominale : cost_components key=commission_relais_kmf (I-5 OWNED).
 * Fallback legacy : finance_config.commission_relais_standard_kmf.
 * Fallback ultime : 500 KMF, valeur CURRENT historique.
 *
 * Sont volontairement EXCLUS de la résolution :
 *   - finance_config.commission_relais_pct : éditeur mort, aucun moteur ne le lit ;
 *   - finance_config.commission_relais_showroom_kmf : aucun contexte runtime
 *     ne sait aujourd'hui sélectionner explicitement un showroom ;
 *   - business_rules COMMISSION_RELAIS_* : legacy sans lecteur runtime prouvé ;
 *   - economic_variables : traité séparément en LOT 1A-4.
 *
 * Aucun fallback implicite "showroom" : un nouveau contexte relais devra être
 * explicite et testé avant d'introduire une commission scopée.
 */

const RELAY_COMMISSION_COMPONENT_KEY = 'commission_relais_kmf';
const RELAY_COMMISSION_CURRENT_FALLBACK_KMF = 500;

function presentNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function resolveRelayCommissionCurrent({ componentValue, legacyStandardValue } = {}) {
  const component = presentNumber(componentValue);
  if (component !== null) {
    return {
      amount_kmf: component,
      source: 'cost_components.commission_relais_kmf',
      fallback_used: false,
    };
  }

  const legacyStandard = presentNumber(legacyStandardValue);
  if (legacyStandard !== null) {
    return {
      amount_kmf: legacyStandard,
      source: 'finance_config.commission_relais_standard_kmf',
      fallback_used: true,
    };
  }

  return {
    amount_kmf: RELAY_COMMISSION_CURRENT_FALLBACK_KMF,
    source: 'literal_current_fallback',
    fallback_used: true,
  };
}

module.exports = {
  RELAY_COMMISSION_COMPONENT_KEY,
  RELAY_COMMISSION_CURRENT_FALLBACK_KMF,
  resolveRelayCommissionCurrent,
};
