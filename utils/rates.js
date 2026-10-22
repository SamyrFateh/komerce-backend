/**
 * @komerce-arch
 * @role          rates
 * @domain        infrastructure
 * @layer         util
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/fx-authority.js
 * @db-write      none
 * @db-read       currency_parities, fx_rate_observations, fx_pegs
 * @used-by       routes/admin-finance-config.js, routes/dashboard-shared.js, routes/finance.js, routes/modules.js, routes/payments.js, services/fx-engine-rates.js, services/pricing-cdr.js, services/pricing-rates.js, services/supplier-catalog-scanner.js
 * @doctrine      eur_is_the_pivot, single_conversion_authority, fail_closed
 * @impact-areas  economic-engine, sourcing, infrastructure, payment, checkout
 * @version       2026-10
 */

'use strict';
/**
 * KOMERCE — Taux « moteur » en KMF par unité de devise (facade de lecture, utils/rates.js)
 *
 * Plus aucune autorité propre : tous les taux viennent de services/fx-authority.js (pivot EUR).
 *   eur_kmf : parité fixe currency_parities (toujours disponible)
 *   aed_kmf / usd_kmf : observation EUR/USD approuvée (+ peg AED) — sinon INDISPONIBLES
 *
 * Un taux indisponible n'est JAMAIS remplacé par un repli (492/138/0,92 supprimés) : la propriété lève
 * `fx_rate_unavailable` (503) quand on la lit, et reste absente de la sérialisation.
 */
const db = require('../db');
const fx = require('../services/fx-authority');

const CACHE_TTL_MS = 60_000;

class AuthoritativeRateUnavailableError extends Error {
  constructor(message = 'Taux de change canonique indisponible') {
    super(message);
    this.name = 'AuthoritativeRateUnavailableError';
    this.code = 'fx_rate_unavailable';
    this.statusCode = 503;
  }
}

function positive(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// Objet de taux : propriété disponible = valeur ; indisponible = getter non énumérable qui lève.
function buildFxRates({ eur_kmf = null, aed_kmf = null, usd_kmf = null } = {}) {
  const out = {};
  const defs = { eur_kmf, aed_kmf, usd_kmf };
  for (const [key, value] of Object.entries(defs)) {
    const v = positive(value);
    if (v !== null) {
      out[key] = v;
    } else {
      Object.defineProperty(out, key, {
        enumerable: false,
        get() { throw new AuthoritativeRateUnavailableError(`Taux ${key} indisponible : aucune observation approuvée.`); },
      });
    }
  }
  const eur = positive(eur_kmf);
  const usd = positive(usd_kmf);
  if (eur && usd) out.usd_eur_ratio = Number((usd / eur).toFixed(6));
  Object.defineProperty(out, 'toJSON', {
    enumerable: false,
    value() { return { eur_kmf: eur, aed_kmf: positive(aed_kmf), usd_kmf: usd, usd_eur_ratio: out.usd_eur_ratio ?? null }; },
  });
  return out;
}

// Lecture synchrone d'un objet finance DÉJÀ superposé par services/fx-engine-rates (jamais de repli).
function resolveFxRates(finance) {
  const fc = finance || {};
  return buildFxRates({ eur_kmf: fc.taux_change_eur_kmf, aed_kmf: fc.taux_aed_kmf, usd_kmf: fc.taux_usd_kmf });
}

let _cache = null;
let _cacheAt = 0;

async function loadFromAuthority(client = db) {
  const rates = {};
  const unit = async (from) => {
    try {
      const r = await fx.convert({ amount: '1', from, to: 'KMF', round: false, client });
      return r.amount;
    } catch (err) {
      if (err && (err.code === 'fx_rate_unavailable' || err.code === 'fx_currency_unsupported')) return null;
      throw err;
    }
  };
  rates.eur_kmf = await fx.fixedUnitsPerEur('KMF', client);
  rates.aed_kmf = await unit('AED');
  rates.usd_kmf = await unit('USD');
  return rates;
}

async function getRates() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;
  let raw;
  try {
    raw = await loadFromAuthority();
  } catch (err) {
    throw err instanceof fx.FxError ? err : new AuthoritativeRateUnavailableError();
  }
  const rates = buildFxRates(raw);
  // Un jeu incomplet n'est pas mis en cache : l'approbation d'une observation doit être vue immédiatement.
  if (raw.aed_kmf && raw.usd_kmf) { _cache = rates; _cacheAt = Date.now(); }
  return rates;
}

// Lecture stricte (paiement en devise) : EUR et AED requis, sinon 503.
async function getAuthoritativeRates() {
  const r = await getRates();
  return { eur_kmf: r.eur_kmf, aed_kmf: r.aed_kmf };
}

function invalidateCache() {
  _cache = null;
  _cacheAt = 0;
}

module.exports = {
  getRates,
  getAuthoritativeRates,
  invalidateCache,
  AuthoritativeRateUnavailableError,
  buildFxRates,
  loadFromAuthority,
  resolveFxRates,
};
