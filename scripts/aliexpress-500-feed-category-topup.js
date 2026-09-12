/**
 * @komerce-arch
 * @role          aliexpress-feed-category-topup-worker
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        AliExpress DS feeds/categories, existing sourcing pool, DATABASE_URL
 * @outputs       clean AliExpress sourcing candidates capped at 500
 * @depends       scripts/aliexpress-500-catalog-sync.js, scripts/aliexpress-feed-surface-proof.js, scripts/aliexpress-feed-topup-runtime.js, services/suppliers/connectors/aliexpress-connected-connector.js, services/suppliers/connectors/aliexpress-connector.js, services/suppliers/catalog-sync-checkpoint.js
 * @used-by       Railway staging one-shot worker
 * @db-read       supplier_catalog_sync_checkpoints, sourcing_candidates, supplier_oauth_connections
 * @db-write      supplier_catalog_sync_checkpoints, supplier_catalog_imports, sourcing_candidates, sourcing_candidate_events, supplier_oauth_connections
 * @db-txn        shared AliExpress advisory lock; canonical import owns candidate writes
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md, docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, sourcing, supplier-import
 */
'use strict';

const db = require('../db');
const primary = require('./aliexpress-500-catalog-sync');
const proof = require('./aliexpress-feed-surface-proof');
const runtime = require('./aliexpress-feed-topup-runtime');
const connected = require('../services/suppliers/connectors/aliexpress-connected-connector');
const base = require('../services/suppliers/connectors/aliexpress-connector');
const checkpoints = require('../services/suppliers/catalog-sync-checkpoint');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

async function invokeTopWithBackoff(method, params, env, attempts) {
  const maxAttempts = Math.max(1, Number(attempts) || 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await base.invokeTop(method, params, { env });
    } catch (error) {
      const waitSeconds = primary.rateLimitWaitSeconds(error);
      if (waitSeconds == null || attempt >= maxAttempts) throw error;
      const delayMs = (waitSeconds + 2) * 1000;
      console.warn(`[aliexpress-feed-topup] throttle method=${method} attempt=${attempt}/${maxAttempts} wait_ms=${delayMs}`);
      await sleep(delayMs);
    }
  }
  throw new Error(`AliExpress ${method} retry exhausted`);
}

async function runLocked(config, env) {
  const start = await runtime.countClean();
  if (start >= config.maxCleanProducts) return { starting_clean: start, final_clean: start, target: config.maxCleanProducts, paused_reason: 'target-already-reached' };

  const feeds = proof.feedNames(await invokeTopWithBackoff('aliexpress.ds.feedname.get', {}, env, config.detailRetryAttempts));
  const categories = proof.categories(await invokeTopWithBackoff('aliexpress.ds.category.get', {}, env, config.detailRetryAttempts));
  const slots = runtime.plan(feeds, categories);
  if (!slots.length) throw new Error(`Aucune surface AliExpress: feeds=${feeds.length} categories=${categories.length}`);

  const cid = `surface:${runtime.SURFACE_ID}`;
  let cp = await checkpoints.getCheckpoint(db, { supplierName: primary.SUPPLIER_NAME, syncKey: config.syncKey, categoryId: cid });
  if (!cp) cp = await checkpoints.ensureCheckpoint(db, { supplierName: primary.SUPPLIER_NAME, syncKey: config.syncKey, categoryId: cid, categoryPath: 'AliExpress feeds + categories', totalPages: slots.length, totalRecords: config.maxCleanProducts, cappedBySupplier: false });

  const seen = await runtime.seenIds();
  let n = Math.max(1, Number(cp?.next_page) || 1);
  let pages = 0;
  console.log(`[aliexpress-feed-topup] start=${start} target=${config.maxCleanProducts} feeds=${feeds.length} categories=${categories.length} slots=${slots.length}`);

  while (n <= slots.length && await runtime.countClean() < config.maxCleanProducts) {
    const spec = slots[n - 1];
    const payload = await invokeTopWithBackoff('aliexpress.ds.recommend.feed.get', {
      country: config.countryCode,
      target_currency: 'USD',
      target_language: 'EN',
      page_size: config.pageSize,
      page_no: spec.page,
      category_id: spec.categoryId,
      sort: 'volumeDesc',
      feed_name: spec.feed,
    }, env, config.detailRetryAttempts);
    const ids = proof.productIds(payload).filter((id) => !seen.has(id));
    const fetched = ids.length ? await primary.fetchProductsRateLimited(ids.slice(0, config.pageSize), {
      countryCode: config.countryCode,
      providerEnv: env,
      detailDelayMs: config.detailDelayMs,
      detailRetryAttempts: config.detailRetryAttempts,
    }) : { products: [] };
    const before = await runtime.countClean();
    const clean = (fetched.products || []).map((p) => primary.withDiscoveryProvenance(p, {
      segment: { id: runtime.SURFACE_ID, category: spec.categoryName || 'AliExpress feed', subcategory: spec.feed },
      keyword: `feed:${spec.feed}|category:${spec.categoryId || 'all'}`,
      queryPage: spec.page,
      countryCode: config.countryCode,
    })).filter(primary.basicCleanProduct).filter((p) => !seen.has(p.supplier_product_id));
    const subset = clean.slice(0, config.maxCleanProducts - before);
    const imported = await runtime.importProducts(config, n, subset, spec);
    subset.forEach((p) => seen.add(p.supplier_product_id));
    const after = await runtime.countClean();
    cp = await checkpoints.recordPageSuccess(db, { supplierName: primary.SUPPLIER_NAME, syncKey: config.syncKey, categoryId: cid, page: n, totalPages: slots.length, totalRecords: config.maxCleanProducts, accepted: imported.accepted || 0, rejected: imported.rejected || 0, requestId: payload?.request_id || null, cappedBySupplier: false });
    pages++;
    if ((imported.accepted || 0) > 0) console.log(`[aliexpress-feed-topup] feed=${JSON.stringify(spec.feed)} category=${spec.categoryId || 'all'} ids=${ids.length} added=${imported.accepted} clean=${after}/${config.maxCleanProducts}`);
    n++;
  }

  const final = await runtime.countClean();
  const out = { runtime: config.runtime, sync_key: config.syncKey, surface: runtime.SURFACE_ID, starting_clean: start, final_clean: final, target: config.maxCleanProducts, added: final - start, feeds_discovered: feeds.length, categories_discovered: categories.length, pages_this_run: pages, paused_reason: final >= config.maxCleanProducts ? 'target-reached' : 'surface-plan-exhausted' };
  console.log(`[aliexpress-feed-topup] ${JSON.stringify(out)}`);
  return out;
}

async function run() {
  const config = primary.runtimeConfig();
  const lock = await primary.acquireRunLock();
  if (!lock) return { target: config.maxCleanProducts, paused_reason: 'another-run-active' };
  try { return await runLocked(config, await connected.managedRuntimeEnv()); }
  finally { await primary.releaseRunLock(lock); }
}

if (require.main === module) run().then(() => process.exit(0)).catch((e) => { console.error(`[aliexpress-feed-topup] FAILED: ${e.stack || e}`); process.exit(1); });
module.exports = { invokeTopWithBackoff, run };
