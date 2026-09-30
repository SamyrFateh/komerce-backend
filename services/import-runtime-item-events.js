/**
 * @komerce-arch
 * @role          import-runtime-item-events
 * @domain        sourcing
 * @layer         service
 * @criticality   medium
 * @inputs        catalog-import-orchestrator (début / fin de traitement d'un produit)
 * @outputs       import_runtime_item_events
 * @depends       db.js
 * @used-by       services/suppliers/catalog-import-orchestrator.js, services/import-runtime-runs.js
 * @db-read       import_runtime_item_events
 * @db-write      import_runtime_item_events
 * @db-txn        none
 * @doctrine      dashboard_observes_server_truth, no_parallel_accounting, best_effort_telemetry_never_fails_import
 * @impact-areas  sourcing, admin-dashboard
 * @version       2026-09
 */
'use strict';

const db = require('../db');

const LIST_LIMIT_DEFAULT = 12;
const CHANGE_KINDS = new Set(['created', 'updated']);

function text(value, max = 300) {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out ? out.slice(0, max) : null;
}

function price(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Ouvre l'événement d'un produit au moment où son traitement commence.
 * Le produit peut ne pas encore exister en base : on garde un instantané d'affichage.
 */
async function startItem(runId, { seq, product = {} } = {}, q = db) {
  const n = Number(seq);
  if (!runId || !Number.isInteger(n) || n < 1) {
    throw new Error('IMPORT_RUNTIME_ITEM_START_INVALID');
  }
  const { rows } = await q.query(
    `INSERT INTO import_runtime_item_events
       (run_id, seq, supplier_product_id, product_name, image_url, purchase_price, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (run_id, seq) DO NOTHING
     RETURNING id`,
    [
      runId,
      n,
      text(product.supplier_product_id, 200),
      text(product.product_name, 300),
      text(product.image_url, 1000),
      price(product.purchase_price),
      text(product.currency, 8),
    ]
  );
  return rows[0] || null;
}

/** Ferme l'événement : fin de traitement, issue, et lien vers le candidat s'il existe. */
async function finishItem(eventId, { outcome = null, candidateId = null, changeKind = null } = {}, q = db) {
  if (!eventId) return null;
  const { rows } = await q.query(
    `UPDATE import_runtime_item_events
        SET finished_at = GREATEST(NOW(), started_at),
            outcome = $2,
            candidate_id = COALESCE($3, candidate_id),
            change_kind = $4
      WHERE id = $1
      RETURNING id`,
    [eventId, text(outcome, 60), candidateId || null, CHANGE_KINDS.has(changeKind) ? changeKind : null]
  );
  return rows[0] || null;
}

/** Derniers événements d'un run, du plus récent au plus ancien. */
async function listRunItems(runId, { limit = LIST_LIMIT_DEFAULT } = {}, q = db) {
  const capped = Math.max(1, Math.min(50, Number(limit) || LIST_LIMIT_DEFAULT));
  const { rows } = await q.query(
    `SELECT id, seq, supplier_product_id, product_name, image_url,
            purchase_price, currency, stage, outcome, change_kind, started_at, finished_at
       FROM import_runtime_item_events
      WHERE run_id = $1
      ORDER BY seq DESC
      LIMIT $2`,
    [runId, capped]
  );
  return rows;
}

module.exports = { startItem, finishItem, listRunItems };
