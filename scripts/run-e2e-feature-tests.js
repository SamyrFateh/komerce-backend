#!/usr/bin/env node
'use strict';

/**
 * Runner canonique des E2E fonctionnels Feature First (tests/e2e-api/**).
 *
 * Même doctrine que scripts/run-integration-tests.js : un processus Jest par
 * fichier, pour qu'un pool PostgreSQL ou un handle ouvert ne contamine jamais
 * la suite suivante ; toutes les suites sont exécutées même après un échec,
 * puis un bilan exhaustif est affiché et le process sort en erreur si au moins
 * une suite est rouge.
 *
 * Convention de nommage — c'est elle qui porte l'ownership :
 *
 *     tests/e2e-api/<feature>.<scenario>.e2e.test.js
 *
 * Le segment avant le premier point EST la feature propriétaire déclarée dans
 * features/<feature>.feature.js (champ files.tests). Un fichier appartient à
 * exactement une feature ; les features traversées sont documentées dans
 * l'en-tête du scénario, jamais par une seconde déclaration d'ownership.
 *
 * Usage :
 *   node scripts/run-e2e-feature-tests.js                  # tout
 *   node scripts/run-e2e-feature-tests.js --feature=orders # une feature
 *   node scripts/run-e2e-feature-tests.js --lot=1          # un lot
 *
 * Précondition : DATABASE_URL pointe une base de test construite depuis
 * docs/db/railway-live-schema.sql puis réconciliée par scripts/ci-migrate.js.
 * Sans DATABASE_URL les suites se skippent proprement (voir
 * tests/helpers/e2eDbKit.js) — elles n'échouent pas en dur.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const E2E_DIR = path.join(ROOT, 'tests', 'e2e-api');
const JEST_BIN = require.resolve('jest/bin/jest');

// Lots du chantier E2E Feature First — ordre = criticité fonctionnelle.
const LOTS = {
  1: ['auth', 'auth-identity', 'catalog', 'shared-cart', 'orders', 'payments'],
  2: ['purchasing', 'logistics', 'inventory', 'customs', 'refunds', 'wallet',
      'loyalty', 'unsold-resolution'],
  3: ['business-rules', 'economic-engine', 'notifications', 'documents',
      'recommendations', 'incident-management', 'decision-signals', 'dashboard',
      'platform-ops', 'infrastructure', 'sourcing'],
};

function parseArgs(argv) {
  const out = { feature: null, lot: null };
  for (const arg of argv.slice(2)) {
    const feature = /^--feature=(.+)$/.exec(arg);
    if (feature) { out.feature = feature[1]; continue; }
    const lot = /^--lot=(.+)$/.exec(arg);
    if (lot) { out.lot = lot[1]; continue; }
    throw new Error(`Argument inconnu : ${arg}`);
  }
  return out;
}

/** @returns {{file: string, feature: string}[]} */
function listSuites() {
  if (!fs.existsSync(E2E_DIR)) return [];
  return fs.readdirSync(E2E_DIR)
    .filter((name) => name.endsWith('.e2e.test.js'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map((name) => ({
      file: path.join('tests', 'e2e-api', name).replace(/\\/g, '/'),
      feature: name.split('.')[0],
    }));
}

function selectSuites(suites, { feature, lot }) {
  if (feature) {
    const kept = suites.filter((s) => s.feature === feature);
    if (!kept.length) {
      const known = [...new Set(suites.map((s) => s.feature))].sort().join(', ') || '(aucune)';
      throw new Error(`Aucun E2E pour la feature « ${feature} ». Features couvertes : ${known}`);
    }
    return kept;
  }
  if (lot) {
    const members = LOTS[lot];
    if (!members) throw new Error(`Lot inconnu : ${lot} (valeurs : ${Object.keys(LOTS).join(', ')})`);
    return suites.filter((s) => members.includes(s.feature));
  }
  return suites;
}

function runSuite(suite) {
  console.log(`\n── ${suite.file}  [feature: ${suite.feature}] ──`);
  const result = spawnSync(
    process.execPath,
    [JEST_BIN, suite.file, '--ci', '--runInBand', '--forceExit'],
    { cwd: ROOT, env: process.env, stdio: 'inherit' }
  );

  if (result.error) {
    console.error(`FAIL ${suite.file}: ${result.error.message}`);
    return false;
  }
  const passed = result.status === 0;
  console.log(`${passed ? 'PASS' : 'FAIL'} ${suite.file}`);
  return passed;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.warn(
      '[e2e] DATABASE_URL absent — les suites se skipperont. ' +
      'Voir .github/workflows/ci.yml pour la base de test canonique.'
    );
  }

  const all = listSuites();
  let suites;
  try {
    suites = selectSuites(all, args);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
    return;
  }

  if (!suites.length) {
    console.log('Aucune suite E2E sélectionnée.');
    return;
  }

  const failures = [];
  for (const suite of suites) {
    if (!runSuite(suite)) failures.push(suite.file);
  }

  const scope = args.feature ? `feature ${args.feature}`
    : args.lot ? `lot ${args.lot}`
      : 'tous lots';

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(
    `E2E Feature First (${scope}) : ${suites.length} suite(s), ` +
    `${suites.length - failures.length} passée(s), ${failures.length} en échec.`
  );

  if (failures.length) {
    console.error('\nSuites en échec :');
    for (const file of failures) console.error(`- ${file}`);
    process.exitCode = 1;
    return;
  }
  console.log('Toutes les suites E2E sélectionnées sont vertes.');
}

main();

module.exports = { LOTS, listSuites, selectSuites };
