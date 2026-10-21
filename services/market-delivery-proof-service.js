/**
 * @komerce-arch
 * @role          market-delivery-proof-service
 * @domain        market-control-plane
 * @layer         service
 * @criticality   critical
 * @inputs        market id, central actor, attestation evidence (carrier, mode, origin, rate, transit, evidence_ref, validity)
 * @outputs       delivery proof verdict (HISTORY | ATTESTATION), auditable attestation/revocation
 * @depends       services/market-delegation-service.js
 * @used-by       services/order-checkout-service.js, services/market-control-plane.js, routes/admin-market-control-plane.js
 * @db-read       market_delivery_attestations, carriers, orders, markets
 * @db-write      market_delivery_attestations
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        caller-owned
 * @doctrine      no_boolean_readiness_bypass, global_tariffs_never_prove_delivery, fail_closed_without_proof, missing_is_not_zero
 * @impact-areas  market-control-plane, orders, checkout, logistics
 * @version       2026-10
 */
'use strict';

const { audit } = require('./market-delegation-service');

const MODES = Object.freeze(['SEA', 'AIR', 'ROAD', 'MIXED']);
const RATE_UNITS = Object.freeze(['PER_KG', 'PER_PARCEL']);
const HISTORY_MIN_COLLECTED = 1;
// Base HISTORY réservée aux marchés hérités explicitement listés (KM : liaison insulaire déjà exploitée).
// Tout autre marché (CM, CG, …) exige une ATTESTATION centrale : l'historique ne la remplace jamais.
const HISTORY_LEGACY_MARKET_CODES = Object.freeze(['KM']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function proofError(code, message, status = 409) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-delivery-proof-service: executor.query requis');
  }
  return executor;
}

/**
 * Preuve courante d'un marché. Deux bases vérifiables, aucune booléenne :
 *  - ATTESTATION : ligne non révoquée, non expirée, transporteur actif ;
 *  - HISTORY     : livraisons RÉELLES déjà abouties (orders collected, hors RCT1) — prouve la
 *                  liaison par les faits, sans réutiliser les tarifs globaux comme preuve.
 * Sans preuve : { proven:false, basis:null } — jamais de zéro/booléen par défaut.
 */
async function getDeliveryProof(executor, marketId) {
  const db = requireExecutor(executor);
  if (!marketId) return Object.freeze({ proven: false, basis: null, attestation: null, collected_orders: 0 });

  const { rows: [att] } = await db.query(
    `SELECT a.id, a.mode, a.origin_ref, a.freight_rate, a.rate_currency, a.rate_unit, a.transit_days,
            a.evidence_ref, a.attested_at, a.valid_until, c.name AS carrier_name
       FROM market_delivery_attestations a
       JOIN carriers c ON c.id = a.carrier_id AND c.is_active = TRUE
      WHERE a.market_id = $1::uuid AND a.revoked_at IS NULL AND a.valid_until > NOW()
      ORDER BY a.attested_at DESC
      LIMIT 1`,
    [marketId]
  );
  if (att) return Object.freeze({ proven: true, basis: 'ATTESTATION', attestation: Object.freeze({ ...att }), collected_orders: null });

  const { rows: [hist] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM orders o
       JOIN markets m ON m.id = o.market_id AND m.code = ANY($2::text[])
      WHERE o.market_id = $1::uuid AND o.status = 'collected' AND o.simulation_scope IS NULL`,
    [marketId, HISTORY_LEGACY_MARKET_CODES]
  );
  const n = Number(hist && hist.n) || 0;
  if (n >= HISTORY_MIN_COLLECTED) return Object.freeze({ proven: true, basis: 'HISTORY', attestation: null, collected_orders: n });
  return Object.freeze({ proven: false, basis: null, attestation: null, collected_orders: n });
}

/** Garde transactionnelle : un marché sans preuve n'accepte aucune nouvelle commande payante. */
async function assertMarketDeliverable(executor, marketId) {
  const proof = await getDeliveryProof(executor, marketId);
  if (!proof.proven) {
    throw proofError('MARKET_DELIVERY_NOT_PROVEN', 'Ce marché ne dispose pas encore d’une liaison de livraison et d’une tarification attestées.');
  }
  return proof;
}

function clean(value) { return typeof value === 'string' ? value.trim() : ''; }

async function attestDelivery(executor, { actorUserId, marketId: marketIdInput = null, marketCode = null, carrierId, mode, originRef, freightRate, rateCurrency, rateUnit, transitDays, evidenceRef, validUntil, correlationId = null }) {
  const db = requireExecutor(executor);
  if (!actorUserId) throw proofError('ATTESTATION_ACTOR_REQUIRED', 'Acteur central requis.', 400);
  if (!marketIdInput && !marketCode) throw proofError('MARKET_REQUIRED', 'Marché requis.', 400);
  if (marketIdInput && !UUID_RE.test(String(marketIdInput))) throw proofError('MARKET_INVALID', 'Identifiant de marché invalide.', 400);
  if (!MODES.includes(mode)) throw proofError('ATTESTATION_MODE_INVALID', 'Mode de transport invalide.', 400);
  if (!RATE_UNITS.includes(rateUnit)) throw proofError('ATTESTATION_RATE_UNIT_INVALID', 'Unité de tarif invalide.', 400);
  const rate = Number(freightRate);
  if (!Number.isFinite(rate) || rate <= 0) throw proofError('ATTESTATION_RATE_INVALID', 'Tarif strictement positif requis.', 400);
  const days = Number(transitDays);
  if (!Number.isInteger(days) || days <= 0 || days > 365) throw proofError('ATTESTATION_TRANSIT_INVALID', 'Délai de transit invalide.', 400);
  const origin = clean(originRef);
  const evidence = clean(evidenceRef);
  const currency = clean(rateCurrency).toUpperCase();
  if (origin.length < 2) throw proofError('ATTESTATION_ORIGIN_REQUIRED', 'Origine requise.', 400);
  if (evidence.length < 3) throw proofError('ATTESTATION_EVIDENCE_REQUIRED', 'Référence de preuve documentaire requise.', 400);
  if (!/^[A-Z]{3}$/.test(currency)) throw proofError('ATTESTATION_CURRENCY_INVALID', 'Devise du tarif invalide.', 400);
  const until = new Date(validUntil);
  if (!Number.isFinite(until.getTime()) || until.getTime() <= Date.now()) throw proofError('ATTESTATION_VALIDITY_INVALID', 'Validité future requise.', 400);

  if (!UUID_RE.test(String(carrierId || ''))) throw proofError('ATTESTATION_CARRIER_INVALID', 'Identifiant de transporteur invalide.', 400);
  const { rows: [carrier] } = await db.query('SELECT id FROM carriers WHERE id = $1::uuid AND is_active = TRUE', [carrierId]);
  if (!carrier) throw proofError('ATTESTATION_CARRIER_NOT_FOUND', 'Transporteur actif introuvable.', 404);
  const { rows: [market] } = marketIdInput
    ? await db.query('SELECT id FROM markets WHERE id = $1::uuid', [marketIdInput])
    : await db.query('SELECT id FROM markets WHERE code = $1', [clean(String(marketCode)).toUpperCase()]);
  if (!market) throw proofError('MARKET_NOT_FOUND', 'Marché introuvable.', 404);
  const marketId = market.id;

  const { rows: [row] } = await db.query(
    `INSERT INTO market_delivery_attestations
       (market_id, carrier_id, mode, origin_ref, freight_rate, rate_currency, rate_unit, transit_days, evidence_ref, attested_by, valid_until)
     VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11::timestamptz)
     RETURNING id, market_id, carrier_id, mode, origin_ref, freight_rate, rate_currency, rate_unit, transit_days, evidence_ref, attested_at, valid_until`,
    [marketId, carrierId, mode, origin, rate, currency, rateUnit, days, evidence, actorUserId, until.toISOString()]
  );
  await audit(db, { actorUserId, marketId, action: 'MARKET_DELIVERY_ATTESTED', after: row, correlationId });
  return row;
}

async function revokeDeliveryAttestation(executor, { actorUserId, attestationId, reason, marketCode = null, correlationId = null }) {
  const db = requireExecutor(executor);
  if (!actorUserId) throw proofError('ATTESTATION_ACTOR_REQUIRED', 'Acteur central requis.', 400);
  const why = clean(reason);
  if (why.length < 3) throw proofError('ATTESTATION_REVOKE_REASON_REQUIRED', 'Motif de révocation requis.', 400);
  if (!UUID_RE.test(String(attestationId || ''))) throw proofError('ATTESTATION_ID_INVALID', 'Identifiant d’attestation invalide.', 400);
  const { rows: [row] } = await db.query(
    `UPDATE market_delivery_attestations
        SET revoked_at = NOW(), revoked_by = $2::uuid, revoke_reason = $3
      WHERE id = $1::uuid AND revoked_at IS NULL
        AND ($4::text IS NULL OR market_id = (SELECT id FROM markets WHERE code = $4))
      RETURNING id, market_id, revoked_at`,
    [attestationId, actorUserId, why, marketCode ? clean(String(marketCode)).toUpperCase() : null]
  );
  if (!row) throw proofError('ATTESTATION_NOT_FOUND', 'Attestation active introuvable.', 404);
  await audit(db, { actorUserId, marketId: row.market_id, action: 'MARKET_DELIVERY_ATTESTATION_REVOKED', after: row, correlationId });
  return row;
}

module.exports = { HISTORY_LEGACY_MARKET_CODES, MODES, RATE_UNITS, HISTORY_MIN_COLLECTED, getDeliveryProof, assertMarketDeliverable, attestDelivery, revokeDeliveryAttestation };
