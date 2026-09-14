/**
 * @komerce-arch
 * @role          sourcing-integrity-health-service
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        persisted sourcing lineage, canonical identities, supplier SKU readiness
 * @outputs       operational_integrity_report, sourcing_health_dashboard_payload, final_authority_snapshot
 * @depends       db.js, services/sourcing-golden-e2e-service.js, services/sourcing-canonical-unit-product-sku-resolution.js
 * @used-by       scripts/sourcing-integrity-audit.js, routes/admin-sourcing-workspace.js
 * @db-read       sourcing_sources, sourcing_captures, sourcing_observations, sourcing_resolution_decisions, sourcing_resolution_bindings, sourcing_canonical_entities, sourcing_canonical_entity_refs, product_skus
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCING_FINAL_AUTHORITY.md
 * @impact-areas  sourcing, catalog, purchasing, admin-dashboard
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const golden = require('./sourcing-golden-e2e-service');
const unitResolver = require('./sourcing-canonical-unit-product-sku-resolution');

const REPORT_VERSION = 'sourcing-operational-integrity-v1';
const HEALTH_SCHEMA_VERSION = 'sourcing-health-dashboard-v1';

const RETIREMENT_MATRIX = Object.freeze({
  KEEP: Object.freeze([
    { component: 'Source/Capture/Observation/Evidence', reason: 'frontière ingestion et provenance immuable' },
    { component: 'ResolutionDecision/ResolutionBinding/CanonicalEntity', reason: 'autorité identité multi-source' },
    { component: 'Canonical Product/Offer/Unit projections', reason: 'grains canoniques séparés identité/commercial/variante' },
    { component: 'sourcing_candidates + promotion inactive', reason: 'workflow de décision avant entrée catalogue' },
    { component: 'Canonical Unit + Supplier Order Identity purchasing gate', reason: 'identité d achat déterministe et fail-closed' },
    { component: 'Golden E2E + operational integrity audit', reason: 'preuve et surveillance permanentes des invariants' },
  ]),
  DEPRECATE: Object.freeze([
    { component: 'Catalog Product route canary', reason: 'outil de preuve temporaire après autorité progressive validée' },
    { component: 'Catalog Product read cutover trial', reason: 'preuve de seam remplacée par le service d autorité de lecture' },
    { component: 'Parallel Product read comparison', reason: 'outil de migration, pas une autorité runtime finale' },
  ]),
  REMOVE_LATER: Object.freeze([
    { component: 'scripts shadow/projection/read-comparison/cutover de migration', reason: 'conserver tant que la fenêtre d observation et de rollback n est pas close' },
    { component: 'comparateurs Offer/Unit de migration', reason: 'retirer seulement après preuve runtime durable de parité' },
  ]),
  REMOVE_NOW: Object.freeze([]),
});

const rowsOf = result => Array.isArray(result?.rows) ? result.rows : [];
const unique = values => [...new Set(values.filter(value => value != null).map(String))].sort();

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

  const activeBindingConflicts = observations.filter(row => Number(row.active_binding_count || 0) > 1);
  if (activeBindingConflicts.length) hard(buckets.integrityHard, 'multiple_active_bindings_for_observation');

  const namespaceRefCollisions = refCollisions.filter(row => Number(row.canonical_count || 0) > 1);
  if (namespaceRefCollisions.length) hard(buckets.integrityHard, 'namespaced_ref_points_to_multiple_canonical_entities');

  const unbound = observations.filter(row => Number(row.active_binding_count || 0) === 0);
  if (unbound.length) warn(buckets.resolutionWarn, 'unbound_observations_present');
  if (latestReviewRequired > 0) warn(buckets.resolutionWarn, 'review_required_present');

  const replayGroups = new Map();
  for (const row of observations.filter(item => item.source_ref)) {
    const key = [row.source_id, row.grain, row.source_ref].join('|');
    if (!replayGroups.has(key)) replayGroups.set(key, []);
    replayGroups.get(key).push(row);
  }
  const repeated = [...replayGroups.values()].filter(group => unique(group.map(row => row.capture_id)).length > 1);
  const replaySplits = repeated.filter(group => unique(group.map(row => row.canonical_entity_id)).length > 1);
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
  const disabledSources = sources.filter(row => row.status === 'disabled');
  if (failedCaptures) warn(buckets.integrityWarn, 'failed_captures_present');
  if (partialCaptures) warn(buckets.integrityWarn, 'partial_captures_present');
  if (runningCaptures) warn(buckets.integrityWarn, 'captures_in_progress');
  if (disabledSources.length) warn(buckets.integrityWarn, 'disabled_sources_present');

  const supersededWithActiveBindings = entities.filter(row => row.status === 'superseded' && Number(row.active_bindings || 0) > 0);
  const activeChildOfNonActiveParent = entities.filter(row => row.status === 'active' && row.grain !== 'product' && row.parent_status && row.parent_status !== 'active');
  if (supersededWithActiveBindings.length) warn(buckets.resolutionWarn, 'superseded_entities_keep_active_bindings');
  if (activeChildOfNonActiveParent.length) warn(buckets.resolutionWarn, 'active_child_has_non_active_parent');

  const malformedResolved = skuResolutions.filter(row => {
    if (row.status !== unitResolver.STATUS.RESOLVED) return false;
    const soi = row.supplier_order_identity;
    return !row.supplier_unit_ref || !soi || !String(soi.provider || '').trim() || soi.version == null || soi.payload == null;
  });
  if (malformedResolved.length) hard(buckets.unitHard, 'resolved_unit_missing_exact_identity');

  const providerNamespaceMismatch = skuResolutions.filter(row => {
    if (row.status !== unitResolver.STATUS.RESOLVED) return false;
    const provider = String(row.supplier_order_identity?.provider || '').trim().toLowerCase();
    const provenanceProviders = unique((row.canonical_unit?.provenance || [])
      .map(item => String(item.adapter_type || '').trim().toLowerCase())
      .filter(Boolean));
    return provider && provenanceProviders.length && !provenanceProviders.includes(provider);
  });
  if (providerNamespaceMismatch.length) hard(buckets.unitHard, 'resolved_soi_provider_namespace_mismatch');

  const ambiguous = skuResolutions.filter(row =>
    row.status === unitResolver.STATUS.AMBIGUOUS_UNIT || row.status === unitResolver.STATUS.AMBIGUOUS_PRODUCT
  );
  const blocked = skuResolutions.filter(row => row.status !== unitResolver.STATUS.RESOLVED && row.status !== 'READ_ERROR');
  const readErrors = skuResolutions.filter(row => row.status === 'READ_ERROR');
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
      exact: skuResolutions.filter(row => row.status === unitResolver.STATUS.RESOLVED).length,
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
    query(`SELECT s.source_id, s.adapter_type, s.status,
                  COUNT(c.capture_id) FILTER (WHERE c.status = 'failed')::int AS failed_captures,
                  COUNT(c.capture_id) FILTER (WHERE c.status = 'partial')::int AS partial_captures,
                  COUNT(c.capture_id) FILTER (WHERE c.status = 'running')::int AS running_captures
             FROM sourcing_sources s
             LEFT JOIN sourcing_captures c ON c.source_id = s.source_id
            GROUP BY s.source_id, s.adapter_type, s.status
            ORDER BY s.source_id`),
    query(`SELECT o.observation_id, c.capture_id, c.source_id, c.started_at AS capture_started_at,
                  o.grain::text AS grain, o.source_ref, o.observed_at, rb.canonical_entity_id,
                  COUNT(rb.binding_id) FILTER (WHERE rb.ended_at IS NULL) OVER (PARTITION BY o.observation_id)::int AS active_binding_count
             FROM sourcing_observations o
             JOIN sourcing_captures c ON c.capture_id = o.capture_id
             LEFT JOIN sourcing_resolution_bindings rb ON rb.observation_id = o.observation_id AND rb.ended_at IS NULL
            ORDER BY c.source_id, o.grain, o.source_ref, c.started_at, o.observed_at, o.observation_id`),
    query(`SELECT source_id, ref_kind, ref_value, COUNT(DISTINCT canonical_entity_id)::int AS canonical_count
             FROM sourcing_canonical_entity_refs
            GROUP BY source_id, ref_kind, ref_value
           HAVING COUNT(DISTINCT canonical_entity_id) > 1
            ORDER BY source_id, ref_kind, ref_value`),
    query(`SELECT ce.canonical_entity_id, ce.grain::text AS grain, ce.status, ce.superseded_by,
                  ce.parent_entity_id, parent.status AS parent_status,
                  COUNT(rb.binding_id) FILTER (WHERE rb.ended_at IS NULL)::int AS active_bindings
             FROM sourcing_canonical_entities ce
             LEFT JOIN sourcing_canonical_entities parent ON parent.canonical_entity_id = ce.parent_entity_id
             LEFT JOIN sourcing_resolution_bindings rb ON rb.canonical_entity_id = ce.canonical_entity_id
            GROUP BY ce.canonical_entity_id, ce.grain, ce.status, ce.superseded_by, ce.parent_entity_id, parent.status
            ORDER BY ce.grain, ce.canonical_entity_id`),
    query(`WITH latest AS (
             SELECT observation_id, decision_type,
                    ROW_NUMBER() OVER (PARTITION BY observation_id ORDER BY created_at DESC, decision_id DESC) AS rn
               FROM sourcing_resolution_decisions
              WHERE observation_id IS NOT NULL
           ) SELECT COUNT(*)::int AS review_required
               FROM latest WHERE rn = 1 AND decision_type = 'REVIEW_REQUIRED'`),
    query(`SELECT id FROM product_skus
            WHERE source = 'SUPPLIER' AND COALESCE(is_active, TRUE) = TRUE
            ORDER BY id`),
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

function buildFinalAuthoritySnapshot() {
  return {
    status: 'FINAL_TECHNICAL_AUTHORITY',
    source_truth: 'OBSERVATION_WITH_PROVENANCE',
    identity_authority: 'RESOLUTION_BINDING_TO_CANONICAL_ENTITY',
    product_authority: 'CANONICAL_PRODUCT',
    offer_authority: 'CANONICAL_OFFER',
    unit_authority: 'CANONICAL_UNIT',
    purchasing_identity_authority: 'CANONICAL_UNIT_PLUS_SUPPLIER_ORDER_IDENTITY',
    catalog_product_read: 'PROGRESSIVE_CANONICAL_PREFERRED_WITH_LEGACY_FALLBACK',
    selection_authority: 'NOT_AUTHORIZED_IN_SOURCING',
    supplier_order_side_effect: 'HARD_STOP',
    hub_routing_authority: 'OUT_OF_SCOPE_NEXT_DOMAIN',
    retirement_matrix: RETIREMENT_MATRIX,
  };
}

const EXCEPTION_LABELS = Object.freeze({
  multiple_active_bindings_for_observation: 'Une observation possède plusieurs bindings actifs.',
  namespaced_ref_points_to_multiple_canonical_entities: 'Une référence namespacée pointe vers plusieurs identités canoniques.',
  replay_split_across_canonical_entities: 'Un replay de la même identité Source est séparé sur plusieurs entités canoniques.',
  resolved_unit_missing_exact_identity: 'Une Unit annoncée résolue ne possède pas une identité fournisseur exacte complète.',
  resolved_soi_provider_namespace_mismatch: 'La Supplier Order Identity contredit le namespace/provider de la Unit canonique.',
  golden_catalog_failed: 'Le Golden E2E signale une rupture du maillon catalogue.',
  failed_captures_present: 'Des captures fournisseur sont en échec.',
  partial_captures_present: 'Des captures fournisseur sont partielles.',
  captures_in_progress: 'Des captures fournisseur sont encore en cours.',
  disabled_sources_present: 'Une ou plusieurs Sources sont désactivées.',
  unbound_observations_present: 'Des Observations ne possèdent pas encore de binding actif.',
  review_required_present: 'Des décisions Resolution attendent une revue.',
  superseded_entities_keep_active_bindings: 'Des entités canoniques superseded conservent des bindings actifs.',
  active_child_has_non_active_parent: 'Une Offer/Unit active dépend d un parent canonique non actif.',
  ambiguous_identity_blocked: 'Des identités Unit/Product ambiguës sont correctement bloquées.',
  supplier_identities_blocked: 'Des SKU fournisseur restent bloqués avant Purchasing.',
  canonical_unit_read_errors: 'Des lectures Canonical Unit ont échoué.',
});

function describeException(code) {
  if (String(code).startsWith('golden:')) return 'Le Golden E2E a détecté une rupture d intégrité.';
  return EXCEPTION_LABELS[code] || code;
}

function buildHealthDashboardFromAudit(audit) {
  const performanceWarnings = Number(audit.integrity.failed_captures || 0)
    + Number(audit.integrity.partial_captures || 0)
    + Number(audit.integrity.running_captures || 0)
    + Number(audit.purchasing_readiness.read_errors || 0);
  const performance = audit.status === 'BROKEN' ? 'BROKEN' : performanceWarnings > 0 ? 'ATTENTION' : 'HEALTHY';
  const exceptions = [
    ...(audit.hard_failures || []).map(code => ({ severity: 'BROKEN', code, label: describeException(code) })),
    ...(audit.exceptions || []).map(code => ({ severity: 'ATTENTION', code, label: describeException(code) })),
  ];

  return {
    schema_version: HEALTH_SCHEMA_VERSION,
    generated_at: audit.generated_at,
    scope: { mode: 'global_sourcing' },
    state: {
      global: audit.status,
      integrity: audit.integrity.status,
      performance,
      blockers: Number(audit.hard_failures?.length || 0),
      attention: Number(audit.exceptions?.length || 0),
      trend: { status: 'UNKNOWN', label: 'Historique non persisté — aucune tendance inventée' },
    },
    aggregates: {
      active_binding_conflicts: audit.integrity.active_binding_conflicts,
      namespace_ref_collisions: audit.integrity.namespace_ref_collisions,
      replay_splits: audit.idempotency.replay_splits,
      review_required: audit.resolution.latest_review_required,
      supplier_skus_checked: audit.unit_identity.supplier_skus_checked,
      exact_supplier_identities: audit.unit_identity.exact,
      ambiguous_blocked: audit.unit_identity.ambiguous_blocked,
      purchasing_blocked: audit.purchasing_readiness.blocked,
      failed_captures: audit.integrity.failed_captures,
      partial_captures: audit.integrity.partial_captures,
    },
    sections: [
      { key: 'integrity', label: 'Intégrité', status: audit.integrity.status },
      { key: 'idempotency', label: 'Idempotence', status: audit.idempotency.status },
      { key: 'resolution', label: 'Resolution', status: audit.resolution.status },
      { key: 'catalog', label: 'Catalogue', status: audit.catalog.status },
      { key: 'unit_identity', label: 'Identité Unit', status: audit.unit_identity.status },
      { key: 'purchasing_readiness', label: 'Purchasing', status: audit.purchasing_readiness.status },
    ],
    exceptions,
    drilldowns: [
      { key: 'candidates', label: 'Candidats & décisions', target: 'workspace:candidates' },
      { key: 'imports', label: 'Imports & captures', target: 'workspace:imports' },
      { key: 'suppliers', label: 'Sources/fournisseurs', target: 'workspace:suppliers' },
      { key: 'raw', label: 'Audit brut', target: 'payload:raw' },
    ],
    authority: buildFinalAuthoritySnapshot(),
    raw: audit,
  };
}

async function buildHealthDashboard(options = {}) {
  const auditFn = options.auditFn || collectIntegrityAudit;
  const audit = await auditFn(
    options.query || db.query.bind(db),
    options.resolveFn || unitResolver.resolveCanonicalUnitForProductSku,
    options.goldenFn || golden.collectGoldenE2E
  );
  return buildHealthDashboardFromAudit(audit);
}

module.exports = {
  REPORT_VERSION,
  HEALTH_SCHEMA_VERSION,
  RETIREMENT_MATRIX,
  buildIntegrityAudit,
  collectIntegrityAudit,
  buildFinalAuthoritySnapshot,
  buildHealthDashboardFromAudit,
  buildHealthDashboard,
};
