#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          sourcing-shadow-proof-staging
 * @domain        sourcing
 * @layer         script
 * @criticality   medium
 * @inputs        shadow sourcing tables
 * @outputs       multi-source proof JSON report
 * @depends       db.js, services/sourcing-shadow-proof-service.js
 * @db-read       sourcing_sources, sourcing_captures, sourcing_observations, sourcing_observation_evidence, sourcing_canonical_entities, sourcing_resolution_bindings, sourcing_resolution_decisions
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCE_SHADOW_PROOF.md
 * @impact-areas  sourcing, supplier-integration
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const proof = require('../services/sourcing-shadow-proof-service');

function parseArgs(argv = process.argv.slice(2)) {
  return {
    requireReady: argv.includes('--require-ready'),
    compact: argv.includes('--compact'),
  };
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await proof.collectShadowProof();
  const serialized = JSON.stringify(report, null, options.compact ? 0 : 2);
  console.log(serialized);

  if (report.verdict.status === 'FAIL') process.exitCode = 2;
  else if (options.requireReady && !report.verdict.ready_for_product_projection_trial) process.exitCode = 3;

  return report;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`[sourcing-shadow-proof] FAILED: ${error.stack || error}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { parseArgs, run };
