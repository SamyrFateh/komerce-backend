/**
 * @komerce-arch
 * @role          fx-chain-service
 * @domain        market
 * @layer         service
 * @criticality   critical
 * @inputs        at, max_age_days, amount_eur
 * @outputs       chain{eur_to_djf, legs[observation_id, peg_id]}, FxChainUnavailableError
 * @depends       db.js
 * @used-by       tests/integration/fx-chain-postgres.test.js
 * @db-read       fx_rate_observations, fx_pegs
 * @db-write      none
 * @db-txn        none
 * @doctrine      fail_closed, no_fallback_rate, frozen_per_transaction, eur_is_pivot
 * @impact-areas  market, finance, checkout
 * @version       2026-10
 *
 * Chaîne EUR→USD→DJF. Le taux DJF/EUR est DÉRIVÉ à la résolution (jamais stocké) ; le résultat porte les ids
 * des jambes afin que le snapshot de transaction les fige. Aucun repli (ni 492, ni 138, ni dernier taux périmé).
 * Un seul arrondi, à la fin (DJF minor_unit = 0).
 * `at` absent = heure de la base (jamais l'horloge du process, décalée de celle de PostgreSQL).
 */
'use strict';

const db = require('../db');

const DEFAULT_MAX_AGE_DAYS = 7;

class FxChainUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FxChainUnavailableError';
    this.code = 'fx_rate_unavailable';
    this.statusCode = 503;
  }
}

async function resolveObservation({ at = null, maxAgeDays = DEFAULT_MAX_AGE_DAYS, client = db } = {}) {
  const { rows: [obs] } = await client.query(
    `SELECT id, rate, rate::text AS rate_text, as_of, source_label
       FROM fx_rate_observations
      WHERE approved_by IS NOT NULL AND as_of <= COALESCE($1::timestamptz, now())
        AND created_at <= COALESCE($1::timestamptz, now()) AND approved_at <= COALESCE($1::timestamptz, now())
        AND as_of >= COALESCE($1::timestamptz, now()) - make_interval(days => $2::int)
      ORDER BY as_of DESC LIMIT 1`,
    [at, maxAgeDays]
  );
  if (!obs) throw new FxChainUnavailableError('Aucun taux EUR/USD approuvé et frais : conversion refusée');
  return obs;
}

async function resolvePeg({ quote = 'DJF', at = null, client = db } = {}) {
  const { rows: [peg] } = await client.query(
    `SELECT id, rate, rate::text AS rate_text, valid_from, source_label FROM fx_pegs
      WHERE quote_ccy = $2 AND valid_from <= COALESCE($1::timestamptz, now())
        AND created_at <= COALESCE($1::timestamptz, now()) ORDER BY valid_from DESC LIMIT 1`,
    [at, quote]
  );
  if (!peg) throw new FxChainUnavailableError(`Aucun peg USD/${quote} valide : conversion refusée`);
  return peg;
}

async function resolveChain({ at = null, maxAgeDays = DEFAULT_MAX_AGE_DAYS, client = db } = {}) {
  const obs = await resolveObservation({ at, maxAgeDays, client });
  const peg = await resolvePeg({ quote: 'DJF', at, client });
  const eurUsd = Number(obs.rate);
  const usdDjf = Number(peg.rate);
  return {
    eur_to_djf: eurUsd * usdDjf,
    legs: [
      { kind: 'observation', id: obs.id, pair: 'EUR/USD', rate: eurUsd, as_of: obs.as_of, source: obs.source_label },
      { kind: 'peg', id: peg.id, pair: 'USD/DJF', rate: usdDjf, valid_from: peg.valid_from, source: peg.source_label },
    ],
  };
}

/** Convertit un montant EUR en DJF avec une chaîne déjà résolue (figée) ; arrondi unique au plus proche. */
function convertEurToDjf(amountEur, chain) {
  const amount = Number(assertAmount(amountEur));
  return Math.round(amount * chain.eur_to_djf);
}

function assertAmount(v) {
  if (!Number.isFinite(Number(v)) || Number(v) < 0) throw new RangeError('Montant EUR invalide');
  return v;
}

module.exports = { resolveObservation, resolvePeg, resolveChain, convertEurToDjf, FxChainUnavailableError, DEFAULT_MAX_AGE_DAYS };
