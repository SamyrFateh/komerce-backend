/**
 * @komerce-arch
 * @role          sourcing-canonical-product-projection-trial
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        active_product_resolution_bindings, immutable_product_observations, identity_evidence
 * @outputs       shadow_canonical_product_projection
 * @depends       db.js
 * @used-by       scripts/sourcing-product-projection-trial-staging.js, services/catalog-product-source-read-service.js
 * @db-read       sourcing_canonical_entities, sourcing_resolution_bindings, sourcing_observations, sourcing_captures, sourcing_sources, sourcing_observation_evidence
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCE_RESOLUTION.md, docs/doctrine/DOCTRINE_SOURCE_PRODUCT_PROJECTION_TRIAL.md
 * @impact-areas  sourcing, catalog
 * @version       2026-09
 */
'use strict';

const db = require('../db');

const PROJECTION_VERSION = 'canonical-product-projection-trial-v1';

// Le Product canonique ne porte aucun fait économique. Les prix, stocks,
// devises, délais, MOQ et unités commandables restent au grain Offer/Unit et
// seront arbitrés plus tard par Selection.
const PRODUCT_FIELDS = Object.freeze([
  'product_name',
  'supplier_category',
  'brand',
  'description',
  'source_locale',
  'weight_kg',
  'dimensions',
  'media',
  'option_axes',
  'highlights',
  'specifications',
  'sections',
  'materials',
  'care',
  'warnings',
]);

const FORBIDDEN_ECONOMIC_FIELDS = Object.freeze([
  'purchase_price',
  'currency',
  'stock_available',
  'min_order_qty',
  'supplier_delay_days',
  'sellable_units',
  'supplier_order_identity',
]);

function stableValue(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPresent(value) {
  return value !== null && value !== undefined && value !== '';
}

function projectField(rows, fieldKey) {
  const groups = new Map();
  for (const row of rows || []) {
    const value = row?.normalized?.[fieldKey];
    if (!isPresent(value)) continue;
    const key = stableValue(value);
    if (!groups.has(key)) {
      groups.set(key, {
        value: clone(value),
        observations: 0,
        source_ids: new Set(),
        latest_observed_at: null,
      });
    }
    const group = groups.get(key);
    group.observations += 1;
    if (row.source_id) group.source_ids.add(row.source_id);
    if (!group.latest_observed_at || String(row.observed_at) > String(group.latest_observed_at)) {
      group.latest_observed_at = row.observed_at;
    }
  }

  const candidates = [...groups.values()].map((group) => ({
    value: group.value,
    observation_count: group.observations,
    source_count: group.source_ids.size,
    source_ids: [...group.source_ids].sort(),
    latest_observed_at: group.latest_observed_at,
  }));

  if (!candidates.length) {
    return { status: 'ABSENT', value: null, candidates: [] };
  }
  if (candidates.length === 1) {
    return { status: 'CONSENSUS', value: clone(candidates[0].value), candidates };
  }
  return { status: 'CONFLICT_PRESERVED', value: null, candidates };
}

function normalizeEvidence(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = `${row.evidence_type}:${row.evidence_key}`;
    if (!grouped.has(key)) grouped.set(key, new Set());
    grouped.get(key).add(String(row.value));
  }
  return [...grouped.entries()]
    .map(([key, values]) => {
      const [evidence_type, ...rest] = key.split(':');
      return { evidence_type, evidence_key: rest.join(':'), values: [...values].sort() };
    })
    .sort((a, b) => `${a.evidence_type}:${a.evidence_key}`.localeCompare(`${b.evidence_type}:${b.evidence_key}`));
}

function buildCanonicalProductProjection(rows, evidenceRows = []) {
  if (!rows?.length) return null;
  const canonicalProductId = rows[0].canonical_entity_id;
  const sources = [...new Set(rows.map((row) => row.source_id).filter(Boolean))].sort();
  const fields = {};
  const resolved = {};
  const conflicts = [];

  for (const field of PRODUCT_FIELDS) {
    const projection = projectField(rows, field);
    fields[field] = projection;
    if (projection.status === 'CONSENSUS') resolved[field] = clone(projection.value);
    if (projection.status === 'CONFLICT_PRESERVED') conflicts.push(field);
  }

  return {
    canonical_product_id: canonicalProductId,
    authority: 'shadow_read_only',
    policy_mode: 'consensus_only_v1',
    source_count: sources.length,
    source_ids: sources,
    observation_count: rows.length,
    latest_observed_at: rows.map((row) => row.observed_at).filter(Boolean).sort().at(-1) || null,
    projection_status: conflicts.length ? 'PARTIAL_CONFLICT_PRESERVED' : 'CONSENSUS',
    resolved,
    conflicts,
    fields,
    identity_evidence: normalizeEvidence(evidenceRows),
  };
}

async function collectCanonicalProductProjectionById(canonicalProductId, query = db.query.bind(db)) {
  const observationResult = await query(`
    SELECT ce.canonical_entity_id, o.observation_id, c.source_id, s.adapter_type,
           o.observed_at, o.normalized
      FROM sourcing_canonical_entities ce
      JOIN sourcing_resolution_bindings rb ON rb.canonical_entity_id = ce.canonical_entity_id AND rb.ended_at IS NULL
      JOIN sourcing_observations o ON o.observation_id = rb.observation_id
      JOIN sourcing_captures c ON c.capture_id = o.capture_id
      JOIN sourcing_sources s ON s.source_id = c.source_id
     WHERE ce.canonical_entity_id = $1
       AND ce.grain::text = 'product' AND ce.status = 'active' AND o.grain::text = 'product'
     ORDER BY o.observed_at, o.observation_id
  `, [canonicalProductId]);
  if (!(observationResult.rows || []).length) return null;
  const evidenceResult = await query(`
    SELECT e.evidence_type, e.evidence_key, e.value
      FROM sourcing_resolution_bindings rb
      JOIN sourcing_observations o ON o.observation_id = rb.observation_id
      JOIN sourcing_observation_evidence e ON e.observation_id = o.observation_id
     WHERE rb.canonical_entity_id = $1 AND rb.ended_at IS NULL
     ORDER BY e.evidence_type, e.evidence_key, e.value
  `, [canonicalProductId]);
  return buildCanonicalProductProjection(observationResult.rows, evidenceResult.rows || []);
}

async function collectCanonicalProductProjections(query = db.query.bind(db)) {
  const observationResult = await query(`
    SELECT ce.canonical_entity_id,
           o.observation_id,
           c.source_id,
           s.adapter_type,
           o.observed_at,
           o.normalized
      FROM sourcing_canonical_entities ce
      JOIN sourcing_resolution_bindings rb
        ON rb.canonical_entity_id = ce.canonical_entity_id
       AND rb.ended_at IS NULL
      JOIN sourcing_observations o
        ON o.observation_id = rb.observation_id
      JOIN sourcing_captures c
        ON c.capture_id = o.capture_id
      JOIN sourcing_sources s
        ON s.source_id = c.source_id
     WHERE ce.grain::text = 'product'
       AND ce.status = 'active'
       AND o.grain::text = 'product'
     ORDER BY ce.canonical_entity_id, o.observed_at, o.observation_id
  `);

  const evidenceResult = await query(`
    SELECT rb.canonical_entity_id,
           e.evidence_type,
           e.evidence_key,
           e.value
      FROM sourcing_resolution_bindings rb
      JOIN sourcing_observations o
        ON o.observation_id = rb.observation_id
      JOIN sourcing_canonical_entities ce
        ON ce.canonical_entity_id = rb.canonical_entity_id
      JOIN sourcing_observation_evidence e
        ON e.observation_id = o.observation_id
     WHERE rb.ended_at IS NULL
       AND ce.grain::text = 'product'
       AND ce.status = 'active'
       AND o.grain::text = 'product'
     ORDER BY rb.canonical_entity_id, e.evidence_type, e.evidence_key, e.value
  `);

  const byEntity = new Map();
  for (const row of observationResult.rows || []) {
    if (!byEntity.has(row.canonical_entity_id)) byEntity.set(row.canonical_entity_id, []);
    byEntity.get(row.canonical_entity_id).push(row);
  }
  const evidenceByEntity = new Map();
  for (const row of evidenceResult.rows || []) {
    if (!evidenceByEntity.has(row.canonical_entity_id)) evidenceByEntity.set(row.canonical_entity_id, []);
    evidenceByEntity.get(row.canonical_entity_id).push(row);
  }

  const products = [...byEntity.entries()].map(([entityId, rows]) =>
    buildCanonicalProductProjection(rows, evidenceByEntity.get(entityId) || [])
  );

  return {
    projection_version: PROJECTION_VERSION,
    generated_at: new Date().toISOString(),
    authority: 'shadow_read_only',
    policy_mode: 'consensus_only_v1',
    product_fields: [...PRODUCT_FIELDS],
    forbidden_economic_fields: [...FORBIDDEN_ECONOMIC_FIELDS],
    products,
  };
}

module.exports = {
  PROJECTION_VERSION,
  PRODUCT_FIELDS,
  FORBIDDEN_ECONOMIC_FIELDS,
  collectCanonicalProductProjections,
  collectCanonicalProductProjectionById,
  buildCanonicalProductProjection,
  projectField,
  _stableValue: stableValue,
};
