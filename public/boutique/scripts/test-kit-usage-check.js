#!/usr/bin/env node
'use strict';

/**
 * test-kit-usage-check.js — Gate : usage obligatoire de boutiqueTestKit
 *
 *   Avant tests/unit/helpers/boutiqueTestKit.js, chaque fichier remockait
 *   window.K/b-store à la main. Une règle dans AGENTS.md ne suffit pas à
 *   empêcher qu'un nouveau fichier reparte de zéro — ce gate le vérifie
 *   mécaniquement à chaque PR.
 *
 *   Principe : tout fichier de test TOUCHÉ dans la diff qui réinvente l'une
 *   des plomberies suivantes à la main DOIT importer boutiqueTestKit à la
 *   place :
 *     - window.K = { ... }               →  mockWindowK(methods)
 *     - reset manuel de state (b-store)  →  resetState(state, overrides)
 *     - montage DOM fixture à la main    →  mountFixture(html)
 *
 *   Ce gate NE vérifie PAS que le kit est utilisé partout (un test de pure
 *   logique sans DOM/réseau n'a rien à importer) — seulement qu'un fichier
 *   qui réinvente la plomberie ne le fait pas en silence.
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
const KIT_IMPORT_RX = /require\([^)]*boutiqueTestKit[^)]*\)/;

// Signaux de réinvention : plomberie déjà couverte par le kit, refaite à la main.
const REINVENTION_PATTERNS = [
  { rx: /window\.K\s*=\s*\{/,                          label: 'window.K = {...} posé à la main (→ mockWindowK)' },
  { rx: /\bfunction\s+mountFixture\s*\(/,              label: 'function mountFixture(...) locale' },
  { rx: /document\.getElementById\(['"]boutique-test-root['"]\)/,
    label: "réimplémentation du fixture id='boutique-test-root' (→ mountFixture)" },
  { rx: /\bfunction\s+resetState\s*\(/,                label: 'function resetState(...) locale' },
  { rx: /\basync\s+function\s+flush\s*\(/,             label: 'async function flush(...) locale (→ flush de boutiqueTestKit)' },
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
  console.log(`${C.bld}║  TEST-KIT USAGE GATE — boutiqueTestKit obligatoire            ║${C.r}`);
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
      console.log(`  ${ICON.PASS} ${C.dim}${f}${C.r}  ${C.grn}importe boutiqueTestKit${C.r}`);
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
    console.log(`${C.grn}${C.bld}✔ Tous les fichiers de test réinventant window.K/state/fixture importent le kit.${C.r}\n`);
    process.exit(0);
  }

  if (fails === 0) {
    console.log(`${C.ylw}▲ ${warns} fichier(s) couvert par exemption.${C.r}\n`);
    process.exit(STRICT ? 1 : 0);
  }

  console.log(`${C.red}${C.bld}✖ ${fails} fichier(s) réinventent la plomberie sans importer le kit :${C.r}\n`);
  for (const f of uncovered) {
    console.log(`  ${C.red}${f}${C.r}`);
    console.log(`    → const { resetState, resetDom, mountFixture, mockWindowK, flush, submitForm } = require('./helpers/boutiqueTestKit');`);
    console.log(`    → OU ajouter "${f}": "<justification>" dans governance/test-kit-exemptions.json\n`);
  }

  if (REPORT) {
    console.log(`${C.ylw}▲ --report : exit 0 (rapport seul).${C.r}\n`);
    process.exit(0);
  }

  process.exit(1);
}

main();
