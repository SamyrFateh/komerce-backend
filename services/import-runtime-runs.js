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
const itemEvents = require('./import-runtime-item-events');
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
// Un produit « en cours » sans fin depuis plus longtemps est considéré interrompu, pas en cours.
const ITEM_STALE_MS = 10 * 60 * 1000;

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

// « Action requise » = ce que Komerce ne peut pas résoudre seul (quarantaine, contrat de certification
// bloqué, anomalie de comptage). DEFERRED (WATCH / AVOID / LOSS), les rejets conformes et les doublons
// sont des issues comptabilisées, jamais une intervention humaine. Dérivation serveur : le navigateur
// n'interprète aucun compteur.
const ACTION_ITEM_CAP = 50;

function reasonText(row, verdict) {
  const parts = [row.promotion_status, row.rejected_reason, ...(verdict?.reasons || [])];
  for (const value of [row.promotion_reasons, row.findings]) {
    if (value == null) continue;
    try { parts.push(typeof value === 'string' ? value : JSON.stringify(value)); } catch (_) { /* ignoré */ }
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function actionKindFor(text) {
  if (/image|m[eé]dia|photo/.test(text)) return { reason: 'Image inexploitable', action: 'fix', action_label: 'Corriger' };
  if (/cat[eé]gor|taxonom|classement|ambigu/.test(text)) return { reason: 'Classement ambigu', action: 'choose', action_label: 'Choisir' };
  if (/manquant|missing|obligatoire|required/.test(text)) return { reason: 'Donnée obligatoire manquante', action: 'complete', action_label: 'Compléter' };
  return { reason: 'Produit à examiner', action: 'examine', action_label: 'Examiner' };
}

function buildActionItems({ rows, verdicts, quarantined, certificationBlocked, anomaly }) {
  const listed = [];
  rows.forEach((row, index) => {
    const verdict = verdicts[index];
    const blocked = !verdict.outcome_valid
      && (verdict.outcome === 'ready_for_refinery' || verdict.outcome === 'catalog_imported');
    if (verdict.outcome !== 'quarantined' && !blocked) return;
    listed.push({
      candidate_ref: row.candidate_ref || null,
      supplier_product_id: row.supplier_product_id || null,
      product_name: row.product_name || null,
      image_url: row.image_url || null,
      ...actionKindFor(reasonText(row, verdict)),
    });
  });
  const expected = quarantined + certificationBlocked;
  while (listed.length < expected) {
    listed.push({ candidate_ref: null, supplier_product_id: null, product_name: null, image_url: null, ...actionKindFor('') });
  }
  for (let i = 0; i < anomaly; i += 1) {
    listed.push({
      candidate_ref: null, supplier_product_id: null, product_name: null, image_url: null,
      reason: 'Anomalie de comptage', action: 'examine', action_label: 'Examiner',
    });
  }
  return { count: listed.length, items: listed.slice(0, ACTION_ITEM_CAP) };
}

// Populations : « quels objets composent ce chiffre ? ». Une carte du cockpit ouvre exactement les
// produits qui la composent ; ce qui n'existe qu'en compteur d'intake (doublons / invalides refusés à
// la réception, jamais persistés en candidat) est restitué en groupes explicites, jamais inventé.
const POPULATION_KINDS = Object.freeze(['received', 'ready', 'discarded']);
const POPULATION_CAP = 500;

function discardKind(row, verdict) {
  const text = reasonText(row, verdict);
  if (/doublon|duplicate/.test(text)) return { issue: 'Doublon', reason: 'Déjà présent dans le catalogue ou dans ce lot' };
  if (/exclu|excluded|r[eè]gle|rule|douane|custom|l[eé]gal|legal|interdit|prohib/.test(text)) {
    return { issue: 'Exclu par règle', reason: 'Écarté par une règle Komerce' };
  }
  return { issue: 'Produit non retenu', reason: 'Ne correspond pas aux critères Komerce' };
}

function issueOf(row, verdict) {
  if (verdict.outcome === 'catalog_imported' && row.product_ref) return { key: 'catalogued', label: 'Remis au Catalogue' };
  if (verdict.outcome === 'deferred') return { key: 'deferred', label: 'Mis de côté' };
  if (verdict.outcome === 'rejected' || verdict.outcome === 'archived') return { key: 'discarded', label: 'Écarté' };
  if (verdict.outcome === 'quarantined'
    || (!verdict.outcome_valid && (verdict.outcome === 'ready_for_refinery' || verdict.outcome === 'catalog_imported'))) {
    return { key: 'action', label: 'Action requise' };
  }
  if (verdict.sourcing_certified) return { key: 'ready', label: 'Prêt pour le Catalogue' };
  return { key: 'control', label: 'Prêt pour contrôle' };
}

function buildPopulation({ kind, rows = [], intake = {}, sourceTotal = 0 }) {
  const verdicts = rows.map(verdictOf);
  const entries = rows.map((row, index) => ({ row, verdict: verdicts[index], issue: issueOf(row, verdicts[index]) }));
  const base = ({ row }) => ({
    candidate_ref: row.candidate_ref || null,
    supplier_product_id: row.supplier_product_id || null,
    product_name: row.product_name || null,
    image_url: row.image_url || null,
  });
  const duplicates = Number(intake.duplicates || 0);
  const rejected = Number(intake.rejected || 0);
  let items = [];
  let total = 0;
  const unlisted = [];

  if (kind === 'received') {
    total = Number(sourceTotal || 0);
    items = entries.map((e) => ({ ...base(e), issue_key: e.issue.key, issue_label: e.issue.label }));
    const missing = Math.max(0, total - rows.length);
    if (missing > 0) unlisted.push({ label: 'Écartés dès la réception (voir Écartés automatiquement)', count: missing });
  } else if (kind === 'ready') {
    const ready = entries.filter((e) => e.verdict.outcome_valid && e.verdict.sourcing_certified);
    total = ready.length;
    items = ready.map((e) => ({
      ...base(e),
      issue_key: e.issue.key === 'catalogued' ? 'catalogued' : 'ready',
      issue_label: e.issue.key === 'catalogued' ? 'Remis' : 'Prêt',
    }));
  } else if (kind === 'discarded') {
    total = duplicates + rejected;
    const gone = entries.filter((e) => e.issue.key === 'discarded');
    items = gone.map((e) => {
      const d = discardKind(e.row, e.verdict);
      return { ...base(e), issue_key: 'discarded', issue_label: d.issue, reason: d.reason };
    });
    const remaining = Math.max(0, total - items.length);
    const listedDuplicates = items.filter((item) => item.issue_label === 'Doublon').length;
    const dup = Math.min(Math.max(0, duplicates - listedDuplicates), remaining);
    if (dup > 0) unlisted.push({ label: 'Doublon', count: dup });
    if (remaining - dup > 0) unlisted.push({ label: 'Produit non retenu à la réception', count: remaining - dup });
  } else {
    return null;
  }
  return { kind, total, listed: Math.min(items.length, POPULATION_CAP), items: items.slice(0, POPULATION_CAP), unlisted };
}

async function getPopulation(runRef, kind, q = db) {
  if (!POPULATION_KINDS.includes(kind)) return null;
  const { rows: [run] } = await q.query(`${RUN_SELECT} WHERE r.run_ref = $1`, [runRef]);
  if (!run) return null;
  const rows = await loadRows(run.id, q);
  return buildPopulation({ kind, rows, intake: run.intake || {}, sourceTotal: run.source_total });
}


function buildProjection({ run, rows = [], sourceProof = null, items = [], now = Date.now() }) {
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
    // processed reste une observation backend : on ne fabrique jamais n/n pour rendre un statut lisible.
    // L'UI masque simplement le ratio lorsqu'il n'est pas la preuve de complétion de l'étape.
    const observed = Number(processed || 0);
    const scope = Number(total || 0);
    return {
      key,
      status,
      processed: Math.min(observed, scope || observed),
      total: scope,
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
          ? 'automatic_catalogue_handoff_pending'
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

  const catalogueStage = stages.find((item) => item.key === 'CATALOGUE');
  const catalogueHandoffPending = catalogueStage?.status === 'RUNNING'
    && catalogueStage?.reason === 'automatic_catalogue_handoff_pending';

  let status = failedRun ? 'FAILED' : 'RUNNING';
  let failureReason = failedRun ? persistedFailureReason : null;
  const failedStage = stages.find((s) => s.status === 'FAILED');
  if (status !== 'FAILED' && failedStage) {
    status = 'FAILED';
    failureReason = failedStage.reason || 'stage_failed';
  } else if (
    status !== 'FAILED'
    && balanced
    && stages.every((s) => s.status === 'COMPLETED')
  ) {
    // La remise Sourcing → Catalogue fait partie du passage automatique.
    // Le run n'est terminé que lorsque les brouillons Catalogue existent
    // réellement ; un handoff encore en cours reste RUNNING.
    status = 'COMPLETED';
  }

  const actionRequired = buildActionItems({
    rows,
    verdicts,
    quarantined,
    certificationBlocked,
    anomaly: intakeRecorded ? rec.unaccounted + rec.overflow : 0,
  });
  accounting.action_required = actionRequired.count;
  // sourcing_status décrit uniquement l'autorité Sourcing : une remise Catalogue
  // automatique encore en cours ne transforme pas un Sourcing terminé en LIVE,
  // et une vraie exception humaine reste visible même si le run global poursuit
  // encore sa matérialisation Catalogue.
  const sourcingStagesDone = stages
    .filter((item) => item.key !== 'CATALOGUE')
    .every((item) => item.status === 'COMPLETED');
  const sourcingStatus = status === 'FAILED' && actionRequired.count === 0
    ? 'BLOCKED'
    : actionRequired.count > 0
      ? 'ACTION_REQUIRED'
      : sourcingStagesDone
        ? 'DONE'
        : 'RUNNING';

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
      purchase_price: row.purchase_price != null ? Number(row.purchase_price) : null,
      currency: row.currency || null,
      stage: candidateStage(row),
      state: row.state,
      updated_at: iso(row.updated_at),
    }));

  // Événements par produit (télémétrie de la boucle d'import) : présents seulement
  // pour les runs réels ; les anciens runs / replays retombent sur le dernier candidat mis à jour.
  const itemList = Array.isArray(items) ? items : [];
  const hasItemEvents = itemList.length > 0;
  const rowByProduct = new Map(
    rows.filter((row) => row.supplier_product_id).map((row) => [row.supplier_product_id, row])
  );
  const itemViews = itemList.map((ev) => {
    const row = rowByProduct.get(ev.supplier_product_id) || null;
    const startedMs = new Date(ev.started_at).getTime();
    const finishedMs = ev.finished_at ? new Date(ev.finished_at).getTime() : null;
    const inProgress = !ev.finished_at && Number.isFinite(startedMs) && (now - startedMs) < ITEM_STALE_MS;
    const price = ev.purchase_price != null ? ev.purchase_price : row?.purchase_price;
    return {
      seq: Number(ev.seq),
      candidate_ref: row?.candidate_ref || null,
      supplier_product_id: ev.supplier_product_id || null,
      product_name: row?.product_name || ev.product_name || null,
      image_url: row?.image_url || ev.image_url || null,
      komerce_category: row?.komerce_category || null,
      product_ref: row?.product_ref || null,
      purchase_price: price != null ? Number(price) : null,
      currency: ev.currency || row?.currency || null,
      stage: inProgress ? 'REFINERY' : (row ? candidateStage(row) : (ev.stage || 'REFINERY')),
      state: inProgress ? 'processing' : (row?.state || ev.outcome || null),
      outcome: ev.outcome || null,
      change_kind: ev.change_kind || null,
      in_progress: inProgress,
      duration_ms: finishedMs != null && Number.isFinite(startedMs) ? Math.max(0, finishedMs - startedMs) : null,
      updated_at: iso(ev.finished_at || ev.started_at),
    };
  });

  const stageEvents = stages
    .filter((s) => s.started_at || s.finished_at)
    .map((s) => ({
      stage: s.key,
      at: s.finished_at || s.started_at,
      kind: s.finished_at ? 'STAGE_FINISHED' : 'STAGE_STARTED',
    }))
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 8);
  const itemFeed = itemViews
    .filter((item) => !item.in_progress && item.updated_at && item.duration_ms != null)
    .slice(0, 6)
    .map((item) => ({
      stage: 'REFINERY',
      at: item.updated_at,
      kind: 'ITEM_FINISHED',
      seq: item.seq,
      product_name: item.product_name,
      outcome: item.outcome,
      change_kind: item.change_kind,
      duration_ms: item.duration_ms,
    }));
  const events = hasItemEvents
    ? [...stageEvents, ...itemFeed].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 12)
    : stageEvents;

  const runningItem = status === 'RUNNING' ? itemViews.find((item) => item.in_progress) : null;
  const currentItem = hasItemEvents
    ? (runningItem || itemViews.find((item) => !item.in_progress) || null)
    : (recentItems[0] || null);
  const currentItemKind = !currentItem
    ? null
    : !hasItemEvents ? 'last_updated' : (runningItem ? 'in_progress' : 'last_processed');

  return {
    run_ref: run.run_ref,
    mode: run.mode,
    status,
    sourcing_status: sourcingStatus,
    action_items: actionRequired.items,
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
    current_item: currentItem,
    current_item_kind: currentItemKind,
    recent_items: hasItemEvents ? itemViews.slice(0, 10) : recentItems,
    item_events: hasItemEvents,
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
  sc.purchase_price,
  sc.currency,
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

async function loadRowsForRuns(runIds, q = db) {
  if (!runIds.length) return new Map();
  const { rows } = await q.query(
    `SELECT r.id::text AS run_id, ${CANDIDATE_COLUMNS}
       FROM import_runtime_runs r
       JOIN sourcing_candidates sc ON sc.import_id = r.import_id
       LEFT JOIN products p ON p.id = sc.product_id
      WHERE r.id = ANY($1::uuid[])`,
    [runIds]
  );
  const grouped = new Map(runIds.map((id) => [String(id), []]));
  for (const row of rows) {
    const key = String(row.run_id);
    const item = { ...row };
    delete item.run_id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  return grouped;
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
  let items = [];
  try {
    items = await itemEvents.listRunItems(run.id, { limit: 12 }, q);
  } catch (_) {
    // Télémétrie optionnelle (table absente, base ancienne…) : le lot reste lisible sans.
    items = [];
  }
  const projection = buildProjection({ run, rows, sourceProof: proof, items: Array.isArray(items) ? items : [] });
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

// Passages : l'historique des runs KIR, uniquement la vérité Sourcing (jamais prix / marché / vente).
const PASSAGE_STATE = Object.freeze({ RUNNING: 'LIVE', DONE: 'Terminé', ACTION_REQUIRED: 'Action requise', BLOCKED: 'Bloqué' });

function handoffLabel(certified, catalogued) {
  if (!certified) return '—';
  if (catalogued >= certified) return 'Terminée';
  if (catalogued === 0) return 'En attente';
  return `${certified - catalogued} restent`;
}

function buildPassage(run, rows) {
  const projection = buildProjection({ run, rows });
  const a = projection.accounting;
  return {
    run_ref: run.run_ref,
    provider: run.provider || null,
    source_ref: run.source_ref || null,
    started_at: iso(run.started_at),
    sourcing_status: projection.sourcing_status,
    state_label: PASSAGE_STATE[projection.sourcing_status] || 'Terminé',
    source_total: a.source_total,
    certified: a.certified,
    discarded: a.duplicates + a.rejected,
    action_required: a.action_required,
    catalogued: a.catalogued,
    handoff_label: handoffLabel(a.certified, a.catalogued),
  };
}

async function listPassages({ limit = 30, offset = 0 } = {}, q = db) {
  const n = Math.max(1, Math.min(50, Number(limit) || 30));
  const start = Math.max(0, Number(offset) || 0);
  const { rows: runsPlusOne } = await q.query(
    `${RUN_SELECT} ORDER BY r.started_at DESC, r.run_ref DESC LIMIT $1 OFFSET $2`,
    [n + 1, start]
  );
  const hasMore = runsPlusOne.length > n;
  const runs = runsPlusOne.slice(0, n);
  const grouped = await loadRowsForRuns(runs.map((run) => run.id), q);
  return {
    passages: runs.map((run) => buildPassage(run, grouped.get(String(run.id)) || [])),
    offset: start,
    next_offset: hasMore ? start + n : null,
  };
}

async function getRunNeighbors(runRef, q = db) {
  if (!runRef) return { older_ref: null, newer_ref: null };
  const { rows: [row] } = await q.query(
    `WITH target AS (
       SELECT started_at, run_ref
         FROM import_runtime_runs
        WHERE run_ref = $1
     )
     SELECT
       (SELECT r.run_ref
          FROM import_runtime_runs r, target t
         WHERE (r.started_at, r.run_ref) < (t.started_at, t.run_ref)
         ORDER BY r.started_at DESC, r.run_ref DESC
         LIMIT 1) AS older_ref,
       (SELECT r.run_ref
          FROM import_runtime_runs r, target t
         WHERE (r.started_at, r.run_ref) > (t.started_at, t.run_ref)
         ORDER BY r.started_at ASC, r.run_ref ASC
         LIMIT 1) AS newer_ref`,
    [runRef]
  );
  return row || { older_ref: null, newer_ref: null };
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
    product_name: row.product_name || null,
    image_url: row.image_url || null,
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
  POPULATION_KINDS,
  buildPopulation,
  getPopulation,
  buildPassage,
  listPassages,
  getRunNeighbors,
};
