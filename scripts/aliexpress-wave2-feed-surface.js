#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-wave2-feed-surface-worker
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        AliExpress DS feeds/categories, Wave 2 state, DATABASE_URL
 * @outputs       additional distinct Wave 2 candidates until 500 clean products
 * @depends       db.js, scripts/aliexpress-wave2-sourcing.js, scripts/aliexpress-500-catalog-sync.js, scripts/aliexpress-feed-surface-proof.js, scripts/aliexpress-feed-topup-runtime.js, scripts/aliexpress-500-feed-category-topup.js, services/suppliers/connectors/aliexpress-connected-connector.js, services/suppliers/connectors/aliexpress-connector.js, services/suppliers/catalog-import-orchestrator.js, services/suppliers/catalog-sync-checkpoint.js
 * @db-read       sourcing_candidates, supplier_catalog_sync_checkpoints, supplier_oauth_connections
 * @db-write      supplier_catalog_imports, sourcing_candidates, sourcing_candidate_events, supplier_catalog_sync_checkpoints, supplier_oauth_connections
 * @db-txn        shared AliExpress advisory lock; canonical import owns candidate writes
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md, docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, sourcing, supplier-import, refinery
 * @version       2026-09-wave2-feed-surface-v1
 */
'use strict';

const db = require('../db');
const primary = require('./aliexpress-500-catalog-sync');
const wave2 = require('./aliexpress-wave2-sourcing');
const proof = require('./aliexpress-feed-surface-proof');
const surfaceRuntime = require('./aliexpress-feed-topup-runtime');
const feedTopup = require('./aliexpress-500-feed-category-topup');
const connected = require('../services/suppliers/connectors/aliexpress-connected-connector');
const importer = require('../services/suppliers/catalog-import-orchestrator');
const checkpoints = require('../services/suppliers/catalog-sync-checkpoint');

const SURFACE_ID = 'wave2-feed-category-v1';
const DEFAULT_SYNC_KEY = 'aliexpress-wave2-feed-category-v1';

function configFromEnv(env = process.env) {
  const base = wave2.waveConfig(env);
  return {
    ...base,
    syncKey: String(env.KOMERCE_ALIEXPRESS_WAVE2_FEED_SYNC_KEY || DEFAULT_SYNC_KEY).trim() || DEFAULT_SYNC_KEY,
  };
}

function withWaveSurfaceProvenance(product, spec, countryCode) {
  const projected = primary.withDiscoveryProvenance(product, {
    segment: {
      id: SURFACE_ID,
      category: spec.categoryName || 'AliExpress feed',
      subcategory: spec.feed,
    },
    keyword: `feed:${spec.feed}|category:${spec.categoryId || 'all'}`,
    queryPage: spec.page,
    countryCode,
  });
  return {
    ...projected,
    raw_payload: {
      ...(projected.raw_payload || {}),
      discovery: {
        ...(projected.raw_payload?.discovery || {}),
        source: 'aliexpress.ds.recommend.feed.get',
        wave: wave2.WAVE_ID,
        wave_leg: SURFACE_ID,
        feed_name: spec.feed,
        supplier_category_id: spec.categoryId || null,
        supplier_category_name: spec.categoryName || null,
        query_page: spec.page,
        supplier_destination_country: countryCode,
      },
    },
  };
}

async function seenIds() {
  const { rows } = await db.query(
    'SELECT supplier_product_id FROM sourcing_candidates WHERE supplier_name=$1 AND supplier_product_id IS NOT NULL',
    [primary.SUPPLIER_NAME]
  );
  return new Set(rows.map((row) => row.supplier_product_id).filter(Boolean));
}

async function importProducts(config, logicalPage, products, spec) {
  if (!products.length) return { accepted: 0, rejected: 0 };
  const result = await importer.importCatalog({
    supplier_name: primary.SUPPLIER_NAME,
    source_type: 'api',
    source_filename: `aliexpress-pool/${config.syncKey}/${wave2.WAVE_ID}/${SURFACE_ID}/page-${String(logicalPage).padStart(4, '0')}.json`,
    notes: `AliExpress ${wave2.WAVE_ID} ${SURFACE_ID} feed=${spec.feed} category=${spec.categoryId || 'all'} page=${spec.page}`,
    is_full_snapshot: false,
  }, null, async () => ({ products, invalid: [], total: products.length }));
  if (result.status !== 200) {
    throw new Error(`Import ${SURFACE_ID} refusé (${result.status}): ${JSON.stringify(result.body).slice(0, 800)}`);
  }
  return result.body;
}

async function runLocked(config, providerEnv) {
  const start = await wave2.countWaveClean();
  if (start >= wave2.WAVE_TARGET) {
    return { starting_clean: start, final_clean: start, target: wave2.WAVE_TARGET, paused_reason: 'target-already-reached' };
  }

  const feeds = proof.feedNames(await feedTopup.invokeTopWithBackoff(
    'aliexpress.ds.feedname.get', {}, providerEnv, config.detailRetryAttempts
  ));
  const categories = proof.categories(await feedTopup.invokeTopWithBackoff(
    'aliexpress.ds.category.get', {}, providerEnv, config.detailRetryAttempts
  ));
  const slots = surfaceRuntime.plan(feeds, categories);
  if (!slots.length) throw new Error(`Aucune surface AliExpress: feeds=${feeds.length} categories=${categories.length}`);

  const categoryId = `surface:${SURFACE_ID}`;
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
      categoryPath: `AliExpress ${wave2.WAVE_ID} feeds + categories`,
      totalPages: slots.length,
      totalRecords: wave2.WAVE_TARGET,
      cappedBySupplier: false,
    });
  }

  const seen = await seenIds();
  let n = Math.max(1, Number(checkpoint?.next_page) || 1);
  let pages = 0;
  console.log(`[aliexpress-wave2-surface] runtime=${config.runtime} start=${start}/${wave2.WAVE_TARGET} missing=${wave2.WAVE_TARGET - start} feeds=${feeds.length} categories=${categories.length} slots=${slots.length} known=${seen.size}`);

  while (n <= slots.length && await wave2.countWaveClean() < wave2.WAVE_TARGET) {
    const spec = slots[n - 1];
    let payload;
    try {
      payload = await feedTopup.invokeTopWithBackoff('aliexpress.ds.recommend.feed.get', {
        country: config.countryCode,
        target_currency: 'USD',
        target_language: 'EN',
        page_size: config.pageSize,
        page_no: spec.page,
        category_id: spec.categoryId,
        sort: 'volumeDesc',
        feed_name: spec.feed,
      }, providerEnv, config.detailRetryAttempts);
    } catch (error) {
      if (!surfaceRuntime.isEmptyResultError(error)) throw error;
      payload = {};
    }

    const ids = proof.productIds(payload).filter((id) => !seen.has(id));
    const fetched = ids.length ? await primary.fetchProductsRateLimited(ids.slice(0, config.pageSize), {
      countryCode: config.countryCode,
      providerEnv,
      detailDelayMs: config.detailDelayMs,
      detailRetryAttempts: config.detailRetryAttempts,
    }) : { products: [], invalid: [] };

    const before = await wave2.countWaveClean();
    const clean = (fetched.products || [])
      .map((product) => withWaveSurfaceProvenance(product, spec, config.countryCode))
      .filter(primary.basicCleanProduct)
      .filter((product) => !seen.has(product.supplier_product_id));
    const subset = clean.slice(0, wave2.WAVE_TARGET - before);
    const imported = await importProducts(config, n, subset, spec);
    subset.forEach((product) => seen.add(product.supplier_product_id));
    const after = await wave2.countWaveClean();
    if (after > wave2.WAVE_TARGET) throw new Error(`Cap Wave 2 dépassé: ${after}/${wave2.WAVE_TARGET}`);

    checkpoint = await checkpoints.recordPageSuccess(db, {
      supplierName: primary.SUPPLIER_NAME,
      syncKey: config.syncKey,
      categoryId,
      page: n,
      totalPages: slots.length,
      totalRecords: wave2.WAVE_TARGET,
      accepted: imported.accepted || 0,
      rejected: imported.rejected || 0,
      requestId: payload?.request_id || null,
      cappedBySupplier: false,
    });
    pages++;
    if ((imported.accepted || 0) > 0) {
      console.log(`[aliexpress-wave2-surface] feed=${JSON.stringify(spec.feed)} category=${spec.categoryId || 'all'} page=${spec.page} ids=${ids.length} added=${imported.accepted} clean=${after}/${wave2.WAVE_TARGET}`);
    }
    n++;
  }

  const final = await wave2.countWaveClean();
  const audit = await wave2.auditWave();
  const out = {
    runtime: config.runtime,
    wave: wave2.WAVE_ID,
    surface: SURFACE_ID,
    starting_clean: start,
    final_clean: final,
    target: wave2.WAVE_TARGET,
    added: final - start,
    missing_after: Math.max(0, wave2.WAVE_TARGET - final),
    feeds_discovered: feeds.length,
    categories_discovered: categories.length,
    pages_this_run: pages,
    promoted: audit.promoted,
    decisions: audit.decisions,
    categories: audit.categories,
    paused_reason: final >= wave2.WAVE_TARGET ? 'target-reached' : 'surface-plan-exhausted',
  };
  console.log(`[aliexpress-wave2-surface] ${JSON.stringify(out)}`);
  return out;
}

async function run() {
  const config = configFromEnv();
  const lock = await primary.acquireRunLock();
  if (!lock) return { target: wave2.WAVE_TARGET, paused_reason: 'another-run-active' };
  try {
    return await runLocked(config, await connected.managedRuntimeEnv());
  } finally {
    await primary.releaseRunLock(lock);
  }
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`[aliexpress-wave2-surface] FAILED: ${error.stack || error}`);
      process.exit(1);
    });
}

module.exports = { SURFACE_ID, DEFAULT_SYNC_KEY, configFromEnv, withWaveSurfaceProvenance, runLocked, run };
