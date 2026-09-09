'use strict';

const fs = require('fs');
const path = require('path');
const { CAPABILITIES, autonomyStats } = require('../config/market-delegation-capabilities');
const { validateRegistry } = require('../services/capability-registry');

function checkMigrationCoverage(root = path.join(__dirname, '..')) {
  const sql = fs.readFileSync(path.join(root, 'migrations', '193_market_delegation_capability_registry.sql'), 'utf8');
  return CAPABILITIES.filter(row => !sql.includes(`'${row.capability}'`)).map(row => row.capability);
}

function runCheck({ root = path.join(__dirname, '..'), print = true } = {}) {
  const validation = validateRegistry(CAPABILITIES);
  const stats = autonomyStats(CAPABILITIES);
  const missingFromMigration = checkMigrationCoverage(root);
  const errors = [...validation.errors];
  if (CAPABILITIES.length !== 42) errors.push(`expected_42_total_got_${CAPABILITIES.length}`);
  if (stats.total !== 31) errors.push(`expected_31_delegation_got_${stats.total}`);
  if (stats.live !== 15) errors.push(`expected_15_live_got_${stats.live}`);
  if (missingFromMigration.length) errors.push(`migration_missing:${missingFromMigration.join(',')}`);
  const result = { ok: errors.length === 0, errors, total: CAPABILITIES.length, autonomy: stats };
  if (print) {
    const pct = Math.round(stats.rate * 100);
    console.log(`[market-delegation] registry ${result.ok ? 'OK' : 'FAIL'} — ${stats.live}/${stats.total} LIVE (${pct}%), ${CAPABILITIES.length} total`);
    for (const error of errors) console.error(` - ${error}`);
  }
  return result;
}

if (require.main === module) {
  const result = runCheck();
  if (!result.ok) process.exitCode = 1;
}

module.exports = { runCheck, checkMigrationCoverage };
