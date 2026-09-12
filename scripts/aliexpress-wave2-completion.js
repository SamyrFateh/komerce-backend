#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-wave2-completion-worker
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        Wave 2 checkpointed state, AliExpress Open Platform, DATABASE_URL
 * @outputs       additional distinct AliExpress candidates until Wave 2 reaches 500 clean products
 * @depends       db.js, scripts/aliexpress-wave2-sourcing.js, scripts/aliexpress-500-catalog-sync.js, services/suppliers/connectors/aliexpress-connected-connector.js, services/suppliers/connectors/aliexpress-connector.js, services/suppliers/catalog-import-orchestrator.js, services/suppliers/catalog-sync-checkpoint.js
 * @db-read       sourcing_candidates, supplier_catalog_sync_checkpoints
 * @db-write      supplier_catalog_imports, sourcing_candidates, sourcing_candidate_events, supplier_catalog_sync_checkpoints
 * @db-txn        canonical owners only; shared AliExpress advisory lock serializes sourcing workers
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md, docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, sourcing, supplier-import, refinery
 * @version       2026-09-wave2-completion-v1
 */
'use strict';

const db = require('../db');
const primary = require('./aliexpress-500-catalog-sync');
const wave2 = require('./aliexpress-wave2-sourcing');
const aliexpressConnector = require('../services/suppliers/connectors/aliexpress-connected-connector');
const aliexpressBaseConnector = require('../services/suppliers/connectors/aliexpress-connector');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const checkpoints = require('../services/suppliers/catalog-sync-checkpoint');

const COMPLETION_ID = 'wave2-completion-v1';
const DEFAULT_SYNC_KEY = 'aliexpress-wave2-completion-v1';
const DEFAULT_PAGES_PER_QUERY = 4;
const SEARCH_SORT = 'salesDesc';
const SEARCH_LOCALE = 'en_US';
const SEARCH_CURRENCY = 'USD';

// Deliberately distinct from the original Wave 2 vocabulary.
// These are discovery hints only; canonical classification stays in the Refinery.
const COMPLETION_QUERIES = Object.freeze([
  { keyword: 'women sandals fashion', category: 'Mode & Beauté', subcategory: 'Femme' },
  { keyword: 'women shoulder bag', category: 'Mode & Beauté', subcategory: 'Femme' },
  { keyword: 'women cardigan sweater', category: 'Mode & Beauté', subcategory: 'Femme' },
  { keyword: 'men wallet leather', category: 'Mode & Beauté', subcategory: 'Homme' },
  { keyword: 'men summer shorts', category: 'Mode & Beauté', subcategory: 'Homme' },
  { keyword: 'men running shoes', category: 'Mode & Beauté', subcategory: 'Homme' },
  { keyword: 'kids pajamas set', category: 'Mode & Beauté', subcategory: 'Enfant' },
  { keyword: 'girls hair accessories', category: 'Mode & Beauté', subcategory: 'Enfant' },
  { keyword: 'boys t shirt set', category: 'Mode & Beauté', subcategory: 'Enfant' },
  { keyword: 'makeup brush set', category: 'Mode & Beauté', subcategory: 'Beauté' },
  { keyword: 'manicure drill machine', category: 'Mode & Beauté', subcategory: 'Beauté' },
  { keyword: 'hair straightener brush', category: 'Mode & Beauté', subcategory: 'Beauté' },
  { keyword: 'cosmetic travel bag', category: 'Mode & Beauté', subcategory: 'Beauté' },
  { keyword: 'facial ice roller', category: 'Mode & Beauté', subcategory: 'Beauté' },

  { keyword: 'drawer organizer', category: 'Maison', subcategory: 'Confort' },
  { keyword: 'shoe storage organizer', category: 'Maison', subcategory: 'Confort' },
  { keyword: 'laundry basket foldable', category: 'Maison', subcategory: 'Confort' },
  { keyword: 'led desk lamp', category: 'Maison', subcategory: 'Confort' },
  { keyword: 'shower shelf adhesive', category: 'Maison', subcategory: 'Confort' },
  { keyword: 'oil spray bottle', category: 'Maison', subcategory: 'Cuisine' },
  { keyword: 'kitchen storage containers', category: 'Maison', subcategory: 'Cuisine' },
  { keyword: 'vegetable slicer manual', category: 'Maison', subcategory: 'Cuisine' },
  { keyword: 'reusable food bags', category: 'Maison', subcategory: 'Cuisine' },
  { keyword: 'coffee frother handheld', category: 'Maison', subcategory: 'Cuisine' },
  { keyword: 'wall clock modern', category: 'Maison', subcategory: 'Déco' },
  { keyword: 'led string lights', category: 'Maison', subcategory: 'Déco' },
  { keyword: 'table vase decor', category: 'Maison', subcategory: 'Déco' },
  { keyword: 'picture hanging kit', category: 'Maison', subcategory: 'Déco' },
  { keyword: 'building blocks kids', category: 'Maison', subcategory: 'Enfants' },
  { keyword: 'kids water bottle', category: 'Maison', subcategory: 'Enfants' },
  { keyword: 'school lunch bag', category: 'Maison', subcategory: 'Enfants' },

  { keyword: 'usb c hub adapter', category: 'Tech', subcategory: 'Phones' },
  { keyword: 'phone case shockproof', category: 'Tech', subcategory: 'Phones' },
  { keyword: 'car phone holder', category: 'Tech', subcategory: 'Phones' },
  { keyword: 'power bank 10000mah', category: 'Tech', subcategory: 'Phones' },
  { keyword: 'bluetooth keyboard tablet', category: 'Tech', subcategory: 'Phones' },
  { keyword: 'wireless mouse silent', category: 'Tech', subcategory: 'Phones' },
  { keyword: 'laptop stand foldable', category: 'Tech', subcategory: 'Phones' },
  { keyword: 'usb microphone', category: 'Tech', subcategory: 'Audio' },
  { keyword: 'bluetooth headphones over ear', category: 'Tech', subcategory: 'Audio' },
  { keyword: 'smartwatch replacement band', category: 'Tech', subcategory: 'Montres' },

  { keyword: 'drill bit set', category: 'Bricolage', subcategory: 'Outillage' },
  { keyword: 'digital multimeter', category: 'Bricolage', subcategory: 'Electricité' },
  { keyword: 'cable ties reusable', category: 'Bricolage', subcategory: 'Electricité' },
  { keyword: 'motion sensor light', category: 'Bricolage', subcategory: 'Sécurité' },
  { keyword: 'door lock portable', category: 'Bricolage', subcategory: 'Sécurité' },
  { keyword: 'tool organizer bag', category: 'Bricolage', subcategory: 'Outillage' },

  { keyword: 'birthday party decoration', category: 'Créations personnelles', subcategory: 'Cérémonie' },
  { keyword: 'acrylic cake topper', category: 'Créations personnelles', subcategory: 'Cérémonie' },
  { keyword: 'jewelry gift box', category: 'Créations personnelles', subcategory: 'Cadeau' },
  { keyword: 'sticker printer paper', category: 'Créations personnelles', subcategory: 'Impression' },

  { keyword: 'car seat organizer', category: 'Auto', subcategory: 'Moto' },
  { keyword: 'car cleaning brush', category: 'Auto', subcategory: 'Moto' },
  { keyword: 'tire pressure gauge', category: 'Auto', subcategory: 'Moto' },
  { keyword: 'car phone charger', category: 'Auto', subcategory: 'Éclairage' },
  { keyword: 'motorcycle phone mount', category: 'Auto', subcategory: 'Moto' },
  { keyword: 'car sun shade', category: 'Auto', subcategory: 'Moto' },
]);

function completionConfig(env = process.env) {
  const base = wave2.waveConfig(env);
  return {
    ...base,
    syncKey: String(env.KOMERCE_ALIEXPRESS_WAVE2_COMPLETION_SYNC_KEY || DEFAULT_SYNC_KEY).trim() || DEFAULT_SYNC_KEY,
    pagesPerQuery: primary.intEnv(
      'KOMERCE_ALIEXPRESS_WAVE2_COMPLETION_PAGES_PER_QUERY',
      DEFAULT_PAGES_PER_QUERY,
      1,
      10,
      env
    ),
  };
}

function logicalCompletionPage(logicalPage, queries = COMPLETION_QUERIES) {
  const n = Number.parseInt(logicalPage, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error('logicalPage doit être >= 1');
  if (!Array.isArray(queries) || !queries.length) throw new Error('COMPLETION_QUERIES vide');
  const queryIndex = (n - 1) % queries.length;
  return {
    ...queries[queryIndex],
    queryIndex,
    queryPage: Math.floor((n - 1) / queries.length) + 1,
  };
}

function checkpointCategoryId() {
  return `text:${wave2.WAVE_ID}:${COMPLETION_ID}`;
}

function sourceFilename(syncKey, logicalPage) {
  return `aliexpress-pool/${syncKey}/${wave2.WAVE_ID}/${COMPLETION_ID}/page-${String(logicalPage).padStart(4, '0')}.json`;
}

function withCompletionProvenance(product, spec) {
  const projected = wave2.withWaveProvenance(product, spec);
  return {
    ...projected,
    raw_payload: {
      ...(projected.raw_payload || {}),
      discovery: {
        ...(projected.raw_payload?.discovery || {}),
        wave_leg: COMPLETION_ID,
      },
    },
  };
}

async function loadSeenSupplierIds() {
  const { rows } = await db.query(
    `SELECT supplier_product_id
       FROM sourcing_candidates
      WHERE supplier_name = $1
        AND supplier_product_id IS NOT NULL`,
    [primary.SUPPLIER_NAME]
  );
  return new Set(rows.map(row => row.supplier_product_id).filter(Boolean));
}

async function countKnownSupplierIds() {
  const { rows: [row] } = await db.query(
    `SELECT COUNT(DISTINCT supplier_product_id)::int AS count
       FROM sourcing_candidates
      WHERE supplier_name = $1
        AND supplier_product_id IS NOT NULL`,
    [primary.SUPPLIER_NAME]
  );
  return Number(row?.count || 0);
}

async function importFetchedSubset({ syncKey, logicalPage, subset, spec }) {
  if (!subset.length) return { accepted: 0, rejected: 0, import_id: null };
  const body = {
    supplier_name: primary.SUPPLIER_NAME,
    source_type: 'api',
    source_filename: sourceFilename(syncKey, logicalPage),
    notes: `AliExpress ${wave2.WAVE_ID} completion — ${spec.category}/${spec.subcategory} — ${spec.keyword} — page ${logicalPage}`,
    is_full_snapshot: false,
  };
  const dispatchSubset = async () => ({ products: subset, invalid: [], total: subset.length });
  const result = await catalogImportOrchestrator.importCatalog(body, null, dispatchSubset);
  if (result.status !== 200) {
    throw new Error(`AliExpress ${COMPLETION_ID} p${logicalPage} refusé (${result.status}): ${JSON.stringify(result.body).slice(0, 1000)}`);
  }
  return result.body;
}

async function runCompletionLocked(config, providerEnv) {
  const startingWave = await wave2.countWaveClean();
  const startingKnown = await countKnownSupplierIds();
  const missingBefore = Math.max(0, wave2.WAVE_TARGET - startingWave);

  if (startingWave >= wave2.WAVE_TARGET) {
    const audit = await wave2.auditWave();
    const output = {
      runtime: config.runtime,
      wave: wave2.WAVE_ID,
      leg: COMPLETION_ID,
      starting_wave_clean: startingWave,
      final_wave_clean: startingWave,
      missing_before: 0,
      missing_after: 0,
      added_this_run: 0,
      paused_reason: 'target-already-reached',
      refinery: audit,
    };
    console.log(`[aliexpress-wave2-completion] ${JSON.stringify(output)}`);
    return output;
  }

  const categoryId = checkpointCategoryId();
  const maxLogicalPages = COMPLETION_QUERIES.length * config.pagesPerQuery;
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
      categoryPath: `AliExpress ${wave2.WAVE_ID} / completion`,
      totalPages: maxLogicalPages,
      totalRecords: wave2.WAVE_TARGET,
      cappedBySupplier: false,
    });
  }

  const seenIds = await loadSeenSupplierIds();
  let logicalPage = Math.max(1, Number(checkpoint?.next_page) || 1);
  let pages = 0;

  console.log(`[aliexpress-wave2-completion] runtime=${config.runtime} start=${startingWave}/${wave2.WAVE_TARGET} missing=${missingBefore} known=${startingKnown} queries=${COMPLETION_QUERIES.length} pagesPerQuery=${config.pagesPerQuery}`);

  while (logicalPage <= maxLogicalPages) {
    const before = await wave2.countWaveClean();
    const remaining = wave2.WAVE_TARGET - before;
    if (remaining <= 0) break;

    const spec = logicalCompletionPage(logicalPage);
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

    const productIds = primary.textSearchProductIds(searchPayload).filter(id => !seenIds.has(id));
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
      .map(product => withCompletionProvenance(product, {
        ...spec,
        countryCode: config.countryCode,
      }));
    const cleanNew = fetchedProducts
      .filter(primary.basicCleanProduct)
      .filter(product => !seenIds.has(product.supplier_product_id));
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
    const after = await wave2.countWaveClean();
    if (after > wave2.WAVE_TARGET) {
      throw new Error(`Cap Wave 2 dépassé: ${after}/${wave2.WAVE_TARGET}`);
    }

    checkpoint = await checkpoints.recordPageSuccess(db, {
      supplierName: primary.SUPPLIER_NAME,
      syncKey: config.syncKey,
      categoryId,
      page: logicalPage,
      totalPages: maxLogicalPages,
      totalRecords: wave2.WAVE_TARGET,
      accepted: imported.accepted || 0,
      rejected: (imported.rejected || 0) + connectorInvalid + filteredOut,
      requestId: searchPayload?.request_id || null,
      cappedBySupplier: false,
    });
    pages += 1;

    if ((imported.accepted || 0) > 0) {
      console.log(`[aliexpress-wave2-completion] keyword=${JSON.stringify(spec.keyword)} queryPage=${spec.queryPage} accepted=${imported.accepted || 0} clean=${after}/${wave2.WAVE_TARGET}`);
    }
    if (after >= wave2.WAVE_TARGET) break;
    logicalPage += 1;
  }

  const finalWave = await wave2.countWaveClean();
  const finalKnown = await countKnownSupplierIds();
  const audit = await wave2.auditWave();
  const output = {
    runtime: config.runtime,
    wave: wave2.WAVE_ID,
    leg: COMPLETION_ID,
    sync_key: config.syncKey,
    starting_wave_clean: startingWave,
    final_wave_clean: finalWave,
    target_new: wave2.WAVE_TARGET,
    missing_before: missingBefore,
    missing_after: Math.max(0, wave2.WAVE_TARGET - finalWave),
    starting_known: startingKnown,
    final_known: finalKnown,
    added_this_run: finalWave - startingWave,
    pages_this_run: pages,
    paused_reason: finalWave >= wave2.WAVE_TARGET ? 'target-reached' : 'completion-plan-exhausted',
    refinery: audit,
  };
  console.log(`[aliexpress-wave2-completion] ${JSON.stringify(output)}`);
  return output;
}

async function runCompletion() {
  const config = completionConfig();
  const lockClient = await primary.acquireRunLock();
  if (!lockClient) {
    const output = {
      runtime: config.runtime,
      wave: wave2.WAVE_ID,
      leg: COMPLETION_ID,
      target_new: wave2.WAVE_TARGET,
      paused_reason: 'another-run-active',
    };
    console.log(`[aliexpress-wave2-completion] ${JSON.stringify(output)}`);
    return output;
  }

  try {
    const providerEnv = await aliexpressConnector.managedRuntimeEnv();
    return await runCompletionLocked(config, providerEnv);
  } finally {
    await primary.releaseRunLock(lockClient);
  }
}

if (require.main === module) {
  runCompletion()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[aliexpress-wave2-completion] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  COMPLETION_ID,
  DEFAULT_SYNC_KEY,
  DEFAULT_PAGES_PER_QUERY,
  COMPLETION_QUERIES,
  completionConfig,
  logicalCompletionPage,
  checkpointCategoryId,
  sourceFilename,
  withCompletionProvenance,
  runCompletion,
};
