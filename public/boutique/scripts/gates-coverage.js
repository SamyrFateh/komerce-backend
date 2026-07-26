#!/usr/bin/env node
'use strict';

/**
 * gates-coverage.js — Mesure objective du critère P2 : « 0 gate sans test
 * de détection ».
 *
 * Étape 1 : reconstitue la liste des gates réels en dépliant récursivement
 *   les scripts npm référencés par check:all (une entrée "npm run X" dont
 *   la commande elle-même contient "npm run" est un agrégateur — on la
 *   déplie ; sinon c'est une feuille = un gate). test:unit et test:e2e sont
 *   des suites de tests, pas des gates unitaires : exclues du périmètre.
 *
 * Étape 2 : extrait les noms de describe('gate X', ...) de
 *   tests/gates/gates-detect.test.js.
 *
 * Étape 3 : croise les deux listes (un describe couvre une feuille si son
 *   titre commence par "gate <nom-du-script>").
 *
 * Usage :
 *   node scripts/gates-coverage.js --report   # liste détaillée
 *   node scripts/gates-coverage.js --strict   # exit 1 si gate(s) non couvert(s)
 */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '..');
const PKG        = path.join(ROOT, 'package.json');
const TEST_FILE  = path.join(ROOT, 'tests', 'gates', 'gates-detect.test.js');

const args   = process.argv.slice(2);
const report = args.includes('--report');
const strict = args.includes('--strict');

const RED = '\x1b[31m', GRN = '\x1b[32m', YLW = '\x1b[33m', BLD = '\x1b[1m', DIM = '\x1b[2m', R = '\x1b[0m';

const EXCLUDED_AGGREGATES = new Set(['test:unit', 'test:e2e']);

// Gates réels mais non testables isolément par injection fiable (dépendance
// à un état externe qui varie dans le temps — même famille que les 5
// exceptions du premier lot de 12 gates). Documenté ici plutôt que compté
// comme un trou de couverture silencieux.
const KNOWN_EXCLUSIONS = {
  'audit:gate': "dépend de `npm audit` réel (0 vuln. high/critical dans l'environnement courant) — "
    + 'injecter une fausse vulnérabilité exigerait un paquet réellement vulnérable, non reproductible dans le temps.',
};

/* ── Étape 1 : dépliage récursif de check:all ──────────────────────────── */

function expandScript(name, scripts, seen, leaves) {
  if (seen.has(name)) return; // anti-cycle
  seen.add(name);
  if (EXCLUDED_AGGREGATES.has(name)) return;

  const cmd = scripts[name];
  if (!cmd) return; // référence orpheline, ignorée

  const refs = [...cmd.matchAll(/npm run ([\w:.-]+)/g)].map(m => m[1]);
  if (refs.length === 0) {
    leaves.add(name); // feuille : commande directe (node script.js ...)
    return;
  }
  for (const ref of refs) expandScript(ref, scripts, seen, leaves);
}

function discoverGates() {
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  const scripts = pkg.scripts || {};
  if (!scripts['check:all']) {
    throw new Error('check:all introuvable dans package.json');
  }
  const leaves = new Set();
  expandScript('check:all', scripts, new Set(), leaves);
  return [...leaves].sort();
}

/* ── Étape 2 : gates couverts par un test de détection ─────────────────── */

function discoverCoveredGates() {
  if (!fs.existsSync(TEST_FILE)) return new Set();
  const content = fs.readFileSync(TEST_FILE, 'utf8');
  const re = /describe\(\s*['"]gate\s+([\w:.-]+)/g;
  const covered = new Set();
  let m;
  while ((m = re.exec(content))) covered.add(m[1]);
  return covered;
}

/* ── Croisement ─────────────────────────────────────────────────────── */

const allGates      = discoverGates();
const coveredGates   = discoverCoveredGates();
const applicableGates = allGates.filter(g => !KNOWN_EXCLUSIONS[g]);
const uncoveredGates  = applicableGates.filter(g => !coveredGates.has(g));

if (report || uncoveredGates.length > 0) {
  console.log(`${BLD}Gates couverts par un test de détection : ${applicableGates.length - uncoveredGates.length}/${applicableGates.length}${R} ${DIM}(+ ${Object.keys(KNOWN_EXCLUSIONS).length} exclusion(s) documentée(s))${R}\n`);
  for (const g of allGates) {
    if (KNOWN_EXCLUSIONS[g]) {
      console.log(`  ${YLW}⊘${R} ${g} ${DIM}— exclu : ${KNOWN_EXCLUSIONS[g]}${R}`);
      continue;
    }
    const ok = coveredGates.has(g);
    console.log(`  ${ok ? GRN + '✔' : RED + '✖'} ${g}${R}`);
  }
  if (uncoveredGates.length > 0) {
    console.log(`\n${RED}${BLD}Non couverts (${uncoveredGates.length}) :${R} ${uncoveredGates.join(', ')}`);
  }
} else {
  console.log(`${GRN}${BLD}✔ ${applicableGates.length}/${applicableGates.length} gates couverts par un test de détection.${R} ${DIM}(+ ${Object.keys(KNOWN_EXCLUSIONS).length} exclusion(s) documentée(s) : ${Object.keys(KNOWN_EXCLUSIONS).join(', ')})${R}`);
}

if (strict && uncoveredGates.length > 0) {
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
