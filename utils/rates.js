/**
 * @komerce-arch
 * @role          rates
 * @domain        infrastructure
 * @layer         util
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js
 * @db-write      none
 * @db-read       finance_config
 * @used-by       routes/admin-finance-config.js, routes/dashboard-shared.js, routes/finance.js, routes/modules.js, routes/orders/create.js, routes/payments.js, services/pricing-cdr.js, services/pricing-rates.js, services/shared-cart-lifecycle.js, services/supplier-catalog-scanner.js
 * @doctrine      lot1a_fx_one_runtime_truth
 * @impact-areas  economic-engine, sourcing, infrastructure
 * @version       2026-08
 */

'use strict';
/**
 * KOMERCE — Taux de change & paramètres financiers (utils/rates.js)
 *
 * Source de vérité persistée : table `finance_config` (singleton id=1).
 * Cette migration centralise ce qui était auparavant éclaté entre
 * exchange_rates, economic_variables, business_rules, et hardcodes JS.
 *
 * LOT 1A-2 : USD n'a PAS de colonne persistée aujourd'hui. Le comportement
 * CURRENT était une dérivation recopiée dans plusieurs consommateurs :
 *   USD_KMF = 0.92 × EUR_KMF
 *
 * La règle 0.92 est désormais canonique ici. Elle reste une dérivation CURRENT
 * (pas un nouveau taux marché, pas un champ admin), afin de garantir
 * BEFORE == AFTER. Une future correction économique devra être un delta
 * explicite, pas un changement caché dans une refactorisation.
 *
 * Politique :
 *   - getRates() conserve son contrat historique { eur_kmf, aed_kmf } ;
 *   - resolveFxRates(finance) fournit la projection canonique incluant USD ;
 *   - exchange_rates reste pur historique ;
 *   - business_rules.*_FALLBACK reste fallback si BDD inaccessible.
 *
 * Cache TTL 60s pour performance.
 */

const db = require('../db');
const log = require('./logger').child({ module: 'rates' });

// Fallbacks CURRENT historiques. Ne pas les modifier silencieusement : toute
// correction de valeur relève d'un delta économique expliqué.
const RATES_FALLBACK = Object.freeze({ eur_kmf: 492, aed_kmf: 138 });
const USD_EUR_CURRENT_RATIO = 0.92;

/**
 * Projection pure des taux à partir de finance_config (ou d'un objet compatible).
 * USD est DERIVED, jamais édité/storé ici.
 *
 * @param {object|null|undefined} finance
 * @returns {{ eur_kmf: number, aed_kmf: number, usd_kmf: number, usd_eur_ratio: number }}
 */
function resolveFxRates(finance) {
  const fc = finance || {};
  const eurKmf = Number(fc.taux_change_eur_kmf) || RATES_FALLBACK.eur_kmf;
  const aedKmf = Number(fc.taux_aed_kmf) || RATES_FALLBACK.aed_kmf;
  return {
    eur_kmf: eurKmf,
    aed_kmf: aedKmf,
    usd_kmf: Number((eurKmf * USD_EUR_CURRENT_RATIO).toFixed(6)),
    usd_eur_ratio: USD_EUR_CURRENT_RATIO,
  };
}

/**
 * Projection qui reproduit exactement les fallbacks historiques du PricingView
 * (492/138 et USD=0.92×492). Elle est exposée par l'API pendant la migration
 * pour retirer le hardcode frontend SANS corriger silencieusement son ancien
 * contrat de config. À retirer quand ce contrat fera l'objet d'un delta assumé.
 */
function resolvePricingViewCurrentCompatRates() {
  return resolveFxRates({
    taux_change_eur_kmf: RATES_FALLBACK.eur_kmf,
    taux_aed_kmf: RATES_FALLBACK.aed_kmf,
  });
}

// Fourni par bootstrap/feature-wiring.js. Le composant technique ne connaît
// plus directement business-rules ; le composition root assemble les deux.
let _ratesFallbackProvider = null;

function configureRatesFallbackProvider(provider) {
  if (provider !== null && typeof provider !== 'function') {
    throw new TypeError('rates fallback provider must be a function or null');
  }
  _ratesFallbackProvider = provider;
  invalidateCache();
}

// Cache mémoire 60s
let _cache = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 60_000;

/**
 * Retourne les taux de change actifs depuis finance_config.
 * Fallback : business_rules → puis valeurs hardcodées.
 *
 * Contrat historique volontairement inchangé en LOT 1A-2 : USD est accessible
 * via resolveFxRates(), sans élargir silencieusement toutes les réponses qui
 * consomment getRates().
 *
 * @returns {Promise<{ eur_kmf: number, aed_kmf: number }>}
 */
async function getRates() {
  // 1. Cache hit
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) {
    return _cache;
  }

  // 2. Source primaire : finance_config (la source de vérité)
  try {
    const { rows } = await db.query(
      'SELECT taux_change_eur_kmf, taux_aed_kmf FROM finance_config WHERE id = 1'
    );
    if (rows[0] && rows[0].taux_change_eur_kmf) {
      const resolved = resolveFxRates(rows[0]);
      _cache = { eur_kmf: resolved.eur_kmf, aed_kmf: resolved.aed_kmf };
      _cacheAt = Date.now();
      return _cache;
    }
  } catch (_) { /* fallback */ }

  // 3. Fallback secondaire injecté par le composition root.
  // La direction reste business-rules -> configuration -> infrastructure ;
  // rates.js ne requiert jamais lui-même la feature métier.
  if (_ratesFallbackProvider) {
    try {
      const [eur, aed] = await Promise.all([
        _ratesFallbackProvider('EUR_KMF_FALLBACK', RATES_FALLBACK.eur_kmf),
        _ratesFallbackProvider('AED_KMF_FALLBACK', RATES_FALLBACK.aed_kmf),
      ]);
      return { eur_kmf: Number(eur), aed_kmf: Number(aed) };
    } catch (err) {
      log.warn({ err }, '[getRates] fallback métier injecté indisponible');
    }
  }

  // 4. Fallback ultime : hardcodés
  // ND2 FIX — on log explicitement pour ne pas manquer une panne DB prolongée
  log.warn('[getRates] Fallback ultime activé — finance_config et business_rules inaccessibles. Taux figés utilisés.');
  return RATES_FALLBACK;
}

/**
 * Invalide le cache pour forcer un refetch au prochain appel.
 * À appeler après PUT /api/admin/finance-config.
 */
function invalidateCache() {
  _cache = null;
  _cacheAt = 0;
}

module.exports = {
  getRates,
  invalidateCache,
  configureRatesFallbackProvider,
  RATES_FALLBACK,
  USD_EUR_CURRENT_RATIO,
  resolveFxRates,
  resolvePricingViewCurrentCompatRates,
};
