/**
 * @komerce-arch
 * @role          sourcing-catalogue-handoff
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        completed_supplier_catalog_import
 * @outputs       inactive_catalogue_drafts, runtime_handoff_projection
 * @depends       db.js, services/sourcing-certification.js, services/sourcing-candidate-actions.js, services/import-runtime-runs.js
 * @db-read       sourcing_candidates, import_runtime_runs
 * @db-write-via:sourcing-candidate-actions sourcing_candidates, sourcing_candidate_events, products, catalog_media, product_variants, product_skus, product_sku_media
 * @db-write-via:import-runtime-runs import_runtime_runs
 * @doctrine      sourcing_certified_auto_handoff, draft_has_no_market_price, publication_owns_price_decision
 * @impact-areas  sourcing, catalog, pricing
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const certification = require('./sourcing-certification');
const candidateActions = require('./sourcing-candidate-actions');
const importRuns = require('./import-runtime-runs');

class SourcingCatalogueHandoffError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'SourcingCatalogueHandoffError';
    this.status = 500;
    this.code = 'sourcing_catalogue_handoff_failed';
    this.details = details;
  }
}

async function candidateRows(importId, q = db) {
  const { rows } = await q.query(
    `SELECT id, state, product_id, supplier_name, supplier_product_id,
            raw_payload, normalized_source_contract, scan_result,
            rejected_reason, promotion_status, promotion_reasons, findings
       FROM sourcing_candidates
      WHERE import_id = $1
      ORDER BY created_at, id`,
    [importId]
  );
  return rows;
}

async function failRunsForImport(importId, count, q = db) {
  const { rows } = await q.query(
    `SELECT id
       FROM import_runtime_runs
      WHERE import_id = $1
        AND status <> 'FAILED'`,
    [importId]
  );
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    await importRuns.failRun(row.id, `catalogue_handoff_failed:${count}`, q);
  }
}

async function handoffCertifiedImport(importId, {
  actorId = null,
  q = db,
  promoteCandidate = candidateActions.promoteCandidate,
} = {}) {
  if (!importId) {
    return { attempted:0, catalogued:0, already_catalogued:0, failed:[] };
  }

  const rows = await candidateRows(importId, q);
  const ready = [];
  let alreadyCatalogued = 0;

  for (const row of rows) {
    const verdict = certification.evaluateSourcingCandidateOutcome(row);
    if (!verdict.outcome_valid || !verdict.sourcing_certified) continue;
    if (row.state === 'imported_to_catalog' && row.product_id) {
      alreadyCatalogued += 1;
      continue;
    }
    ready.push(row);
  }

  const summary = {
    attempted: ready.length,
    catalogued: 0,
    already_catalogued: alreadyCatalogued,
    failed: [],
  };

  for (const row of ready) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await promoteCandidate(
        row.id,
        { enrichment_mode:'source_only' },
        actorId,
        { syncRuntime:false }
      );
      summary.catalogued += 1;
    } catch (error) {
      if (error?.code === 'candidate_already_promoted') {
        summary.already_catalogued += 1;
        continue;
      }
      summary.failed.push({
        candidate_id: row.id,
        supplier_product_id: row.supplier_product_id || null,
        code: error?.code || 'catalogue_handoff_failed',
        error: String(error?.message || error).slice(0, 300),
      });
    }
  }

  if (summary.failed.length) {
    await failRunsForImport(importId, summary.failed.length, q);
    throw new SourcingCatalogueHandoffError(
      `Remise automatique au Catalogue incomplète : ${summary.failed.length} produit(s) bloqué(s)`,
      summary
    );
  }

  await importRuns.syncRunsForImport(importId, q);
  return summary;
}

async function handoffImportResult(result, actorId = null, options = {}) {
  if (!result || Number(result.status) >= 400 || !result.body?.import_id) return result;
  const summary = await handoffCertifiedImport(result.body.import_id, {
    actorId,
    ...options,
  });
  return {
    ...result,
    body: {
      ...(result.body || {}),
      catalogue_handoff: summary,
    },
  };
}

module.exports = {
  SourcingCatalogueHandoffError,
  candidateRows,
  handoffCertifiedImport,
  handoffImportResult,
};
