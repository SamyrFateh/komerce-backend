#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          sourcing-golden-e2e-staging
 * @domain        sourcing
 * @layer         script
 * @criticality   high
 * @inputs        persisted Source to Purchasing shadow lineage
 * @outputs       Golden multi-source JSON and terminal verdict
 * @depends       db.js, services/sourcing-golden-e2e-service.js
 * @db-read       sourcing_sources, sourcing_captures, sourcing_observations, sourcing_observation_evidence, sourcing_resolution_bindings, sourcing_canonical_entities, sourcing_canonical_entity_refs, sourcing_candidates, products, product_skus
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCING_GOLDEN_E2E.md
 * @impact-areas  sourcing, catalog, purchasing, supplier-integration, staging
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const golden = require('../services/sourcing-golden-e2e-service');

function parseArgs(argv = process.argv.slice(2)) {
  return { compact: argv.includes('--compact') };
}

function printSummary(report) {
  const lines = [
    ['INTEGRITY', report.integrity.status],
    ['RESOLUTION', report.resolution.status],
    ['CATALOG', report.catalog.status],
    ['UNIT IDENTITY', report.unit_identity.status],
    ['COMMANDABILITY', report.commandability.status],
  ];
  for (const [label, status] of lines) {
    console.log(label.padEnd(17) + status);
  }
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await golden.collectGoldenE2E();
  console.log(JSON.stringify(report, null, options.compact ? 0 : 2));
  printSummary(report);
  if (report.status !== 'PASS') process.exitCode = 2;
  return report;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('[sourcing-golden-e2e] FAILED: ' + (error.stack || error));
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { parseArgs, printSummary, run };
