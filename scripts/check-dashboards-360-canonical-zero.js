#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch-lite
 * @feature       dashboard
 * @domain        governance
 * @owner         backend-core
 *
 * Fail-closed zero-debt gate for the Canonical dashboard 360 projection.
 * Unlike the rollback Legacy map, the new Canonical proof starts clean:
 * there is therefore no tolerance baseline to maintain or grow.
 */

const fs = require('fs');
const path = require('path');

const REPORT = path.resolve(__dirname, '..', 'docs', 'DASHBOARDS_360_CANONICAL.json');

const BLOCKING = Object.freeze({
  surfaceWithoutModule: 'surface de navigation sans module',
  navHrefUnresolved: 'destination de navigation non résolue',
  notFoundContracts: 'endpoint appelé absent du contrat OpenAPI',
  legacyDependencies: 'dépendance Canonical vers Legacy',
  clientMarketAuthoritySuspects: 'autorité Market ID construite côté navigateur',
});

function fail(message) {
  console.error(`✖ Dashboards 360 Canonical — ${message}`);
  process.exit(1);
}

if (!fs.existsSync(REPORT)) {
  fail('projection absente; exécuter d’abord gen-dashboards-360-canonical.js');
}

let report;
try {
  report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
} catch (error) {
  fail(`projection JSON invalide: ${error.message}`);
}

if (!report || typeof report !== 'object' || !report.diagnostics || typeof report.diagnostics !== 'object') {
  fail('projection invalide: diagnostics absents');
}

const failures = [];
for (const [key, label] of Object.entries(BLOCKING)) {
  const entries = report.diagnostics[key];
  if (!Array.isArray(entries)) {
    failures.push(`${key}: diagnostic absent ou non-tableau`);
    continue;
  }
  for (const entry of entries) failures.push(`${label}: ${entry}`);
}

if (failures.length) {
  console.error(`✖ Dashboards 360 Canonical — ${failures.length} anomalie(s) bloquante(s), budget autorisé = 0`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('✔ Dashboards 360 Canonical — budget zéro respecté');
console.log('  0 surface sans module');
console.log('  0 navigation non résolue');
console.log('  0 endpoint statique absent du contrat');
console.log('  0 dépendance Legacy');
console.log('  0 autorité Market ID suspecte côté navigateur');
