#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-product-read-cutover-trial-staging
 * @domain        sourcing
 * @layer         script
 * @criticality   medium
 * @inputs        proven_catalog_product_link, canonical_product_projection
 * @outputs       controlled_read_seam_trial_report
 * @depends       db.js, services/catalog-product-read-cutover-trial.js
 * @db-read       sourcing_canonical_entities, sourcing_resolution_bindings, sourcing_observations, sourcing_captures, sourcing_candidates, products
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOG_PRODUCT_READ_CUTOVER_TRIAL.md
 * @impact-areas  sourcing, catalog
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const trial = require('../services/catalog-product-read-cutover-trial');

async function run(argv = process.argv.slice(2)) {
  const requireRouteCanary = argv.includes('--require-route-canary');
  const report = await trial.collectCatalogProductReadCutoverTrial();
  console.log(JSON.stringify(report));
  if (report.verdict.status === 'FAIL') process.exitCode = 2;
  else if (requireRouteCanary && !report.verdict.ready_for_route_canary) process.exitCode = 3;
  return report;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`[catalog-product-read-cutover-trial] FAILED: ${error.stack || error}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { run };
