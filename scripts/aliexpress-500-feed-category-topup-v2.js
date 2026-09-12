#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-feed-category-topup-empty-tolerant-worker
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        AliExpress DS feed/category surface, existing pool
 * @outputs       resumed clean AliExpress pool capped at 500
 * @depends       scripts/aliexpress-500-feed-category-topup.js, scripts/aliexpress-feed-topup-runtime.js, services/suppliers/connectors/aliexpress-connector.js
 * @used-by       Railway staging one-shot worker
 * @db-read       sourcing_candidates, supplier_catalog_sync_checkpoints
 * @db-write      sourcing_candidates, sourcing_candidate_events, supplier_catalog_sync_checkpoints
 * @db-txn        delegated to canonical worker/services
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md, docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, sourcing, supplier-import
 */
'use strict';

const runtime = require('./aliexpress-feed-topup-runtime');
const base = require('../services/suppliers/connectors/aliexpress-connector');
const originalInvokeTop = base.invokeTop.bind(base);

base.invokeTop = async function invokeTopEmptyTolerant(method, params, options) {
  try {
    return await originalInvokeTop(method, params, options);
  } catch (error) {
    if (method === 'aliexpress.ds.recommend.feed.get' && runtime.isEmptyResultError(error)) {
      console.log(`[aliexpress-feed-topup] empty feed=${JSON.stringify(params?.feed_name || null)} category=${params?.category_id || 'all'} page=${params?.page_no || 1}`);
      return {};
    }
    throw error;
  }
};

const worker = require('./aliexpress-500-feed-category-topup');

if (require.main === module) {
  worker.run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`[aliexpress-feed-topup] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    });
}

module.exports = { run: worker.run };
