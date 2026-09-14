#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          sourcing-product-read-comparison-staging
 * @domain        sourcing
 * @layer         script
 * @criticality   medium
 * @inputs        canonical_product_projection, historical_sourcing_candidate, historical_catalog_product
 * @outputs       parallel_product_read_comparison_report
 * @depends       db.js, services/sourcing-product-read-comparison.js
 * @db-read       sourcing_canonical_entities, sourcing_resolution_bindings, sourcing_observations, sourcing_captures, sourcing_candidates, products
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCE_PRODUCT_READ_COMPARISON.md
 * @impact-areas  sourcing, catalog
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const comparison = require('../services/sourcing-product-read-comparison');

async function run(argv = process.argv.slice(2)) {
  const requireCatalogLink = argv.includes('--require-catalog-link');
  const report = await comparison.collectProductReadComparison();
  console.log(JSON.stringify(report));
  if (report.verdict.status === 'FAIL') process.exitCode = 2;
  else if (requireCatalogLink && !report.verdict.ready_for_catalog_product_read_cutover_trial) process.exitCode = 3;
  return report;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`[sourcing-product-read-comparison] FAILED: ${error.stack || error}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { run };
