#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-wave2-sourcing-worker
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        existing AliExpress candidates, AliExpress Open Platform, DATABASE_URL
 * @outputs       up to 500 NEW distinct AliExpress sourcing candidates, fully refined
 * @depends       db.js, scripts/aliexpress-500-catalog-sync.js, services/suppliers/connectors/aliexpress-connected-connector.js, services/suppliers/connectors/aliexpress-connector.js, services/suppliers/catalog-import-orchestrator.js, services/suppliers/catalog-sync-checkpoint.js
 * @db-read       sourcing_candidates, supplier_catalog_sync_checkpoints
 * @db-write      supplier_catalog_imports, sourcing_candidates, sourcing_candidate_events, supplier_catalog_sync_checkpoints
 * @db-txn        canonical owners only; shared AliExpress advisory lock serializes sourcing workers
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md, docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, sourcing, supplier-import, refinery
 * @version       2026-09-wave2-v1
 */
'use strict';

const db = require('../db');
const primary = require('./aliexpress-500-catalog-sync');
const aliexpressConnector = require('../services/suppliers/connectors/aliexpress-connected-connector');
const aliexpressBaseConnector = require('../services/suppliers/connectors/aliexpress-connector');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const checkpoints = require('../services/suppliers/catalog-sync-checkpoint');

const WAVE_ID = 'wave2-500-v1';
const WAVE_TARGET = 500;
const DEFAULT_SYNC_KEY = 'aliexpress-wave2-500-v1';
const FLAG = 'KOMERCE_ALLOW_ALIEXPRESS_WAVE2';
const SEARCH_SORT = 'salesDesc';
const SEARCH_LOCALE = 'en_US';
const SEARCH_CURRENCY = 'USD';
const DEFAULT_SEARCH_PAGES_PER_QUERY = 8;

// New commercial vocabulary on purpose. These are discovery hints only;
// canonical category classification remains owned by the Refinery.
const WAVE_QUERIES = Object.freeze([
  { keyword: 'maxi summer dress', category: 'Mode & Beauté', subcategory: 'Femme' },
  { keyword: 'linen women blouse', category: 'Mode & Beauté', subcategory: 'Femme' },
  { keyword: 'women crossbody bag', category: 'Mode & Beauté', subcategory: 'Femme' },
  { keyword: 'men polo shirt', category: 'Mode & Beauté', subcategory: 'Homme' },
  { keyword: 'men cargo pants', category: 'Mode & Beauté', subcategory: 'Homme' },
  { keyword: 'men casual sneakers', category: 'Mode & Beauté', subcategory: 'Homme' },
  { keyword: 'kids jacket', category: 'Mode & Beauté', subcategory: 'Enfant' },
  { keyword: 'kids sandals', category: 'Mode & Beauté', subcategory: 'Enfant' },
  { keyword: 'children backpack', category: 'Mode & Beauté', subcategory: 'Enfant' },
  { keyword: 'facial cleansing brush', category: 'Mode & Beauté', subcategory: 'Beauté' },
  { keyword: 'nail uv lamp', category: 'Mode & Beauté', subcategory: 'Beauté' },
  { keyword: 'makeup organizer', category: 'Mode & Beauté', subcategory: 'Beauté' },
  { keyword: 'hair dryer brush', category: 'Mode & Beauté', subcategory: 'Beauté' },

  { keyword: 'vacuum storage bags', category: 'Maison', subcategory: 'Confort' },
  { keyword: 'bedside night lamp', category: 'Maison', subcategory: 'Confort' },
  { keyword: 'bathroom storage rack', category: 'Maison', subcategory: 'Confort' },
  { keyword: 'portable fan', category: 'Maison', subcategory: 'Confort' },
  { keyword: 'silicone kitchen utensils', category: 'Maison', subcategory: 'Cuisine' },
  { keyword: 'spice rack organizer', category: 'Maison', subcategory: 'Cuisine' },
  { keyword: 'lunch box insulated', category: 'Maison', subcategory: 'Cuisine' },
  { keyword: 'manual food chopper', category: 'Maison', subcategory: 'Cuisine' },
  { keyword: 'wall mirror decor', category: 'Maison', subcategory: 'Déco' },
  { keyword: 'decorative cushion cover', category: 'Maison', subcategory: 'Déco' },
  { keyword: 'artificial plant decor', category: 'Maison', subcategory: 'Déco' },
  { keyword: 'kids learning toy', category: 'Maison', subcategory: 'Enfants' },
  { keyword: 'pencil case school', category: 'Maison', subcategory: 'Enfants' },
  { keyword: 'drawing set kids', category: 'Maison', subcategory: 'Enfants' },

  { keyword: 'magnetic phone stand', category: 'Tech', subcategory: 'Phones' },
  { keyword: 'usb c fast charging cable', category: 'Tech', subcategory: 'Phones' },
  { keyword: 'phone camera lens kit', category: 'Tech', subcategory: 'Phones' },
  { keyword: 'wireless charging stand', category: 'Tech', subcategory: 'Phones' },
  { keyword: 'tws earbuds', category: 'Tech', subcategory: 'Audio' },
  { keyword: 'mini bluetooth speaker', category: 'Tech', subcategory: 'Audio' },
  { keyword: 'gaming headset', category: 'Tech', subcategory: 'Audio' },
  { keyword: 'wireless lavalier microphone', category: 'Tech', subcategory: 'Audio' },
  { keyword: 'fitness smart band', category: 'Tech', subcategory: 'Montres' },
  { keyword: 'smart watch women', category: 'Tech', subcategory: 'Montres' },
  { keyword: 'digital sports watch', category: 'Tech', subcategory: 'Montres' },

  { keyword: 'socket wrench set', category: 'Bricolage', subcategory: 'Outillage' },
  { keyword: 'cordless screwdriver', category: 'Bricolage', subcategory: 'Outillage' },
  { keyword: 'precision screwdriver kit', category: 'Bricolage', subcategory: 'Outillage' },
  { keyword: 'voltage tester pen', category: 'Bricolage', subcategory: 'Electricité' },
  { keyword: 'wire connector kit', category: 'Bricolage', subcategory: 'Electricité' },
  { keyword: 'smart wall socket', category: 'Bricolage', subcategory: 'Electricité' },
  { keyword: 'door alarm sensor', category: 'Bricolage', subcategory: 'Sécurité' },
  { keyword: 'security camera wifi', category: 'Bricolage', subcategory: 'Sécurité' },
  { keyword: 'combination padlock', category: 'Bricolage', subcategory: 'Sécurité' },

  { keyword: 'wedding table decoration', category: 'Créations personnelles', subcategory: 'Cérémonie' },
  { keyword: 'wedding invitation cards', category: 'Créations personnelles', subcategory: 'Cérémonie' },
  { keyword: 'cake topper wedding', category: 'Créations personnelles', subcategory: 'Cérémonie' },
  { keyword: 'gift wrapping box', category: 'Créations personnelles', subcategory: 'Cadeau' },
  { keyword: 'personalized keyring', category: 'Créations personnelles', subcategory: 'Cadeau' },
  { keyword: 'photo frame gift', category: 'Créations personnelles', subcategory: 'Cadeau' },
  { keyword: 'thermal label stickers', category: 'Créations personnelles', subcategory: 'Impression' },
  { keyword: 'printable sticker paper', category: 'Créations personnelles', subcategory: 'Impression' },

  { keyword: 'cabin air filter car', category: 'Auto', subcategory: 'Filtres' },
  { keyword: 'engine air filter car', category: 'Auto', subcategory: 'Filtres' },
  { keyword: 'ceramic brake pads', category: 'Auto', subcategory: 'Freinage' },
  { keyword: 'brake caliper tool', category: 'Auto', subcategory: 'Freinage' },
  { keyword: 'led fog lights car', category: 'Auto', subcategory: 'Éclairage' },
  { keyword: 'car interior led light', category: 'Auto', subcategory: 'Éclairage' },
  { keyword: 'motorcycle gloves', category: 'Auto', subcategory: 'Moto' },
  { keyword: 'motorcycle mirror', category: 'Auto', subcategory: 'Moto' },
  { keyword: 'motorcycle led indicator', category: 'Auto', subcategory: 'Moto' },
]);

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function waveConfig(env = process.env) {
  const runtime = primary.runtimeEnvironment(env);
  if (runtime === 'production') throw new Error('REFUS: Wave 2 AliExpress interdite en production');
  if (!isTruthy(env[FLAG])) throw new Error(`${FLAG}=1 requis`);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (!env.ALIEXPRESS_APP_KEY || !env.ALIEXPRESS_APP_SECRET) {
    throw new Error('ALIEXPRESS_APP_KEY et ALIEXPRESS_APP_SECRET requis');
  }
  if (!env.ALIEXPRESS_SESSION && !env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY) {
    throw new Error('ALIEXPRESS_SESSION ou ALIEXPRESS_TOKEN_ENCRYPTION_KEY requis');
  }
  return {
    runtime,
    syncKey: String(env.KOMERCE_ALIEXPRESS_WAVE2_SYNC_KEY || DEFAULT_SYNC_KEY).trim() || DEFAULT_SYNC_KEY,
    countryCode: primary.normalizeCountryCode(env.KOMERCE_ALIEXPRESS_COUNTRY_CODE),
    pageSize: primary.intEnv('KOMERCE_ALIEXPRESS_PAGE_SIZE', primary.DEFAULT_PAGE_SIZE, 1, 50, env),
    maxSearchPagesPerQuery: primary.intEnv(
      'KOMERCE_ALIEXPRESS_WAVE2_SEARCH_PAGES_PER_QUERY',
      DEFAULT_SEARCH_PAGES_PER_QUERY,
      1,
      20,
      env
    ),
    detailDelayMs: primary.intEnv(
      'KOMERCE_ALIEXPRESS_DETAIL_DELAY_MS',
      primary.DEFAULT_DETAIL_DELAY_MS,
      0,
      5000,
      env
    ),
    detailRetryAttempts: primary.intEnv(
      'KOMERCE_ALIEXPRESS_DETAIL_RETRY_ATTEMPTS',
      primary.DEFAULT_DETAIL_RETRY_ATTEMPTS,
      1,
      10,
      env
    ),
  };
}

function logicalWavePage(logicalPage, queries = WAVE_QUERIES) {
  const n = Number.parseInt(logicalPage, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error('logicalPage doit être >= 1');
  if (!Array.isArray(queries) || !queries.length) throw new Error('WAVE_QUERIES vide');
  const queryIndex = (n - 1) % queries.length;
  return {
    ...queries[queryIndex],
    queryIndex,
    queryPage: Math.floor((n - 1) / queries.length) + 1,
  };
}

function checkpointCategoryId() {
  return `text:${WAVE_ID}`;
}

function waveSourceFilename(syncKey, logicalPage) {
  return `aliexpress-pool/${syncKey}/${WAVE_ID}/page-${String(logicalPage).padStart(4, '0')}.json`;
}

function withWaveProvenance(product, spec) {
  const rawPayload = product?.raw_payload || {};
  return {
    ...product,
    raw_payload: {
      ...rawPayload,
      discovery: {
        ...(rawPayload.discovery || {}),
        source: 'aliexpress.ds.text.search',
        wave: WAVE_ID,
        target_category: spec.category,
        target_subcategory: spec.subcategory,
        keyword: spec.keyword,
        query_page: spec.queryPage,
        supplier_destination_country: spec.countryCode,
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

async function countWaveClean() {
  const { rows: [row] } = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM sourcing_candidates sc
      WHERE sc.supplier_name = $1
        AND sc.raw_payload #>> '{discovery,wave}' = $2
        AND sc.supplier_product_id IS NOT NULL
        AND sc.state IN ('scanned', 'imported_to_catalog')
        AND COALESCE(sc.product_name, '') <> ''
        AND sc.image_url ~ '^https://'
        AND sc.purchase_price IS NOT NULL
        AND sc.purchase_price > 0
        AND ${primary.stockSqlPredicate('sc')}`,
    [primary.SUPPLIER_NAME, WAVE_ID]
  );
  return Number(row?.count || 0);
}

async function auditWave() {
  const { rows: [summary] } = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE normalized_source_contract IS NOT NULL)::int AS normalized_v2,
            COUNT(*) FILTER (WHERE state = 'scanned')::int AS scanned,
            COUNT(*) FILTER (WHERE state = 'imported_to_catalog')::int AS promoted
       FROM sourcing_candidates
      WHERE supplier_name = $1
        AND raw_payload #>> '{discovery,wave}' = $2`,
    [primary.SUPPLIER_NAME, WAVE_ID]
  );
  const { rows: decisions } = await db.query(
    `SELECT COALESCE(scan_result->>'sourcing_decision', 'UNKNOWN') AS decision,
            COUNT(*)::int AS count
       FROM sourcing_candidates
      WHERE supplier_name = $1
        AND raw_payload #>> '{discovery,wave}' = $2
      GROUP BY 1 ORDER BY 1`,
    [primary.SUPPLIER_NAME, WAVE_ID]
  );
  const { rows: categories } = await db.query(
    `SELECT COALESCE(komerce_category, 'UNRESOLVED') AS category,
            COUNT(*)::int AS count
       FROM sourcing_candidates
      WHERE supplier_name = $1
        AND raw_payload #>> '{discovery,wave}' = $2
      GROUP BY 1 ORDER BY count DESC, category`,
    [primary.SUPPLIER_NAME, WAVE_ID]
  );
  return {
    total: Number(summary?.total || 0),
    normalized_v2: Number(summary?.normalized_v2 || 0),
    scanned: Number(summary?.scanned || 0),
    promoted: Number(summary?.promoted || 0),
    decisions: Object.fromEntries(decisions.map(row => [row.decision, Number(row.count)])),
    categories: Object.fromEntries(categories.map(row => [row.category, Number(row.count)])),
  };
}

async function importFetchedSubset({ syncKey, logicalPage, subset, spec }) {
  if (!subset.length) return { accepted: 0, rejected: 0, import_id: null };
  const body = {
    supplier_name: primary.SUPPLIER_NAME,
    source_type: 'api',
    source_filename: waveSourceFilename(syncKey, logicalPage),
    notes: `AliExpress ${WAVE_ID} — ${spec.category}/${spec.subcategory} — ${spec.keyword} — page ${logicalPage}`,
    is_full_snapshot: false,
  };
  const dispatchSubset = async () => ({ products: subset, invalid: [], total: subset.length });
  const result = await catalogImportOrchestrator.importCatalog(body, null, dispatchSubset);
  if (result.status !== 200) {
    throw new Error(`AliExpress ${WAVE_ID} p${logicalPage} refusé (${result.status}): ${JSON.stringify(result.body).slice(0, 1000)}`);
  }
  return result.body;
}

async function runWaveLocked(config, providerEnv) {
  const baselineKnown = await countKnownSupplierIds();
  const startingWave = await countWaveClean();
  if (startingWave > WAVE_TARGET) {
    throw new Error(`Wave 2 déjà au-dessus de la cible: ${startingWave}/${WAVE_TARGET}`);
  }
  if (startingWave >= WAVE_TARGET) {
    const audit = await auditWave();
    const output = {
      runtime: config.runtime,
      wave: WAVE_ID,
      sync_key: config.syncKey,
      baseline_known: baselineKnown - startingWave,
      wave_clean: startingWave,
      target_new: WAVE_TARGET,
      added_this_run: 0,
      paused_reason: 'target-already-reached',
      refinery: audit,
    };
    console.log(`[aliexpress-wave2] ${JSON.stringify(output)}`);
    return output;
  }

  const categoryId = checkpointCategoryId();
  const maxLogicalPages = WAVE_QUERIES.length * config.maxSearchPagesPerQuery;
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
      categoryPath: `AliExpress ${WAVE_ID} / nouveau sourcing`,
      totalPages: maxLogicalPages,
      totalRecords: WAVE_TARGET,
      cappedBySupplier: false,
    });
  }

  const seenIds = await loadSeenSupplierIds();
  let logicalPage = Math.max(1, Number(checkpoint?.next_page) || 1);
  let pages = 0;
  console.log(`[aliexpress-wave2] runtime=${config.runtime} baselineKnown=${baselineKnown} waveStart=${startingWave}/${WAVE_TARGET} queries=${WAVE_QUERIES.length} pagesPerQuery=${config.maxSearchPagesPerQuery}`);

  while (logicalPage <= maxLogicalPages) {
    const before = await countWaveClean();
    const remaining = WAVE_TARGET - before;
    if (remaining <= 0) break;

    const spec = logicalWavePage(logicalPage);
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
      .map(product => withWaveProvenance(product, {
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
    const after = await countWaveClean();
    if (after > WAVE_TARGET) throw new Error(`Cap Wave 2 dépassé: ${after}/${WAVE_TARGET}`);

    checkpoint = await checkpoints.recordPageSuccess(db, {
      supplierName: primary.SUPPLIER_NAME,
      syncKey: config.syncKey,
      categoryId,
      page: logicalPage,
      totalPages: maxLogicalPages,
      totalRecords: WAVE_TARGET,
      accepted: imported.accepted || 0,
      rejected: (imported.rejected || 0) + connectorInvalid + filteredOut,
      requestId: searchPayload?.request_id || null,
      cappedBySupplier: false,
    });
    pages += 1;
    if ((imported.accepted || 0) > 0) {
      console.log(`[aliexpress-wave2] keyword=${JSON.stringify(spec.keyword)} queryPage=${spec.queryPage} added=${imported.accepted || 0} wave=${after}/${WAVE_TARGET}`);
    }
    if (after >= WAVE_TARGET) break;
    logicalPage += 1;
  }

  const finalWave = await countWaveClean();
  const audit = await auditWave();
  const finalKnown = await countKnownSupplierIds();
  const output = {
    runtime: config.runtime,
    wave: WAVE_ID,
    sync_key: config.syncKey,
    baseline_known: baselineKnown - startingWave,
    final_known: finalKnown,
    starting_wave_clean: startingWave,
    final_wave_clean: finalWave,
    target_new: WAVE_TARGET,
    added_this_run: finalWave - startingWave,
    pages_this_run: pages,
    paused_reason: finalWave >= WAVE_TARGET ? 'target-reached' : 'search-plan-exhausted',
    refinery: audit,
  };
  console.log(`[aliexpress-wave2] ${JSON.stringify(output)}`);
  return output;
}

async function runWave() {
  const config = waveConfig();
  const lockClient = await primary.acquireRunLock();
  if (!lockClient) {
    const output = {
      runtime: config.runtime,
      wave: WAVE_ID,
      target_new: WAVE_TARGET,
      paused_reason: 'another-run-active',
    };
    console.log(`[aliexpress-wave2] ${JSON.stringify(output)}`);
    return output;
  }
  try {
    const providerEnv = await aliexpressConnector.managedRuntimeEnv();
    return await runWaveLocked(config, providerEnv);
  } finally {
    await primary.releaseRunLock(lockClient);
  }
}

if (require.main === module) {
  runWave()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[aliexpress-wave2] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  WAVE_ID,
  WAVE_TARGET,
  DEFAULT_SYNC_KEY,
  FLAG,
  WAVE_QUERIES,
  waveConfig,
  logicalWavePage,
  checkpointCategoryId,
  waveSourceFilename,
  withWaveProvenance,
  countWaveClean,
  auditWave,
  runWave,
};
