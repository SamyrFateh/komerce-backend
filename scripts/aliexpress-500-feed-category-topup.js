'use strict';

const primary = require('./aliexpress-500-catalog-sync');
const proof = require('./aliexpress-feed-surface-proof');
const connected = require('../services/suppliers/connectors/aliexpress-connected-connector');
const base = require('../services/suppliers/connectors/aliexpress-connector');
const checkpoints = require('../services/suppliers/catalog-sync-checkpoint');
const runtime = require('../services/suppliers/aliexpress-feed-topup-runtime');

async function runLocked(config, env) {
  const start = await runtime.countClean();
  if (start >= config.maxCleanProducts) return { starting_clean: start, final_clean: start, target: config.maxCleanProducts, paused_reason: 'target-already-reached' };

  const feeds = proof.feedNames(await base.invokeTop('aliexpress.ds.feedname.get', {}, { env }));
  const categories = proof.categories(await base.invokeTop('aliexpress.ds.category.get', {}, { env }));
  const slots = runtime.plan(feeds, categories);
  if (!slots.length) throw new Error(`Aucune surface AliExpress: feeds=${feeds.length} categories=${categories.length}`);

  const cid = `surface:${runtime.SURFACE_ID}`;
  let cp = await checkpoints.getCheckpoint(require('../db'), { supplierName: primary.SUPPLIER_NAME, syncKey: config.syncKey, categoryId: cid });
  if (!cp) cp = await checkpoints.ensureCheckpoint(require('../db'), { supplierName: primary.SUPPLIER_NAME, syncKey: config.syncKey, categoryId: cid, categoryPath: 'AliExpress feeds + categories', totalPages: slots.length, totalRecords: config.maxCleanProducts, cappedBySupplier: false });

  const seen = await runtime.seenIds();
  let n = Math.max(1, Number(cp?.next_page) || 1);
  let pages = 0;
  console.log(`[aliexpress-feed-topup] start=${start} target=${config.maxCleanProducts} feeds=${feeds.length} categories=${categories.length} slots=${slots.length}`);

  while (n <= slots.length && await runtime.countClean() < config.maxCleanProducts) {
    const spec = slots[n - 1];
    const payload = await base.invokeTop('aliexpress.ds.recommend.feed.get', {
      country: config.countryCode,
      target_currency: 'USD',
      target_language: 'EN',
      page_size: config.pageSize,
      page_no: spec.page,
      category_id: spec.categoryId,
      sort: 'volumeDesc',
      feed_name: spec.feed,
    }, { env });
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
    cp = await checkpoints.recordPageSuccess(require('../db'), { supplierName: primary.SUPPLIER_NAME, syncKey: config.syncKey, categoryId: cid, page: n, totalPages: slots.length, totalRecords: config.maxCleanProducts, accepted: imported.accepted || 0, rejected: imported.rejected || 0, requestId: payload?.request_id || null, cappedBySupplier: false });
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
module.exports = { run };
