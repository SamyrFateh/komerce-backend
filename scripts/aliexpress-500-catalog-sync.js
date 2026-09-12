#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-catalog-pool-sync-worker
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        AliExpress Open Platform credentials/session, DATABASE_URL, KOMERCE_ALLOW_ALIEXPRESS_POOL_SYNC
 * @outputs       resumable diversified AliExpress sourcing pool capped at 500 in-stock products
 * @depends       db.js, services/suppliers/connectors/aliexpress-connected-connector.js, services/suppliers/connectors/aliexpress-connector.js, services/suppliers/catalog-import-orchestrator.js, services/suppliers/catalog-sync-checkpoint.js
 * @used-by       Railway staging one-shot/scheduled worker
 * @db-read       supplier_catalog_sync_checkpoints, sourcing_candidates, supplier_oauth_connections
 * @db-write      supplier_catalog_sync_checkpoints, supplier_catalog_imports, sourcing_candidates, sourcing_candidate_events, supplier_oauth_connections (token refresh only)
 * @db-txn        canonical services own candidate writes; session advisory lock serializes worker runs
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md, docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, sourcing, supplier-import
 * @version       2026-09-v4
 */
'use strict';

const db = require('../db');
const aliexpressConnector = require('../services/suppliers/connectors/aliexpress-connected-connector');
const aliexpressBaseConnector = require('../services/suppliers/connectors/aliexpress-connector');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const checkpoints = require('../services/suppliers/catalog-sync-checkpoint');

const SUPPLIER_NAME = 'AliExpress';
const DEFAULT_SYNC_KEY = 'aliexpress-instock-500-text-v1';
const DEFAULT_COUNTRY_CODE = 'AE';
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_SEARCH_PAGES_PER_QUERY = 5;
const DEFAULT_DETAIL_DELAY_MS = 600;
const DEFAULT_DETAIL_RETRY_ATTEMPTS = 4;
const DEFAULT_MAX_CLEAN_PRODUCTS = 500;
const ABSOLUTE_MAX_CLEAN_PRODUCTS = 500;
const SEARCH_SORT = 'salesDesc';
const SEARCH_LOCALE = 'en_US';
const SEARCH_CURRENCY = 'USD';
const RUN_LOCK_NAMESPACE = 'komerce';
const RUN_LOCK_KEY = 'aliexpress-500-catalog-sync';

// 500 slots, aligned with the current Komerce showcase taxonomy. Search terms are
// intentionally commercial/plain-English rather than fixture/image-search wording.
const SEARCH_PLAN = Object.freeze([
  { id: 'mode-femme', category: 'Mode & Beauté', subcategory: 'Femme', target: 35, queries: ['women dress', 'women clothing'] },
  { id: 'mode-homme', category: 'Mode & Beauté', subcategory: 'Homme', target: 25, queries: ['men shirt', 'men clothing'] },
  { id: 'mode-enfant', category: 'Mode & Beauté', subcategory: 'Enfant', target: 25, queries: ['kids clothing', 'kids shoes'] },
  { id: 'beaute', category: 'Mode & Beauté', subcategory: 'Beauté', target: 45, queries: ['cosmetics makeup', 'skin care', 'beauty tools'] },

  { id: 'maison-confort', category: 'Maison', subcategory: 'Confort', target: 25, queries: ['home appliance', 'household appliance'] },
  { id: 'maison-cuisine', category: 'Maison', subcategory: 'Cuisine', target: 25, queries: ['kitchenware', 'kitchen utensil'] },
  { id: 'maison-deco', category: 'Maison', subcategory: 'Déco', target: 20, queries: ['home decor', 'table lamp'] },
  { id: 'maison-enfants', category: 'Maison', subcategory: 'Enfants', target: 20, queries: ['school supplies', 'school bag'] },

  { id: 'tech-phones', category: 'Tech', subcategory: 'Phones', target: 30, queries: ['android smartphone', 'mobile phone'] },
  { id: 'tech-audio', category: 'Tech', subcategory: 'Audio', target: 30, queries: ['wireless headphones', 'bluetooth speaker'] },
  { id: 'tech-montres', category: 'Tech', subcategory: 'Montres', target: 30, queries: ['smartwatch', 'wrist watch'] },

  { id: 'bricolage-outillage', category: 'Bricolage', subcategory: 'Outillage', target: 25, queries: ['power tools', 'hand tools'] },
  { id: 'bricolage-electricite', category: 'Bricolage', subcategory: 'Electricité', target: 25, queries: ['electrical connectors', 'extension cable'] },
  { id: 'bricolage-securite', category: 'Bricolage', subcategory: 'Sécurité', target: 20, queries: ['padlock', 'door lock'] },

  { id: 'creation-ceremonie', category: 'Créations personnelles', subcategory: 'Cérémonie', target: 20, queries: ['evening dress', 'formal suit'] },
  { id: 'creation-cadeau', category: 'Créations personnelles', subcategory: 'Cadeau', target: 20, queries: ['gift box', 'personalized gift'] },
  { id: 'creation-impression', category: 'Créations personnelles', subcategory: 'Impression', target: 15, queries: ['printed mug', 'custom stationery'] },

  { id: 'auto-filtres', category: 'Auto', subcategory: 'Filtres', target: 20, queries: ['car oil filter', 'car air filter'] },
  { id: 'auto-freinage', category: 'Auto', subcategory: 'Freinage', target: 15, queries: ['brake pads', 'brake disc'] },
  { id: 'auto-eclairage', category: 'Auto', subcategory: 'Éclairage', target: 15, queries: ['car led headlight', 'car tail light'] },
  { id: 'auto-moto', category: 'Auto', subcategory: 'Moto', target: 15, queries: ['motorcycle accessories', 'motorcycle phone holder'] },
]);

function intEnv(name, fallback, min, max, env = process.env) {
  const raw = env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} doit être un entier entre ${min} et ${max}`);
  }
  return n;
}

function runtimeEnvironment(env = process.env) {
  return String(env.KOMERCE_ENV || env.NODE_ENV || '').trim().toLowerCase();
}

function normalizeCountryCode(value) {
  const code = String(value || DEFAULT_COUNTRY_CODE).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw new Error('KOMERCE_ALIEXPRESS_COUNTRY_CODE doit être un code ISO alpha-2');
  return code;
}

function runtimeConfig(env = process.env) {
  const runtime = runtimeEnvironment(env);
  if (runtime === 'production') {
    throw new Error('REFUS: pool AliExpress 500 interdit en production');
  }
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
    runtime,
    syncKey: String(env.KOMERCE_ALIEXPRESS_SYNC_KEY || DEFAULT_SYNC_KEY).trim() || DEFAULT_SYNC_KEY,
    countryCode: normalizeCountryCode(env.KOMERCE_ALIEXPRESS_COUNTRY_CODE),
    pageSize: intEnv('KOMERCE_ALIEXPRESS_PAGE_SIZE', DEFAULT_PAGE_SIZE, 1, 50, env),
    maxSearchPagesPerQuery: intEnv(
      'KOMERCE_ALIEXPRESS_SEARCH_PAGES_PER_QUERY',
      DEFAULT_MAX_SEARCH_PAGES_PER_QUERY,
      1,
      20,
      env
    ),
    detailDelayMs: intEnv('KOMERCE_ALIEXPRESS_DETAIL_DELAY_MS', DEFAULT_DETAIL_DELAY_MS, 0, 5000, env),
    detailRetryAttempts: intEnv(
      'KOMERCE_ALIEXPRESS_DETAIL_RETRY_ATTEMPTS',
      DEFAULT_DETAIL_RETRY_ATTEMPTS,
      1,
      10,
      env
    ),
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

function searchPlanTotal(plan = SEARCH_PLAN) {
  return plan.reduce((sum, segment) => sum + Number(segment.target || 0), 0);
}

function logicalSearchPage(segment, logicalPage) {
  const queries = Array.isArray(segment?.queries) ? segment.queries : [];
  if (!queries.length) throw new Error(`Segment ${segment?.id || 'unknown'} sans requête`);
  const n = Number.parseInt(logicalPage, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error('logicalPage doit être >= 1');
  const queryIndex = (n - 1) % queries.length;
  return {
    keyword: queries[queryIndex],
    queryIndex,
    queryPage: Math.floor((n - 1) / queries.length) + 1,
  };
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function flattenTextSearchProducts(payload = {}) {
  const data = payload?.data || payload?.result?.data || payload?.result || payload || {};
  const products = data?.products || {};
  return toArray(products.selection_search_product || products.product || products.products);
}

function textSearchProductIds(payload = {}) {
  return [...new Set(flattenTextSearchProducts(payload)
    .map((item) => String(item?.itemId || item?.product_id || '').trim())
    .filter((id) => /^\d{5,20}$/.test(id)))];
}

function checkpointCategoryId(segment) {
  return `text:${segment.id}`;
}

function importSourceFilename(syncKey, segmentId, logicalPage) {
  return `aliexpress-pool/${syncKey}/${segmentId}/page-${String(logicalPage).padStart(4, '0')}.json`;
}

function stockSqlPredicate(alias = 'sc') {
  return `(
    ${alias}.normalized_source_contract ? 'stock_available'
    AND (${alias}.normalized_source_contract->>'stock_available') ~ '^[0-9]+([.][0-9]+)?$'
    AND (${alias}.normalized_source_contract->>'stock_available')::numeric > 0
  )`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function rateLimitWaitSeconds(error) {
  const message = String(error?.message || error || '');
  if (!/frequency of app access|exceeds the limit|rate.?limit/i.test(message)) return null;
  const match = message.match(/(?:last|for)\s+(\d+)\s+seconds?/i) || message.match(/(\d+)\s+seconds?/i);
  const seconds = match ? Number.parseInt(match[1], 10) : 30;
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : 30;
}

async function acquireRunLock() {
  const client = await db.getClient();
  try {
    const { rows: [row] } = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked',
      [RUN_LOCK_NAMESPACE, RUN_LOCK_KEY]
    );
    if (!row?.locked) {
      client.release();
      return null;
    }
    return client;
  } catch (error) {
    client.release();
    throw error;
  }
}

async function releaseRunLock(client) {
  if (!client) return;
  try {
    await client.query(
      'SELECT pg_advisory_unlock(hashtext($1), hashtext($2))',
      [RUN_LOCK_NAMESPACE, RUN_LOCK_KEY]
    );
  } finally {
    client.release();
  }
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

function withDiscoveryProvenance(product, { segment, keyword, queryPage, countryCode = DEFAULT_COUNTRY_CODE }) {
  return {
    ...product,
    raw_payload: {
      ...(product.raw_payload || {}),
      discovery: {
        source: 'aliexpress.ds.text.search',
        segment_id: segment.id,
        target_category: segment.category,
        target_subcategory: segment.subcategory,
        keyword,
        query_page: queryPage,
        supplier_destination_country: countryCode,
      },
    },
  };
}

async function fetchProductsRateLimited(productIds, {
  countryCode,
  providerEnv,
  detailDelayMs = DEFAULT_DETAIL_DELAY_MS,
  detailRetryAttempts = DEFAULT_DETAIL_RETRY_ATTEMPTS,
  sleepFn = sleep,
} = {}) {
  const products = [];
  const invalid = [];
  const ids = [...new Set(toArray(productIds).map((id) => String(id || '').trim()).filter(Boolean))];

  for (let index = 0; index < ids.length; index += 1) {
    const productId = ids[index];
    let fetched = null;
    for (let attempt = 1; attempt <= detailRetryAttempts; attempt += 1) {
      try {
        fetched = await aliexpressBaseConnector.fetchProducts({
          productIds: [productId],
          countryCode,
          env: providerEnv,
        });
        break;
      } catch (error) {
        const waitSeconds = rateLimitWaitSeconds(error);
        if (waitSeconds == null || attempt >= detailRetryAttempts) throw error;
        const waitMs = (waitSeconds + 2) * 1000;
        console.warn(`[aliexpress-pool] throttle product=${productId} attempt=${attempt}/${detailRetryAttempts} wait=${waitSeconds + 2}s`);
        await sleepFn(waitMs);
      }
    }

    products.push(...(Array.isArray(fetched?.products) ? fetched.products : []));
    invalid.push(...(Array.isArray(fetched?.invalid) ? fetched.invalid : []));
    if (detailDelayMs > 0 && index < ids.length - 1) await sleepFn(detailDelayMs);
  }

  return { products, invalid, total: products.length + invalid.length };
}

async function importFetchedSubset({ syncKey, segment, logicalPage, subset }) {
  if (!subset.length) return { accepted: 0, rejected: 0, import_id: null };
  const body = {
    supplier_name: SUPPLIER_NAME,
    source_type: 'api',
    source_filename: importSourceFilename(syncKey, segment.id, logicalPage),
    notes: `AliExpress text-search pool ${syncKey} — ${segment.category}/${segment.subcategory} — page ${logicalPage}`,
  };
  const dispatchSubset = async () => ({
    products: subset,
    invalid: [],
    total: subset.length,
  });
  const result = await catalogImportOrchestrator.importCatalog(body, null, dispatchSubset);
  if (result.status !== 200) {
    throw new Error(`AliExpress import ${segment.id} p${logicalPage} refusé (${result.status}): ${JSON.stringify(result.body).slice(0, 1000)}`);
  }
  return result.body;
}

async function runSegment({ config, segment, seenIds, providerEnv }) {
  const categoryId = checkpointCategoryId(segment);
  const maxLogicalPages = segment.queries.length * config.maxSearchPagesPerQuery;
  let checkpoint = await checkpoints.getCheckpoint(db, {
    supplierName: SUPPLIER_NAME,
    syncKey: config.syncKey,
    categoryId,
  });

  if (!checkpoint) {
    checkpoint = await checkpoints.ensureCheckpoint(db, {
      supplierName: SUPPLIER_NAME,
      syncKey: config.syncKey,
      categoryId,
      categoryPath: `${segment.category} / ${segment.subcategory}`,
      totalPages: maxLogicalPages,
      totalRecords: segment.target,
      cappedBySupplier: false,
    });
  }

  const existingAccepted = Number(checkpoint?.accepted_items || 0);
  if (existingAccepted >= segment.target) {
    if (!checkpoint?.completed) {
      checkpoint = await checkpoints.markComplete(db, {
        supplierName: SUPPLIER_NAME,
        syncKey: config.syncKey,
        categoryId,
        totalPages: maxLogicalPages,
        totalRecords: segment.target,
        cappedBySupplier: false,
      }) || checkpoint;
    }
    return { pages: 0, accepted: existingAccepted, completed: true };
  }
  if (checkpoint?.completed) {
    return { pages: 0, accepted: existingAccepted, completed: true };
  }

  let logicalPage = Math.max(1, Number(checkpoint?.next_page) || 1);
  let pages = 0;

  while (logicalPage <= maxLogicalPages) {
    const globalBefore = await countCleanCandidates();
    const globalRemaining = config.maxCleanProducts - globalBefore;
    const segmentAccepted = Number(checkpoint?.accepted_items || 0);
    const segmentRemaining = segment.target - segmentAccepted;
    if (globalRemaining <= 0 || segmentRemaining <= 0) break;

    const { keyword, queryPage } = logicalSearchPage(segment, logicalPage);
    let searchPayload;
    try {
      searchPayload = await aliexpressBaseConnector.invokeTop('aliexpress.ds.text.search', {
        keyword,
        countryCode: config.countryCode,
        currency: SEARCH_CURRENCY,
        local: SEARCH_LOCALE,
        page_size: config.pageSize,
        page_index: queryPage,
        sort: SEARCH_SORT,
      }, { env: providerEnv });
    } catch (error) {
      await checkpoints.recordError(db, {
        supplierName: SUPPLIER_NAME,
        syncKey: config.syncKey,
        categoryId,
        error,
      });
      throw error;
    }

    const productIds = textSearchProductIds(searchPayload).filter((id) => !seenIds.has(id));
    let fetched = { products: [], invalid: [], total: 0 };
    if (productIds.length) {
      fetched = await fetchProductsRateLimited(productIds, {
        countryCode: config.countryCode,
        providerEnv,
        detailDelayMs: config.detailDelayMs,
        detailRetryAttempts: config.detailRetryAttempts,
      });
    }

    const fetchedProducts = (Array.isArray(fetched.products) ? fetched.products : [])
      .map((product) => withDiscoveryProvenance(product, {
        segment,
        keyword,
        queryPage,
        countryCode: config.countryCode,
      }));
    const cleanNew = fetchedProducts
      .filter(basicCleanProduct)
      .filter((product) => !seenIds.has(product.supplier_product_id));
    const subset = cleanNew.slice(0, Math.min(globalRemaining, segmentRemaining));
    const imported = await importFetchedSubset({
      syncKey: config.syncKey,
      segment,
      logicalPage,
      subset,
    });
    for (const product of subset) seenIds.add(product.supplier_product_id);

    const connectorInvalid = Array.isArray(fetched.invalid) ? fetched.invalid.length : 0;
    const filteredOut = Math.max(0, fetchedProducts.length - cleanNew.length);
    pages += 1;

    const globalAfter = await countCleanCandidates();
    if (globalAfter > config.maxCleanProducts) {
      throw new Error(`Cap AliExpress dépassé: ${globalAfter}/${config.maxCleanProducts}`);
    }

    checkpoint = await checkpoints.recordPageSuccess(db, {
      supplierName: SUPPLIER_NAME,
      syncKey: config.syncKey,
      categoryId,
      page: logicalPage,
      totalPages: maxLogicalPages,
      totalRecords: segment.target,
      accepted: imported.accepted || 0,
      rejected: (imported.rejected || 0) + connectorInvalid + filteredOut,
      requestId: searchPayload?.request_id || null,
      cappedBySupplier: false,
    });

    if (globalAfter >= config.maxCleanProducts) break;
    if (Number(checkpoint?.accepted_items || 0) >= segment.target) {
      checkpoint = await checkpoints.markComplete(db, {
        supplierName: SUPPLIER_NAME,
        syncKey: config.syncKey,
        categoryId,
        totalPages: maxLogicalPages,
        totalRecords: segment.target,
        cappedBySupplier: false,
      }) || checkpoint;
      break;
    }
    logicalPage += 1;
  }

  const accepted = Number(checkpoint?.accepted_items || 0);
  return {
    pages,
    accepted,
    completed: Boolean(checkpoint?.completed) || accepted >= segment.target,
  };
}

async function runSyncLocked(config, providerEnv) {
  if (searchPlanTotal() !== ABSOLUTE_MAX_CLEAN_PRODUCTS) {
    throw new Error(`Plan AliExpress invalide: ${searchPlanTotal()}/${ABSOLUTE_MAX_CLEAN_PRODUCTS}`);
  }

  const startingClean = await countCleanCandidates();
  if (startingClean > config.maxCleanProducts) {
    throw new Error(`Pool AliExpress déjà au-dessus du cap: ${startingClean}/${config.maxCleanProducts}`);
  }

  if (startingClean === config.maxCleanProducts) {
    const summary = await checkpoints.summarize(db, { supplierName: SUPPLIER_NAME, syncKey: config.syncKey });
    const output = {
      runtime: config.runtime,
      sync_key: config.syncKey,
      discovery: 'aliexpress.ds.text.search',
      country_code: config.countryCode,
      starting_clean: startingClean,
      final_clean: startingClean,
      target: config.maxCleanProducts,
      search_pages_this_run: 0,
      paused_reason: 'target-already-reached',
      checkpoint_summary: summary,
    };
    console.log(`[aliexpress-pool] ${JSON.stringify(output)}`);
    return output;
  }

  const seenIds = await loadSeenSupplierIds();
  let pages = 0;
  let completedSegments = 0;
  const segmentResults = [];

  console.log(`[aliexpress-pool] runtime=${config.runtime || 'unknown'} discovery=ds.text.search country=${config.countryCode} start=${startingClean} target=${config.maxCleanProducts} pageSize=${config.pageSize} pagesPerQuery=${config.maxSearchPagesPerQuery} detailDelayMs=${config.detailDelayMs}`);

  for (const segment of SEARCH_PLAN) {
    const before = await countCleanCandidates();
    if (before >= config.maxCleanProducts) break;

    const result = await runSegment({ config, segment, seenIds, providerEnv });
    pages += result.pages;
    if (result.completed) completedSegments += 1;
    segmentResults.push({ id: segment.id, target: segment.target, accepted: result.accepted, completed: result.completed });
    console.log(`[aliexpress-pool] segment=${segment.id} accepted=${result.accepted}/${segment.target} pages=${result.pages}`);
  }

  const finalClean = await countCleanCandidates();
  const summary = await checkpoints.summarize(db, {
    supplierName: SUPPLIER_NAME,
    syncKey: config.syncKey,
  });
  const shortfalls = segmentResults
    .filter((row) => row.accepted < row.target)
    .map((row) => ({ id: row.id, missing: row.target - row.accepted }));
  const output = {
    runtime: config.runtime,
    sync_key: config.syncKey,
    discovery: 'aliexpress.ds.text.search',
    country_code: config.countryCode,
    starting_clean: startingClean,
    final_clean: finalClean,
    target: config.maxCleanProducts,
    plan_target: searchPlanTotal(),
    segments_seen: segmentResults.length,
    segments_completed: completedSegments,
    search_pages_this_run: pages,
    paused_reason: finalClean >= config.maxCleanProducts ? 'target-reached' : 'search-plan-exhausted',
    shortfalls,
    checkpoint_summary: summary,
  };
  if (finalClean > config.maxCleanProducts) {
    throw new Error(`Audit final AliExpress refusé: ${finalClean}/${config.maxCleanProducts}`);
  }
  console.log(`[aliexpress-pool] ${JSON.stringify(output)}`);
  return output;
}

async function runSync() {
  const config = runtimeConfig();
  const lockClient = await acquireRunLock();
  if (!lockClient) {
    const output = {
      runtime: config.runtime,
      sync_key: config.syncKey,
      target: config.maxCleanProducts,
      paused_reason: 'another-run-active',
    };
    console.log(`[aliexpress-pool] ${JSON.stringify(output)}`);
    return output;
  }

  try {
    const providerEnv = await aliexpressConnector.managedRuntimeEnv();
    return await runSyncLocked(config, providerEnv);
  } finally {
    await releaseRunLock(lockClient);
  }
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
  DEFAULT_COUNTRY_CODE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_SEARCH_PAGES_PER_QUERY,
  DEFAULT_DETAIL_DELAY_MS,
  DEFAULT_DETAIL_RETRY_ATTEMPTS,
  DEFAULT_MAX_CLEAN_PRODUCTS,
  ABSOLUTE_MAX_CLEAN_PRODUCTS,
  RUN_LOCK_NAMESPACE,
  RUN_LOCK_KEY,
  SEARCH_PLAN,
  intEnv,
  runtimeEnvironment,
  normalizeCountryCode,
  runtimeConfig,
  positiveStock,
  basicCleanProduct,
  searchPlanTotal,
  logicalSearchPage,
  flattenTextSearchProducts,
  textSearchProductIds,
  checkpointCategoryId,
  importSourceFilename,
  stockSqlPredicate,
  rateLimitWaitSeconds,
  acquireRunLock,
  releaseRunLock,
  withDiscoveryProvenance,
  fetchProductsRateLimited,
  runSync,
};