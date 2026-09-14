#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          sourcing-operational-integrity-audit
 * @domain        sourcing
 * @layer         script
 * @criticality   high
 * @inputs        persisted sourcing lineage, canonical identities, supplier SKU readiness
 * @outputs       HEALTHY_ATTENTION_BROKEN_integrity_report
 * @depends       db.js, services/sourcing-integrity-service.js
 * @db-read       via services/sourcing-integrity-service.js
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCING_OPERATIONAL_INTEGRITY.md, docs/doctrine/DOCTRINE_SOURCING_FINAL_AUTHORITY.md
 * @impact-areas  sourcing, catalog, purchasing, supplier-integration, staging
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const integrity = require('../services/sourcing-integrity-service');

function printSummary(report) {
  const lines = [
    ['INTEGRITY', report.integrity.status],
    ['IDEMPOTENCY', report.idempotency.status],
    ['RESOLUTION', report.resolution.status],
    ['CATALOG', report.catalog.status],
    ['UNIT IDENTITY', report.unit_identity.status],
    ['PURCHASING', report.purchasing_readiness.status],
  ];
  console.log(`OVERALL          ${report.status}`);
  for (const [label, status] of lines) console.log(label.padEnd(17) + status);
}

function parseArgs(argv = process.argv.slice(2)) {
  return { compact: argv.includes('--compact') };
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await integrity.collectIntegrityAudit();
  console.log(JSON.stringify(report, null, options.compact ? 0 : 2));
  printSummary(report);
  if (report.status === 'BROKEN') process.exitCode = 2;
  return report;
}

if (require.main === module) {
  run()
    .catch(error => {
      console.error('[sourcing-integrity-audit] FAILED: ' + (error.stack || error));
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  REPORT_VERSION: integrity.REPORT_VERSION,
  buildIntegrityAudit: integrity.buildIntegrityAudit,
  collectIntegrityAudit: integrity.collectIntegrityAudit,
  parseArgs,
  printSummary,
  run,
};
