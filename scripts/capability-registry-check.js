'use strict';

const fs = require('fs');
const path = require('path');
const { CAPABILITIES, autonomyStats } = require('../config/market-delegation-capabilities');
const { validateRegistry } = require('../services/capability-registry');

const CHECKPOINT = Object.freeze({
  lot: '9-catalog-read',
  total: 44,
  delegation: 33,
  live: 32,
  p0_live: 15,
});

function checkMigrationCoverage(root = path.join(__dirname, '..')) {
  // Historiquement ce check ne lisait que 193_market_delegation_capability_registry.sql
  // (la déclaration de base). Mais depuis, de nouvelles capabilities sont
  // introduites directement par leur propre migration dédiée (ex.
  // 210_market_delegation_structure_event_record_live.sql,
  // 223_market_delegation_decision_signal_manage_live.sql) sans jamais être
  // rétro-ajoutées à 193 — et ne doivent pas l'être : les migrations
  // appliquées sont append-only (scripts/check-migration-immutability.js).
  // On scanne donc l'historique complet des migrations numérotées, pas un
  // seul fichier figé dans le temps.
  const migrationsDir = path.join(root, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => /^\d+.*\.sql$/.test(f));
  const combined = files.map(f => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n');
  return CAPABILITIES.filter(row => !combined.includes(`'${row.capability}'`)).map(row => row.capability);
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
