/**
 * @komerce-arch
 * @role          supplier-catalog-sync-checkpoint-owner
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        supplier_sync_progress
 * @outputs       persisted_sync_checkpoint
 * @depends       none
 * @used-by       scripts/cj-full-catalog-sync.js
 * @db-read       supplier_catalog_sync_checkpoints
 * @db-write      supplier_catalog_sync_checkpoints
 * @db-txn        caller_owned
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, supplier-import
 * @version       2026-09-v1
 */
'use strict';

async function getCheckpoint(q, { supplierName, syncKey, categoryId }) {
  const { rows: [row] } = await q.query(
    `SELECT *
       FROM supplier_catalog_sync_checkpoints
      WHERE supplier_name = $1
        AND sync_key = $2
        AND category_id = $3`,
    [supplierName, syncKey, categoryId]
  );
  return row || null;
}

async function ensureCheckpoint(q, {
  supplierName,
  syncKey,
  categoryId,
  categoryPath = null,
  totalPages = null,
  totalRecords = null,
  cappedBySupplier = false,
}) {
  const { rows: [row] } = await q.query(
    `INSERT INTO supplier_catalog_sync_checkpoints
       (supplier_name, sync_key, category_id, category_path,
        total_pages, total_records, capped_by_supplier)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (supplier_name, sync_key, category_id)
     DO UPDATE SET
       category_path = COALESCE(EXCLUDED.category_path, supplier_catalog_sync_checkpoints.category_path),
       total_pages = COALESCE(EXCLUDED.total_pages, supplier_catalog_sync_checkpoints.total_pages),
       total_records = COALESCE(EXCLUDED.total_records, supplier_catalog_sync_checkpoints.total_records),
       capped_by_supplier = supplier_catalog_sync_checkpoints.capped_by_supplier OR EXCLUDED.capped_by_supplier,
       updated_at = NOW()
     RETURNING *`,
    [supplierName, syncKey, categoryId, categoryPath, totalPages, totalRecords, cappedBySupplier]
  );
  return row;
}

async function markComplete(q, {
  supplierName,
  syncKey,
  categoryId,
  totalPages = 0,
  totalRecords = 0,
  cappedBySupplier = false,
}) {
  const { rows: [row] } = await q.query(
    `UPDATE supplier_catalog_sync_checkpoints
        SET total_pages = $4,
            total_records = $5,
            capped_by_supplier = capped_by_supplier OR $6,
            completed = TRUE,
            last_error = NULL,
            last_synced_at = NOW(),
            updated_at = NOW()
      WHERE supplier_name = $1
        AND sync_key = $2
        AND category_id = $3
      RETURNING *`,
    [supplierName, syncKey, categoryId, totalPages, totalRecords, Boolean(cappedBySupplier)]
  );
  return row || null;
}

async function recordPageSuccess(q, {
  supplierName,
  syncKey,
  categoryId,
  page,
  totalPages,
  totalRecords,
  accepted = 0,
  rejected = 0,
  requestId = null,
  cappedBySupplier = false,
}) {
  const completed = Number(page) >= Number(totalPages || 0);
  const { rows: [row] } = await q.query(
    `UPDATE supplier_catalog_sync_checkpoints
        SET next_page = $4,
            total_pages = $5,
            total_records = $6,
            api_calls = api_calls + 1,
            accepted_items = accepted_items + $7,
            rejected_items = rejected_items + $8,
            capped_by_supplier = capped_by_supplier OR $9,
            completed = $10,
            last_request_id = $11,
            last_error = NULL,
            last_synced_at = NOW(),
            updated_at = NOW()
      WHERE supplier_name = $1
        AND sync_key = $2
        AND category_id = $3
      RETURNING *`,
    [
      supplierName,
      syncKey,
      categoryId,
      Math.max(1, Number(page) + 1),
      totalPages,
      totalRecords,
      Math.max(0, Number(accepted) || 0),
      Math.max(0, Number(rejected) || 0),
      Boolean(cappedBySupplier),
      completed,
      requestId,
    ]
  );
  return row || null;
}

async function recordError(q, { supplierName, syncKey, categoryId, error }) {
  await q.query(
    `UPDATE supplier_catalog_sync_checkpoints
        SET last_error = $4,
            updated_at = NOW()
      WHERE supplier_name = $1
        AND sync_key = $2
        AND category_id = $3`,
    [supplierName, syncKey, categoryId, String(error || '').slice(0, 2000)]
  );
}

async function summarize(q, { supplierName, syncKey }) {
  const { rows: [row] } = await q.query(
    `SELECT
       COUNT(*)::int AS categories,
       COUNT(*) FILTER (WHERE completed)::int AS completed_categories,
       COUNT(*) FILTER (WHERE capped_by_supplier)::int AS capped_categories,
       COALESCE(SUM(api_calls), 0)::int AS api_calls,
       COALESCE(SUM(accepted_items), 0)::int AS accepted_items,
       COALESCE(SUM(rejected_items), 0)::int AS rejected_items,
       COALESCE(SUM(total_records), 0)::bigint AS announced_records
       FROM supplier_catalog_sync_checkpoints
      WHERE supplier_name = $1
        AND sync_key = $2`,
    [supplierName, syncKey]
  );
  return row;
}

module.exports = {
  getCheckpoint,
  ensureCheckpoint,
  markComplete,
  recordPageSuccess,
  recordError,
  summarize,
};
