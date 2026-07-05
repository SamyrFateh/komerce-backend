#!/usr/bin/env node
'use strict';

/**
 * test-kit-usage-check.js — Gate : usage obligatoire de dashboardTestKit
 *
 *   Avant tests/unit/helpers/dashboardTestKit.js, chaque nouvelle vue
 *   redécouvrait/redéboguait les mêmes pièges (loadView, mocks KmcApi/
 *   KmcFilters/KpiCard, flush des microtasks). Une règle dans AGENTS.md ne
 *   suffit pas à empêcher qu'une nouvelle vue reparte de zéro — ce gate le
 *   vérifie mécaniquement à chaque PR.
 *
 *   Principe : tout fichier de test TOUCHÉ dans la diff qui réinvente l'une
 *   des plomberies suivantes à la main DOIT importer dashboardTestKit à la
 *   place :
 *     - chargement de vue à la main (require + resetModules + lecture de
 *       window[Name])                      →  loadView(relPath, globalName)
 *     - window.KmcApi / global.KmcApi = {}  →  makeKmcApi(methods)
 *     - window.KmcFilters = {}              →  makeKmcFilters(defaults)
 *     - window.KpiCard = {}                 →  makeKpiCard(methods)
 *
 *   Exception connue et volontairement TOLÉRÉE par ce gate : les tests
 *   antérieurs au kit (SalesView, ProductsView, HubRelaisView) chargent la
 *   vue directement par require() sans passer par loadView — ils sont
 *   pré-existants, non touchés par ce gate tant qu'ils ne sont pas modifiés.
 *   Un fichier TOUCHÉ (nouveau ou modifié) qui fait pareil sera lui flaggé.
 *
 *   Exemptions : governance/test-kit-exemptions.json
 *     { "tests/unit/xxx.test.js": "raison" }
 *
 * Usage : même interface que touched-tests-gate.js (backend)
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
const VIEW_TEST_RX = /tests\/unit\/[A-Za-z0-9_-]+View\.test\.js$/; // fichiers qui testent une vue admin/js/views/*
const KIT_IMPORT_RX = /require\([^)]*dashboardTestKit[^)]*\)/;

const REINVENTION_PATTERNS = [
  { rx: /(window|global)\.KmcApi\s*=\s*\{/,      label: 'KmcApi = {...} posé à la main (→ makeKmcApi)' },
  { rx: /(window|global)\.KmcFilters\s*=\s*\{/,  label: 'KmcFilters = {...} posé à la main (→ makeKmcFilters)' },
  { rx: /(window|global)\.KpiCard\s*=\s*\{/,     label: 'KpiCard = {...} posé à la main (→ makeKpiCard)' },
  { rx: /\bfunction\s+loadView\s*\(/,            label: 'function loadView(...) locale (→ importer loadView du kit)' },
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
  console.log(`${C.bld}║  TEST-KIT USAGE GATE — dashboardTestKit obligatoire           ║${C.r}`);
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
    if (content === null) continue; // fichier supprimé dans la diff

    const hits = REINVENTION_PATTERNS.filter(p => p.rx.test(content));
    if (hits.length === 0) {
      console.log(`  ${ICON.PASS} ${C.dim}${f}${C.r}  ${C.grn}pas de réinvention détectée${C.r}`);
      passes++;
      continue;
    }

    if (KIT_IMPORT_RX.test(content)) {
      console.log(`  ${ICON.FAIL} ${f}`);
      hits.forEach(h => console.log(`      ${C.red}→ ${h.label}${C.r}`));
      console.log(`      ${C.dim}(importe dashboardTestKit MAIS pose quand même le global à la main — ` +
        `un fichier correctement écrit ne matche plus ces patterns du tout)${C.r}`);
      uncovered.push(f);
      fails++;
      continue;
    }

    if (exemptions[f]) {
      console.log(`  ${ICON.WARN} ${C.dim}${f}${C.r}  ${C.ylw}exempté : ${exemptions[f]}${C.r}`);
      warns++;
      continue;
    }

    console.log(`  ${ICON.FAIL} ${f}`);
    hits.forEach(h => console.log(`      ${C.red}→ ${h.label}${C.r}`));
    if (VIEW_TEST_RX.test(f)) {
      console.log(`      ${C.dim}(fichier de vue *View.test.js — le kit est fait pour ça)${C.r}`);
    }
    uncovered.push(f);
    fails++;
  }

  console.log();

  if (fails === 0 && warns === 0) {
    console.log(`${C.grn}${C.bld}✔ Tous les fichiers de test réinventant loadView/KmcApi/KmcFilters/KpiCard importent le kit.${C.r}\n`);
    process.exit(0);
  }

  if (fails === 0) {
    console.log(`${C.ylw}▲ ${warns} fichier(s) couvert par exemption.${C.r}\n`);
    process.exit(STRICT ? 1 : 0);
  }

  console.log(`${C.red}${C.bld}✖ ${fails} fichier(s) réinventent la plomberie sans importer le kit :${C.r}\n`);
  for (const f of uncovered) {
    console.log(`  ${C.red}${f}${C.r}`);
    console.log(`    → const { loadView, makeKmcApi, makeKmcFilters, makeKpiCard, flush } = require('./helpers/dashboardTestKit');`);
    console.log(`    → OU ajouter "${f}": "<justification>" dans governance/test-kit-exemptions.json\n`);
  }

  if (REPORT) {
    console.log(`${C.ylw}▲ --report : exit 0 (rapport seul).${C.r}\n`);
    process.exit(0);
  }

  process.exit(1);
}

main();
