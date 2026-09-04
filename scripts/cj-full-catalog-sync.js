#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cj-full-catalog-sync-worker
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        CJ_API_KEY, DATABASE_URL, KOMERCE_ALLOW_CJ_FULL_SYNC
 * @outputs       resumable CJ sourcing_candidates catalog mirror
 * @depends       db.js, services/suppliers/cj-catalog-index.js, services/suppliers/connectors/cj-connector.js, services/suppliers/catalog-import-orchestrator.js, services/sourcing-import-dispatch.js, services/suppliers/catalog-sync-checkpoint.js
 * @used-by       Railway scheduled worker
 * @db-read       supplier_catalog_sync_checkpoints, sourcing_candidates
 * @db-write      supplier_catalog_sync_checkpoints, supplier_catalog_imports, sourcing_candidates, sourcing_candidate_events
 * @db-txn        canonical services own candidate writes
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md, docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, sourcing, supplier-import
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');
const cjConnector = require('../services/suppliers/connectors/cj-connector');
const cjCatalogIndex = require('../services/suppliers/cj-catalog-index');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const { dispatchToConnector } = require('../services/sourcing-import-dispatch');
const checkpoints = require('../services/suppliers/catalog-sync-checkpoint');

const SUPPLIER_NAME = 'CJdropshipping';
const SUPPLIER_ID = 'cj';
const DEFAULT_SYNC_KEY = 'cj-full-v1';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_API_CALLS = 500;
const CJ_RESULT_CAP = 6000;

function intEnv(name, fallback, min, max, env = process.env) {
  const raw = env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} doit être un entier entre ${min} et ${max}`);
  }
  return n;
}

function runtimeConfig(env = process.env) {
  if (env.KOMERCE_ALLOW_CJ_FULL_SYNC !== '1') {
    throw new Error('KOMERCE_ALLOW_CJ_FULL_SYNC=1 requis');
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (!env.CJ_API_KEY && !env.CJ_ACCESS_TOKEN) {
    throw new Error('CJ_API_KEY ou CJ_ACCESS_TOKEN requis');
  }
  return {
    syncKey: String(env.KOMERCE_CJ_SYNC_KEY || DEFAULT_SYNC_KEY).trim() || DEFAULT_SYNC_KEY,
    pageSize: intEnv('KOMERCE_CJ_SYNC_PAGE_SIZE', DEFAULT_PAGE_SIZE, 1, 100, env),
    maxApiCalls: intEnv('KOMERCE_CJ_SYNC_MAX_API_CALLS', DEFAULT_MAX_API_CALLS, 1, 1000, env),
  };
}

function isQuotaError(error) {
  return /(?:HTTP\s*)?429|insufficient api points|too many requests|rate.?limit/i.test(String(error?.message || error || ''));
}

function totalPagesFor(totalRecords, pageSize) {
  const total = Math.max(0, Number(totalRecords) || 0);
  return total === 0 ? 0 : Math.ceil(total / pageSize);
}

function importSourceFilename(syncKey, categoryId, page) {
  return `cj-full/${syncKey}/${categoryId}/page-${String(page).padStart(4, '0')}.json`;
}

async function importPage({ syncKey, category, page, pageSize }) {
  const body = {
    supplier_name: SUPPLIER_NAME,
    supplier_id: SUPPLIER_ID,
    source_type: 'api',
    category_id: category.category_id,
    page,
    size: pageSize,
    source_filename: importSourceFilename(syncKey, category.category_id, page),
    notes: `CJ full catalog sync ${syncKey} — ${category.path} — page ${page}`,
  };
  const result = await catalogImportOrchestrator.importCatalog(body, null, dispatchToConnector);
  if (result.status !== 200) {
    throw new Error(`CJ import ${category.category_id}/p${page} refusé (${result.status}): ${JSON.stringify(result.body).slice(0, 1000)}`);
  }
  return result.body;
}

async function discoverCategory(category, config, budget) {
  if (budget.used >= config.maxApiCalls) return { paused: true };
  const result = await cjConnector.fetchProducts({
    categoryId: category.category_id,
    page: 1,
    size: config.pageSize,
  });
  budget.used += 1;
  const totalRecords = Math.max(0, Number(result.total_records) || 0);
  const totalPages = totalPagesFor(totalRecords, config.pageSize);
  const cappedBySupplier = totalRecords >= CJ_RESULT_CAP;
  const checkpoint = await checkpoints.ensureCheckpoint(db, {
    supplierName: SUPPLIER_NAME,
    syncKey: config.syncKey,
    categoryId: category.category_id,
    categoryPath: category.path,
    totalPages,
    totalRecords,
    cappedBySupplier,
  });
  if (totalPages === 0) {
    await checkpoints.markComplete(db, {
      supplierName: SUPPLIER_NAME,
      syncKey: config.syncKey,
      categoryId: category.category_id,
      totalPages: 0,
      totalRecords: 0,
      cappedBySupplier,
    });
  }
  return { checkpoint, totalPages, totalRecords, cappedBySupplier, paused: false };
}

async function syncCategory(category, config, budget) {
  let checkpoint = await checkpoints.getCheckpoint(db, {
    supplierName: SUPPLIER_NAME,
    syncKey: config.syncKey,
    categoryId: category.category_id,
  });
  if (checkpoint?.completed) return { status: 'already-complete', pages: 0 };

  let totalPages = Number(checkpoint?.total_pages);
  let totalRecords = Number(checkpoint?.total_records);
  let cappedBySupplier = Boolean(checkpoint?.capped_by_supplier);

  if (!checkpoint || !Number.isFinite(totalPages)) {
    let discovered;
    try {
      discovered = await discoverCategory(category, config, budget);
    } catch (error) {
      if (checkpoint) await checkpoints.recordError(db, {
        supplierName: SUPPLIER_NAME,
        syncKey: config.syncKey,
        categoryId: category.category_id,
        error,
      });
      if (isQuotaError(error)) return { status: 'quota-paused', pages: 0 };
      throw error;
    }
    if (discovered.paused) return { status: 'budget-paused', pages: 0 };
    checkpoint = discovered.checkpoint;
    totalPages = discovered.totalPages;
    totalRecords = discovered.totalRecords;
    cappedBySupplier = discovered.cappedBySupplier;
    if (totalPages === 0) return { status: 'empty', pages: 0 };
  }

  let page = Math.max(1, Number(checkpoint?.next_page) || 1);
  let pages = 0;
  while (page <= totalPages) {
    if (budget.used >= config.maxApiCalls) return { status: 'budget-paused', pages };
    try {
      const result = await importPage({ syncKey: config.syncKey, category, page, pageSize: config.pageSize });
      budget.used += 1;
      pages += 1;
      await checkpoints.recordPageSuccess(db, {
        supplierName: SUPPLIER_NAME,
        syncKey: config.syncKey,
        categoryId: category.category_id,
        page,
        totalPages,
        totalRecords,
        accepted: result.accepted || 0,
        rejected: result.rejected || 0,
        requestId: null,
        cappedBySupplier,
      });
      page += 1;
    } catch (error) {
      await checkpoints.recordError(db, {
        supplierName: SUPPLIER_NAME,
        syncKey: config.syncKey,
        categoryId: category.category_id,
        error,
      });
      if (isQuotaError(error)) return { status: 'quota-paused', pages };
      throw error;
    }
  }
  return { status: cappedBySupplier ? 'complete-capped' : 'complete', pages };
}

async function runSync() {
  const config = runtimeConfig();
  const index = await cjCatalogIndex.fetchCategories();
  const budget = { used: 0 };
  let visited = 0;
  let completedThisRun = 0;
  let pausedReason = null;

  console.log(`[cj-full-sync] categories=${index.total} sync=${config.syncKey} pageSize=${config.pageSize} maxCalls=${config.maxApiCalls}`);

  for (const category of index.categories) {
    visited += 1;
    const result = await syncCategory(category, config, budget);
    if (result.status === 'complete' || result.status === 'complete-capped' || result.status === 'empty') {
      completedThisRun += 1;
    }
    if (result.status === 'budget-paused' || result.status === 'quota-paused') {
      pausedReason = result.status;
      break;
    }
  }

  const summary = await checkpoints.summarize(db, {
    supplierName: SUPPLIER_NAME,
    syncKey: config.syncKey,
  });
  const output = {
    sync_key: config.syncKey,
    category_index_total: index.total,
    visited_this_run: visited,
    completed_this_run: completedThisRun,
    api_calls_this_run: budget.used,
    paused_reason: pausedReason,
    checkpoint_summary: summary,
    supplier_result_cap: CJ_RESULT_CAP,
    fully_complete_without_caps: Number(summary?.completed_categories || 0) >= index.total && Number(summary?.capped_categories || 0) === 0,
  };
  console.log(`[cj-full-sync] ${JSON.stringify(output)}`);
  return output;
}

if (require.main === module) {
  runSync()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`[cj-full-sync] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    });
}

module.exports = {
  SUPPLIER_NAME,
  DEFAULT_SYNC_KEY,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_API_CALLS,
  CJ_RESULT_CAP,
  intEnv,
  runtimeConfig,
  isQuotaError,
  totalPagesFor,
  importSourceFilename,
  runSync,
};
