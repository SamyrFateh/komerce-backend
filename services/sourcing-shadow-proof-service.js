/**
 * @komerce-arch
 * @role          sourcing-shadow-proof
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        shadow_observations, shadow_resolution_state
 * @outputs       multi_source_resolution_proof_report
 * @depends       db.js
 * @used-by       scripts/sourcing-shadow-proof-staging.js
 * @db-read       sourcing_sources, sourcing_captures, sourcing_observations, sourcing_observation_evidence, sourcing_canonical_entities, sourcing_resolution_bindings, sourcing_resolution_decisions
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCE_RESOLUTION.md, docs/doctrine/DOCTRINE_SOURCE_SHADOW_PROOF.md
 * @impact-areas  sourcing, supplier-import
 * @version       2026-09
 */
'use strict';

const db = require('../db');

const PROOF_VERSION = 'multisource-shadow-proof-v1';
const ECONOMIC_IDENTITY_KEY = /(price|stock|freight|shipping|delivery|delay|currency|cost|margin)/i;

function int(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rowsOf(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

function normalizeSourceRows(rows) {
  return rows.map((row) => ({
    source_id: row.source_id,
    adapter_type: row.adapter_type,
    captures: int(row.captures),
    products: int(row.products),
    offers: int(row.offers),
    units: int(row.units),
    bound_observations: int(row.bound_observations),
  }));
}

function buildVerdict({ sources, convergence, deterministicConflicts, prohibitedEvidence, unresolved, decisions }) {
  const observedSources = sources.length;
  const observedAdapters = new Set(sources.map((source) => source.adapter_type).filter(Boolean)).size;
  const crossSourceProducts = int(convergence.cross_source_products);
  const hardFailures = [];
  const warnings = [];

  if (deterministicConflicts.length) hardFailures.push('deterministic_identity_conflict');
  if (prohibitedEvidence.length) hardFailures.push('economic_fact_used_as_identity_evidence');

  if (observedSources < 2) warnings.push('fewer_than_two_sources_observed');
  if (crossSourceProducts < 1) warnings.push('no_cross_source_product_convergence_proven');
  if (int(decisions.review_required) > 0) warnings.push('manual_review_queue_non_empty');
  if (int(unresolved.unbound_products) > 0) warnings.push('unbound_product_observations');

  const invariantSafe = hardFailures.length === 0;
  const multisourceObserved = observedSources >= 2;
  const convergenceProven = crossSourceProducts >= 1;

  return {
    status: hardFailures.length ? 'FAIL' : (warnings.length ? 'WARN' : 'PASS'),
    hard_failures: hardFailures,
    warnings,
    invariant_safe: invariantSafe,
    multisource_observed: multisourceObserved,
    distinct_adapters_observed: observedAdapters,
    cross_source_convergence_proven: convergenceProven,
    ready_for_product_projection_trial: invariantSafe && multisourceObserved && convergenceProven,
  };
}

async function collectShadowProof(query = db.query.bind(db)) {
  const sourceResult = await query(`
    SELECT s.source_id,
           s.adapter_type,
           COUNT(DISTINCT c.capture_id)::int AS captures,
           COUNT(o.observation_id) FILTER (WHERE o.grain::text = 'product')::int AS products,
           COUNT(o.observation_id) FILTER (WHERE o.grain::text = 'offer')::int AS offers,
           COUNT(o.observation_id) FILTER (WHERE o.grain::text = 'unit')::int AS units,
           COUNT(rb.binding_id) FILTER (WHERE rb.ended_at IS NULL)::int AS bound_observations
      FROM sourcing_sources s
      LEFT JOIN sourcing_captures c ON c.source_id = s.source_id
      LEFT JOIN sourcing_observations o ON o.capture_id = c.capture_id
      LEFT JOIN sourcing_resolution_bindings rb
        ON rb.observation_id = o.observation_id AND rb.ended_at IS NULL
     GROUP BY s.source_id, s.adapter_type
     ORDER BY s.source_id
  `);

  const convergenceResult = await query(`
    WITH entity_sources AS (
      SELECT rb.canonical_entity_id,
             COUNT(DISTINCT c.source_id)::int AS source_count,
             COUNT(DISTINCT o.observation_id)::int AS observation_count
        FROM sourcing_resolution_bindings rb
        JOIN sourcing_observations o ON o.observation_id = rb.observation_id
        JOIN sourcing_captures c ON c.capture_id = o.capture_id
        JOIN sourcing_canonical_entities ce ON ce.canonical_entity_id = rb.canonical_entity_id
       WHERE rb.ended_at IS NULL
         AND o.grain::text = 'product'
         AND ce.grain::text = 'product'
         AND ce.status = 'active'
       GROUP BY rb.canonical_entity_id
    )
    SELECT COUNT(*)::int AS canonical_products,
           COUNT(*) FILTER (WHERE source_count >= 2)::int AS cross_source_products,
           COALESCE(MAX(source_count), 0)::int AS max_sources_per_product,
           COUNT(*) FILTER (WHERE observation_count >= 2)::int AS repeatedly_observed_products
      FROM entity_sources
  `);

  const deterministicConflictResult = await query(`
    SELECT rb.canonical_entity_id,
           e.evidence_key,
           ARRAY_AGG(DISTINCT e.value ORDER BY e.value) AS values
      FROM sourcing_resolution_bindings rb
      JOIN sourcing_observations o ON o.observation_id = rb.observation_id
      JOIN sourcing_observation_evidence e ON e.observation_id = rb.observation_id
     WHERE rb.ended_at IS NULL
       AND o.grain::text = 'product'
       AND e.evidence_type = 'deterministic_id'
     GROUP BY rb.canonical_entity_id, e.evidence_key
    HAVING COUNT(DISTINCT e.value) > 1
     ORDER BY rb.canonical_entity_id, e.evidence_key
     LIMIT 100
  `);

  const evidenceKeyResult = await query(`
    SELECT DISTINCT evidence_type, evidence_key
      FROM sourcing_observation_evidence
     ORDER BY evidence_type, evidence_key
  `);

  const unresolvedResult = await query(`
    SELECT COUNT(*) FILTER (WHERE o.grain::text = 'product' AND rb.binding_id IS NULL)::int AS unbound_products,
           COUNT(*) FILTER (WHERE o.grain::text = 'offer' AND rb.binding_id IS NULL)::int AS unbound_offers,
           COUNT(*) FILTER (WHERE o.grain::text = 'unit' AND rb.binding_id IS NULL)::int AS unbound_units
      FROM sourcing_observations o
      LEFT JOIN sourcing_resolution_bindings rb
        ON rb.observation_id = o.observation_id AND rb.ended_at IS NULL
  `);

  const decisionResult = await query(`
    SELECT COUNT(*) FILTER (WHERE decision_type = 'LINK')::int AS links,
           COUNT(*) FILTER (WHERE decision_type = 'REVIEW_REQUIRED')::int AS review_required,
           COUNT(*) FILTER (WHERE decision_type = 'DISTINCT')::int AS distinct_decisions,
           COUNT(*) FILTER (WHERE decision_type = 'MERGE')::int AS merges,
           COUNT(*) FILTER (WHERE decision_type = 'SPLIT')::int AS splits
      FROM sourcing_resolution_decisions
     WHERE actor_type = 'rule'
       AND actor_ref = 'shadow-resolution-v1'
  `);

  const sources = normalizeSourceRows(rowsOf(sourceResult));
  const convergence = rowsOf(convergenceResult)[0] || {};
  const deterministicConflicts = rowsOf(deterministicConflictResult);
  const prohibitedEvidence = rowsOf(evidenceKeyResult).filter((row) => ECONOMIC_IDENTITY_KEY.test(String(row.evidence_key || '')));
  const unresolved = rowsOf(unresolvedResult)[0] || {};
  const decisions = rowsOf(decisionResult)[0] || {};

  const observations = sources.reduce((acc, source) => {
    acc.products += source.products;
    acc.offers += source.offers;
    acc.units += source.units;
    acc.bound += source.bound_observations;
    acc.captures += source.captures;
    return acc;
  }, { products: 0, offers: 0, units: 0, bound: 0, captures: 0 });

  const verdict = buildVerdict({
    sources,
    convergence,
    deterministicConflicts,
    prohibitedEvidence,
    unresolved,
    decisions,
  });

  return {
    proof_version: PROOF_VERSION,
    generated_at: new Date().toISOString(),
    authority: 'shadow_only',
    sources,
    observations,
    decisions: {
      links: int(decisions.links),
      review_required: int(decisions.review_required),
      distinct: int(decisions.distinct_decisions),
      merges: int(decisions.merges),
      splits: int(decisions.splits),
    },
    convergence: {
      canonical_products: int(convergence.canonical_products),
      cross_source_products: int(convergence.cross_source_products),
      max_sources_per_product: int(convergence.max_sources_per_product),
      repeatedly_observed_products: int(convergence.repeatedly_observed_products),
    },
    unresolved: {
      products: int(unresolved.unbound_products),
      offers: int(unresolved.unbound_offers),
      units: int(unresolved.unbound_units),
    },
    safety: {
      deterministic_identity_conflicts: deterministicConflicts,
      prohibited_identity_evidence_keys: prohibitedEvidence,
    },
    verdict,
  };
}

module.exports = {
  PROOF_VERSION,
  collectShadowProof,
  buildVerdict,
  _economicIdentityKey: ECONOMIC_IDENTITY_KEY,
};
