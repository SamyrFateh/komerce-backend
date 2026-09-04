#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cj-catalog-pool-sync-worker
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        CJ_API_KEY, DATABASE_URL, KOMERCE_ALLOW_CJ_FULL_SYNC
 * @outputs       resumable clean CJ sourcing pool capped at 1000 products
 * @depends       db.js, services/suppliers/cj-catalog-index.js, services/suppliers/connectors/cj-connector.js, services/suppliers/catalog-import-orchestrator.js, services/suppliers/catalog-sync-checkpoint.js
 * @used-by       Railway one-shot/scheduled worker
 * @db-read       supplier_catalog_sync_checkpoints, sourcing_candidates
 * @db-write      supplier_catalog_sync_checkpoints, supplier_catalog_imports, sourcing_candidates, sourcing_candidate_events
 * @db-txn        canonical services own candidate writes
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md, docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, sourcing, supplier-import
 * @version       2026-09-v2
 */
'use strict';

const db = require('../db');
const cjConnector = require('../services/suppliers/connectors/cj-connector');
const cjCatalogIndex = require('../services/suppliers/cj-catalog-index');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const checkpoints = require('../services/suppliers/catalog-sync-checkpoint');

const SUPPLIER_NAME = 'CJdropshipping';
const DEFAULT_SYNC_KEY = 'cj-clean-pool-v1';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_API_CALLS = 500;
const DEFAULT_MAX_CLEAN_PRODUCTS = 1000;
const ABSOLUTE_MAX_CLEAN_PRODUCTS = 1000;
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
    maxCleanProducts: intEnv(
      'KOMERCE_CJ_SYNC_MAX_CLEAN_PRODUCTS',
      DEFAULT_MAX_CLEAN_PRODUCTS,
      1,
      ABSOLUTE_MAX_CLEAN_PRODUCTS,
      env
    ),
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
  return `cj-pool/${syncKey}/${categoryId}/page-${String(page).padStart(4, '0')}.json`;
}

function basicCleanProduct(product) {
  return Boolean(
    product?.supplier_product_id &&
    String(product.product_name || '').trim() &&
    /^https:\/\//i.test(String(product.image_url || '')) &&
    Number(product.purchase_price) > 0
  );
}

async function countCleanCandidates() {
  const { rows: [row] } = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM sourcing_candidates
      WHERE supplier_name = $1
        AND supplier_product_id IS NOT NULL
        AND state IN ('scanned', 'imported_to_catalog')
        AND COALESCE(product_name, '') <> ''
        AND image_url ~ '^https://'
        AND purchase_price IS NOT NULL
        AND purchase_price > 0`,
    [SUPPLIER_NAME]
  );
  return Number(row?.count || 0);
}

async function loadSeenSupplierIds() {
  const { rows } = await db.query(
    `SELECT supplier_product_id
       FROM sourcing_candidates
      WHERE supplier_name = $1
        AND supplier_product_id IS NOT NULL`,
    [SUPPLIER_NAME]
  );
  return new Set(rows.map((row) => row.supplier_product_id).filter(Boolean));
}

async function importFetchedSubset({ syncKey, category, page, subset }) {
  if (!subset.length) return { accepted: 0, rejected: 0, import_id: null };
  const body = {
    supplier_name: SUPPLIER_NAME,
    source_type: 'api',
    source_filename: importSourceFilename(syncKey, category.category_id, page),
    notes: `CJ clean pool ${syncKey} — ${category.path} — page ${page}`,
  };
  const dispatchSubset = async () => ({
    products: subset,
    invalid: [],
    total: subset.length,
  });
  const result = await catalogImportOrchestrator.importCatalog(body, null, dispatchSubset);
  if (result.status !== 200) {
    throw new Error(`CJ import ${category.category_id}/p${page} refusé (${result.status}): ${JSON.stringify(result.body).slice(0, 1000)}`);
  }
  return result.body;
}

async function syncCategory(category, config, budget, seenIds) {
  let checkpoint = await checkpoints.getCheckpoint(db, {
    supplierName: SUPPLIER_NAME,
    syncKey: config.syncKey,
    categoryId: category.category_id,
  });
  if (checkpoint?.completed) return { status: 'already-complete', pages: 0 };

  let page = Math.max(1, Number(checkpoint?.next_page) || 1);
  let totalPages = checkpoint?.total_pages == null ? null : Number(checkpoint.total_pages);
  let totalRecords = checkpoint?.total_records == null ? null : Number(checkpoint.total_records);
  let cappedBySupplier = Boolean(checkpoint?.capped_by_supplier);
  let pages = 0;

  while (totalPages == null || page <= totalPages) {
    if (budget.used >= config.maxApiCalls) return { status: 'budget-paused', pages };

    const beforeCount = await countCleanCandidates();
    const remaining = config.maxCleanProducts - beforeCount;
    if (remaining <= 0) return { status: 'target-reached', pages };

    let fetched;
    try {
      fetched = await cjConnector.fetchProducts({
        categoryId: category.category_id,
        page,
        size: config.pageSize,
      });
      budget.used += 1;
    } catch (error) {
      if (checkpoint) {
        await checkpoints.recordError(db, {
          supplierName: SUPPLIER_NAME,
          syncKey: config.syncKey,
          categoryId: category.category_id,
          error,
        });
      }
      if (isQuotaError(error)) return { status: 'quota-paused', pages };
      throw error;
    }

    if (totalPages == null) {
      totalRecords = Math.max(0, Number(fetched.total_records) || 0);
      totalPages = totalPagesFor(totalRecords, config.pageSize);
      cappedBySupplier = totalRecords >= CJ_RESULT_CAP;
      checkpoint = await checkpoints.ensureCheckpoint(db, {
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
        return { status: 'empty', pages };
      }
    }

    const cleanNew = (fetched.products || [])
      .filter(basicCleanProduct)
      .filter((product) => !seenIds.has(product.supplier_product_id));
    const subset = cleanNew.slice(0, remaining);
    const imported = await importFetchedSubset({
      syncKey: config.syncKey,
      category,
      page,
      subset,
    });
    for (const product of subset) seenIds.add(product.supplier_product_id);

    pages += 1;
    const afterCount = await countCleanCandidates();
    if (afterCount > config.maxCleanProducts) {
      throw new Error(`Cap CJ dépassé: ${afterCount}/${config.maxCleanProducts}`);
    }

    await checkpoints.recordPageSuccess(db, {
      supplierName: SUPPLIER_NAME,
      syncKey: config.syncKey,
      categoryId: category.category_id,
      page,
      totalPages,
      totalRecords,
      accepted: imported.accepted || 0,
      rejected: imported.rejected || 0,
      requestId: fetched.request_id || null,
      cappedBySupplier,
    });

    if (afterCount >= config.maxCleanProducts) return { status: 'target-reached', pages };
    page += 1;
  }

  return { status: cappedBySupplier ? 'complete-capped' : 'complete', pages };
}

async function runSync() {
  const config = runtimeConfig();
  const startingClean = await countCleanCandidates();
  if (startingClean > config.maxCleanProducts) {
    throw new Error(`Pool CJ déjà au-dessus du cap: ${startingClean}/${config.maxCleanProducts}`);
  }
  if (startingClean === config.maxCleanProducts) {
    const summary = await checkpoints.summarize(db, { supplierName: SUPPLIER_NAME, syncKey: config.syncKey });
    const output = { sync_key: config.syncKey, starting_clean: startingClean, final_clean: startingClean, target: config.maxCleanProducts, api_calls_this_run: 0, paused_reason: 'target-already-reached', checkpoint_summary: summary };
    console.log(`[cj-clean-pool] ${JSON.stringify(output)}`);
    return output;
  }

  const index = await cjCatalogIndex.fetchCategories();
  const seenIds = await loadSeenSupplierIds();
  const budget = { used: 0 };
  let visited = 0;
  let pausedReason = null;

  console.log(`[cj-clean-pool] categories=${index.total} start=${startingClean} target=${config.maxCleanProducts} pageSize=${config.pageSize} maxCalls=${config.maxApiCalls}`);

  for (const category of index.categories) {
    visited += 1;
    const result = await syncCategory(category, config, budget, seenIds);
    if (['target-reached', 'budget-paused', 'quota-paused'].includes(result.status)) {
      pausedReason = result.status;
      break;
    }
  }

  const finalClean = await countCleanCandidates();
  const summary = await checkpoints.summarize(db, {
    supplierName: SUPPLIER_NAME,
    syncKey: config.syncKey,
  });
  const output = {
    sync_key: config.syncKey,
    starting_clean: startingClean,
    final_clean: finalClean,
    target: config.maxCleanProducts,
    category_index_total: index.total,
    visited_this_run: visited,
    api_calls_this_run: budget.used,
    paused_reason: pausedReason,
    checkpoint_summary: summary,
    supplier_result_cap: CJ_RESULT_CAP,
  };
  if (finalClean > config.maxCleanProducts) {
    throw new Error(`Audit final CJ refusé: ${finalClean}/${config.maxCleanProducts}`);
  }
  console.log(`[cj-clean-pool] ${JSON.stringify(output)}`);
  return output;
}

if (require.main === module) {
  runSync()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`[cj-clean-pool] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    });
}

module.exports = {
  SUPPLIER_NAME,
  DEFAULT_SYNC_KEY,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_API_CALLS,
  DEFAULT_MAX_CLEAN_PRODUCTS,
  ABSOLUTE_MAX_CLEAN_PRODUCTS,
  CJ_RESULT_CAP,
  intEnv,
  runtimeConfig,
  isQuotaError,
  totalPagesFor,
  importSourceFilename,
  basicCleanProduct,
  runSync,
};
