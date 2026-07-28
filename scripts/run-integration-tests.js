#!/usr/bin/env node
'use strict';

/**
 * Runner canonique des suites d'intégration Komerce.
 *
 * Chaque fichier Jest tourne dans son propre processus afin qu'un mock global,
 * un pool PostgreSQL ou un handle ouvert ne contamine jamais la suite suivante.
 * Toutes les suites sont exécutées, même après un échec, puis un bilan exhaustif
 * est affiché et le processus sort en erreur si au moins une suite est rouge.
 *
 * Précondition : DATABASE_URL pointe vers une base construite depuis
 * docs/db/railway-live-schema.sql puis réconciliée par scripts/ci-migrate.js.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const INTEGRATION_DIR = path.join(ROOT, 'tests', 'integration');
const JEST_BIN = require.resolve('jest/bin/jest');

function listSuites() {
  return fs.readdirSync(INTEGRATION_DIR)
    .filter(name => name.endsWith('.test.js'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(name => path.join('tests', 'integration', name).replace(/\\/g, '/'));
}

function runSuite(suite) {
  console.log(`\n── ${suite} ──`);
  const result = spawnSync(
    process.execPath,
    [JEST_BIN, suite, '--ci', '--forceExit'],
    {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
    }
  );

  if (result.error) {
    console.error(`FAIL ${suite}: ${result.error.message}`);
    return false;
  }

  const passed = result.status === 0;
  console.log(`${passed ? 'PASS' : 'FAIL'} ${suite}`);
  return passed;
}

function main() {
  const suites = listSuites();
  const failures = [];

  for (const suite of suites) {
    if (!runSuite(suite)) failures.push(suite);
  }

  const passed = suites.length - failures.length;
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`Integration suites: ${suites.length} total, ${passed} passed, ${failures.length} failed`);

  if (failures.length > 0) {
    console.error('\nSuites en échec :');
    for (const suite of failures) console.error(`- ${suite}`);
    process.exitCode = 1;
    return;
  }

  console.log('Toutes les suites d’intégration sont vertes.');
}

main();
