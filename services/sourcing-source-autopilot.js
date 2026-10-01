/**
 * @komerce-arch
 * @role          sourcing-source-autopilot
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        sourcing_sources_autopilot_switch, connector_automation_registry, provider_capability_policy, provider_runtime_certification_evidence
 * @outputs       recurring_source_imports, source_runtime_projection
 * @depends       db.js, services/sourcing-import-dispatch.js, services/suppliers/catalog-import-orchestrator.js, services/sourcing-observation-shadow-service.js, services/sourcing-provider-control-policy.js, services/sourcing-candidate-actions.js
 * @used-by       services/sourcing-workspace.js, scripts/sourcing-source-autopilot.js
 * @db-read       sourcing_sources, sourcing_captures
 * @db-write      sourcing_sources, sourcing_captures
 * @db-write-via:catalog-import-orchestrator supplier_catalog_imports, sourcing_candidates, sourcing_sources, sourcing_source_provides, sourcing_captures, sourcing_observations
 * @db-write-via:sourcing-candidate-actions sourcing_candidates, sourcing_candidate_events, products, catalog_media, product_variants, product_skus, product_sku_media, import_runtime_runs
 * @db-txn        advisory_lock_per_source
 * @doctrine      source_on_means_active_recurring_acquisition, source_lifecycle_is_not_autopilot_authority, provider_agnostic_runner, bounded_pull, fail_closed_connector_readiness, production_requires_runtime_certification
 * @impact-areas  sourcing, catalog, supplier-import
 * @version       2026-09
 */
'use strict';

const crypto = require('crypto');
const db = require('../db');
const importDispatch = require('./sourcing-import-dispatch');
const catalogImport = require('./suppliers/catalog-import-orchestrator');
const providerPolicy = require('./sourcing-provider-control-policy');
const candidateActions = require('./sourcing-candidate-actions');
const { buildSourceDescriptor } = require('./sourcing-observation-shadow-service');

const LOCK_NAMESPACE = 'komerce:sourcing-source-autopilot';
const DEFAULT_BATCH_LIMIT = 10;
const DEFAULT_TRANSIENT_RETRIES = 3;
const DEFAULT_TRANSIENT_RETRY_DELAY_MS = 2000;

class SourcingSourceAutopilotError extends Error {
  constructor(status, message, code, details = null) {
    super(message);
    this.name = 'SourcingSourceAutopilotError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function runtimeEnabled(env = process.env) {
  return String(env.KOMERCE_SOURCE_AUTOPILOT || '').trim() === '1';
}

function descriptorSourceRef(descriptor) {
  return buildSourceDescriptor({
    sourceType: 'api',
    supplierName: descriptor.supplier_name,
    supplierId: descriptor.adapter,
  }).sourceId;
}

function automationBySourceRef(sourceRef) {
  return importDispatch.sourceAutomationCatalog()
    .find((descriptor) => descriptorSourceRef(descriptor) === sourceRef) || null;
}

// Le registre opérateur est explicite : une source n'existe que si l'opérateur l'a ajoutée
// (services/sourcing-source-registry.js). Ce rafraîchissement ne crée JAMAIS de ligne : il
// réaligne seulement le contrat (adapter/pull/recurring) des sources déjà enregistrées.
async function refreshRegisteredPullSources(q = db) {
  const descriptors = importDispatch.sourceAutomationCatalog();
  const refs = descriptors.map(descriptorSourceRef);
  if (!refs.length) return [];
  const { rows } = await q.query(
    'SELECT source_id FROM sourcing_sources WHERE source_id = ANY($1::text[])',
    [refs]
  );
  const present = new Set(rows.map((row) => row.source_id));
  for (const descriptor of descriptors) {
    const sourceRef = descriptorSourceRef(descriptor);
    if (!present.has(sourceRef)) continue;
    await q.query(
      `UPDATE sourcing_sources
          SET adapter_type = $2, acquisition = 'pull', continuity = 'recurring'
        WHERE source_id = $1
          AND (adapter_type IS DISTINCT FROM $2 OR acquisition <> 'pull' OR continuity <> 'recurring')`,
      [sourceRef, descriptor.adapter]
    );
  }
  return refs.filter((ref) => present.has(ref));
}

async function listSources(q = db) {
  await refreshRegisteredPullSources(q);
  const { rows } = await q.query(
    `SELECT s.source_id AS source_ref,
            s.adapter_type,
            s.acquisition,
            s.continuity,
            s.status,
            s.autopilot_enabled,
            s.discovery_enabled, s.sync_enabled, s.import_enabled, s.production_enabled,
            s.production_certified_at,
            s.connection_test_status, s.connection_test_code, s.connection_tested_at,
            s.updated_at,
            last_capture.status AS last_capture_status,
            last_capture.completed_at AS last_capture_at,
            last_capture.stats AS last_capture_stats
       FROM sourcing_sources s
       LEFT JOIN LATERAL (
         SELECT c.status, c.completed_at, c.stats
           FROM sourcing_captures c
          WHERE c.source_id = s.source_id
          ORDER BY c.started_at DESC
          LIMIT 1
       ) last_capture ON TRUE
      WHERE s.acquisition = 'pull'
        AND s.continuity = 'recurring'
      ORDER BY s.source_id`
  );

  return rows.map((row) => {
    const automation = automationBySourceRef(row.source_ref);
    return {
      ...row,
      production_runtime_certified: Boolean(row.production_certified_at),
      label: automation?.label || row.adapter_type,
      supplier_name: automation?.supplier_name || null,
      connector_ready: Boolean(automation?.connector_ready),
      connector_reason: automation?.connector_ready ? null : (automation?.reason || 'connecteur non enregistré'),
      discovery_ready: Boolean(automation?.discovery_ready),
      discovery_mode: automation?.discovery_mode || null,
      discovery_version: automation?.discovery_version || null,
      runtime_enabled: runtimeEnabled(),
    };
  });
}

async function requireSource(sourceRef, q = db) {
  const { rows: [row] } = await q.query(
    `SELECT source_id AS source_ref, adapter_type, acquisition, continuity, status, autopilot_enabled, discovery_enabled, sync_enabled, import_enabled, production_enabled, production_certified_capture_id, production_certified_at, connection_test_status
       FROM sourcing_sources
      WHERE source_id = $1`,
    [sourceRef]
  );
  if (!row) {
    throw new SourcingSourceAutopilotError(404, 'Source sourcing introuvable', 'sourcing_source_not_found');
  }
  return row;
}

async function recordSyntheticCapture(sourceRef, status, stats, q = db) {
  const captureId = crypto.randomUUID();
  const now = new Date().toISOString();
  await q.query(
    `INSERT INTO sourcing_captures
       (capture_id, source_id, status, started_at, completed_at, stats)
     VALUES ($1, $2, $3, $4, $4, $5::jsonb)`,
    [captureId, sourceRef, status, now, JSON.stringify(stats || {})]
  );
  return captureId;
}

function boundedError(err) {
  return String(err?.message || err || 'erreur inconnue').slice(0, 500);
}

function boundedNonNegativeInt(value, fallback, max) {
  const n = Number.parseInt(value ?? fallback, 10);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : fallback;
}

function isTransientImportResult(result) {
  const status = Number(result?.status || 0);
  const message = String(result?.body?.error || '');
  return status >= 500
    || /(?:HTTP\s*)?429|too many requests|rate.?limit|frequency exceeds(?: the)? limit|ban will last|timeout|timed out|temporar(?:y|ily) unavailable|bad gateway|gateway timeout|service unavailable|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND/i.test(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function acquireSourceLock(client, sourceRef) {
  const { rows: [row] } = await client.query(
    'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked',
    [LOCK_NAMESPACE, sourceRef]
  );
  return Boolean(row?.locked);
}

async function releaseSourceLock(client, sourceRef) {
  await client.query(
    'SELECT pg_advisory_unlock(hashtext($1), hashtext($2))',
    [LOCK_NAMESPACE, sourceRef]
  ).catch(() => {});
}

function discoverySummary(plan) {
  return {
    status: plan?.status || null,
    provider: plan?.provider || null,
    strategy: plan?.strategy || null,
    version: plan?.version || null,
    pull_options: plan?.pull_options || null,
    evidence: plan?.evidence || null,
  };
}

async function resolveDiscoveryPlan(sourceRef, source, automation, { reason = 'scheduled' } = {}) {
  if (!automation?.discovery_ready) {
    throw new SourcingSourceAutopilotError(
      409,
      'Discovery runtime non configuré pour cette source',
      'sourcing_discovery_not_ready'
    );
  }

  try {
    const plan = await importDispatch.discoverSourcePlan(
      source.adapter_type,
      automation.pull_options || {}
    );
    if (!plan || plan.status !== 'READY' || !plan.pull_options) {
      throw new Error('Discovery sans plan READY exploitable');
    }
    await recordSyntheticCapture(sourceRef, 'complete', {
      kind: 'discovery_plan',
      reason,
      discovery: discoverySummary(plan),
    });
    return plan;
  } catch (error) {
    await recordSyntheticCapture(sourceRef, 'failed', {
      kind: 'discovery_plan',
      reason,
      code: error?.code || 'SOURCE_DISCOVERY_FAILED',
      error: boundedError(error),
      details: error?.details || null,
    }).catch(() => {});
    throw new SourcingSourceAutopilotError(
      502,
      `Discovery fournisseur en échec · ${boundedError(error)}`,
      error?.code || 'SOURCE_DISCOVERY_FAILED',
      error?.details || null
    );
  }
}

function buildImportBody(source, automation, reason, discoveryPlan) {
  if (!discoveryPlan?.pull_options) {
    throw new SourcingSourceAutopilotError(
      409,
      'Import interdit sans plan Discovery READY',
      'sourcing_discovery_plan_required'
    );
  }
  return {
    source_type: 'api',
    supplier_id: source.adapter_type,
    supplier_name: automation.supplier_name,
    notes: `source-autopilot:${reason || 'scheduled'};discovery=${discoveryPlan.version || 'unknown'}`,
    is_full_snapshot: false,
    ...discoveryPlan.pull_options,
  };
}

async function runSourceOnce(sourceRef, { reason = 'scheduled' } = {}) {
  if (!runtimeEnabled()) {
    return { status: 'skipped', source_ref: sourceRef, reason: 'runtime_disabled' };
  }

  await refreshRegisteredPullSources();
  const source = await requireSource(sourceRef);
  if (source.status !== 'active') {
    return { status: 'skipped', source_ref: sourceRef, reason: 'source_lifecycle_disabled' };
  }
  if (!source.autopilot_enabled) {
    return { status: 'skipped', source_ref: sourceRef, reason: 'autopilot_off' };
  }
  if (!providerPolicy.canRunAutomaticImport(source)) {
    return { status: 'skipped', source_ref: sourceRef, reason: 'provider_capability_policy_off' };
  }
  if (source.acquisition !== 'pull' || source.continuity !== 'recurring') {
    return { status: 'skipped', source_ref: sourceRef, reason: 'source_not_recurring_pull' };
  }

  const automation = automationBySourceRef(sourceRef);
  if (!automation) {
    await recordSyntheticCapture(sourceRef, 'failed', {
      autopilot: true,
      reason,
      code: 'AUTOMATION_DESCRIPTOR_MISSING',
    });
    return { status: 'failed', source_ref: sourceRef, code: 'automation_descriptor_missing' };
  }
  if (!automation.connector_ready) {
    await recordSyntheticCapture(sourceRef, 'failed', {
      autopilot: true,
      reason,
      code: 'CONNECTOR_NOT_READY',
      connector_reason: automation.reason || null,
    });
    return {
      status: 'failed',
      source_ref: sourceRef,
      code: 'connector_not_ready',
      reason: automation.reason || null,
    };
  }

  const lockClient = await db.getClient();
  let locked = false;
  try {
    locked = await acquireSourceLock(lockClient, sourceRef);
    if (!locked) return { status: 'skipped', source_ref: sourceRef, reason: 'already_running' };

    const maxTransientRetries = boundedNonNegativeInt(
      process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRIES,
      DEFAULT_TRANSIENT_RETRIES,
      10
    );
    const transientRetryDelayMs = boundedNonNegativeInt(
      process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRY_DELAY_MS,
      DEFAULT_TRANSIENT_RETRY_DELAY_MS,
      300000
    );

    const discoveryPlan = await resolveDiscoveryPlan(sourceRef, source, automation, { reason });
    let result;
    let transientRetries = 0;
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      result = await catalogImport.importCatalog(
        buildImportBody(source, automation, reason, discoveryPlan),
        null,
        importDispatch.dispatchToConnector
      );
      if (Number(result?.status) < 400) {
        // eslint-disable-next-line no-await-in-loop
        result = await candidateActions.handoffImportResult(result, null);
      }
      if (!isTransientImportResult(result) || transientRetries >= maxTransientRetries) break;
      transientRetries += 1;
      const delay = transientRetryDelayMs * (2 ** (transientRetries - 1));
      if (delay > 0) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(delay);
      }
    }

    if (result.status >= 400) {
      const empty = result.status === 400 && result.body?.error === 'Aucun produit valide trouvé';
      const retryPending = !empty && isTransientImportResult(result);
      await recordSyntheticCapture(sourceRef, retryPending ? 'partial' : (empty ? 'complete' : 'failed'), {
        autopilot: true,
        reason,
        outcome: retryPending ? 'retry_pending' : (empty ? 'empty' : 'failed'),
        error: result.body?.error || `HTTP ${result.status}`,
        rejected: result.body?.invalid?.length || result.body?.rejected || 0,
        transient_retries: transientRetries,
      });
      return {
        status: retryPending ? 'retry_pending' : (empty ? 'empty' : 'failed'),
        source_ref: sourceRef,
        run_ref: result.body?.run_ref || null,
        code: retryPending ? 'transient_import_retry_pending' : (empty ? null : 'import_failed'),
        error: result.body?.error || null,
        transient_retries: transientRetries,
      };
    }

    const body = result.body || {};
    const partial = body.pipeline_status === 'PARTIAL_BLOCKED'
      || body.shadow_ingestion?.status === 'failed'
      || body.shadow_ingestion?.resolution?.status === 'failed';
    if (partial) {
      await recordSyntheticCapture(sourceRef, 'partial', {
        autopilot: true,
        reason,
        outcome: 'imported_canonical_incomplete',
        accepted: body.accepted || 0,
        rejected: body.rejected || 0,
        shadow_code: body.shadow_ingestion?.code || body.shadow_ingestion?.resolution?.code || null,
      });
    }

    return {
      status: partial ? 'partial' : 'ok',
      source_ref: sourceRef,
      run_ref: body.run_ref || null,
      supplier_name: automation.supplier_name,
      accepted: body.accepted || 0,
      created: body.created || 0,
      updated: body.updated || 0,
      rejected: body.rejected || 0,
      shadow_status: body.shadow_ingestion?.status || null,
      pipeline_status: body.pipeline_status || null,
      transient_retries: transientRetries,
    };
  } catch (err) {
    await recordSyntheticCapture(sourceRef, 'failed', {
      autopilot: true,
      reason,
      outcome: 'exception',
      error: boundedError(err),
    }).catch(() => {});
    return {
      status: 'failed',
      source_ref: sourceRef,
      code: err?.code || 'autopilot_exception',
      error: boundedError(err),
    };
  } finally {
    if (locked) await releaseSourceLock(lockClient, sourceRef);
    lockClient.release();
  }
}

async function runSourceImportNow(sourceRef, { actorId = null, reason = 'operator_import_live' } = {}) {
  await refreshRegisteredPullSources();
  const source = await requireSource(sourceRef);
  const automation = automationBySourceRef(sourceRef);

  if (source.status !== 'active') {
    throw new SourcingSourceAutopilotError(409, 'Source désactivée au niveau lifecycle', 'sourcing_source_lifecycle_disabled');
  }
  if (!source.discovery_enabled || !source.sync_enabled || !source.import_enabled) {
    throw new SourcingSourceAutopilotError(
      409,
      'Discovery/Sync/Import doivent être autorisés avant un import opérateur',
      'provider_preproduction_capability_policy_off'
    );
  }
  if (!automation) {
    throw new SourcingSourceAutopilotError(409, 'Source sans contrat d’autopull', 'sourcing_autopull_unavailable');
  }
  if (!automation.connector_ready) {
    throw new SourcingSourceAutopilotError(
      409,
      automation.reason || 'Connecteur source non prêt',
      'sourcing_connector_not_ready'
    );
  }

  const lockClient = await db.getClient();
  let locked = false;
  try {
    locked = await acquireSourceLock(lockClient, sourceRef);
    if (!locked) {
      throw new SourcingSourceAutopilotError(409, 'Un import est déjà en cours pour cette source', 'sourcing_source_already_running');
    }

    const discoveryPlan = await resolveDiscoveryPlan(sourceRef, source, automation, { reason });
    const maxTransientRetries = boundedNonNegativeInt(
      process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRIES,
      DEFAULT_TRANSIENT_RETRIES,
      10
    );
    const transientRetryDelayMs = boundedNonNegativeInt(
      process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRY_DELAY_MS,
      DEFAULT_TRANSIENT_RETRY_DELAY_MS,
      300000
    );
    let result;
    let transientRetries = 0;
    while (true) {
      // Operator/certification imports must have the same transient resilience
      // as scheduled autopilot runs. Otherwise a provider throttle during the
      // first ON transition fails immediately while the scheduled rail retries.
      // eslint-disable-next-line no-await-in-loop
      result = await catalogImport.importCatalog(
        buildImportBody(source, automation, reason, discoveryPlan),
        actorId,
        importDispatch.dispatchToConnector
      );
      if (Number(result?.status) < 400) {
        // eslint-disable-next-line no-await-in-loop
        result = await candidateActions.handoffImportResult(result, actorId);
      }
      if (!isTransientImportResult(result) || transientRetries >= maxTransientRetries) break;
      transientRetries += 1;
      const delay = transientRetryDelayMs * (2 ** (transientRetries - 1));
      if (delay > 0) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(delay);
      }
    }

    if (result.status >= 400) {
      const body = result.body || {};
      const invalid = Array.isArray(body.invalid) ? body.invalid : [];
      const noValidProduct = result.status === 400 && body.error === 'Aucun produit valide trouvé';
      if (noValidProduct) {
        const rejected = invalid.length;
        const sourceEmpty = rejected === 0;
        throw new SourcingSourceAutopilotError(
          result.status,
          sourceEmpty
            ? 'Aucun produit valide trouvé · la source a retourné 0 produit'
            : `Aucun produit valide trouvé · ${rejected} produit(s) rejeté(s)`,
          sourceEmpty ? 'SUPPLIER_SOURCE_EMPTY' : 'NO_VALID_SUPPLIER_PRODUCT',
          {
            run_ref: body.run_ref || null,
            connector_total: rejected,
            rejected,
            reject_reasons: body.reject_reasons || null,
            transient_retries: transientRetries,
          }
        );
      }
      throw new SourcingSourceAutopilotError(
        result.status,
        body.error || 'Import source refusé',
        isTransientImportResult(result)
          ? 'transient_import_retry_exhausted'
          : (body.code || 'sourcing_source_import_failed'),
        { ...body, transient_retries: transientRetries }
      );
    }

    const body = result.body || {};
    return {
      status: body.pipeline_status === 'CANONICAL_RESOLVED' ? 'certified' : 'completed',
      source_ref: sourceRef,
      run_ref: body.run_ref || null,
      pipeline_status: body.pipeline_status || null,
      accepted: body.accepted || 0,
      created: body.created || 0,
      updated: body.updated || 0,
      rejected: body.rejected || 0,
      canonical_resolved: Boolean(body.canonical_resolved),
      transient_retries: transientRetries,
      discovery: discoverySummary(discoveryPlan),
    };
  } finally {
    if (locked) await releaseSourceLock(lockClient, sourceRef);
    lockClient.release();
  }
}

async function setSourceActive(sourceRef, active, { runNow = true } = {}) {
  await refreshRegisteredPullSources();
  const source = await requireSource(sourceRef);
  const automation = automationBySourceRef(sourceRef);

  if (active) {
    if (source.status !== 'active') {
      throw new SourcingSourceAutopilotError(409, 'Source désactivée au niveau lifecycle', 'sourcing_source_lifecycle_disabled');
    }
    if (!runtimeEnabled()) {
      throw new SourcingSourceAutopilotError(
        409,
        'Autopilot sourcing désactivé sur ce runtime',
        'sourcing_autopilot_runtime_disabled'
      );
    }
    if (!providerPolicy.canRunAutomaticImport(source)) {
      throw new SourcingSourceAutopilotError(409, 'Capacités Discovery/Sync/Import/Production non autorisées', 'provider_capability_policy_off');
    }
    if (!automation) {
      throw new SourcingSourceAutopilotError(409, 'Source sans contrat d’autopull', 'sourcing_autopull_unavailable');
    }
    if (!automation.connector_ready) {
      throw new SourcingSourceAutopilotError(
        409,
        automation.reason || 'Connecteur source non prêt',
        'sourcing_connector_not_ready'
      );
    }
  }

  await db.query(
    `UPDATE sourcing_sources
        SET autopilot_enabled = $2, updated_at = NOW()
      WHERE source_id = $1`,
    [source.source_ref, Boolean(active)]
  );

  const state = { source_ref: source.source_ref, autopilot_enabled: Boolean(active) };
  if (active && runNow) state.first_run = await runSourceOnce(source.source_ref, { reason: 'activation' });
  return state;
}

async function runActiveSources({ limit = DEFAULT_BATCH_LIMIT, reason = 'scheduled' } = {}) {
  if (!runtimeEnabled()) return { status: 'disabled', scanned_sources: 0, results: [] };
  await refreshRegisteredPullSources();
  const boundedLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_BATCH_LIMIT, 50));
  const { rows } = await db.query(
    `SELECT source_id AS source_ref
       FROM sourcing_sources
      WHERE status = 'active'
        AND autopilot_enabled = true
        AND discovery_enabled = true AND sync_enabled = true AND import_enabled = true AND production_enabled = true
        AND production_certified_capture_id IS NOT NULL
        AND production_certified_at IS NOT NULL
        AND acquisition = 'pull'
        AND continuity = 'recurring'
      ORDER BY updated_at ASC, source_id ASC
      LIMIT $1`,
    [boundedLimit]
  );

  const results = [];
  for (const row of rows) {
    results.push(await runSourceOnce(row.source_ref, { reason }));
  }
  return { status: 'ok', scanned_sources: rows.length, results };
}

module.exports = {
  SourcingSourceAutopilotError,
  runtimeEnabled,
  refreshRegisteredPullSources,
  descriptorSourceRef,
  listSources,
  requireSource,
  setSourceActive,
  runSourceImportNow,
  runSourceOnce,
  runActiveSources,
  _descriptorSourceRef: descriptorSourceRef,
  _automationBySourceRef: automationBySourceRef,
  _buildImportBody: buildImportBody,
  _resolveDiscoveryPlan: resolveDiscoveryPlan,
  _discoverySummary: discoverySummary,
  _recordSyntheticCapture: recordSyntheticCapture,
  _isTransientImportResult: isTransientImportResult,
};
