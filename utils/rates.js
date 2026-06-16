/**
 * @komerce-arch
 * @role          rates
 * @domain        unknown
 * @layer         util
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @db-write      @unknown
 * @db-read      finance_config
 * @used-by       @unknown
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

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
const { getRuleNumber } = require('./rules');
const log = require('./logger').child({ module: 'rates' });

// Fallback hardcodé ultime (si BDD totalement inaccessible)
const RATES_FALLBACK = { eur_kmf: 492, aed_kmf: 138 };

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

  // 3. Fallback secondaire : business_rules (legacy)
  try {
    const eur = await getRuleNumber('EUR_KMF_FALLBACK', RATES_FALLBACK.eur_kmf);
    const aed = await getRuleNumber('AED_KMF_FALLBACK', RATES_FALLBACK.aed_kmf);
    return { eur_kmf: eur, aed_kmf: aed };
  } catch (_) { /* fallback */ }

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

module.exports = { getRates, invalidateCache, RATES_FALLBACK };
