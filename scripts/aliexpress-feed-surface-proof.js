'use strict';
const connected = require('../services/suppliers/connectors/aliexpress-connected-connector');
const base = require('../services/suppliers/connectors/aliexpress-connector');

const asArray = (v) => Array.isArray(v) ? v : (v == null ? [] : [v]);
const unwrap = (p = {}) => p?.resp_result?.result || p?.result?.result || p?.result || p || {};

function feedNames(payload) {
  const r = unwrap(payload);
  return asArray(r?.promos?.promo || r?.promos || r?.promo)
    .map((x) => String(x?.promo_name || x?.feed_name || '').trim())
    .filter(Boolean);
}

function categories(payload) {
  const r = unwrap(payload);
  return asArray(r?.categories?.category || r?.categories || r?.category)
    .map((x) => ({ id: String(x?.category_id || '').trim(), name: String(x?.category_name || '').trim() }))
    .filter((x) => /^\d+$/.test(x.id));
}

function productIds(payload) {
  const out = new Set();
  function walk(v, depth = 0) {
    if (!v || typeof v !== 'object' || depth > 10) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    const id = String(v.product_id || v.itemId || '').trim();
    if (/^\d{5,20}$/.test(id)) out.add(id);
    Object.values(v).forEach((x) => walk(x, depth + 1));
  }
  walk(payload);
  return [...out];
}

async function run() {
  const env = await connected.managedRuntimeEnv();
  const feeds = feedNames(await base.invokeTop('aliexpress.ds.feedname.get', {}, { env }));
  const cats = categories(await base.invokeTop('aliexpress.ds.category.get', {}, { env }));
  const samples = [];
  for (const feed of feeds.slice(0, 12)) {
    const payload = await base.invokeTop('aliexpress.ds.recommend.feed.get', {
      country: 'AE', target_currency: 'USD', target_language: 'EN', page_size: 20, page_no: 1,
      sort: 'volumeDesc', feed_name: feed,
    }, { env });
    samples.push({ feed, ids: productIds(payload).length });
  }
  console.log(JSON.stringify({ feeds: feeds.length, categories: cats.length, samples }));
}

if (require.main === module) run().catch((e) => { console.error(e.stack || e); process.exitCode = 1; });
module.exports = { feedNames, categories, productIds };
