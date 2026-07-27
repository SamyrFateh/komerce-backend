#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch
 * @role          feature-invariant-check
 * @domain        governance
 * @layer         gate
 * @criticality   high
 * @inputs        features/*.feature.js, tests/invariants/
 * @outputs       rapport + exit code
 * @depends       jest, features/*.feature.js
 * @used-by       scripts/map-check.js, package.json (map:check)
 * @db-read       none
 * @db-txn        none
 * @doctrine      invariant_executable_non_speculatif
 * @impact-areas  governance, all-features
 * @version       2026-07
 *
 * ── Pourquoi ce gate existe ────────────────────────────────────────────────
 * Les manifestes features/*.feature.js peuvent déclarer des invariants sous
 * deux formes :
 *
 *   Forme chaîne  : 'description textuelle'      → non exécutable, informatif
 *   Forme objet   : { statement, test: 'path' }  → exécutable, vérifié ici
 *
 * Ce gate vérifie, pour tout invariant portant un champ `test` :
 *   1. Le fichier de test référencé EXISTE sur disque.
 *   2. Le test PASSE (jest --testPathPattern sur ce fichier).
 *
 * Sans ce gate, la forme { statement, test } est une déclaration d'intention,
 * pas une garantie — exactement le problème qu'elle prétend résoudre.
 *
 * ── R2 : comment prouver que ce gate est faillible ────────────────────────
 *   1. Référencer un fichier inexistant → échec "fichier introuvable"
 *   2. Casser une assertion dans le test → échec "test échoue"
 *   3. Restaurer → vert
 *
 * Usage :
 *   node scripts/feature-invariant-check.js            ← rapport
 *   node scripts/feature-invariant-check.js --strict   ← bloque (CI)
 *   node scripts/feature-invariant-check.js --verbose  ← sortie jest incluse
 */

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT    = path.resolve(__dirname, '..');
const FEAT_DIR = path.join(ROOT, 'features');
const strict  = process.argv.includes('--strict');
const verbose = process.argv.includes('--verbose');

const GRN = '\x1b[32m', RED = '\x1b[31m', YEL = '\x1b[33m', BLD = '\x1b[1m', DIM = '\x1b[2m', R = '\x1b[0m';

// ── 1. Collecter tous les invariants {statement, test} ────────────────────

const collected = [];   // { feature, statement, testFile, absPath }
const manifestes = fs.readdirSync(FEAT_DIR)
  .filter(f => f.endsWith('.feature.js'))
  .sort();

for (const fname of manifestes) {
  let manifest;
  try { manifest = require(path.join(FEAT_DIR, fname)); }
  catch (e) { continue; }

  const featureId = (manifest.id || fname.replace('.feature.js', ''));
  for (const inv of (manifest.invariants || [])) {
    if (typeof inv !== 'object' || !inv.test) continue;
    collected.push({
      feature:   featureId,
      statement: inv.statement || '(sans libellé)',
      testFile:  inv.test,
      absPath:   path.resolve(ROOT, inv.test),
    });
  }
}

console.log(`${BLD}Feature Invariant Check — invariants exécutables${R}`);
console.log(`${DIM}  ${manifestes.length} manifeste(s) scanné(s) · ${collected.length} invariant(s) exécutable(s)${R}\n`);

if (!collected.length) {
  console.log(`${YEL}⚠ Aucun invariant {statement, test} trouvé dans features/.${R}`);
  console.log(`${DIM}  Tous les invariants sont en forme chaîne (non exécutables).${R}`);
  process.exit(strict ? 1 : 0);
}

// ── 2. Vérifier existence + exécution de chaque test ─────────────────────

let errors = 0;

for (const inv of collected) {
  const label = `[${inv.feature}] ${inv.statement.slice(0, 72)}`;

  // 2a. Existence du fichier
  if (!fs.existsSync(inv.absPath)) {
    console.log(`${RED}✗ FICHIER INTROUVABLE${R}  ${label}`);
    console.log(`  ${DIM}chemin attendu : ${inv.testFile}${R}`);
    errors++;
    continue;
  }

  // 2b. Exécution du test
  try {
    const args = [
      '--testPathPattern', inv.absPath.replace(/\\/g, '/'),
      '--no-coverage',
      '--forceExit',
      ...(verbose ? [] : ['--silent']),
    ];
    const out = execFileSync('npx', ['jest', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      stdio: verbose ? 'inherit' : 'pipe',
      shell: true, // npx est npx.cmd sous Windows — sans shell, execFileSync échoue en ENOENT avant même de lancer jest
    });
    console.log(`${GRN}✔${R}  ${label}`);
    console.log(`   ${DIM}test : ${inv.testFile}${R}`);
  } catch (e) {
    console.log(`${RED}✗ TEST ÉCHOUE${R}  ${label}`);
    console.log(`   ${DIM}test : ${inv.testFile}${R}`);
    if (e.stdout && !verbose) {
      // Extraire uniquement les lignes d'erreur pertinentes
      const lines = e.stdout.split('\n')
        .filter(l => /●|FAIL|expect|received|Cannot/.test(l))
        .slice(0, 6);
      lines.forEach(l => console.log(`   ${RED}${l}${R}`));
    } else if (!e.stdout) {
      // Le process jest n'a jamais démarré (ex. ENOENT) — sans ça, l'échec est
      // muet et indiscernable d'un vrai test rouge. Toujours afficher la cause.
      console.log(`   ${RED}${DIM}spawn error : ${e.message}${R}`);
    }
    errors++;
  }
}

// ── 3. Bilan ──────────────────────────────────────────────────────────────

console.log('');
if (!errors) {
  console.log(`${GRN}${BLD}✔ ${collected.length} invariant(s) exécutable(s) — tous verts.${R}`);
  process.exit(0);
}

console.log(`${RED}${BLD}✗ ${errors}/${collected.length} invariant(s) en échec.${R}`);
if (strict) {
  console.log(`${DIM}  Mode --strict : exit 1. Corrigez les tests ou les chemins référencés.${R}`);
  process.exit(1);
}
process.exit(0);
