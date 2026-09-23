/**
 * @komerce-arch
 * @role          sourcing-catalog-change-unit-resolution-proof
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        immutable_stock_delta_observation_id
 * @outputs       exact_source_scoped_canonical_unit_identity_proof_or_blocker
 * @depends       db.js
 * @used-by       tests/unit/sourcing-catalog-change-unit-resolution-proof.test.js, tests/integration/catalog-change-unit-resolution-proof-real-db.test.js
 * @db-read       sourcing_observations, sourcing_captures, sourcing_sources, sourcing_resolution_bindings, sourcing_canonical_entities, sourcing_canonical_entity_refs
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOG_CHANGE_INTAKE.md
 * @impact-areas  sourcing, catalog
 * @version       2026-09
 */
'use strict';

const db = require('../db');

const STATUS = Object.freeze({
  EXACT_CANONICAL_UNIT: 'EXACT_CANONICAL_UNIT',
  INVALID_OBSERVATION_ID: 'INVALID_OBSERVATION_ID',
  NO_OBSERVATION: 'NO_OBSERVATION',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  NOT_EXACT_STOCK_DELTA: 'NOT_EXACT_STOCK_DELTA',
  NOT_OBSERVED: 'NOT_OBSERVED',
  ALREADY_BOUND: 'ALREADY_BOUND',
  SOURCE_PRODUCT_IDENTITY_UNPROVEN: 'SOURCE_PRODUCT_IDENTITY_UNPROVEN',
  NO_EXACT_UNIT: 'NO_EXACT_UNIT',
  AMBIGUOUS_UNIT: 'AMBIGUOUS_UNIT',
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const blocked = (status, observationId) => ({
  status, observation_id: observationId, application_status: 'NOT_EVALUATED',
  applicable: false, freshness_evaluated: false, sku_resolution_evaluated: false,
});

// This function only reads. A unique external reference is NOT sufficient by
// itself: the product AND unit must still have active source-scoped resolution
// bindings from prior full observations and the canonical hierarchy must agree.
async function proveExactCanonicalUnitForStockDelta(observationId, query = db.query.bind(db)) {
  if (typeof observationId !== 'string' || !UUID.test(observationId)) {
    return blocked(STATUS.INVALID_OBSERVATION_ID, null);
  }
  const { rows } = await query(`
    SELECT o.observation_id, o.grain::text AS grain, o.source_ref,
           o.parent_observation_id, o.normalized, o.field_provenance,
           o.raw_fragment, c.source_id, c.stats, s.status AS source_status,
           rb.canonical_entity_id AS existing_binding
      FROM sourcing_observations o
      JOIN sourcing_captures c ON c.capture_id = o.capture_id
      JOIN sourcing_sources s ON s.source_id = c.source_id
      LEFT JOIN sourcing_resolution_bindings rb
        ON rb.observation_id = o.observation_id AND rb.ended_at IS NULL
     WHERE o.observation_id = $1::uuid
     LIMIT 2
  `, [observationId]);
  if (!rows?.length) return blocked(STATUS.NO_OBSERVATION, observationId);
  if (rows.length !== 1) return blocked(STATUS.AMBIGUOUS_UNIT, observationId);
  const row = rows[0];
  if (row.source_status !== 'active') return blocked(STATUS.SOURCE_UNAVAILABLE, observationId);
  if (row.existing_binding) return blocked(STATUS.ALREADY_BOUND, observationId);
  const fact = row.field_provenance?.stock_available;
  const rawFact = row.raw_fragment?.fact;
  const stock = row.normalized?.stock_available;
  const productRef = row.normalized?.product_ref;
  const unitRef = row.normalized?.unit_ref;
  if (row.grain !== 'unit' || row.parent_observation_id !== null ||
      row.stats?.change_kind !== 'UNIT_STOCK_DELTA' ||
      row.stats?.application_status !== 'NOT_EVALUATED' ||
      row.normalized?.observation_kind !== 'CATALOG_CHANGE_DELTA' ||
      typeof productRef !== 'string' || !productRef ||
      typeof unitRef !== 'string' || !unitRef ||
      row.source_ref !== unitRef || row.raw_fragment?.unit_ref !== unitRef ||
      row.raw_fragment?.product_ref !== productRef ||
      row.raw_fragment?.source_ref !== productRef ||
      !row.stats?.event_id || row.stats.event_id !== fact?.event_id ||
      fact?.status !== 'OBSERVED' || rawFact?.status !== 'OBSERVED' ||
      rawFact?.value !== stock || !Number.isSafeInteger(stock) || stock < 0 ||
      !row.source_id || fact.provider !== row.source_id.split(':')[1]) {
    return blocked(STATUS.NOT_EXACT_STOCK_DELTA, observationId);
  }

  const { rows: matches } = await query(`
    SELECT DISTINCT unit.canonical_entity_id AS canonical_unit_id,
                    product.canonical_entity_id AS canonical_product_id
      FROM sourcing_canonical_entity_refs product_ref
      JOIN sourcing_canonical_entities product
        ON product.canonical_entity_id = product_ref.canonical_entity_id
       AND product.grain::text = 'product' AND product.status = 'active'
      JOIN sourcing_canonical_entities offer
        ON offer.parent_entity_id = product.canonical_entity_id
       AND offer.grain::text = 'offer' AND offer.status = 'active'
      JOIN sourcing_canonical_entities unit
        ON unit.parent_entity_id = offer.canonical_entity_id
       AND unit.grain::text = 'unit' AND unit.status = 'active'
      JOIN sourcing_canonical_entity_refs unit_ref
        ON unit_ref.canonical_entity_id = unit.canonical_entity_id
       AND unit_ref.source_id = product_ref.source_id
       AND unit_ref.ref_kind = 'unit.source_ref'
       AND unit_ref.ref_value = $3
     WHERE product_ref.source_id = $1
       AND product_ref.ref_kind = 'product.source_ref'
       AND product_ref.ref_value = $2
       AND EXISTS (
         SELECT 1 FROM sourcing_resolution_bindings rb
         JOIN sourcing_observations prior ON prior.observation_id = rb.observation_id
         JOIN sourcing_captures pc ON pc.capture_id = prior.capture_id
         WHERE rb.canonical_entity_id = product.canonical_entity_id
           AND rb.ended_at IS NULL AND pc.source_id = $1
           AND prior.grain::text = 'product' AND prior.source_ref = $2
           AND prior.normalized->>'observation_kind' IS DISTINCT FROM 'CATALOG_CHANGE_DELTA'
       )
       AND EXISTS (
         SELECT 1 FROM sourcing_resolution_bindings rb
         JOIN sourcing_observations prior ON prior.observation_id = rb.observation_id
         JOIN sourcing_captures pc ON pc.capture_id = prior.capture_id
         WHERE rb.canonical_entity_id = unit.canonical_entity_id
           AND rb.ended_at IS NULL AND pc.source_id = $1
           AND prior.grain::text = 'unit' AND prior.source_ref = $3
           AND prior.normalized->>'observation_kind' IS DISTINCT FROM 'CATALOG_CHANGE_DELTA'
       )
     LIMIT 2
  `, [row.source_id, productRef, unitRef]);
  if (!matches?.length) return blocked(STATUS.NO_EXACT_UNIT, observationId);
  if (matches.length !== 1) return blocked(STATUS.AMBIGUOUS_UNIT, observationId);
  return {
    status: STATUS.EXACT_CANONICAL_UNIT,
    observation_id: observationId,
    source_id: row.source_id,
    canonical_product_id: matches[0].canonical_product_id,
    canonical_unit_id: matches[0].canonical_unit_id,
    stock_available_observed: stock,
    application_status: 'NOT_EVALUATED',
    applicable: false,
    freshness_evaluated: false,
    sku_resolution_evaluated: false,
    authority: 'read_only_identity_evidence',
  };
}

module.exports = { STATUS, proveExactCanonicalUnitForStockDelta };
