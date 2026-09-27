/**
 * @komerce-arch
 * @role          sourcing-canonical-commercial-projection-core
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        immutable_offer_or_unit_observations
 * @outputs       identity_and_temporal_state_projection
 * @depends       none
 * @used-by       services/sourcing-canonical-offer-projection.js, services/sourcing-canonical-unit-projection.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CANONICAL_PRODUCT_OFFER_UNIT.md
 * @impact-areas  sourcing, purchasing
 * @version       2026-09
 */
'use strict';

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const present = (value) => value !== null && value !== undefined && value !== '';

// PostgreSQL timestamps arrive as JS Date objects. String(Date) drops
// milliseconds, so adjacent captures in the same second could otherwise
// be reversed by their random observation UUID and regress current stock.
function comparableTime(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]/.test(value)) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function compareObservationOrder(a, b) {
  const aTime = comparableTime(a?.observed_at);
  const bTime = comparableTime(b?.observed_at);
  const timeOrder = aTime !== null && bTime !== null
    ? Math.sign(aTime - bTime)
    : String(a?.observed_at ?? '').localeCompare(String(b?.observed_at ?? ''));
  return timeOrder || String(a?.observation_id ?? '').localeCompare(String(b?.observation_id ?? ''));
}

function latestObservation(rows = []) {
  return [...rows].sort(compareObservationOrder).at(-1) || null;
}

function currentState(rows, fields) {
  const latest = latestObservation(rows);
  const state = {};
  for (const field of fields) {
    if (present(latest?.normalized?.[field])) state[field] = clone(latest.normalized[field]);
  }
  return { state, latest };
}

function identityRefs(rows = [], fields = []) {
  const refs = [];
  for (const row of rows) {
    if (present(row.source_ref)) refs.push({ namespace: row.source_id, kind: 'source_ref', value: String(row.source_ref) });
    for (const field of fields) {
      if (present(row.normalized?.[field])) refs.push({ namespace: row.source_id, kind: field, value: String(row.normalized[field]) });
    }
  }
  const unique = new Map(refs.map((ref) => [`${ref.namespace}:${ref.kind}:${ref.value}`, ref]));
  return [...unique.values()].sort((a, b) =>
    `${a.namespace}:${a.kind}:${a.value}`.localeCompare(`${b.namespace}:${b.kind}:${b.value}`)
  );
}

function provenance(rows = []) {
  return [...rows]
    .sort(compareObservationOrder)
    .map((row) => ({
      observation_id: row.observation_id,
      source_id: row.source_id,
      adapter_type: row.adapter_type,
      principal_ref: row.principal_ref || null,
      observed_at: row.observed_at,
    }));
}

/**
 * Read-only difference between the last two observations of ONE canonical
 * Offer or Unit. Missing/null facts are UNKNOWN, never zero or removal.
 * This is detection evidence, NOT a sellability or Purchasing verdict.
 */
function observationDelta(rows = [], fields = []) {
  const ordered = [...rows].sort(compareObservationOrder);
  const latest = ordered.at(-1);
  const previous = ordered.at(-2);
  if (!latest) return { status: 'UNKNOWN', reason: 'NO_OBSERVATION', changes: [], unknown_fields: [...fields] };
  if (!previous) return {
    status: 'FIRST_OBSERVATION', observed_at: latest.observed_at,
    changes: [], unknown_fields: [], newly_observed_fields: [],
  };

  // An Offer can have multiple observation sources. A cross-source pair
  // is not a comparable supplier delta unless the provider contract proves it.
  if (String(previous.source_id || '') !== String(latest.source_id || '') ||
      String(previous.principal_ref || '') !== String(latest.principal_ref || '')) {
    return {
      status: 'UNKNOWN', reason: 'SOURCE_SCOPE_CHANGED',
      previous_observed_at: previous.observed_at, observed_at: latest.observed_at,
      changes: [], unknown_fields: [...fields], newly_observed_fields: [],
    };
  }

  const changes = [];
  const unknownFields = [];
  const newlyObserved = [];
  let compared = 0;
  const equal = (a, b) => stableFact(a) === stableFact(b);
  for (const field of fields) {
    const before = previous.normalized?.[field];
    const after = latest.normalized?.[field];
    if (!present(after)) {
      unknownFields.push(field);
    } else if (!present(before)) {
      newlyObserved.push(field);
    } else {
      compared += 1;
      if (!equal(before, after)) changes.push({ field, before: clone(before), after: clone(after) });
    }
  }
  return {
    status: changes.length ? 'CHANGED' : (unknownFields.length || newlyObserved.length || !compared ? 'UNKNOWN' : 'UNCHANGED'),
    previous_observed_at: previous.observed_at,
    observed_at: latest.observed_at,
    compared_fields: compared,
    changes,
    unknown_fields: unknownFields,
    newly_observed_fields: newlyObserved,
  };
}

function stableFact(value) {
  if (Array.isArray(value)) return '[' + value.map(stableFact).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableFact(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

module.exports = { clone, present, latestObservation, currentState, identityRefs, provenance, observationDelta };
