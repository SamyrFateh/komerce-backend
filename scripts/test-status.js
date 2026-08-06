#!/usr/bin/env node
'use strict';

/**
 * scripts/test-status.js — "vérification générale" (mission Étape 5, mode 1).
 *
 * Ne lance JAMAIS les suites `@test-requires postgres` elle-même si
 * PostgreSQL n'est pas prêt : les compte comme NOT RUN — ENVIRONMENT
 * UNAVAILABLE, jamais comme rouge. Pour forcer l'exécution réelle de la
 * campagne integration/e2e-api (mode 2, environnement exigé), utiliser
 * `npm run test:integration` / `npm run test:e2e:features`, qui font leur
 * propre preflight et échouent au niveau ENVIRONMENT si besoin — jamais en
 * listant de fausses suites FAIL (scripts/lib/pg-preflight.js).
 *
 * Usage : node scripts/test-status.js [--skip-unit]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { checkPostgresPreflight } = require('./lib/pg-preflight');

const ROOT = path.resolve(__dirname, '..');
const SKIP_UNIT = process.argv.includes('--skip-unit');

function countSuites(dir, ext) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return 0;
  return fs.readdirSync(abs).filter((n) => n.endsWith(ext)).length;
}

function runHeaderCheck() {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts/test-header-check.js'), '--json'], {
    cwd: ROOT, encoding: 'utf8',
  });
  try {
    return JSON.parse(res.stdout);
  } catch {
    return { total: 0, byKind: {}, byRunner: {}, errors: [{ file: '(scan)', code: 'SCAN_FAILED', detail: res.stderr }] };
  }
}

function runUnitLane() {
  // Some suites log to stdout (dotenv, pino) which corrupts a plain --json
  // stdout capture — write the JSON report to a temp file instead so the
  // machine-readable summary is never mixed with test console output.
  const outFile = path.join(ROOT, '.tmp-test-status-unit.json');
  const res = spawnSync(
    process.execPath,
    [require.resolve('jest/bin/jest'), '--config', 'jest.unit.config.js', '--runInBand', '--forceExit',
      '--json', `--outputFile=${outFile}`],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } catch {
    // fall through — report stays null, treated as executed-but-unparseable
  } finally {
    fs.rmSync(outFile, { force: true });
  }
  return { exitCode: res.status, report };
}

async function main() {
  const classification = runHeaderCheck();

  const integrationSuiteCount = countSuites('tests/integration', '.test.js');
  const e2eApiSuiteCount = countSuites('tests/e2e-api', '.test.js');
  const boutiqueE2eCount = countSuites('public/boutique/tests/e2e/authenticated', '.spec.js')
    + (fs.existsSync(path.join(ROOT, 'public/boutique/tests/e2e'))
      ? fs.readdirSync(path.join(ROOT, 'public/boutique/tests/e2e')).filter((n) => n.endsWith('.spec.js')).length
      : 0);

  const preflight = await checkPostgresPreflight();

  let unit = { exitCode: null, report: null };
  if (!SKIP_UNIT) {
    unit = runUnitLane();
  }

  const passed = unit.report ? unit.report.numPassedTests : null;
  const failed = unit.report ? unit.report.numFailedTests : null;
  const skipped = unit.report ? unit.report.numPendingTests + unit.report.numTodoTests : null;

  console.log('TEST CLASSIFICATION');
  console.log(`  total suites: ${classification.total}`);
  console.log(`  unit: ${classification.byKind.unit || 0}`);
  console.log(`  integration: ${classification.byKind.integration || 0}`);
  console.log(`  e2e: ${classification.byKind.e2e || 0}`);
  console.log(`  jest: ${classification.byRunner.jest || 0}`);
  console.log(`  playwright: ${classification.byRunner.playwright || 0}`);

  console.log('\nENVIRONMENT');
  console.log(`  postgres: ${preflight.ready ? 'AVAILABLE' : 'UNAVAILABLE'} (${preflight.reason})`);
  console.log('  webapp: UNKNOWN (not probed by test:status — see test:e2e:features for the real E2E lane)');

  console.log('\nEXECUTION');
  if (SKIP_UNIT) {
    console.log('  unit lane: SKIPPED (--skip-unit)');
  } else {
    console.log(`  executed (unit): ${unit.report ? unit.report.numTotalTests : 'unknown (jest output unparseable)'}`);
    console.log(`  PASS: ${passed ?? 'unknown'}`);
    console.log(`  FAIL: ${failed ?? 'unknown'}`);
    console.log(`  skipped/todo: ${skipped ?? 'unknown'}`);
  }
  if (preflight.ready) {
    console.log(`  integration (${integrationSuiteCount} suites) + e2e-api (${e2eApiSuiteCount} suites): ` +
      `NOT executed by test:status — run \`npm run test:integration\` / \`npm run test:e2e:features\``);
  } else {
    console.log(`  NOT RUN (environment): integration (${integrationSuiteCount} suites), ` +
      `e2e-api (${e2eApiSuiteCount} suites) — PostgreSQL unavailable`);
    console.log(`  NOT RUN (environment): boutique authenticated e2e (${boutiqueE2eCount} specs) — needs a running webapp`);
  }
  console.log(`  classification errors: ${classification.errors.length}`);

  console.log('\nREAL FAILURES');
  if (unit.report && failed > 0) {
    for (const suite of unit.report.testResults) {
      for (const t of suite.testResults) {
        if (t.status === 'failed') {
          console.log(`  - ${path.relative(ROOT, suite.testFilePath)} :: ${t.fullName}`);
        }
      }
    }
  } else {
    console.log('  NONE (unit lane)');
  }

  console.log('\nHARNESS DEBT');
  if (classification.errors.length) {
    for (const e of classification.errors) console.log(`  - ${e.file} — ${e.code}: ${e.detail}`);
  } else {
    console.log('  NONE (0 classification errors)');
  }

  const hardFailure = (unit.exitCode !== null && unit.exitCode !== 0) || classification.errors.length > 0;
  process.exitCode = hardFailure ? 1 : 0;
}

main();
