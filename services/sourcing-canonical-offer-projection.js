/**
 * @komerce-arch
 * @role          sourcing-canonical-offer-projection
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        active_offer_resolution_bindings, immutable_offer_observations
 * @outputs       shadow_canonical_offer_projection
 * @depends       db.js, services/sourcing-canonical-commercial-projection-core.js
 * @used-by       services/sourcing-canonical-offer-unit-comparison.js
 * @db-read       sourcing_canonical_entities, sourcing_resolution_bindings, sourcing_observations, sourcing_captures, sourcing_sources, sourcing_canonical_entity_refs
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CANONICAL_PRODUCT_OFFER_UNIT.md
 * @impact-areas  sourcing, purchasing
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const core = require('./sourcing-canonical-commercial-projection-core');

const OFFER_STATE_FIELDS = Object.freeze([
  'supplier_product_id', 'offer_ref', 'currency', 'purchase_price',
  'stock_available', 'availability', 'min_order_qty', 'supplier_delay_days',
  'freight', 'freight_facts',
]);

function buildCanonicalOfferProjection(rows = [], refs = []) {
  if (!rows.length) return null;
  const first = rows[0];
  const { state, latest } = core.currentState(rows, OFFER_STATE_FIELDS);
  const principals = [...new Set(rows.map((row) => row.principal_id || row.principal_ref).filter(Boolean))].sort();
  const sourceIds = [...new Set(rows.map((row) => row.source_id).filter(Boolean))].sort();
  const externalRefs = refs.length ? refs : core.identityRefs(rows, ['supplier_product_id', 'offer_ref']);
  return {
    canonical_offer_id: first.canonical_entity_id,
    canonical_product_id: first.parent_entity_id,
    identity: {
      canonical_offer_id: first.canonical_entity_id,
      canonical_product_id: first.parent_entity_id,
      principal_id: first.principal_id || null,
      observed_principal_refs: principals,
      external_refs: core.clone(externalRefs),
      deterministic: Boolean(first.principal_id || principals.length || externalRefs.length),
      ambiguity_preserved: !(first.principal_id || principals.length || externalRefs.length),
    },
    current_state: state,
    last_observation_delta: core.observationDelta(rows, OFFER_STATE_FIELDS),
    observation_count: rows.length,
    observed_at: latest?.observed_at || null,
    freshness: { latest_observed_at: latest?.observed_at || null, stale: null },
    source_ids: sourceIds,
    provenance: core.provenance(rows),
    authority: 'shadow_read_only',
  };
}

async function collectCanonicalOfferProjectionById(canonicalOfferId, query = db.query.bind(db)) {
  const result = await query(`
    SELECT ce.canonical_entity_id, ce.parent_entity_id, ce.principal_id,
           o.observation_id, o.source_ref, o.principal_ref, o.observed_at, o.normalized,
           c.source_id, s.adapter_type
      FROM sourcing_canonical_entities ce
      JOIN sourcing_resolution_bindings rb ON rb.canonical_entity_id = ce.canonical_entity_id AND rb.ended_at IS NULL
      JOIN sourcing_observations o ON o.observation_id = rb.observation_id AND o.grain::text = 'offer'
      JOIN sourcing_captures c ON c.capture_id = o.capture_id
      JOIN sourcing_sources s ON s.source_id = c.source_id
     WHERE ce.canonical_entity_id = $1 AND ce.grain::text = 'offer' AND ce.status = 'active'
     ORDER BY o.observed_at, o.observation_id
  `, [canonicalOfferId]);
  if (!(result.rows || []).length) return null;
  const refResult = await query(`
    SELECT source_id AS namespace, ref_kind AS kind, ref_value AS value
      FROM sourcing_canonical_entity_refs
     WHERE canonical_entity_id = $1 ORDER BY source_id, ref_kind, ref_value
  `, [canonicalOfferId]);
  return buildCanonicalOfferProjection(result.rows, refResult.rows || []);
}

module.exports = { OFFER_STATE_FIELDS, buildCanonicalOfferProjection, collectCanonicalOfferProjectionById };
