/**
 * @komerce-arch
 * @role          sourcing-source-autopilot
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        sourcing_sources_status, connector_automation_registry
 * @outputs       recurring_source_imports, source_runtime_projection
 * @depends       db.js, services/sourcing-import-dispatch.js, services/suppliers/catalog-import-orchestrator.js, services/sourcing-observation-shadow-service.js
 * @used-by       services/sourcing-workspace.js, scripts/sourcing-source-autopilot.js
 * @db-read       sourcing_sources, sourcing_captures
 * @db-write      sourcing_sources, sourcing_captures
 * @db-write-via:catalog-import-orchestrator supplier_catalog_imports, sourcing_candidates, sourcing_sources, sourcing_source_provides, sourcing_captures, sourcing_observations
 * @db-txn        advisory_lock_per_source
 * @doctrine      source_on_means_active_recurring_acquisition, provider_agnostic_runner, bounded_pull, fail_closed_connector_readiness
 * @impact-areas  sourcing, catalog, supplier-import
 * @version       2026-09
 */
'use strict';

const crypto = require('crypto');
const db = require('../db');
const importDispatch = require('./sourcing-import-dispatch');
const catalogImport = require('./suppliers/catalog-import-orchestrator');
const { buildSourceDescriptor } = require('./sourcing-observation-shadow-service');

const LOCK_NAMESPACE = 'komerce:sourcing-source-autopilot';
const DEFAULT_BATCH_LIMIT = 10;

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

async function ensureRegisteredPullSources(q = db) {
  const descriptors = importDispatch.sourceAutomationCatalog();
  const registered = [];
  for (const descriptor of descriptors) {
    const sourceRef = descriptorSourceRef(descriptor);
    await q.query(
      `INSERT INTO sourcing_sources
         (source_id, adapter_type, acquisition, continuity, status)
       VALUES ($1, $2, 'pull', 'recurring', 'disabled')
       ON CONFLICT (source_id) DO UPDATE
         SET adapter_type = EXCLUDED.adapter_type,
             acquisition = EXCLUDED.acquisition,
             continuity = EXCLUDED.continuity,
             updated_at = NOW()`,
      [sourceRef, descriptor.adapter]
    );
    registered.push(sourceRef);
  }
  return registered;
}

async function listSources(q = db) {
  await ensureRegisteredPullSources(q);
  const { rows } = await q.query(
    `SELECT s.source_id AS source_ref,
            s.adapter_type,
            s.acquisition,
            s.continuity,
            s.status,
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
      label: automation?.label || row.adapter_type,
      supplier_name: automation?.supplier_name || null,
      connector_ready: Boolean(automation?.connector_ready),
      connector_reason: automation?.connector_ready ? null : (automation?.reason || 'connecteur non enregistré'),
      runtime_enabled: runtimeEnabled(),
    };
  });
}

async function requireSource(sourceRef, q = db) {
  const { rows: [row] } = await q.query(
    `SELECT source_id AS source_ref, adapter_type, acquisition, continuity, status
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

function buildImportBody(source, automation, reason) {
  return {
    source_type: 'api',
    supplier_id: source.adapter_type,
    supplier_name: automation.supplier_name,
    notes: `source-autopilot:${reason || 'scheduled'}`,
    is_full_snapshot: false,
    ...automation.pull_options,
  };
}

async function runSourceOnce(sourceRef, { reason = 'scheduled' } = {}) {
  if (!runtimeEnabled()) {
    return { status: 'skipped', source_ref: sourceRef, reason: 'runtime_disabled' };
  }

  await ensureRegisteredPullSources();
  const source = await requireSource(sourceRef);
  if (source.status !== 'active') {
    return { status: 'skipped', source_ref: sourceRef, reason: 'source_disabled' };
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

    const result = await catalogImport.importCatalog(
      buildImportBody(source, automation, reason),
      null,
      importDispatch.dispatchToConnector
    );

    if (result.status >= 400) {
      const empty = result.status === 400 && result.body?.error === 'Aucun produit valide trouvé';
      await recordSyntheticCapture(sourceRef, empty ? 'complete' : 'failed', {
        autopilot: true,
        reason,
        outcome: empty ? 'empty' : 'failed',
        error: result.body?.error || `HTTP ${result.status}`,
        rejected: result.body?.invalid?.length || result.body?.rejected || 0,
      });
      return {
        status: empty ? 'empty' : 'failed',
        source_ref: sourceRef,
        code: empty ? null : 'import_failed',
        error: result.body?.error || null,
      };
    }

    const body = result.body || {};
    if (body.shadow_ingestion?.status === 'failed') {
      await recordSyntheticCapture(sourceRef, 'partial', {
        autopilot: true,
        reason,
        outcome: 'imported_shadow_failed',
        accepted: body.accepted || 0,
        rejected: body.rejected || 0,
        shadow_code: body.shadow_ingestion.code || null,
      });
    }

    return {
      status: 'ok',
      source_ref: sourceRef,
      supplier_name: automation.supplier_name,
      accepted: body.accepted || 0,
      created: body.created || 0,
      updated: body.updated || 0,
      rejected: body.rejected || 0,
      shadow_status: body.shadow_ingestion?.status || null,
    };
  } catch (err) {
    await recordSyntheticCapture(sourceRef, 'failed', {
      autopilot: true,
      reason,
      outcome: 'exception',
      error: boundedError(err),
    }).catch(() => {});
    return { status: 'failed', source_ref: sourceRef, code: 'autopilot_exception', error: boundedError(err) };
  } finally {
    if (locked) await releaseSourceLock(lockClient, sourceRef);
    lockClient.release();
  }
}

async function setSourceActive(sourceRef, active, { runNow = true } = {}) {
  await ensureRegisteredPullSources();
  const source = await requireSource(sourceRef);
  const automation = automationBySourceRef(sourceRef);

  if (active) {
    if (!runtimeEnabled()) {
      throw new SourcingSourceAutopilotError(
        409,
        'Autopilot sourcing désactivé sur ce runtime',
        'sourcing_autopilot_runtime_disabled'
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
  }

  await db.query(
    `UPDATE sourcing_sources
        SET status = $2, updated_at = NOW()
      WHERE source_id = $1`,
    [source.source_ref, active ? 'active' : 'disabled']
  );

  const state = { source_ref: source.source_ref, status: active ? 'active' : 'disabled' };
  if (active && runNow) state.first_run = await runSourceOnce(source.source_ref, { reason: 'activation' });
  return state;
}

async function runActiveSources({ limit = DEFAULT_BATCH_LIMIT, reason = 'scheduled' } = {}) {
  if (!runtimeEnabled()) return { status: 'disabled', scanned_sources: 0, results: [] };
  await ensureRegisteredPullSources();
  const boundedLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_BATCH_LIMIT, 50));
  const { rows } = await db.query(
    `SELECT source_id AS source_ref
       FROM sourcing_sources
      WHERE status = 'active'
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
  ensureRegisteredPullSources,
  listSources,
  requireSource,
  setSourceActive,
  runSourceOnce,
  runActiveSources,
  _descriptorSourceRef: descriptorSourceRef,
  _automationBySourceRef: automationBySourceRef,
  _buildImportBody: buildImportBody,
  _recordSyntheticCapture: recordSyntheticCapture,
};
