/**
 * @komerce-arch
 * @role          fx-observation-service
 * @domain        market
 * @layer         service
 * @criticality   critical
 * @inputs        rate, source_label, source_ref, as_of, actor_identity
 * @outputs       fx_rate_observation
 * @depends       db, utils/alerts.js, utils/logger.js
 * @used-by       routes/admin-finance-config.js, scripts/fx-observation-cli.js
 * @db-read       fx_rate_observations
 * @db-write      fx_rate_observations
 * @db-txn        none
 * @doctrine      eur_is_the_pivot, two_person_rule, append_only_fx_observations, no_invented_rate
 * @impact-areas  market, pricing, payments
 * @version       2026-10
 *
 * Saisie et approbation de l'observation EUR/USD (seule entrée flottante de la chaîne FX) :
 *   - saisie (identité A) puis approbation (identité B ≠ A) ; identités normalisées (trim + minuscules) ;
 *   - la table est append-only (triggers) : jamais de modification d'un taux existant ;
 *   - le taux, sa source et sa date (`as_of`) sont fournis par l'opérateur : aucun taux n'est pré-rempli ni inventé ;
 *   - à l'approbation, un écart > 3 % avec la précédente observation approuvée lève une alerte (l'approbation reste possible).
 */
'use strict';

const db = require('../db');
const log = require('../utils/logger').child({ module: 'fx-observation-service' });
const { createAlert } = require('../utils/alerts');

const GAP_ALERT_PCT = 3;

class FxObservationError extends Error {
  constructor(message, code, statusCode = 422) {
    super(message);
    this.name = 'FxObservationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeIdentity(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) throw new FxObservationError('Identité de l\'opérateur requise.', 'fx_observation_identity_required', 400);
  return v;
}

async function enterObservation({ rate, sourceLabel, sourceRef = null, asOf, enteredBy }, client = db) {
  const actor = normalizeIdentity(enteredBy);
  const r = Number(rate);
  if (!Number.isFinite(r) || r < 0.8 || r > 1.6) {
    throw new FxObservationError('Taux EUR/USD hors bande de plausibilité (0,8 à 1,6 USD pour 1 EUR).', 'fx_observation_rate_invalid');
  }
  if (!String(sourceLabel || '').trim()) throw new FxObservationError('Source du taux requise.', 'fx_observation_source_required');
  const when = new Date(asOf);
  if (!asOf || Number.isNaN(when.getTime())) throw new FxObservationError('Date du taux (as_of) requise.', 'fx_observation_as_of_required');
  if (when.getTime() > Date.now()) throw new FxObservationError('Date du taux dans le futur.', 'fx_observation_as_of_future');
  try {
    const { rows: [row] } = await client.query(
      `INSERT INTO fx_rate_observations (rate, source_label, source_ref, as_of, entered_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, rate::text AS rate, source_label, source_ref, as_of, entered_by, approved_by, approved_at, created_at`,
      [String(rate), String(sourceLabel).trim(), sourceRef ? String(sourceRef).trim() : null, when, actor]
    );
    return row;
  } catch (err) {
    if (err && err.code === '23505') {
      throw new FxObservationError('Une observation existe déjà pour cette date.', 'fx_observation_duplicate_as_of', 409);
    }
    throw err;
  }
}

async function approveObservation({ id, approvedBy }, client = db) {
  const actor = normalizeIdentity(approvedBy);
  const { rows: [obs] } = await client.query(
    'SELECT id, rate::text AS rate, as_of, entered_by, approved_by FROM fx_rate_observations WHERE id = $1', [id]);
  if (!obs) throw new FxObservationError('Observation introuvable.', 'fx_observation_not_found', 404);
  if (obs.approved_by) throw new FxObservationError('Observation déjà approuvée.', 'fx_observation_already_approved', 409);
  if (String(obs.entered_by).trim().toLowerCase() === actor) {
    throw new FxObservationError('L\'approbation doit être faite par une autre personne que le saisissant.', 'fx_observation_two_person_required', 409);
  }
  const { rows: [prev] } = await client.query(
    `SELECT rate::text AS rate FROM fx_rate_observations
      WHERE approved_by IS NOT NULL AND as_of < $1 ORDER BY as_of DESC LIMIT 1`, [obs.as_of]);
  const { rows: [approved] } = await client.query(
    `UPDATE fx_rate_observations SET approved_by = $2
      WHERE id = $1 AND approved_by IS NULL
      RETURNING id, rate::text AS rate, source_label, as_of, entered_by, approved_by, approved_at`,
    [id, actor]);
  if (!approved) throw new FxObservationError('Observation déjà approuvée.', 'fx_observation_already_approved', 409);
  let gapPct = null;
  if (prev && Number(prev.rate) > 0) {
    gapPct = Math.abs(Number(obs.rate) - Number(prev.rate)) / Number(prev.rate) * 100;
    if (gapPct > GAP_ALERT_PCT) {
      try {
        await createAlert(client, {
          type: 'fx_observation_gap', entityType: 'fx_rate_observation', entityId: obs.id, severity: 'high',
          title: `Écart EUR/USD de ${gapPct.toFixed(2)} % à l'approbation`,
          description: `Taux ${obs.rate} approuvé contre ${prev.rate} précédemment (seuil ${GAP_ALERT_PCT} %). À vérifier auprès de la source.`,
        });
      } catch (err) {
        log.error({ err }, '[fx-observation] alerte d\'écart non créée');
      }
    }
  }
  try { require('../utils/rates').invalidateCache(); } catch (_) { /* best-effort */ }
  return { ...approved, gap_pct: gapPct === null ? null : Number(gapPct.toFixed(4)), gap_alert: gapPct !== null && gapPct > GAP_ALERT_PCT };
}

async function listObservations({ limit = 20 } = {}, client = db) {
  const { rows } = await client.query(
    `SELECT id, rate::text AS rate, source_label, source_ref, as_of, entered_by, approved_by, approved_at, created_at
       FROM fx_rate_observations ORDER BY as_of DESC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 20, 1), 100)]);
  return rows;
}

module.exports = { enterObservation, approveObservation, listObservations, normalizeIdentity, FxObservationError, GAP_ALERT_PCT };
