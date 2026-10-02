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
const { checkPostgresPreflight } = require('./lib/pg-preflight');

const ROOT = path.resolve(__dirname, '..');
const INTEGRATION_DIR = path.join(ROOT, 'tests', 'integration');
const FEATURES_DIR = path.join(ROOT, 'features');
const JEST_BIN = require.resolve('jest/bin/jest');

function norm(file) {
  return String(file || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function argValue(flag) {
  const args = process.argv.slice(2);
  const inline = args.find(arg => arg.startsWith(flag + '='));
  if (inline) return inline.slice(flag.length + 1);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

function flattenFiles(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) {
      if (typeof item === 'string') out.push(norm(item));
      else flattenFiles(item, out);
    }
    return out;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) flattenFiles(value, out);
  }
  return out;
}

function loadFeatureManifests() {
  if (!fs.existsSync(FEATURES_DIR)) return [];
  return fs.readdirSync(FEATURES_DIR)
    .filter(name => name.endsWith('.feature.js'))
    .map(name => require(path.join(FEATURES_DIR, name)))
    .filter(Boolean);
}

function integrationTests(manifest) {
  return [...new Set(flattenFiles(manifest?.files || {})
    .filter(file => /^tests\/integration\/.+\.test\.js$/i.test(file)))].sort();
}

function selectSuitesForFiles(files, manifests = loadFeatureManifests()) {
  const changed = [...new Set((files || []).map(norm).filter(Boolean))];
  if (!changed.length) {
    return { mode: 'full', owners: [], suites: listSuites(), reason: 'no scoped files' };
  }

  const runtime = changed.filter(file =>
    /^(?:server\.js|routes|services|middleware|utils|validators|core|bootstrap|db)\//i.test(file)
    || file === 'server.js'
  );
  const candidates = runtime.length
    ? runtime
    : changed.filter(file => /^tests\/integration\//i.test(file));

  if (!candidates.length) {
    return { mode: 'skip', owners: [], suites: [], reason: 'no integration runtime impact' };
  }

  const ownership = new Map();
  for (const manifest of manifests) {
    const owner = String(manifest?.name || '').trim();
    if (!owner) continue;
    for (const file of new Set(flattenFiles(manifest?.files || {}))) {
      if (!ownership.has(file)) ownership.set(file, []);
      ownership.get(file).push(owner);
    }
  }

  const owners = new Set();
  for (const file of candidates) {
    const matches = ownership.get(file) || [];
    if (matches.length !== 1) {
      return {
        mode: 'full',
        owners: [],
        suites: listSuites(),
        reason: matches.length ? `ambiguous ownership: ${file}` : `unowned integration runtime: ${file}`,
      };
    }
    owners.add(matches[0]);
  }

  const suites = [...new Set(
    manifests
      .filter(manifest => owners.has(String(manifest?.name || '').trim()))
      .flatMap(integrationTests)
  )].sort();

  if (!suites.length) {
    return {
      mode: 'full',
      owners: [...owners].sort(),
      suites: listSuites(),
      reason: 'owned runtime has no declared integration suite',
    };
  }

  return {
    mode: 'targeted',
    owners: [...owners].sort(),
    suites,
    reason: 'feature-owned integration scope',
  };
}

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

async function main() {
  // Campagne integration explicitement demandée (cette commande n'existe
  // que pour ça) : PostgreSQL absent/mal configuré est une ENVIRONMENT
  // FAILURE, jamais une liste de suites FAIL fabriquée par des timeouts de
  // connexion (mission §5). Un seul preflight, avant la première suite.
  const preflight = await checkPostgresPreflight();
  if (!preflight.ready) {
    console.error('ENVIRONMENT NOT READY: PostgreSQL unavailable');
    console.error('0 tests executed');
    console.error(`Reason (${preflight.stage}): ${preflight.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`POSTGRES: available — ${preflight.reason}`);

  const filesArg = argValue('--files');
  const scopedFiles = filesArg ? filesArg.split(',').map(norm).filter(Boolean) : [];
  const selection = selectSuitesForFiles(scopedFiles);
  const suites = selection.suites;
  const failures = [];

  console.log(`Integration scope: ${selection.mode} — ${selection.reason}`);
  if (selection.owners.length) console.log(`Integration owners: ${selection.owners.join(', ')}`);
  if (selection.mode === 'skip') {
    console.log('Aucune suite d’intégration nécessaire pour ce diff.');
    return;
  }

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

if (require.main === module) {
  main();
}

module.exports = {
  norm,
  flattenFiles,
  loadFeatureManifests,
  integrationTests,
  selectSuitesForFiles,
  listSuites,
};

