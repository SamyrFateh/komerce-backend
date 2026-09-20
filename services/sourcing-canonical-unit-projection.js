/**
 * @komerce-arch
 * @role          sourcing-canonical-unit-projection
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        active_unit_resolution_bindings, immutable_unit_observations
 * @outputs       shadow_canonical_unit_projection
 * @depends       db.js, services/sourcing-canonical-commercial-projection-core.js
 * @used-by       services/sourcing-canonical-offer-unit-comparison.js, services/sourcing-canonical-unit-product-sku-resolution.js
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

const UNIT_IDENTITY_FIELDS = Object.freeze(['supplier_unit_ref', 'supplier_sku', 'supplier_variant_id']);
const UNIT_STATE_FIELDS = Object.freeze([
  'option_values', 'variant_attributes', 'purchase_price', 'currency',
  'stock_available', 'availability', 'is_active', 'supplier_order_identity',
]);

function buildCanonicalUnitProjection(rows = [], refs = []) {
  if (!rows.length) return null;
  const first = rows[0];
  const externalRefs = refs.length ? refs : core.identityRefs(rows, UNIT_IDENTITY_FIELDS);
  const { state, latest } = core.currentState(rows, UNIT_STATE_FIELDS);
  const deterministicRefs = externalRefs.filter((ref) =>
    ref.kind === 'source_ref' || ref.kind === 'unit.source_ref' || UNIT_IDENTITY_FIELDS.includes(ref.kind)
  );
  const hasSoi = Boolean(state.supplier_order_identity);
  const identityDeterministic = deterministicRefs.length > 0;
  const blockers = [];
  if (!identityDeterministic) blockers.push('missing_deterministic_unit_ref');
  if (!hasSoi) blockers.push('missing_supplier_order_identity');
  if (state.is_active === false) blockers.push('unit_inactive');
  if (state.stock_available === 0) blockers.push('out_of_stock');

  return {
    canonical_unit_id: first.canonical_entity_id,
    canonical_offer_id: first.parent_entity_id,
    identity: {
      canonical_unit_id: first.canonical_entity_id,
      canonical_offer_id: first.parent_entity_id,
      external_refs: core.clone(externalRefs),
      deterministic_refs: core.clone(deterministicRefs),
      deterministic: identityDeterministic,
      ambiguity_preserved: !identityDeterministic,
    },
    current_state: state,
    last_observation_delta: core.observationDelta(rows, UNIT_STATE_FIELDS),
    observation_count: rows.length,
    observed_at: latest?.observed_at || null,
    provenance: core.provenance(rows),
    commandability: {
      capability_identified: identityDeterministic,
      supplier_order_identity_present: hasSoi,
      ready_now: false,
      readiness_evaluated: false,
      blockers,
    },
    authority: 'shadow_read_only',
  };
}

async function collectCanonicalUnitProjectionById(canonicalUnitId, query = db.query.bind(db)) {
  const result = await query(`
    SELECT ce.canonical_entity_id, ce.parent_entity_id,
           o.observation_id, o.source_ref, o.principal_ref, o.observed_at, o.normalized,
           c.source_id, s.adapter_type
      FROM sourcing_canonical_entities ce
      JOIN sourcing_resolution_bindings rb ON rb.canonical_entity_id = ce.canonical_entity_id AND rb.ended_at IS NULL
      JOIN sourcing_observations o ON o.observation_id = rb.observation_id AND o.grain::text = 'unit'
      JOIN sourcing_captures c ON c.capture_id = o.capture_id
      JOIN sourcing_sources s ON s.source_id = c.source_id
     WHERE ce.canonical_entity_id = $1 AND ce.grain::text = 'unit' AND ce.status = 'active'
     ORDER BY o.observed_at, o.observation_id
  `, [canonicalUnitId]);
  if (!(result.rows || []).length) return null;
  const refResult = await query(`
    SELECT source_id AS namespace, ref_kind AS kind, ref_value AS value
      FROM sourcing_canonical_entity_refs
     WHERE canonical_entity_id = $1 ORDER BY source_id, ref_kind, ref_value
  `, [canonicalUnitId]);
  return buildCanonicalUnitProjection(result.rows, refResult.rows || []);
}

module.exports = { UNIT_IDENTITY_FIELDS, UNIT_STATE_FIELDS, buildCanonicalUnitProjection, collectCanonicalUnitProjectionById };
