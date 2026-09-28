'use strict';
const connected = require('../services/suppliers/connectors/aliexpress-connected-connector');
const base = require('../services/suppliers/connectors/aliexpress-connector');
const discovery = require('../services/suppliers/aliexpress-discovery');

const { feedNames, categories, productIds } = discovery;

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
