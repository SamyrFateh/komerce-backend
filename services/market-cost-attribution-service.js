/**
 * @komerce-arch
 * @role          economic-engine-market-cost-attribution
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        economic_structure_cost_event_id, allocation_policies, actor_id, reason
 * @outputs       market_cost_attributions
 * @depends       db, services/pricing-period-structure.js
 * @used-by       future admin attribution route, future pricing market coverage
 * @db-read       economic_structure_cost_events, market_cost_attributions
 * @db-write      market_cost_attributions
 * @db-txn        BEGIN/COMMIT with advisory lock per source event
 * @doctrine      pricing_market_viability_cost_scope
 * @impact-areas  economic-engine, pricing, governance
 * @version       2026-10
 */

/**
 * KOMERCE — Attribution des charges de structure mutualisées aux marchés
 * ════════════════════════════════════════════════════════════════════════
 *
 * Invariants :
 * - seuls les faits GROUP de type ACCRUAL sont attribuables ; les charges de
 *   structure directes portent déjà leur market_id, et les coûts variables
 *   transactionnels sont projetés via order.market_id, jamais attribués ici ;
 * - la ventilation vient exclusivement de pricing-period-structure
 *   (allocateStructurePool) : aucune clé de répartition parallèle ;
 * - journal append-only : jamais d'UPDATE, jamais de DELETE ;
 * - idempotence sur attribution ACTIVE : une ATTRIBUTION non ciblée par un
 *   REVERSAL bloque toute nouvelle attribution du même fait (noop) ;
 * - correction = REVERSAL de toutes les attributions actives puis nouvelle
 *   ATTRIBUTION, dans une seule transaction ;
 * - conservation : la somme des parts écrites égale le montant du fait, au
 *   centime ; sinon rien n'est écrit ;
 * - un fait non décisionnel (politique absente/ambiguë, assiette vide…) n'écrit
 *   rien et ne déclenche aucun repli silencieux ;
 * - un verrou transactionnel par fait sérialise les écritures concurrentes.
 */

'use strict';

const db = require('../db');
const { allocateStructurePool } = require('./pricing-period-structure');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const OUTCOMES = Object.freeze({
  ATTRIBUTED: 'ATTRIBUTED',
  NOOP_ACTIVE_ATTRIBUTION: 'NOOP_ACTIVE_ATTRIBUTION',
  NOOP_UNCHANGED: 'NOOP_UNCHANGED',
  NOT_DECISIONAL: 'NOT_DECISIONAL',
  REVERSED: 'REVERSED',
  NOTHING_TO_REVERSE: 'NOTHING_TO_REVERSE',
  CORRECTED: 'CORRECTED',
});

class MarketCostAttributionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MarketCostAttributionError';
    this.code = code;
  }
}

function requireUuid(value, field) {
  const text = String(value || '').trim();
  if (!UUID_RE.test(text)) {
    throw new MarketCostAttributionError('INVALID_INPUT', `${field} must be a UUID`);
  }
  return text;
}

function requireReason(value) {
  const text = String(value || '').trim();
  if (text.length < 3 || text.length > 500) {
    throw new MarketCostAttributionError('INVALID_INPUT', 'reason length must be between 3 and 500');
  }
  return text;
}

function toCents(value) {
  return Math.round(Number(value) * 100);
}

function centsToAmount(cents) {
  return (cents / 100).toFixed(2);
}

function resolveExecutor(options) {
  const injected = options && options.executor ? options.executor : null;
  if (injected && typeof injected.query !== 'function') {
    throw new TypeError('market-cost-attribution options.executor.query is required');
  }
  return injected;
}

// Exécute `fn(client)` sous verrou exclusif par fait source. Possède la
// transaction sauf si l'appelant injecte un executor déjà transactionnel.
async function runExclusive(eventId, options, fn) {
  const injected = resolveExecutor(options);
  const client = injected || await db.getClient();
  const ownsTransaction = !injected;
  try {
    if (ownsTransaction) await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [eventId]);
    const result = await fn(client);
    if (ownsTransaction) await client.query('COMMIT');
    return result;
  } catch (error) {
    if (ownsTransaction) {
      try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }
    }
    throw error;
  } finally {
    if (ownsTransaction && typeof client.release === 'function') client.release();
  }
}

async function loadSourceEvent(client, eventId) {
  const { rows } = await client.query(
    `SELECT e.id, e.charge_id, e.scope_kind, e.event_kind, e.amount_kmf,
            e.economic_from, e.economic_to,
            EXISTS (
              SELECT 1 FROM public.economic_structure_cost_events adj
               WHERE adj.adjusts_event_id = e.id
            ) AS has_adjustments
       FROM public.economic_structure_cost_events e
      WHERE e.id = $1`,
    [eventId]
  );
  if (!rows || !rows[0]) {
    throw new MarketCostAttributionError('EVENT_NOT_FOUND', `structure cost event ${eventId} not found`);
  }
  return rows[0];
}

function assertAttributable(event) {
  if (event.scope_kind !== 'GROUP') {
    throw new MarketCostAttributionError('EVENT_NOT_GROUP', 'only GROUP structure cost events can be attributed');
  }
  if (event.event_kind !== 'ACCRUAL') {
    throw new MarketCostAttributionError('EVENT_NOT_ACCRUAL', 'only ACCRUAL events can be attributed');
  }
  if (event.has_adjustments) {
    throw new MarketCostAttributionError(
      'EVENT_ALREADY_ADJUSTED',
      'event has adjustments or reversals; attribution requires a human decision'
    );
  }
}

// Attributions actives = ATTRIBUTION qu'aucun REVERSAL ne cible.
async function loadActiveAttributions(client, eventId) {
  const { rows } = await client.query(
    `SELECT a.id, a.market_id, a.amount_kmf, a.allocation_key, a.policy_version
       FROM public.market_cost_attributions a
      WHERE a.source_event_id = $1
        AND a.event_kind = 'ATTRIBUTION'
        AND NOT EXISTS (
          SELECT 1 FROM public.market_cost_attributions r
           WHERE r.reverses_id = a.id
        )
      ORDER BY a.market_id ASC, a.id ASC`,
    [eventId]
  );
  return rows || [];
}

async function insertRow(client, row) {
  const { rows } = await client.query(
    `INSERT INTO public.market_cost_attributions
       (source_event_id, market_id, event_kind, amount_kmf, allocation_key,
        allocation_basis, policy_version, reverses_id, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
     RETURNING id, source_event_id, market_id, event_kind, amount_kmf, policy_version, reverses_id`,
    [
      row.source_event_id, row.market_id, row.event_kind, row.amount_kmf,
      row.allocation_key, JSON.stringify(row.allocation_basis), row.policy_version,
      row.reverses_id || null, row.recorded_by,
    ]
  );
  return rows[0];
}

async function computeAllocation(event, policies) {
  return allocateStructurePool(
    { charge_id: event.charge_id, group_pool_kmf: Number(event.amount_kmf) },
    policies,
    { from: event.economic_from, to: event.economic_to }
  );
}

// Construit les lignes ATTRIBUTION et vérifie la conservation avant toute écriture.
function buildAttributionRows(event, allocation, actorId) {
  const policy = allocation.policy;
  const period = {
    from: new Date(event.economic_from).toISOString(),
    to: new Date(event.economic_to).toISOString(),
  };
  const rows = allocation.shares
    .filter((share) => toCents(share.allocated_kmf) > 0)
    .map((share) => ({
      source_event_id: event.id,
      market_id: String(share.market_id),
      event_kind: 'ATTRIBUTION',
      amount_kmf: centsToAmount(toCents(share.allocated_kmf)),
      allocation_key: `${policy.policy_kind}:${policy.basis_kind}`,
      allocation_basis: {
        policy: {
          charge_id: policy.charge_id,
          version: policy.version,
          source: policy.source,
          evidence_ref: policy.evidence_ref,
          policy_kind: policy.policy_kind,
          basis_kind: policy.basis_kind,
          eligibility_kind: policy.eligibility_kind,
          confidence: policy.confidence,
          base_pool_ratio: policy.base_pool_ratio,
        },
        basis_source: allocation.basis_source,
        basis_total: allocation.basis_total,
        basis_value: share.basis_value,
        allocation_ratio: share.allocation_ratio,
        pool_kmf: Number(event.amount_kmf),
        period,
      },
      policy_version: policy.version,
      recorded_by: actorId,
    }));

  const writtenCents = rows.reduce((sum, row) => sum + toCents(row.amount_kmf), 0);
  if (writtenCents !== toCents(event.amount_kmf)) {
    throw new MarketCostAttributionError(
      'CONSERVATION_FAILURE',
      `attribution total ${centsToAmount(writtenCents)} differs from event amount ${event.amount_kmf}`
    );
  }
  return rows;
}

async function insertReversals(client, active, actorId, reason) {
  const written = [];
  for (const attribution of active) {
    written.push(await insertRow(client, {
      source_event_id: attribution.source_event_id,
      market_id: attribution.market_id,
      event_kind: 'REVERSAL',
      amount_kmf: centsToAmount(-toCents(attribution.amount_kmf)),
      allocation_key: attribution.allocation_key,
      allocation_basis: { reversal_of: attribution.id, reason },
      policy_version: attribution.policy_version,
      reverses_id: attribution.id,
      recorded_by: actorId,
    }));
  }
  return written;
}

function sameDistribution(active, rows) {
  if (active.length !== rows.length) return false;
  const current = new Map(active.map((a) => [`${a.market_id}|${a.policy_version}`, toCents(a.amount_kmf)]));
  return rows.every((row) => current.get(`${row.market_id}|${row.policy_version}`) === toCents(row.amount_kmf));
}

function validateCommon(input) {
  return {
    eventId: requireUuid(input.eventId, 'eventId'),
    actorId: requireUuid(input.actorId, 'actorId'),
  };
}

function requirePolicies(policies) {
  if (!Array.isArray(policies) || policies.length === 0) {
    throw new MarketCostAttributionError('INVALID_INPUT', 'policies must be a non-empty array');
  }
  return policies;
}

// Attribue un fait GROUP aux marchés. Noop si une attribution active existe.
async function attributeGroupEvent(input = {}, options = {}) {
  const { eventId, actorId } = validateCommon(input);
  const policies = requirePolicies(input.policies);

  return runExclusive(eventId, options, async (client) => {
    const event = await loadSourceEvent(client, eventId);
    assertAttributable(event);

    const active = await loadActiveAttributions(client, eventId);
    if (active.length > 0) {
      return { outcome: OUTCOMES.NOOP_ACTIVE_ATTRIBUTION, event_id: eventId, active_count: active.length, written: [] };
    }

    const allocation = await computeAllocation(event, policies);
    if (!allocation.decisional) {
      return { outcome: OUTCOMES.NOT_DECISIONAL, event_id: eventId, reason: allocation.status, written: [] };
    }

    const written = [];
    for (const row of buildAttributionRows(event, allocation, actorId)) {
      written.push(await insertRow(client, row));
    }
    return { outcome: OUTCOMES.ATTRIBUTED, event_id: eventId, written };
  });
}

// Annule toutes les attributions actives d'un fait (REVERSAL, jamais DELETE).
async function reverseAttributions(input = {}, options = {}) {
  const { eventId, actorId } = validateCommon(input);
  const reason = requireReason(input.reason);

  return runExclusive(eventId, options, async (client) => {
    await loadSourceEvent(client, eventId);
    const active = await loadActiveAttributions(client, eventId);
    if (active.length === 0) {
      return { outcome: OUTCOMES.NOTHING_TO_REVERSE, event_id: eventId, written: [] };
    }
    const withSource = active.map((a) => ({ ...a, source_event_id: eventId }));
    const written = await insertReversals(client, withSource, actorId, reason);
    return { outcome: OUTCOMES.REVERSED, event_id: eventId, written };
  });
}

// Correction atomique : recalcul d'abord, puis REVERSAL des actives et nouvelle
// ATTRIBUTION. Si le recalcul n'est pas décisionnel, rien n'est annulé.
async function correctGroupEventAttribution(input = {}, options = {}) {
  const { eventId, actorId } = validateCommon(input);
  const policies = requirePolicies(input.policies);
  const reason = requireReason(input.reason);

  return runExclusive(eventId, options, async (client) => {
    const event = await loadSourceEvent(client, eventId);
    assertAttributable(event);

    const active = await loadActiveAttributions(client, eventId);
    if (active.length === 0) {
      throw new MarketCostAttributionError(
        'NO_ACTIVE_ATTRIBUTION',
        'nothing to correct: use attributeGroupEvent for a first attribution'
      );
    }

    const allocation = await computeAllocation(event, policies);
    if (!allocation.decisional) {
      return { outcome: OUTCOMES.NOT_DECISIONAL, event_id: eventId, reason: allocation.status, written: [] };
    }

    const rows = buildAttributionRows(event, allocation, actorId);
    if (sameDistribution(active, rows)) {
      return { outcome: OUTCOMES.NOOP_UNCHANGED, event_id: eventId, written: [] };
    }

    const withSource = active.map((a) => ({ ...a, source_event_id: eventId }));
    const written = await insertReversals(client, withSource, actorId, reason);
    for (const row of rows) written.push(await insertRow(client, row));
    return { outcome: OUTCOMES.CORRECTED, event_id: eventId, written };
  });
}

module.exports = {
  OUTCOMES,
  MarketCostAttributionError,
  attributeGroupEvent,
  reverseAttributions,
  correctGroupEventAttribution,
};
