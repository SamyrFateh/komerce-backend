#!/usr/bin/env node
'use strict';

/**
 * test-kit-usage-check.js — Gate : usage obligatoire de backendTestKit
 *
 *   Constat qui motive ce gate : avant tests/helpers/backendTestKit.js, 238
 *   fichiers réimplémentaient chacun leur propre makeReq/makeRes/makeNext
 *   (variantes quasi identiques). Une règle dans AGENTS.md ne suffit pas à
 *   empêcher qu'un 239e fichier reparte de zéro — ce gate le vérifie
 *   mécaniquement à chaque PR.
 *
 *   Principe : tout fichier de test TOUCHÉ dans la diff qui réinvente un
 *   mock req/res/next Express à la main (déclare localement makeReq/makeRes/
 *   makeNext, ou construit un objet res chainable `res.status = jest.fn()…`)
 *   DOIT en échange importer l'une des deux sources légitimes :
 *
 *     A) backendTestKit  (tests/helpers/backendTestKit.js) — le point
 *        d'entrée unique recommandé pour tout nouveau fichier.
 *     B) mock-db.js directement (tests/integration/test-harness/mock-db.js)
 *        — usage historique déjà réutilisé par 56 fichiers pour
 *        makeClient/expectTransactionCommitted/RolledBack ; toléré tel quel,
 *        pas de migration forcée.
 *
 *   Ce gate NE vérifie PAS que le kit est utilisé partout où c'est possible
 *   (un test de logique pure sans req/res n'a rien à importer) — seulement
 *   qu'un fichier qui réinvente la plomberie ne le fait pas en silence.
 *
 *   Exemptions : governance/test-kit-exemptions.json
 *     { "tests/unit/xxx.test.js": "raison" }
 *
 * Usage : même interface que touched-tests-gate.js
 *   node scripts/test-kit-usage-check.js
 *   node scripts/test-kit-usage-check.js --base <ref>
 *   node scripts/test-kit-usage-check.js --files a.test.js,b.test.js
 *   node scripts/test-kit-usage-check.js --strict
 *   node scripts/test-kit-usage-check.js --report
 */

const fs   = require('fs');
const path = require('path');
const cp   = require('child_process');

const args   = process.argv.slice(2);
const ROOT   = path.resolve(argVal('--root') || process.cwd());
const STRICT = args.includes('--strict');
const REPORT = args.includes('--report');

function argVal(f) { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; }

const C = {
  red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m',
  dim: '\x1b[2m',  bld: '\x1b[1m',  cyn: '\x1b[36m', r: '\x1b[0m',
};
const ICON = { PASS: `${C.grn}✔${C.r}`, FAIL: `${C.red}✖${C.r}`, WARN: `${C.ylw}▲${C.r}` };

// ── Périmètre ────────────────────────────────────────────────────────────────
const TEST_FILE_RX = /\.(test|spec)\.js$/;
const KIT_IMPORT_RX = /require\([^)]*backendTestKit[^)]*\)/;
const MOCKDB_IMPORT_RX = /require\([^)]*mock-db[^)]*\)/;

// Signaux de réinvention : déclaration locale des mêmes helpers que le kit.
const REINVENTION_PATTERNS = [
  { rx: /\bfunction\s+makeReq\s*\(/,               label: 'function makeReq(...) locale' },
  { rx: /\bconst\s+makeReq\s*=\s*(\(|function)/,    label: 'const makeReq = ... locale' },
  { rx: /\bfunction\s+makeRes\s*\(/,               label: 'function makeRes(...) locale' },
  { rx: /\bconst\s+makeRes\s*=\s*(\(|function)/,    label: 'const makeRes = ... locale' },
  { rx: /\bfunction\s+makeNext\s*\(/,              label: 'function makeNext(...) locale' },
  { rx: /res\.status\s*=\s*jest\.fn\(\)/,          label: 'objet res chainable construit à la main' },
];

// ── Git diff (identique à touched-tests-gate.js) ────────────────────────────
function touchedFiles() {
  if (argVal('--files')) {
    return argVal('--files').split(',').map(f => f.trim()).filter(Boolean);
  }
  const base = argVal('--base') || 'origin/main';
  try {
    const out = cp.execSync(`git diff --name-only ${base}...HEAD`, {
      cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    try {
      const out = cp.execSync('git diff --name-only HEAD', {
        cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      return out.split('\n').map(l => l.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
}

function loadExemptions() {
  const f = path.join(ROOT, 'governance', 'test-kit-exemptions.json');
  if (!fs.existsSync(f)) return {};
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; }
}

function readSafe(f) {
  try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return null; }
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  console.log(`\n${C.bld}╔════════════════════════════════════════════════════════════╗${C.r}`);
  console.log(`${C.bld}║  TEST-KIT USAGE GATE — backendTestKit obligatoire            ║${C.r}`);
  console.log(`${C.bld}╚════════════════════════════════════════════════════════════╝${C.r}\n`);
  console.log(`${C.dim}racine: ${ROOT}${C.r}\n`);

  const all = touchedFiles();
  const testFiles = all.filter(f => TEST_FILE_RX.test(f));
  const exemptions = loadExemptions();

  console.log(`${C.dim}Fichiers touchés total : ${all.length}  ·  fichiers de test : ${testFiles.length}${C.r}\n`);

  if (testFiles.length === 0) {
    console.log(`${C.grn}✔ Aucun fichier de test touché — gate ignoré.${C.r}\n`);
    process.exit(0);
  }

  let fails = 0, warns = 0, passes = 0;
  const uncovered = [];

  for (const f of testFiles) {
    const content = readSafe(f);
    if (content === null) {
      // fichier supprimé dans la diff, rien à vérifier
      continue;
    }

    const hits = REINVENTION_PATTERNS.filter(p => p.rx.test(content));
    if (hits.length === 0) {
      console.log(`  ${ICON.PASS} ${C.dim}${f}${C.r}  ${C.grn}pas de réinvention détectée${C.r}`);
      passes++;
      continue;
    }

    const usesKit = KIT_IMPORT_RX.test(content) || MOCKDB_IMPORT_RX.test(content);
    if (usesKit) {
      console.log(`  ${ICON.PASS} ${C.dim}${f}${C.r}  ${C.grn}importe backendTestKit/mock-db${C.r}`);
      passes++;
      continue;
    }

    if (exemptions[f]) {
      console.log(`  ${ICON.WARN} ${C.dim}${f}${C.r}  ${C.ylw}exempté : ${exemptions[f]}${C.r}`);
      warns++;
      continue;
    }

    console.log(`  ${ICON.FAIL} ${f}`);
    hits.forEach(h => console.log(`      ${C.red}→ ${h.label}${C.r}`));
    uncovered.push(f);
    fails++;
  }

  console.log();

  if (fails === 0 && warns === 0) {
    console.log(`${C.grn}${C.bld}✔ Tous les fichiers de test réinventant req/res/next importent le kit.${C.r}\n`);
    process.exit(0);
  }

  if (fails === 0) {
    console.log(`${C.ylw}▲ ${warns} fichier(s) couvert par exemption.${C.r}\n`);
    process.exit(STRICT ? 1 : 0);
  }

  console.log(`${C.red}${C.bld}✖ ${fails} fichier(s) réinventent la plomberie req/res sans importer le kit :${C.r}\n`);
  for (const f of uncovered) {
    console.log(`  ${C.red}${f}${C.r}`);
    console.log(`    → const { makeReq, makeRes, makeNext, invokeHandler } = require('.../helpers/backendTestKit');`);
    console.log(`    → OU ajouter "${f}": "<justification>" dans governance/test-kit-exemptions.json\n`);
  }

  if (REPORT) {
    console.log(`${C.ylw}▲ --report : exit 0 (rapport seul).${C.r}\n`);
    process.exit(0);
  }

  process.exit(1);
}

main();
