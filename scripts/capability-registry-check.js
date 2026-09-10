'use strict';

const fs = require('fs');
const path = require('path');
const { CAPABILITIES, autonomyStats } = require('../config/market-delegation-capabilities');
const { validateRegistry } = require('../services/capability-registry');

const CHECKPOINT = Object.freeze({
  lot: '5-client-case',
  total: 42,
  delegation: 31,
  live: 26,
  p0_live: 15,
});

function checkMigrationCoverage(root = path.join(__dirname, '..')) {
  const sql = fs.readFileSync(path.join(root, 'migrations', '193_market_delegation_capability_registry.sql'), 'utf8');
  return CAPABILITIES.filter(row => !sql.includes(`'${row.capability}'`)).map(row => row.capability);
}

function runCheck({ root = path.join(__dirname, '..'), print = true } = {}) {
  const validation = validateRegistry(CAPABILITIES);
  const stats = autonomyStats(CAPABILITIES);
  const missingFromMigration = checkMigrationCoverage(root);
  const errors = [...validation.errors];
  if (CAPABILITIES.length !== CHECKPOINT.total) errors.push(`expected_${CHECKPOINT.total}_total_got_${CAPABILITIES.length}`);
  if (stats.total !== CHECKPOINT.delegation) errors.push(`expected_${CHECKPOINT.delegation}_delegation_got_${stats.total}`);
  if (stats.live !== CHECKPOINT.live) errors.push(`expected_${CHECKPOINT.live}_live_got_${stats.live}`);
  if (missingFromMigration.length) errors.push(`migration_missing:${missingFromMigration.join(',')}`);
  const result = { ok: errors.length === 0, errors, total: CAPABILITIES.length, autonomy: stats, checkpoint: CHECKPOINT };
  if (print) {
    const pct = Math.round(stats.rate * 100);
    console.log(`[market-delegation] ${CHECKPOINT.lot} registry ${result.ok ? 'OK' : 'FAIL'} — ${stats.live}/${stats.total} LIVE (${pct}%), ${CAPABILITIES.length} total; P0=${CHECKPOINT.p0_live}/${CHECKPOINT.delegation}`);
    for (const error of errors) console.error(` - ${error}`);
  }
  return result;
}

if (require.main === module) {
  const result = runCheck();
  if (!result.ok) process.exitCode = 1;
}

module.exports = { CHECKPOINT, runCheck, checkMigrationCoverage };
