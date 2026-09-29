/**
 * @komerce-arch
 * @role          import-runtime-run-projection
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        import_lifecycle_hooks, sourcing_candidates, provider_runtime_certification_proof
 * @outputs       import_runtime_run_projection, product_trace
 * @depends       db.js, services/sourcing-certification.js, services/catalog-run-progress.js
 * @used-by       services/suppliers/catalog-import-orchestrator.js, services/sourcing-candidate-actions.js, routes/admin-sourcing-workspace.js
 * @db-read       import_runtime_runs, sourcing_candidates, supplier_catalog_imports, sourcing_sources, products
 * @db-write      import_runtime_runs
 * @db-txn        none
 * @doctrine      dashboard_observes_server_truth, fail_closed_certification, no_parallel_accounting, no_browser_internal_ids, sourcing_global_authority
 * @impact-areas  sourcing, catalog, certification, admin-dashboard
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const { readRunProgress } = require('./catalog-run-progress');
const {
  evaluateSourcingCandidateOutcome,
  reconcileSourcingCounts,
} = require('./sourcing-certification');

const STAGE_KEYS = Object.freeze([
  'SOURCE_CONNECTED',
  'RAW_IMPORT',
  'REFINERY',
  'TAXONOMY',
  'CERTIFICATION',
  'CATALOGUE',
]);
const RUN_MODES = Object.freeze(['normal', 'replay', 'reconstruction']);
const DUPLICATE_CODE = 'DUPLICATE_SUPPLIER_PRODUCT_ID_IN_BATCH';

function normalizeMode(mode) {
  const value = String(mode || 'normal').trim().toLowerCase();
  return RUN_MODES.includes(value) ? value : 'normal';
}

function iso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function safe(factory) {
  return Promise.resolve()
    .then(factory)
    .catch((err) => {
      console.warn('[import-runtime-runs] hook ignoré:', err?.message || err);
      return null;
    });
}

async function startRun({
  provider,
  sourceType,
  sourceRef = null,
  mode = 'normal',
  actorId = null,
}, q = db) {
  const stages = {
    SOURCE_CONNECTED: { started_at: new Date().toISOString() },
  };
  const { rows: [row] } = await q.query(
    `INSERT INTO import_runtime_runs
       (provider, source_type, source_ref, mode, started_by, stages)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id, run_ref`,
    [provider, sourceType, sourceRef, normalizeMode(mode), actorId, JSON.stringify(stages)]
  );
  return row;
}

async function markStage(runId, key, {
  started = false,
  finished = false,
  reason = null,
} = {}, q = db) {
  if (!STAGE_KEYS.includes(key)) {
    throw new Error(`IMPORT_RUNTIME_UNKNOWN_STAGE_${key}`);
  }
  const now = new Date().toISOString();
  const patch = {};
  if (started) patch.started_at = now;
  if (finished) patch.finished_at = now;
  if (reason) patch.reason = String(reason).slice(0, 300);

  await q.query(
    `UPDATE import_runtime_runs
        SET stages = jsonb_set(
              stages,
              ARRAY[$2::text],
              COALESCE(stages->$2::text, '{}'::jsonb) || $3::jsonb,
              true
            ),
            updated_at = NOW()
      WHERE id = $1`,
    [runId, key, JSON.stringify(patch)]
  );
}

async function attachImport(runId, {
  importId,
  sourceTotal,
  sourceRef = null,
} = {}, q = db) {
  await q.query(
    `UPDATE import_runtime_runs
        SET import_id = $2,
            source_total = $3,
            source_ref = COALESCE($4, source_ref),
            updated_at = NOW()
      WHERE id = $1`,
    [runId, importId, Number(sourceTotal || 0), sourceRef]
  );
}

async function recordIntake(runId, intake, q = db) {
  await q.query(
    `UPDATE import_runtime_runs
        SET intake = intake || $2::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [runId, JSON.stringify(intake || {})]
  );
}

async function failRun(runId, reason, q = db) {
  await q.query(
    `UPDATE import_runtime_runs
        SET status = 'FAILED',
            failure_reason = $2,
            finished_at = COALESCE(finished_at, NOW()),
            updated_at = NOW()
      WHERE id = $1
        AND status = 'RUNNING'`,
    [runId, String(reason || 'unknown').slice(0, 300)]
  );
}

function candidateStage(row = {}) {
  if (row.state === 'imported_to_catalog' && row.product_ref) return 'CATALOGUE';
  if (row.komerce_category) return 'TAXONOMY';
  if (row.scan_at) return 'REFINERY';
  return 'RAW_IMPORT';
}

function verdictOf(row = {}) {
  return evaluateSourcingCandidateOutcome({
    ...row,
    product_id: row.product_ref || null,
    raw_payload: row.has_raw_payload ? { present: true } : null,
    normalized_source_contract: row.normalized_source_contract || null,
  });
}

function buildProjection({ run, rows = [], sourceProof = null }) {
  const intake = run.intake || {};
  const storedStages = run.stages || {};
  const sourceTotal = Number(run.source_total || 0);

  const accepted = Number(intake.accepted || 0);
  const duplicates = Number(intake.duplicates || 0);
  const rejected = Number(intake.rejected || 0);
  const quarantined = Number(intake.quarantined || 0);
  const deferred = Number(intake.deferred || 0);
  const readyForRefinery = Number(intake.ready_for_refinery || 0);
  const certificationBlocked = Number(intake.certification_blocked || 0);

  const refined = rows.filter((row) => row.scan_at).length;
  const taxonomized = rows.filter((row) => row.komerce_category).length;
  const verdicts = rows.map(verdictOf);
  const certified = verdicts.filter((v) => v.outcome_valid && v.sourcing_certified).length;
  const catalogued = rows.filter(
    (row) => row.state === 'imported_to_catalog' && row.product_ref
  ).length;

  const rec = reconcileSourcingCounts({
    inputTotal: sourceTotal,
    readyForRefinery,
    quarantined,
    rejected,
    duplicates,
    deferred,
    otherTerminal: certificationBlocked,
  });

  const accounting = {
    source_total: sourceTotal,
    accepted,
    duplicates,
    rejected,
    quarantined,
    deferred,
    certification_blocked: certificationBlocked,
    refined,
    taxonomized,
    certified,
    catalogued,
    awaiting_catalogue_promotion: Math.max(0, certified - catalogued),
    unaccounted: rec.unaccounted,
    overflow: rec.overflow,
  };

  const intakeRecorded = Boolean(intake.recorded_at);
  const balanced = intakeRecorded && rec.balanced;
  const sourceDone = Boolean(storedStages.SOURCE_CONNECTED?.finished_at);
  const rawDone = Boolean(storedStages.RAW_IMPORT?.finished_at);
  const refineryDone = Boolean(storedStages.REFINERY?.finished_at) && intakeRecorded;

  const taxonomyEligible = rows.filter((row) => {
    const verdict = verdictOf(row);
    return verdict.outcome === 'ready_for_refinery' || verdict.outcome === 'catalog_imported';
  });
  const taxonomyDone = refineryDone
    && taxonomyEligible.length >= readyForRefinery
    && taxonomyEligible.every((row) => Boolean(row.komerce_category));

  const proofOk = Boolean(
    run.source_type === 'api'
      && sourceProof?.certified_at
      && sourceProof?.capture_id
      && intake.capture_id
      && String(sourceProof.capture_id) === String(intake.capture_id)
  );

  // Product certification belongs to the lot. Provider runtime certification
  // belongs to the source rail. They must never block each other.
  let certificationStatus = 'PENDING';
  let certificationReason = null;
  if (taxonomyDone) {
    if (!balanced) {
      certificationStatus = 'FAILED';
      certificationReason = 'accounting_unbalanced';
    } else if (certified < readyForRefinery) {
      certificationStatus = 'FAILED';
      certificationReason = 'sourcing_certification_incomplete';
    } else {
      certificationStatus = 'COMPLETED';
    }
  }

  let providerRuntimeStatus = run.source_type === 'api' ? 'PENDING' : 'NOT_APPLICABLE';
  let providerRuntimeReason = run.source_type === 'api'
    ? null
    : 'provider_runtime_certification_unavailable_for_source_type';
  if (run.source_type === 'api' && intakeRecorded) {
    if (intake.pipeline_status !== 'CANONICAL_RESOLVED') {
      providerRuntimeStatus = 'BLOCKED';
      providerRuntimeReason = `pipeline_${String(intake.pipeline_status || 'unknown').toLowerCase()}`;
    } else if (!proofOk) {
      providerRuntimeStatus = 'PENDING';
      providerRuntimeReason = 'provider_runtime_proof_missing';
    } else {
      providerRuntimeStatus = 'CERTIFIED';
      providerRuntimeReason = null;
    }
  }

  const catalogueStatus = certificationStatus !== 'COMPLETED'
    ? 'PENDING'
    : certified === 0
      ? 'COMPLETED'
      : (catalogued >= certified ? 'COMPLETED' : 'RUNNING');

  const persistedFailureReason = run.failure_reason || null;
  const legacyProviderRuntimeFailure = run.status === 'FAILED'
    && persistedFailureReason === 'pipeline_partial_blocked'
    && taxonomyDone
    && balanced
    && certified >= readyForRefinery;
  const failedRun = run.status === 'FAILED' && !legacyProviderRuntimeFailure;

  function stage(key, status, processed, total, extra = {}) {
    const stored = storedStages[key] || {};
    return {
      key,
      status,
      processed: Number(processed || 0),
      total: Number(total || 0),
      started_at: iso(stored.started_at),
      finished_at: status === 'COMPLETED'
        ? (iso(stored.finished_at) || iso(run.updated_at))
        : iso(stored.finished_at),
      reason: stored.reason || null,
      metrics: {},
      ...extra,
    };
  }

  const stages = [
    stage(
      'SOURCE_CONNECTED',
      sourceDone ? 'COMPLETED' : 'RUNNING',
      sourceDone ? 1 : 0,
      1,
      { metrics: { provider: run.provider } }
    ),
    stage(
      'RAW_IMPORT',
      rawDone ? 'COMPLETED' : (sourceDone ? 'RUNNING' : 'PENDING'),
      rawDone ? sourceTotal : rows.length,
      sourceTotal,
      { metrics: { accepted, duplicates, rejected } }
    ),
    stage(
      'REFINERY',
      refineryDone ? 'COMPLETED' : (rawDone ? 'RUNNING' : 'PENDING'),
      refined,
      readyForRefinery,
      { metrics: { deferred, quarantined, certification_blocked: certificationBlocked } }
    ),
    stage(
      'TAXONOMY',
      taxonomyDone ? 'COMPLETED' : (refineryDone ? 'RUNNING' : 'PENDING'),
      taxonomized,
      readyForRefinery
    ),
    stage(
      'CERTIFICATION',
      certificationStatus,
      certificationStatus === 'COMPLETED' ? certified : 0,
      readyForRefinery,
      {
        reason: certificationReason,
        metrics: {
          certified,
          provider_runtime_status: providerRuntimeStatus,
          runtime_certified: proofOk,
          pipeline_status: intake.pipeline_status || null,
        },
      }
    ),
    stage(
      'CATALOGUE',
      catalogueStatus,
      catalogued,
      certified,
      {
        reason: catalogueStatus === 'RUNNING'
          ? 'awaiting_explicit_operator_promotion'
          : null,
      }
    ),
  ];

  if (failedRun) {
    const failedStageKey = !sourceDone
      ? 'SOURCE_CONNECTED'
      : !rawDone
        ? 'RAW_IMPORT'
        : !refineryDone
          ? 'REFINERY'
          : !taxonomyDone
            ? 'TAXONOMY'
            : certificationStatus !== 'COMPLETED'
              ? 'CERTIFICATION'
              : 'CATALOGUE';
    const failedStage = stages.find((item) => item.key === failedStageKey);
    if (failedStage) {
      failedStage.status = 'FAILED';
      failedStage.reason = persistedFailureReason || failedStage.reason || 'run_failed';
      failedStage.finished_at = iso(run.finished_at) || iso(run.updated_at);
    }
  }

  let status = failedRun ? 'FAILED' : 'RUNNING';
  let failureReason = failedRun ? persistedFailureReason : null;
  const failedStage = stages.find((s) => s.status === 'FAILED');
  if (status !== 'FAILED' && failedStage) {
    status = 'FAILED';
    failureReason = failedStage.reason || 'stage_failed';
  } else if (
    status !== 'FAILED'
    && stages.every((s) => s.status === 'COMPLETED')
    && balanced
  ) {
    status = 'COMPLETED';
  }

  const current = stages.find((s) => s.status !== 'COMPLETED') || stages[stages.length - 1];
  const processed = Math.min(
    sourceTotal,
    readyForRefinery + duplicates + rejected + deferred + quarantined + certificationBlocked
  );
  const stageProgress = stages.reduce((sum, item) => {
    if (item.status === 'COMPLETED') return sum + 1;
    if (item.status !== 'RUNNING') return sum;
    if (item.total > 0) return sum + Math.min(1, item.processed / item.total);
    return sum + 0.15;
  }, 0);
  const progressPct = Math.min(100, Math.round((stageProgress / STAGE_KEYS.length) * 100));

  const recentItems = [...rows]
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
    .slice(0, 10)
    .map((row) => ({
      candidate_ref: row.candidate_ref,
      supplier_product_id: row.supplier_product_id,
      product_name: row.product_name,
      image_url: row.image_url || null,
      komerce_category: row.komerce_category || null,
      product_ref: row.product_ref || null,
      stage: candidateStage(row),
      state: row.state,
      updated_at: iso(row.updated_at),
    }));

  const events = stages
    .filter((s) => s.started_at || s.finished_at)
    .map((s) => ({
      stage: s.key,
      at: s.finished_at || s.started_at,
      kind: s.finished_at ? 'STAGE_FINISHED' : 'STAGE_STARTED',
    }))
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 8);

  return {
    run_ref: run.run_ref,
    mode: run.mode,
    status,
    failure_reason: failureReason,
    provider: run.provider,
    source_type: run.source_type,
    source_ref: run.source_ref || null,
    import_ref: run.import_ref || null,
    started_at: iso(run.started_at),
    finished_at: status === 'COMPLETED' || status === 'FAILED'
      ? (iso(run.finished_at) || iso(run.updated_at))
      : null,
    updated_at: iso(run.updated_at),
    current_stage: current.key,
    processed,
    progress_pct: progressPct,
    accounting,
    diagnostics: {
      pipeline_status: intake.pipeline_status || null,
      canonical_resolved: intake.canonical_resolved === true,
      reject_reasons: intake.reject_reasons && typeof intake.reject_reasons === 'object'
        ? intake.reject_reasons
        : {},
      runtime_certified: proofOk,
      provider_runtime_status: providerRuntimeStatus,
      provider_runtime_reason: providerRuntimeReason,
      certification_reason: certificationReason,
    },
    stages,
    current_item: recentItems[0] || null,
    recent_items: recentItems,
    events,
  };
}

const RUN_SELECT = `
  SELECT r.id,
         r.run_ref,
         r.provider,
         r.source_type,
         r.source_ref,
         r.mode,
         r.status,
         r.source_total,
         r.stages,
         r.intake,
         r.failure_reason,
         r.started_at,
         r.finished_at,
         r.updated_at,
         i.import_ref
    FROM import_runtime_runs r
    LEFT JOIN supplier_catalog_imports i ON i.id = r.import_id
`;

const CANDIDATE_COLUMNS = `
  sc.candidate_ref,
  sc.supplier_name,
  sc.supplier_product_id,
  sc.product_name,
  sc.image_url,
  sc.komerce_category,
  sc.state,
  sc.scan_at,
  sc.updated_at,
  sc.promotion_status,
  sc.promotion_reasons,
  sc.findings,
  sc.rejected_reason,
  sc.raw_payload IS NOT NULL AS has_raw_payload,
  sc.normalized_source_contract,
  sc.scan_result,
  p.product_ref
`;

async function loadRows(runId, q = db) {
  const { rows } = await q.query(
    `SELECT ${CANDIDATE_COLUMNS}
       FROM import_runtime_runs r
       JOIN sourcing_candidates sc ON sc.import_id = r.import_id
       LEFT JOIN products p ON p.id = sc.product_id
      WHERE r.id = $1`,
    [runId]
  );
  return rows;
}

async function loadProof(sourceRef, q = db) {
  if (!sourceRef) return null;
  const { rows: [row] } = await q.query(
    `SELECT production_certified_capture_id AS capture_id,
            production_certified_at AS certified_at
       FROM sourcing_sources
      WHERE source_id = $1`,
    [sourceRef]
  );
  return row || null;
}

async function project(run, q = db, includeDownstream = false) {
  const [rows, proof] = await Promise.all([
    loadRows(run.id, q),
    loadProof(run.source_ref, q),
  ]);
  const projection = buildProjection({ run, rows, sourceProof: proof });
  if (includeDownstream) {
    const refs = rows.filter(row => row.state === 'imported_to_catalog' && row.product_ref)
      .map(row => row.product_ref);
    try {
      projection.downstream = await readRunProgress(refs, q);
    } catch (_) {
      // An unavailable downstream observation must not turn a completed import
      // into a failed run, nor fabricate zeroes for unknown counts.
      projection.downstream = { available: false };
    }
  }
  return projection;
}

async function getRun(runRef, q = db) {
  const { rows: [run] } = await q.query(
    `${RUN_SELECT} WHERE r.run_ref = $1`,
    [runRef]
  );
  return run ? project(run, q, true) : null;
}

async function listRuns({ limit = 10 } = {}, q = db) {
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  const { rows } = await q.query(
    `SELECT run_ref, provider, mode, status, source_total,
            started_at, finished_at, updated_at
       FROM import_runtime_runs
      ORDER BY started_at DESC
      LIMIT $1`,
    [n]
  );
  return rows.map((row) => ({
    run_ref: row.run_ref,
    provider: row.provider,
    mode: row.mode,
    status: row.status,
    source_total: row.source_total,
    started_at: iso(row.started_at),
    finished_at: iso(row.finished_at),
    updated_at: iso(row.updated_at),
  }));
}

async function syncRun(runId, q = db) {
  const { rows: [run] } = await q.query(
    `${RUN_SELECT} WHERE r.id = $1`,
    [runId]
  );
  if (!run) return null;

  const projection = await project(run, q);
  if (
    projection.status !== run.status
    || projection.failure_reason !== run.failure_reason
  ) {
    await q.query(
      `UPDATE import_runtime_runs
          SET status = $2,
              failure_reason = $3,
              finished_at = CASE
                WHEN $2 = 'RUNNING' THEN NULL
                ELSE COALESCE(finished_at, NOW())
              END,
              updated_at = NOW()
        WHERE id = $1`,
      [runId, projection.status, projection.failure_reason]
    );
  }
  return projection;
}

async function syncRunsForImport(importId, q = db) {
  if (!importId) return;
  const { rows } = await q.query(
    `SELECT id
       FROM import_runtime_runs
      WHERE import_id = $1
        AND status <> 'FAILED'`,
    [importId]
  );
  for (const row of rows) {
    await syncRun(row.id, q);
  }
}

async function getProductTrace(runRef, supplierProductId, q = db) {
  const { rows: [run] } = await q.query(
    `${RUN_SELECT} WHERE r.run_ref = $1`,
    [runRef]
  );
  if (!run) return null;

  const { rows: [row] } = await q.query(
    `SELECT ${CANDIDATE_COLUMNS}
       FROM import_runtime_runs r
       JOIN sourcing_candidates sc ON sc.import_id = r.import_id
       LEFT JOIN products p ON p.id = sc.product_id
      WHERE r.id = $1
        AND sc.supplier_product_id = $2`,
    [run.id, supplierProductId]
  );
  if (!row) return null;

  const verdict = verdictOf(row);
  return {
    run_ref: run.run_ref,
    provider: run.provider,
    import_ref: run.import_ref || null,
    candidate_ref: row.candidate_ref,
    supplier_product_id: row.supplier_product_id,
    refinery: {
      done: Boolean(row.scan_at),
      scanned_at: iso(row.scan_at),
    },
    canonical_category: row.komerce_category || null,
    product_ref: row.product_ref || null,
    certification: {
      outcome: verdict.outcome,
      sourcing_certified: verdict.sourcing_certified,
      reasons: verdict.reasons,
    },
    catalogue_status: row.state,
  };
}

module.exports = {
  STAGE_KEYS,
  RUN_MODES,
  DUPLICATE_CODE,
  normalizeMode,
  safe,
  startRun,
  markStage,
  attachImport,
  recordIntake,
  failRun,
  buildProjection,
  getRun,
  listRuns,
  syncRun,
  syncRunsForImport,
  getProductTrace,
};
