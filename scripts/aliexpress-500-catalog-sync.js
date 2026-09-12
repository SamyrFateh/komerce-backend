#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-catalog-pool-sync-worker
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        AliExpress Open Platform credentials/session, DATABASE_URL, KOMERCE_ALLOW_ALIEXPRESS_POOL_SYNC
 * @outputs       resumable clean AliExpress sourcing pool capped at 500 in-stock products
 * @depends       db.js, services/suppliers/connectors/aliexpress-connected-connector.js, services/suppliers/catalog-import-orchestrator.js, services/suppliers/catalog-sync-checkpoint.js
 * @used-by       Railway staging one-shot/scheduled worker
 * @db-read       supplier_catalog_sync_checkpoints, sourcing_candidates, supplier_oauth_connections
 * @db-write      supplier_catalog_sync_checkpoints, supplier_catalog_imports, sourcing_candidates, sourcing_candidate_events, supplier_oauth_connections (token refresh only)
 * @db-txn        canonical services own candidate writes
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md, docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, sourcing, supplier-import
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');
const aliexpressConnector = require('../services/suppliers/connectors/aliexpress-connected-connector');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const checkpoints = require('../services/suppliers/catalog-sync-checkpoint');

const SUPPLIER_NAME = 'AliExpress';
const DEFAULT_SYNC_KEY = 'aliexpress-instock-500-v1';
const DEFAULT_FEED_NAME = 'DS bestseller';
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_FEED_PAGES = 40;
const DEFAULT_MAX_CLEAN_PRODUCTS = 500;
const ABSOLUTE_MAX_CLEAN_PRODUCTS = 500;
const CHECKPOINT_CATEGORY_ID = 'feed:ds-bestseller';

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
  if (env.KOMERCE_ALLOW_ALIEXPRESS_POOL_SYNC !== '1') {
    throw new Error('KOMERCE_ALLOW_ALIEXPRESS_POOL_SYNC=1 requis');
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (!env.ALIEXPRESS_APP_KEY || !env.ALIEXPRESS_APP_SECRET) {
    throw new Error('ALIEXPRESS_APP_KEY et ALIEXPRESS_APP_SECRET requis');
  }
  if (!env.ALIEXPRESS_SESSION && !env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY) {
    throw new Error('ALIEXPRESS_SESSION ou ALIEXPRESS_TOKEN_ENCRYPTION_KEY requis');
  }

  return {
    syncKey: String(env.KOMERCE_ALIEXPRESS_SYNC_KEY || DEFAULT_SYNC_KEY).trim() || DEFAULT_SYNC_KEY,
    feedName: String(env.KOMERCE_ALIEXPRESS_FEED_NAME || DEFAULT_FEED_NAME).trim() || DEFAULT_FEED_NAME,
    pageSize: intEnv('KOMERCE_ALIEXPRESS_PAGE_SIZE', DEFAULT_PAGE_SIZE, 1, 50, env),
    maxFeedPages: intEnv('KOMERCE_ALIEXPRESS_MAX_FEED_PAGES', DEFAULT_MAX_FEED_PAGES, 1, 1000, env),
    maxCleanProducts: intEnv(
      'KOMERCE_ALIEXPRESS_MAX_CLEAN_PRODUCTS',
      DEFAULT_MAX_CLEAN_PRODUCTS,
      1,
      ABSOLUTE_MAX_CLEAN_PRODUCTS,
      env
    ),
  };
}

function positiveStock(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function basicCleanProduct(product) {
  if (!product?.supplier_product_id) return false;
  if (!String(product.product_name || '').trim()) return false;
  if (!/^https:\/\//i.test(String(product.image_url || ''))) return false;
  if (!(Number(product.purchase_price) > 0)) return false;
  if (!positiveStock(product.stock_available)) return false;

  const units = Array.isArray(product.sellable_units) ? product.sellable_units : [];
  if (units.length) {
    const hasInStockUnit = units.some((unit) => unit?.is_active !== false && positiveStock(unit?.stock_available));
    if (!hasInStockUnit) return false;
  }
  return true;
}

function totalPagesFor(totalRecords, pageSize, maxFeedPages = DEFAULT_MAX_FEED_PAGES) {
  const total = Math.max(0, Number(totalRecords) || 0);
  if (total === 0) return 0;
  return Math.min(Math.ceil(total / pageSize), maxFeedPages);
}

function importSourceFilename(syncKey, page) {
  return `aliexpress-pool/${syncKey}/page-${String(page).padStart(4, '0')}.json`;
}

function stockSqlPredicate(alias = 'sc') {
  return `(
    ${alias}.normalized_source_contract ? 'stock_available'
    AND (${alias}.normalized_source_contract->>'stock_available') ~ '^[0-9]+(?:\\.[0-9]+)?$'
    AND (${alias}.normalized_source_contract->>'stock_available')::numeric > 0
  )`;
}

async function countCleanCandidates() {
  const { rows: [row] } = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM sourcing_candidates sc
      WHERE sc.supplier_name = $1
        AND sc.supplier_product_id IS NOT NULL
        AND sc.state IN ('scanned', 'imported_to_catalog')
        AND COALESCE(sc.product_name, '') <> ''
        AND sc.image_url ~ '^https://'
        AND sc.purchase_price IS NOT NULL
        AND sc.purchase_price > 0
        AND ${stockSqlPredicate('sc')}`,
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

async function importFetchedSubset({ syncKey, page, subset }) {
  if (!subset.length) return { accepted: 0, rejected: 0, import_id: null };
  const body = {
    supplier_name: SUPPLIER_NAME,
    source_type: 'api',
    source_filename: importSourceFilename(syncKey, page),
    notes: `AliExpress in-stock pool ${syncKey} — page ${page}`,
  };
  const dispatchSubset = async () => ({
    products: subset,
    invalid: [],
    total: subset.length,
  });
  const result = await catalogImportOrchestrator.importCatalog(body, null, dispatchSubset);
  if (result.status !== 200) {
    throw new Error(`AliExpress import p${page} refusé (${result.status}): ${JSON.stringify(result.body).slice(0, 1000)}`);
  }
  return result.body;
}

async function runSync() {
  const config = runtimeConfig();
  const startingClean = await countCleanCandidates();
  if (startingClean > config.maxCleanProducts) {
    throw new Error(`Pool AliExpress déjà au-dessus du cap: ${startingClean}/${config.maxCleanProducts}`);
  }

  if (startingClean === config.maxCleanProducts) {
    const summary = await checkpoints.summarize(db, { supplierName: SUPPLIER_NAME, syncKey: config.syncKey });
    const output = {
      sync_key: config.syncKey,
      feed_name: config.feedName,
      starting_clean: startingClean,
      final_clean: startingClean,
      target: config.maxCleanProducts,
      feed_pages_this_run: 0,
      paused_reason: 'target-already-reached',
      checkpoint_summary: summary,
    };
    console.log(`[aliexpress-pool] ${JSON.stringify(output)}`);
    return output;
  }

  let checkpoint = await checkpoints.getCheckpoint(db, {
    supplierName: SUPPLIER_NAME,
    syncKey: config.syncKey,
    categoryId: CHECKPOINT_CATEGORY_ID,
  });
  let page = Math.max(1, Number(checkpoint?.next_page) || 1);
  let totalPages = checkpoint?.total_pages == null ? null : Number(checkpoint.total_pages);
  let totalRecords = checkpoint?.total_records == null ? null : Number(checkpoint.total_records);
  const seenIds = await loadSeenSupplierIds();
  let pages = 0;
  let pausedReason = null;

  console.log(`[aliexpress-pool] feed=${config.feedName} start=${startingClean} target=${config.maxCleanProducts} pageSize=${config.pageSize} maxPages=${config.maxFeedPages}`);

  while (page <= config.maxFeedPages && (totalPages == null || page <= totalPages)) {
    const beforeCount = await countCleanCandidates();
    const remaining = config.maxCleanProducts - beforeCount;
    if (remaining <= 0) {
      pausedReason = 'target-reached';
      break;
    }

    let fetched;
    try {
      fetched = await aliexpressConnector.fetchProducts({
        feed_name: config.feedName,
        page,
        page_size: config.pageSize,
      });
    } catch (error) {
      if (checkpoint) {
        await checkpoints.recordError(db, {
          supplierName: SUPPLIER_NAME,
          syncKey: config.syncKey,
          categoryId: CHECKPOINT_CATEGORY_ID,
          error,
        });
      }
      throw error;
    }

    if (totalPages == null) {
      totalRecords = Math.max(0, Number(fetched.total_records) || 0);
      totalPages = totalPagesFor(totalRecords, config.pageSize, config.maxFeedPages);
      checkpoint = await checkpoints.ensureCheckpoint(db, {
        supplierName: SUPPLIER_NAME,
        syncKey: config.syncKey,
        categoryId: CHECKPOINT_CATEGORY_ID,
        categoryPath: config.feedName,
        totalPages,
        totalRecords,
        cappedBySupplier: totalPages * config.pageSize < totalRecords,
      });
      if (totalPages === 0) {
        await checkpoints.markComplete(db, {
          supplierName: SUPPLIER_NAME,
          syncKey: config.syncKey,
          categoryId: CHECKPOINT_CATEGORY_ID,
          totalPages: 0,
          totalRecords: 0,
          cappedBySupplier: false,
        });
        pausedReason = 'feed-empty';
        break;
      }
    }

    const fetchedProducts = Array.isArray(fetched.products) ? fetched.products : [];
    const cleanNew = fetchedProducts
      .filter(basicCleanProduct)
      .filter((product) => !seenIds.has(product.supplier_product_id));
    const subset = cleanNew.slice(0, remaining);
    const imported = await importFetchedSubset({
      syncKey: config.syncKey,
      page,
      subset,
    });
    for (const product of subset) seenIds.add(product.supplier_product_id);

    const connectorInvalid = Array.isArray(fetched.invalid) ? fetched.invalid.length : 0;
    const filteredOut = Math.max(0, fetchedProducts.length - cleanNew.length);
    pages += 1;

    const afterCount = await countCleanCandidates();
    if (afterCount > config.maxCleanProducts) {
      throw new Error(`Cap AliExpress dépassé: ${afterCount}/${config.maxCleanProducts}`);
    }

    await checkpoints.recordPageSuccess(db, {
      supplierName: SUPPLIER_NAME,
      syncKey: config.syncKey,
      categoryId: CHECKPOINT_CATEGORY_ID,
      page,
      totalPages,
      totalRecords,
      accepted: imported.accepted || 0,
      rejected: (imported.rejected || 0) + connectorInvalid + filteredOut,
      requestId: fetched.request_id || null,
      cappedBySupplier: totalPages * config.pageSize < totalRecords,
    });

    if (afterCount >= config.maxCleanProducts) {
      pausedReason = 'target-reached';
      break;
    }
    page += 1;
  }

  const finalClean = await countCleanCandidates();
  if (!pausedReason) {
    pausedReason = finalClean >= config.maxCleanProducts
      ? 'target-reached'
      : (page > config.maxFeedPages ? 'page-budget-reached' : 'feed-exhausted');
  }
  const summary = await checkpoints.summarize(db, {
    supplierName: SUPPLIER_NAME,
    syncKey: config.syncKey,
  });
  const output = {
    sync_key: config.syncKey,
    feed_name: config.feedName,
    starting_clean: startingClean,
    final_clean: finalClean,
    target: config.maxCleanProducts,
    announced_records: totalRecords,
    feed_pages_this_run: pages,
    paused_reason: pausedReason,
    checkpoint_summary: summary,
  };
  if (finalClean > config.maxCleanProducts) {
    throw new Error(`Audit final AliExpress refusé: ${finalClean}/${config.maxCleanProducts}`);
  }
  console.log(`[aliexpress-pool] ${JSON.stringify(output)}`);
  return output;
}

if (require.main === module) {
  runSync()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`[aliexpress-pool] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    });
}

module.exports = {
  SUPPLIER_NAME,
  DEFAULT_SYNC_KEY,
  DEFAULT_FEED_NAME,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_FEED_PAGES,
  DEFAULT_MAX_CLEAN_PRODUCTS,
  ABSOLUTE_MAX_CLEAN_PRODUCTS,
  CHECKPOINT_CATEGORY_ID,
  intEnv,
  runtimeConfig,
  positiveStock,
  basicCleanProduct,
  totalPagesFor,
  importSourceFilename,
  stockSqlPredicate,
  runSync,
};
