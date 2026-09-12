#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-catalog-pool-topup-worker
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        existing AliExpress sourcing pool, AliExpress Open Platform credentials/session, DATABASE_URL
 * @outputs       diversified clean AliExpress sourcing top-up capped at 500 products
 * @depends       db.js, scripts/aliexpress-500-catalog-sync.js, services/suppliers/connectors/aliexpress-connected-connector.js, services/suppliers/connectors/aliexpress-connector.js, services/suppliers/catalog-import-orchestrator.js, services/suppliers/catalog-sync-checkpoint.js
 * @used-by       Railway staging one-shot worker after the primary 500-plan is exhausted
 * @db-read       supplier_catalog_sync_checkpoints, sourcing_candidates, supplier_oauth_connections
 * @db-write      supplier_catalog_sync_checkpoints, supplier_catalog_imports, sourcing_candidates, sourcing_candidate_events, supplier_oauth_connections (token refresh only)
 * @db-txn        canonical services own candidate writes; shared advisory lock serializes AliExpress pool workers
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md, docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, sourcing, supplier-import
 * @version       2026-09-v2
 */
'use strict';

const db = require('../db');
const primary = require('./aliexpress-500-catalog-sync');
const aliexpressConnector = require('../services/suppliers/connectors/aliexpress-connected-connector');
const aliexpressBaseConnector = require('../services/suppliers/connectors/aliexpress-connector');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const checkpoints = require('../services/suppliers/catalog-sync-checkpoint');

const TOPUP_ID = 'topup-diversified-v1';
const SEARCH_SORT = 'salesDesc';
const SEARCH_LOCALE = 'en_US';
const SEARCH_CURRENCY = 'USD';

// Deliberately broad fallbacks. The first entries target the structural shortfalls
// observed by the live v1 campaign; the rest spread any remaining top-up across
// productive families instead of filling the catalogue with a single category.
const TOPUP_QUERIES = Object.freeze([
  { keyword: 'gift', category: 'Créations personnelles', subcategory: 'Cadeau' },
  { keyword: 'wedding dress', category: 'Créations personnelles', subcategory: 'Cérémonie' },
  { keyword: 'mug', category: 'Créations personnelles', subcategory: 'Impression' },
  { keyword: 'photo frame', category: 'Créations personnelles', subcategory: 'Impression' },
  { keyword: 'car accessories', category: 'Auto', subcategory: 'Accessoires' },
  { keyword: 'motorcycle', category: 'Auto', subcategory: 'Moto' },
  { keyword: 'car light', category: 'Auto', subcategory: 'Éclairage' },
  { keyword: 'brake', category: 'Auto', subcategory: 'Freinage' },
  { keyword: 'oil filter', category: 'Auto', subcategory: 'Filtres' },
  { keyword: 'phone accessories', category: 'Tech', subcategory: 'Phones' },
  { keyword: 'wireless earbuds', category: 'Tech', subcategory: 'Audio' },
  { keyword: 'smartwatch accessories', category: 'Tech', subcategory: 'Montres' },
  { keyword: 'kitchen gadget', category: 'Maison', subcategory: 'Cuisine' },
  { keyword: 'home storage', category: 'Maison', subcategory: 'Confort' },
  { keyword: 'home decor', category: 'Maison', subcategory: 'Déco' },
  { keyword: 'beauty tools', category: 'Mode & Beauté', subcategory: 'Beauté' },
  { keyword: 'women accessories', category: 'Mode & Beauté', subcategory: 'Femme' },
  { keyword: 'men accessories', category: 'Mode & Beauté', subcategory: 'Homme' },
  { keyword: 'kids toys', category: 'Maison', subcategory: 'Enfants' },
  { keyword: 'hand tools', category: 'Bricolage', subcategory: 'Outillage' },
]);

function logicalTopupPage(logicalPage, queries = TOPUP_QUERIES) {
  const n = Number.parseInt(logicalPage, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error('logicalPage doit être >= 1');
  if (!Array.isArray(queries) || !queries.length) throw new Error('TOPUP_QUERIES vide');
  const queryIndex = (n - 1) % queries.length;
  return {
    ...queries[queryIndex],
    queryIndex,
    queryPage: Math.floor((n - 1) / queries.length) + 1,
  };
}

function topupCheckpointCategoryId() {
  return `text:${TOPUP_ID}`;
}

function topupSourceFilename(syncKey, logicalPage) {
  return `aliexpress-pool/${syncKey}/${TOPUP_ID}/page-${String(logicalPage).padStart(4, '0')}.json`;
}

function canResumeCompletedCheckpoint(checkpoint, maxLogicalPages) {
  if (!checkpoint?.completed) return false;
  const nextPage = Math.max(1, Number(checkpoint?.next_page) || 1);
  return nextPage <= Number(maxLogicalPages || 0);
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
        AND ${primary.stockSqlPredicate('sc')}`,
    [primary.SUPPLIER_NAME]
  );
  return Number(row?.count || 0);
}

async function loadSeenSupplierIds() {
  const { rows } = await db.query(
    `SELECT supplier_product_id
       FROM sourcing_candidates
      WHERE supplier_name = $1
        AND supplier_product_id IS NOT NULL`,
    [primary.SUPPLIER_NAME]
  );
  return new Set(rows.map((row) => row.supplier_product_id).filter(Boolean));
}

async function importFetchedSubset({ syncKey, logicalPage, subset, spec }) {
  if (!subset.length) return { accepted: 0, rejected: 0, import_id: null };
  const body = {
    supplier_name: primary.SUPPLIER_NAME,
    source_type: 'api',
    source_filename: topupSourceFilename(syncKey, logicalPage),
    notes: `AliExpress diversified top-up ${syncKey} — ${spec.category}/${spec.subcategory} — ${spec.keyword} — page ${logicalPage}`,
  };
  const dispatchSubset = async () => ({ products: subset, invalid: [], total: subset.length });
  const result = await catalogImportOrchestrator.importCatalog(body, null, dispatchSubset);
  if (result.status !== 200) {
    throw new Error(`AliExpress top-up p${logicalPage} refusé (${result.status}): ${JSON.stringify(result.body).slice(0, 1000)}`);
  }
  return result.body;
}

function discoverySegment(spec) {
  return {
    id: TOPUP_ID,
    category: spec.category,
    subcategory: spec.subcategory,
  };
}

async function runTopupLocked(config, providerEnv) {
  const startingClean = await countCleanCandidates();
  if (startingClean > config.maxCleanProducts) {
    throw new Error(`Pool AliExpress déjà au-dessus du cap: ${startingClean}/${config.maxCleanProducts}`);
  }
  if (startingClean >= config.maxCleanProducts) {
    const output = {
      runtime: config.runtime,
      sync_key: config.syncKey,
      starting_clean: startingClean,
      final_clean: startingClean,
      target: config.maxCleanProducts,
      added: 0,
      paused_reason: 'target-already-reached',
    };
    console.log(`[aliexpress-topup] ${JSON.stringify(output)}`);
    return output;
  }

  const categoryId = topupCheckpointCategoryId();
  const maxLogicalPages = TOPUP_QUERIES.length * config.maxSearchPagesPerQuery;
  let checkpoint = await checkpoints.getCheckpoint(db, {
    supplierName: primary.SUPPLIER_NAME,
    syncKey: config.syncKey,
    categoryId,
  });
  if (!checkpoint) {
    checkpoint = await checkpoints.ensureCheckpoint(db, {
      supplierName: primary.SUPPLIER_NAME,
      syncKey: config.syncKey,
      categoryId,
      categoryPath: 'Top-up diversifié / global',
      totalPages: maxLogicalPages,
      totalRecords: config.maxCleanProducts,
      cappedBySupplier: false,
    });
  }

  const resumeCompleted = canResumeCompletedCheckpoint(checkpoint, maxLogicalPages);
  if (checkpoint?.completed && !resumeCompleted) {
    const finalClean = await countCleanCandidates();
    const output = {
      runtime: config.runtime,
      sync_key: config.syncKey,
      starting_clean: startingClean,
      final_clean: finalClean,
      target: config.maxCleanProducts,
      added: finalClean - startingClean,
      pages_this_run: 0,
      paused_reason: finalClean >= config.maxCleanProducts ? 'target-reached' : 'topup-plan-exhausted',
    };
    console.log(`[aliexpress-topup] ${JSON.stringify(output)}`);
    return output;
  }

  const seenIds = await loadSeenSupplierIds();
  let logicalPage = Math.max(1, Number(checkpoint?.next_page) || 1);
  let pages = 0;

  console.log(`[aliexpress-topup] runtime=${config.runtime || 'unknown'} country=${config.countryCode} start=${startingClean} target=${config.maxCleanProducts} queries=${TOPUP_QUERIES.length} pagesPerQuery=${config.maxSearchPagesPerQuery}`);
  if (resumeCompleted) {
    console.log(`[aliexpress-topup] extend checkpoint next=${logicalPage} max=${maxLogicalPages}`);
  }

  while (logicalPage <= maxLogicalPages) {
    const before = await countCleanCandidates();
    const remaining = config.maxCleanProducts - before;
    if (remaining <= 0) break;

    const spec = logicalTopupPage(logicalPage);
    let searchPayload;
    try {
      searchPayload = await aliexpressBaseConnector.invokeTop('aliexpress.ds.text.search', {
        keyword: spec.keyword,
        countryCode: config.countryCode,
        currency: SEARCH_CURRENCY,
        local: SEARCH_LOCALE,
        page_size: config.pageSize,
        page_index: spec.queryPage,
        sort: SEARCH_SORT,
      }, { env: providerEnv });
    } catch (error) {
      await checkpoints.recordError(db, {
        supplierName: primary.SUPPLIER_NAME,
        syncKey: config.syncKey,
        categoryId,
        error,
      });
      throw error;
    }

    const productIds = primary.textSearchProductIds(searchPayload).filter((id) => !seenIds.has(id));
    let fetched = { products: [], invalid: [], total: 0 };
    if (productIds.length) {
      fetched = await primary.fetchProductsRateLimited(productIds, {
        countryCode: config.countryCode,
        providerEnv,
        detailDelayMs: config.detailDelayMs,
        detailRetryAttempts: config.detailRetryAttempts,
      });
    }

    const fetchedProducts = (Array.isArray(fetched.products) ? fetched.products : [])
      .map((product) => primary.withDiscoveryProvenance(product, {
        segment: discoverySegment(spec),
        keyword: spec.keyword,
        queryPage: spec.queryPage,
        countryCode: config.countryCode,
      }));
    const cleanNew = fetchedProducts
      .filter(primary.basicCleanProduct)
      .filter((product) => !seenIds.has(product.supplier_product_id));
    const subset = cleanNew.slice(0, remaining);
    const imported = await importFetchedSubset({
      syncKey: config.syncKey,
      logicalPage,
      subset,
      spec,
    });
    for (const product of subset) seenIds.add(product.supplier_product_id);

    const connectorInvalid = Array.isArray(fetched.invalid) ? fetched.invalid.length : 0;
    const filteredOut = Math.max(0, fetchedProducts.length - cleanNew.length);
    const after = await countCleanCandidates();
    if (after > config.maxCleanProducts) {
      throw new Error(`Cap AliExpress dépassé: ${after}/${config.maxCleanProducts}`);
    }

    checkpoint = await checkpoints.recordPageSuccess(db, {
      supplierName: primary.SUPPLIER_NAME,
      syncKey: config.syncKey,
      categoryId,
      page: logicalPage,
      totalPages: maxLogicalPages,
      totalRecords: config.maxCleanProducts,
      accepted: imported.accepted || 0,
      rejected: (imported.rejected || 0) + connectorInvalid + filteredOut,
      requestId: searchPayload?.request_id || null,
      cappedBySupplier: false,
    });
    pages += 1;

    if ((imported.accepted || 0) > 0) {
      console.log(`[aliexpress-topup] keyword=${JSON.stringify(spec.keyword)} queryPage=${spec.queryPage} added=${imported.accepted || 0} clean=${after}/${config.maxCleanProducts}`);
    }
    if (after >= config.maxCleanProducts) break;
    logicalPage += 1;
  }

  const finalClean = await countCleanCandidates();
  const output = {
    runtime: config.runtime,
    sync_key: config.syncKey,
    discovery: 'aliexpress.ds.text.search',
    country_code: config.countryCode,
    starting_clean: startingClean,
    final_clean: finalClean,
    target: config.maxCleanProducts,
    added: finalClean - startingClean,
    pages_this_run: pages,
    paused_reason: finalClean >= config.maxCleanProducts ? 'target-reached' : 'topup-plan-exhausted',
  };
  console.log(`[aliexpress-topup] ${JSON.stringify(output)}`);
  return output;
}

async function runTopup() {
  const config = primary.runtimeConfig();
  const lockClient = await primary.acquireRunLock();
  if (!lockClient) {
    const output = {
      runtime: config.runtime,
      sync_key: config.syncKey,
      target: config.maxCleanProducts,
      paused_reason: 'another-run-active',
    };
    console.log(`[aliexpress-topup] ${JSON.stringify(output)}`);
    return output;
  }

  try {
    const providerEnv = await aliexpressConnector.managedRuntimeEnv();
    return await runTopupLocked(config, providerEnv);
  } finally {
    await primary.releaseRunLock(lockClient);
  }
}

if (require.main === module) {
  runTopup()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`[aliexpress-topup] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    });
}

module.exports = {
  TOPUP_ID,
  TOPUP_QUERIES,
  logicalTopupPage,
  topupCheckpointCategoryId,
  topupSourceFilename,
  canResumeCompletedCheckpoint,
  discoverySegment,
  runTopup,
};
