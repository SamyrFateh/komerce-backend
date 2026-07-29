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
 * @db-read      finance_config
 * @used-by       routes/admin-finance-config.js, routes/dashboard-shared.js, routes/finance.js, routes/modules.js, routes/orders/create.js, routes/payments.js, services/pricing-rates.js, services/shared-cart-lifecycle.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */


'use strict';
/**
 * KOMERCE — Taux de change & paramètres financiers (utils/rates.js)
 *
 * Source de vérité : table `finance_config` (singleton id=1).
 * Cette migration centralise ce qui était auparavant éclaté entre
 * exchange_rates, economic_variables, business_rules, et hardcodes JS.
 *
 * Politique :
 *   - getRates() lit finance_config.taux_change_eur_kmf / .taux_aed_kmf
 *   - exchange_rates devient pur historique (lecture pour audit, plus écriture)
 *   - business_rules.EUR_KMF_FALLBACK reste fallback ULTIME si BDD inaccessible
 *
 * Cache TTL 60s pour performance.
 */

const db = require('../db');
const log = require('./logger').child({ module: 'rates' });

// Fallback hardcodé ultime (si BDD totalement inaccessible)
const RATES_FALLBACK = { eur_kmf: 492, aed_kmf: 138 };

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
      _cache = {
        eur_kmf: Number(rows[0].taux_change_eur_kmf),
        aed_kmf: Number(rows[0].taux_aed_kmf) || RATES_FALLBACK.aed_kmf,
      };
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

module.exports = { getRates, invalidateCache, configureRatesFallbackProvider, RATES_FALLBACK };
