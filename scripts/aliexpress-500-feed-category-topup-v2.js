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
const STARTUP_DELAY_MS = 8000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

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

async function runOneShot() {
  console.log(`[aliexpress-feed-topup] rollout_delay_ms=${STARTUP_DELAY_MS}`);
  await sleep(STARTUP_DELAY_MS);
  const result = await worker.run();
  console.log(`[aliexpress-feed-topup] one_shot_result=${JSON.stringify(result)}`);
  return result;
}

if (require.main === module) {
  runOneShot()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`[aliexpress-feed-topup] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    });
}

module.exports = { STARTUP_DELAY_MS, run: runOneShot };
