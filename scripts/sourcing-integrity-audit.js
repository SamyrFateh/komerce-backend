#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          sourcing-operational-integrity-audit
 * @domain        sourcing
 * @layer         script
 * @criticality   high
 * @inputs        persisted sourcing lineage, canonical identities, supplier SKU readiness
 * @outputs       HEALTHY_ATTENTION_BROKEN_integrity_report
 * @depends       db.js, services/sourcing-golden-e2e-service.js, services/sourcing-canonical-unit-product-sku-resolution.js
 * @db-read       sourcing_sources, sourcing_captures, sourcing_observations, sourcing_resolution_decisions, sourcing_resolution_bindings, sourcing_canonical_entities, sourcing_canonical_entity_refs, product_skus
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCING_OPERATIONAL_INTEGRITY.md
 * @impact-areas  sourcing, catalog, purchasing, supplier-integration, staging
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const golden = require('../services/sourcing-golden-e2e-service');
const unitResolver = require('../services/sourcing-canonical-unit-product-sku-resolution');

const REPORT_VERSION = 'sourcing-operational-integrity-v1';
const rowsOf = (result) => Array.isArray(result?.rows) ? result.rows : [];
const unique = (values) => [...new Set(values.filter((value) => value != null).map(String))].sort();

function section(hardFailures, warnings, metrics = {}) {
  return {
    status: hardFailures.length ? 'BROKEN' : warnings.length ? 'ATTENTION' : 'HEALTHY',
    ...metrics,
    hard_failures: hardFailures,
    warnings,
  };
}

function buildIntegrityAudit(snapshot = {}) {
  const goldenReport = snapshot.golden_report || { status: 'PASS', hard_failures: [], catalog: { status: 'PASS' } };
  const sources = snapshot.source_states || [];
  const observations = snapshot.observations || [];
  const refCollisions = snapshot.ref_collisions || [];
  const entities = snapshot.entities || [];
  const latestReviewRequired = Number(snapshot.latest_review_required || 0);
  const skuResolutions = snapshot.sku_resolutions || [];

  const hardFailures = [];
  const warnings = [];
  const buckets = {
    integrityHard: [], integrityWarn: [], idempotencyHard: [], idempotencyWarn: [],
    resolutionHard: [], resolutionWarn: [], catalogHard: [], catalogWarn: [],
    unitHard: [], unitWarn: [], purchasingHard: [], purchasingWarn: [],
  };
  const hard = (bucket, code) => {
    if (!bucket.includes(code)) bucket.push(code);
    if (!hardFailures.includes(code)) hardFailures.push(code);
  };
  const warn = (bucket, code) => {
    if (!bucket.includes(code)) bucket.push(code);
    if (!warnings.includes(code)) warnings.push(code);
  };

  for (const code of goldenReport.hard_failures || []) hard(buckets.integrityHard, `golden:${code}`);
  if (goldenReport.catalog?.status === 'FAIL') hard(buckets.catalogHard, 'golden_catalog_failed');

  const activeBindingConflicts = observations.filter((row) => Number(row.active_binding_count || 0) > 1);
  if (activeBindingConflicts.length) hard(buckets.integrityHard, 'multiple_active_bindings_for_observation');

  const namespaceRefCollisions = refCollisions.filter((row) => Number(row.canonical_count || 0) > 1);
  if (namespaceRefCollisions.length) hard(buckets.integrityHard, 'namespaced_ref_points_to_multiple_canonical_entities');

  const unbound = observations.filter((row) => Number(row.active_binding_count || 0) === 0);
  if (unbound.length) warn(buckets.resolutionWarn, 'unbound_observations_present');
  if (latestReviewRequired > 0) warn(buckets.resolutionWarn, 'review_required_present');

  const replayGroups = new Map();
  for (const row of observations.filter((item) => item.source_ref)) {
    const key = [row.source_id, row.grain, row.source_ref].join('|');
    if (!replayGroups.has(key)) replayGroups.set(key, []);
    replayGroups.get(key).push(row);
  }
  const repeated = [...replayGroups.values()].filter((group) => unique(group.map((row) => row.capture_id)).length > 1);
  const replaySplits = repeated.filter((group) => unique(group.map((row) => row.canonical_entity_id)).length > 1);
  if (replaySplits.length) hard(buckets.idempotencyHard, 'replay_split_across_canonical_entities');

  let outOfOrderObservations = 0;
  for (const group of repeated) {
    const ordered = [...group].sort((a, b) => String(a.capture_started_at || '').localeCompare(String(b.capture_started_at || '')));
    for (let i = 1; i < ordered.length; i++) {
      if (String(ordered[i].observed_at || '') < String(ordered[i - 1].observed_at || '')) outOfOrderObservations++;
    }
  }

  const failedCaptures = sources.reduce((sum, row) => sum + Number(row.failed_captures || 0), 0);
  const partialCaptures = sources.reduce((sum, row) => sum + Number(row.partial_captures || 0), 0);
  const runningCaptures = sources.reduce((sum, row) => sum + Number(row.running_captures || 0), 0);
  const disabledSources = sources.filter((row) => row.status === 'disabled');
  if (failedCaptures) warn(buckets.integrityWarn, 'failed_captures_present');
  if (partialCaptures) warn(buckets.integrityWarn, 'partial_captures_present');
  if (runningCaptures) warn(buckets.integrityWarn, 'captures_in_progress');
  if (disabledSources.length) warn(buckets.integrityWarn, 'disabled_sources_present');

  const supersededWithActiveBindings = entities.filter((row) => row.status === 'superseded' && Number(row.active_bindings || 0) > 0);
  const activeChildOfNonActiveParent = entities.filter((row) => row.status === 'active' && row.grain !== 'product' && row.parent_status && row.parent_status !== 'active');
  if (supersededWithActiveBindings.length) warn(buckets.resolutionWarn, 'superseded_entities_keep_active_bindings');
  if (activeChildOfNonActiveParent.length) warn(buckets.resolutionWarn, 'active_child_has_non_active_parent');

  const malformedResolved = skuResolutions.filter((row) => {
    if (row.status !== unitResolver.STATUS.RESOLVED) return false;
    const soi = row.supplier_order_identity;
    return !row.supplier_unit_ref || !soi || !String(soi.provider || '').trim() || soi.version == null || soi.payload == null;
  });
  if (malformedResolved.length) hard(buckets.unitHard, 'resolved_unit_missing_exact_identity');

  const providerNamespaceMismatch = skuResolutions.filter((row) => {
    if (row.status !== unitResolver.STATUS.RESOLVED) return false;
    const provider = String(row.supplier_order_identity?.provider || '').trim().toLowerCase();
    const provenanceProviders = unique((row.canonical_unit?.provenance || []).map((item) => String(item.adapter_type || '').trim().toLowerCase()).filter(Boolean));
    return provider && provenanceProviders.length && !provenanceProviders.includes(provider);
  });
  if (providerNamespaceMismatch.length) hard(buckets.unitHard, 'resolved_soi_provider_namespace_mismatch');

  const ambiguous = skuResolutions.filter((row) =>
    row.status === unitResolver.STATUS.AMBIGUOUS_UNIT || row.status === unitResolver.STATUS.AMBIGUOUS_PRODUCT
  );
  const blocked = skuResolutions.filter((row) => row.status !== unitResolver.STATUS.RESOLVED && row.status !== 'READ_ERROR');
  const readErrors = skuResolutions.filter((row) => row.status === 'READ_ERROR');
  if (ambiguous.length) warn(buckets.unitWarn, 'ambiguous_identity_blocked');
  if (blocked.length) warn(buckets.purchasingWarn, 'supplier_identities_blocked');
  if (readErrors.length) warn(buckets.purchasingWarn, 'canonical_unit_read_errors');

  const status = hardFailures.length ? 'BROKEN' : warnings.length ? 'ATTENTION' : 'HEALTHY';
  return {
    report_version: REPORT_VERSION,
    generated_at: new Date().toISOString(),
    status,
    authority: 'read_only_audit',
    integrity: section(buckets.integrityHard, buckets.integrityWarn, {
      active_binding_conflicts: activeBindingConflicts.length,
      namespace_ref_collisions: namespaceRefCollisions.length,
      disabled_sources: disabledSources.length,
      failed_captures: failedCaptures,
      partial_captures: partialCaptures,
      running_captures: runningCaptures,
      place_order_invoked: false,
    }),
    idempotency: section(buckets.idempotencyHard, buckets.idempotencyWarn, {
      repeated_source_identities: repeated.length,
      replay_splits: replaySplits.length,
      out_of_order_observations: outOfOrderObservations,
      out_of_order_preserved_without_identity_rewrite: replaySplits.length === 0,
    }),
    resolution: section(buckets.resolutionHard, buckets.resolutionWarn, {
      unbound_observations: unbound.length,
      latest_review_required: latestReviewRequired,
      superseded_with_active_bindings: supersededWithActiveBindings.length,
      active_child_non_active_parent: activeChildOfNonActiveParent.length,
    }),
    catalog: section(buckets.catalogHard, buckets.catalogWarn, {
      golden_status: goldenReport.catalog?.status || 'UNKNOWN',
    }),
    unit_identity: section(buckets.unitHard, buckets.unitWarn, {
      supplier_skus_checked: skuResolutions.length,
      exact: skuResolutions.filter((row) => row.status === unitResolver.STATUS.RESOLVED).length,
      ambiguous_blocked: ambiguous.length,
      malformed_resolved: malformedResolved.length,
      provider_namespace_mismatch: providerNamespaceMismatch.length,
    }),
    purchasing_readiness: section(buckets.purchasingHard, buckets.purchasingWarn, {
      blocked: blocked.length,
      read_errors: readErrors.length,
      place_order_invoked: false,
    }),
    exceptions: warnings,
    hard_failures: hardFailures,
  };
}

async function collectIntegrityAudit(
  query = db.query.bind(db),
  resolveFn = unitResolver.resolveCanonicalUnitForProductSku,
  goldenFn = golden.collectGoldenE2E
) {
  const goldenReport = await goldenFn(query, resolveFn);
  const [sourceStateResult, observationResult, refCollisionResult, entityResult, reviewResult, skuResult] = await Promise.all([
    query(`
      SELECT s.source_id, s.adapter_type, s.status,
             COUNT(c.capture_id) FILTER (WHERE c.status = 'failed')::int AS failed_captures,
             COUNT(c.capture_id) FILTER (WHERE c.status = 'partial')::int AS partial_captures,
             COUNT(c.capture_id) FILTER (WHERE c.status = 'running')::int AS running_captures
        FROM sourcing_sources s
        LEFT JOIN sourcing_captures c ON c.source_id = s.source_id
       GROUP BY s.source_id, s.adapter_type, s.status
       ORDER BY s.source_id
    `),
    query(`
      SELECT o.observation_id, c.capture_id, c.source_id, c.started_at AS capture_started_at,
             o.grain::text AS grain, o.source_ref, o.observed_at,
             rb.canonical_entity_id,
             COUNT(rb.binding_id) FILTER (WHERE rb.ended_at IS NULL) OVER (PARTITION BY o.observation_id)::int AS active_binding_count
        FROM sourcing_observations o
        JOIN sourcing_captures c ON c.capture_id = o.capture_id
        LEFT JOIN sourcing_resolution_bindings rb ON rb.observation_id = o.observation_id AND rb.ended_at IS NULL
       ORDER BY c.source_id, o.grain, o.source_ref, c.started_at, o.observed_at, o.observation_id
    `),
    query(`
      SELECT source_id, ref_kind, ref_value, COUNT(DISTINCT canonical_entity_id)::int AS canonical_count
        FROM sourcing_canonical_entity_refs
       GROUP BY source_id, ref_kind, ref_value
      HAVING COUNT(DISTINCT canonical_entity_id) > 1
       ORDER BY source_id, ref_kind, ref_value
    `),
    query(`
      SELECT ce.canonical_entity_id, ce.grain::text AS grain, ce.status, ce.superseded_by,
             ce.parent_entity_id, parent.status AS parent_status,
             COUNT(rb.binding_id) FILTER (WHERE rb.ended_at IS NULL)::int AS active_bindings
        FROM sourcing_canonical_entities ce
        LEFT JOIN sourcing_canonical_entities parent ON parent.canonical_entity_id = ce.parent_entity_id
        LEFT JOIN sourcing_resolution_bindings rb ON rb.canonical_entity_id = ce.canonical_entity_id
       GROUP BY ce.canonical_entity_id, ce.grain, ce.status, ce.superseded_by, ce.parent_entity_id, parent.status
       ORDER BY ce.grain, ce.canonical_entity_id
    `),
    query(`
      WITH latest AS (
        SELECT observation_id, decision_type,
               ROW_NUMBER() OVER (PARTITION BY observation_id ORDER BY created_at DESC, decision_id DESC) AS rn
          FROM sourcing_resolution_decisions
         WHERE observation_id IS NOT NULL
      )
      SELECT COUNT(*)::int AS review_required
        FROM latest WHERE rn = 1 AND decision_type = 'REVIEW_REQUIRED'
    `),
    query(`
      SELECT id FROM product_skus
       WHERE source = 'SUPPLIER' AND COALESCE(is_active, TRUE) = TRUE
       ORDER BY id
    `),
  ]);

  const skuResolutions = [];
  for (const row of rowsOf(skuResult)) {
    try {
      skuResolutions.push(await resolveFn(row.id, query));
    } catch (error) {
      skuResolutions.push({ status: 'READ_ERROR', product_sku_id: row.id, error_code: error.code || 'CANONICAL_UNIT_READ_ERROR' });
    }
  }

  return buildIntegrityAudit({
    golden_report: goldenReport,
    source_states: rowsOf(sourceStateResult),
    observations: rowsOf(observationResult),
    ref_collisions: rowsOf(refCollisionResult),
    entities: rowsOf(entityResult),
    latest_review_required: Number(rowsOf(reviewResult)[0]?.review_required || 0),
    sku_resolutions: skuResolutions,
  });
}

function printSummary(report) {
  const lines = [
    ['INTEGRITY', report.integrity.status],
    ['IDEMPOTENCY', report.idempotency.status],
    ['RESOLUTION', report.resolution.status],
    ['CATALOG', report.catalog.status],
    ['UNIT IDENTITY', report.unit_identity.status],
    ['PURCHASING', report.purchasing_readiness.status],
  ];
  console.log(`OVERALL          ${report.status}`);
  for (const [label, status] of lines) console.log(label.padEnd(17) + status);
}

function parseArgs(argv = process.argv.slice(2)) {
  return { compact: argv.includes('--compact') };
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await collectIntegrityAudit();
  console.log(JSON.stringify(report, null, options.compact ? 0 : 2));
  printSummary(report);
  if (report.status === 'BROKEN') process.exitCode = 2;
  return report;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('[sourcing-integrity-audit] FAILED: ' + (error.stack || error));
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  REPORT_VERSION,
  buildIntegrityAudit,
  collectIntegrityAudit,
  parseArgs,
  printSummary,
  run,
};
