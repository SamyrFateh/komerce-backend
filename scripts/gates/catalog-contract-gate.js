#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-contract-gate
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        tests/contract/**\/*.test.js (contrat v1 ING-1 + fixtures sales ING-3)
 * @outputs       exit_code, rapport_console
 * @depends       jest
 * @used-by       .github/workflows/ci.yml, npm run gate:catalog-contract
 * @db-read       @none
 * @db-write      @none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      DOCTRINE_INGESTION_CATALOGUE (ING-I4, ING-4)
 * @impact-areas  catalog, ci
 * @version       2026-07
 */

/**
 * KOMERCE — Gate CI catalogue (ING-4)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Répond par un code de sortie à LA question du fondateur (doctrine
 * DOCTRINE_INGESTION_CATALOGUE §8) :
 *
 *     « Un fournisseur sale peut-il polluer la raffinerie ? »
 *
 * Rejoue tests/contract/ (contrat pivot v1 — ING-1 — et le corpus de
 * fixtures sales — ING-3) et affiche un résultat lisible par fixture/règle,
 * puis quitte en 1 au premier sale accepté. Non contournable : ce script ne
 * lit ni n'honore governance/test-exemptions.json (qui gouverne un autre
 * gate, touched-tests-gate.js) — l'ingestion catalogue n'a pas d'exemption.
 *
 * Usage : npm run gate:catalog-contract
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const CONTRACT_DIR = 'tests/contract';

function resolveJestBin() {
  const bin = path.join(__dirname, '..', '..', 'node_modules', '.bin', process.platform === 'win32' ? 'jest.cmd' : 'jest');
  return bin;
}

/**
 * Lance jest en JSON sur tests/contract/ et retourne le rapport parsé.
 * jest sort avec un code != 0 dès qu'un test échoue — on récupère quand
 * même le JSON depuis stdout dans ce cas (comportement normal, pas une
 * panne d'exécution).
 */
function runContractTests() {
  const args = ['--testPathPattern', CONTRACT_DIR, '--json', '--runInBand'];
  let stdout;
  try {
    stdout = execFileSync(resolveJestBin(), args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      cwd: path.join(__dirname, '..', '..'),
    });
  } catch (err) {
    stdout = err.stdout ? err.stdout.toString('utf8') : '';
    if (!stdout) {
      console.error('✘  GATE FAILED — impossible de lancer jest sur tests/contract/.');
      console.error(`   ${err.message}`);
      process.exit(1);
    }
  }

  try {
    return JSON.parse(stdout);
  } catch (parseErr) {
    console.error('✘  GATE FAILED — sortie jest illisible (JSON invalide).');
    console.error(`   ${parseErr.message}`);
    process.exit(1);
  }
}

function main() {
  console.log('🔍  Gate catalogue (ING-4) — « un fournisseur sale peut-il polluer la raffinerie ? »');
  console.log(`    Rejoue ${CONTRACT_DIR}/ (contrat pivot v1 + corpus de fixtures sales)\n`);

  const report = runContractTests();

  if (!report.testResults || !report.testResults.length) {
    console.error('✘  GATE FAILED — aucune suite trouvée sous tests/contract/. Le gate ne peut rien vérifier.');
    process.exit(1);
  }

  let anyFailure = false;

  for (const suite of report.testResults) {
    const suiteFile = path.relative(process.cwd(), suite.testFilePath || suite.name || '');
    console.log(`── ${suiteFile} ──`);

    if (suite.testExecError) {
      anyFailure = true;
      console.log(`  ✘  suite en échec (erreur d'exécution) → GATE FAILED`);
      console.log(`       ${suite.testExecError.message || suite.testExecError}`);
      continue;
    }

    for (const test of suite.assertionResults) {
      const label = test.title;
      if (test.status === 'passed') {
        console.log(`  ✔  ${label}`);
      } else if (test.status === 'failed') {
        anyFailure = true;
        console.log(`  ✘  ${label} → GATE FAILED`);
        (test.failureMessages || []).forEach(msg => {
          console.log(`       ${String(msg).split('\n')[0]}`);
        });
      } else {
        // pending / todo — aucun cas attendu dans ce corpus, signalé sans bloquer
        console.log(`  ○  ${label} (${test.status})`);
      }
    }
    console.log('');
  }

  const failed = report.numFailedTests || 0;
  const total = report.numTotalTests || 0;
  const passed = report.numPassedTests || 0;

  if (anyFailure || failed > 0 || report.numFailedTestSuites > 0) {
    console.log(`✘  GATE FAILED — ${failed}/${total} test(s) de contrat en échec.`);
    console.log('   Un fournisseur sale peut polluer la raffinerie tel quel. Ne pas merger.');
    process.exit(1);
  }

  console.log(`✅  GATE OK — ${passed}/${total} tests de contrat verts.`);
  console.log('   Aucun fournisseur sale ne passe en silence (ING-I1 → ING-I8 respectés).');
  process.exit(0);
}

main();
