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
 * @doctrine      lot1a_fx_one_runtime_truth, payment_fx_authority
 * @impact-areas  economic-engine, sourcing, infrastructure, payment, checkout
 * @version       2026-09
 */

'use strict';
/**
 * KOMERCE — Taux de change & paramètres financiers (utils/rates.js)
 *
 * Source de vérité persistée : table `finance_config` (singleton id=1).
 *
 * Deux contrats sont volontairement séparés :
 *   - getRates() : lecture tolérante pour affichage, pilotage et calculs qui
 *     conservent les fallbacks historiques ;
 *   - getAuthoritativeRates() : lecture stricte pour engager un paiement en
 *     devise. Aucun fallback business_rules/hardcodé n'est accepté.
 *
 * Le chemin strict remplit le même cache mémoire que le chemin tolérant. Ainsi,
 * après validation autoritative au boundary checkout, le getRates() exécuté
 * immédiatement dans l'orchestrateur réutilise exactement ce snapshot issu de
 * finance_config et ne peut pas retomber silencieusement sur 492/138 pendant
 * cette création de commande.
 *
 * LOT 1A-2 : USD n'a PAS de colonne persistée aujourd'hui. Le comportement
 * CURRENT reste une dérivation : USD_KMF = 0.92 × EUR_KMF.
 */

const db = require('../db');
const log = require('./logger').child({ module: 'rates' });

const RATES_FALLBACK = Object.freeze({ eur_kmf: 492, aed_kmf: 138 });
const USD_EUR_CURRENT_RATIO = 0.92;
const CACHE_TTL_MS = 60_000;

class AuthoritativeRateUnavailableError extends Error {
  constructor(message = 'Taux de change canonique indisponible') {
    super(message);
    this.name = 'AuthoritativeRateUnavailableError';
    this.code = 'fx_rate_unavailable';
    this.statusCode = 503;
  }
}

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

function resolvePricingViewCurrentCompatRates() {
  return resolveFxRates({
    taux_change_eur_kmf: RATES_FALLBACK.eur_kmf,
    taux_aed_kmf: RATES_FALLBACK.aed_kmf,
  });
}

let _ratesFallbackProvider = null;
let _cache = null;
let _cacheAt = 0;

function configureRatesFallbackProvider(provider) {
  if (provider !== null && typeof provider !== 'function') {
    throw new TypeError('rates fallback provider must be a function or null');
  }
  _ratesFallbackProvider = provider;
  invalidateCache();
}

function isFreshAuthoritativeCache() {
  return Boolean(_cache && Date.now() - _cacheAt < CACHE_TTL_MS);
}

function normalizeAuthoritativeFinanceRow(row) {
  if (!row) return null;
  const eurKmf = Number(row.taux_change_eur_kmf);
  const aedKmf = Number(row.taux_aed_kmf);
  if (!Number.isFinite(eurKmf) || eurKmf <= 0) return null;
  if (!Number.isFinite(aedKmf) || aedKmf <= 0) return null;
  return { eur_kmf: eurKmf, aed_kmf: aedKmf };
}

/**
 * Lecture STRICTE de finance_config pour tout flux qui engage un paiement en
 * devise. Aucun fallback n'est autorisé : si la ligne ou un taux est absent,
 * invalide ou inaccessible, l'appel échoue explicitement en 503 côté boundary.
 */
async function getAuthoritativeRates() {
  if (isFreshAuthoritativeCache()) return _cache;

  try {
    const { rows } = await db.query(
      'SELECT taux_change_eur_kmf, taux_aed_kmf FROM finance_config WHERE id = 1'
    );
    const resolved = normalizeAuthoritativeFinanceRow(rows && rows[0]);
    if (!resolved) {
      throw new AuthoritativeRateUnavailableError('finance_config ne contient pas de taux EUR/AED valides');
    }
    _cache = resolved;
    _cacheAt = Date.now();
    return _cache;
  } catch (err) {
    if (err instanceof AuthoritativeRateUnavailableError) throw err;
    log.error?.({ err }, '[getAuthoritativeRates] finance_config indisponible');
    throw new AuthoritativeRateUnavailableError();
  }
}

/**
 * Lecture tolérante historique. Fallback : business_rules puis constantes.
 * Les fallback ne sont jamais mis en cache, afin qu'ils ne puissent pas être
 * confondus ensuite avec un snapshot autoritatif.
 */
async function getRates() {
  if (isFreshAuthoritativeCache()) return _cache;

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

  log.warn('[getRates] Fallback ultime activé — finance_config et business_rules inaccessibles. Taux figés utilisés.');
  return RATES_FALLBACK;
}

function invalidateCache() {
  _cache = null;
  _cacheAt = 0;
}

module.exports = {
  getRates,
  getAuthoritativeRates,
  invalidateCache,
  configureRatesFallbackProvider,
  AuthoritativeRateUnavailableError,
  RATES_FALLBACK,
  USD_EUR_CURRENT_RATIO,
  resolveFxRates,
  resolvePricingViewCurrentCompatRates,
};
