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

function latestObservation(rows = []) {
  return [...rows].sort((a, b) =>
    String(a.observed_at).localeCompare(String(b.observed_at)) ||
    String(a.observation_id).localeCompare(String(b.observation_id))
  ).at(-1) || null;
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
    .sort((a, b) => String(a.observed_at).localeCompare(String(b.observed_at)))
    .map((row) => ({
      observation_id: row.observation_id,
      source_id: row.source_id,
      adapter_type: row.adapter_type,
      principal_ref: row.principal_ref || null,
      observed_at: row.observed_at,
    }));
}

module.exports = { clone, present, latestObservation, currentState, identityRefs, provenance };
