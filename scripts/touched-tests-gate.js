#!/usr/bin/env node
'use strict';

/**
 * touched-tests-gate.js — Gate : code modifié ↔ tests modifiés / justification
 *
 *   Principe : tout fichier applicatif touché dans la PR doit être couvert par
 *   AU MOINS UNE des trois preuves suivantes :
 *
 *     A) Un fichier de test correspondant est lui aussi touché dans la diff
 *        (tests/unit/<module>.test.js, tests/integration/<module>.test.js,
 *        ou tout autre *.test.js / *.spec.js dans tests/).
 *
 *     B) Le fichier est explicitement exempté dans governance/test-exemptions.json
 *        avec une justification documentée (ex: glue pur, fichier de config,
 *        CLI one-shot, helpers sans branche).
 *
 *     C) Le body PR contient une section "## Tests" non vide qui justifie
 *        l'absence de test (accepté en mode "justification prose").
 *
 *   Ce gate N'exige PAS que chaque fichier ait un test dédié 1:1 — il exige
 *   qu'une réponse existe (tests touchés, exemption, ou justification PR).
 *   L'objectif est d'éliminer les "modification silencieuse sans aucun signal test".
 *
 *   Périmètre scanné : même logique que touched-files-feature-gate.js.
 *     - fichiers .js/.mjs/.ts/.css uniquement
 *     - exclusions : tests/, scripts/, migrations/, docs/, dist/, .github/
 *
 * Usage :
 *   node scripts/touched-tests-gate.js                   # git diff vs origin/main
 *   node scripts/touched-tests-gate.js --base <ref>
 *   node scripts/touched-tests-gate.js --files a.js,b.js # test manuel
 *   node scripts/touched-tests-gate.js --pr-body "<md>"  # injecter le body PR
 *   node scripts/touched-tests-gate.js --strict          # exit 1 si WARN (mode CI complet)
 *   node scripts/touched-tests-gate.js --report          # rapport seul, exit 0
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

// ── Périmètre (aligné avec touched-files-feature-gate.js) ───────────────────
const ENFORCE_EXT = /\.(js|mjs|cjs|ts|css)$/;
const EXCLUDE = [
  /^archive\//, /node_modules\//, /\/dist\//, /\.github\//,
  /(^|\/)docs\//, /\.md$/, /\.feature\.js$/,
  /(^|\/)tests?\//, /\.spec\.js$/, /\.test\.js$/,
  /(^|\/)migrations\//, /(^|\/)scripts\//,
  /package(-lock)?\.json$/, /\.(config|min)\.(js|cjs|mjs)$/,
  /public\/boutique\/css\/dist\//,
];

function isApplicative(f) {
  if (!ENFORCE_EXT.test(f)) return false;
  return !EXCLUDE.some(rx => rx.test(f));
}

function isTestFile(f) {
  return /\.(test|spec)\.(js|mjs|ts)$/.test(f) || /\btests?\//.test(f);
}

// ── Git diff ─────────────────────────────────────────────────────────────────
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
    // Fallback: diff non-staged
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

// ── Exemptions ───────────────────────────────────────────────────────────────
function loadExemptions() {
  const exemptFile = path.join(ROOT, 'governance', 'test-exemptions.json');
  if (!fs.existsSync(exemptFile)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(exemptFile, 'utf8'));
    // Format attendu : { "routes/health.js": "glue pur, pas de branche", … }
    return raw;
  } catch {
    return {};
  }
}

// ── PR body (preuve C) ───────────────────────────────────────────────────────
function prBodyHasTestSection() {
  // Priorité : --pr-body passé en arg
  const inline = argVal('--pr-body');
  if (inline) return /^##\s+(tests?|vérification|verification)/im.test(inline);

  // Sinon : variable d'environnement PR_BODY (injectée dans le workflow)
  const env = process.env.PR_BODY || '';
  if (env) return /^##\s+(tests?|vérification|verification)/im.test(env);

  return false;
}

// ── Correspondance fichier source ↔ test ─────────────────────────────────────
// On cherche un test dont le nom de base contient le stem du fichier source,
// ou l'inverse. Couvre les conventions :
//   routes/wallet.js  →  tests/unit/wallet.test.js
//   services/cart-engine.js  →  tests/integration/cart-engine.test.js
function stemOf(f) {
  return path.basename(f).replace(/\.(js|mjs|ts|css)$/, '').toLowerCase();
}

function hasMatchingTest(sourceFile, allTouched) {
  const stem = stemOf(sourceFile);
  return allTouched.some(t => {
    if (!isTestFile(t)) return false;
    const tstem = path.basename(t).replace(/\.(test|spec)\.(js|mjs|ts)$/, '').toLowerCase();
    return tstem === stem || tstem.includes(stem) || stem.includes(tstem);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  console.log(`\n${C.bld}╔════════════════════════════════════════════════════════════╗${C.r}`);
  console.log(`${C.bld}║  TOUCHED-TESTS GATE — code modifié ↔ signal test requis    ║${C.r}`);
  console.log(`${C.bld}╚════════════════════════════════════════════════════════════╝${C.r}\n`);
  console.log(`${C.dim}racine: ${ROOT}${C.r}\n`);

  const all         = touchedFiles();
  const appFiles    = all.filter(isApplicative);
  const exemptions  = loadExemptions();
  const hasPrTests  = prBodyHasTestSection();

  console.log(`${C.dim}Fichiers touchés total : ${all.length}  ·  applicatifs : ${appFiles.length}${C.r}`);
  if (hasPrTests) console.log(`${C.dim}Section ## Tests détectée dans le body PR (preuve C active)${C.r}`);
  console.log();

  if (appFiles.length === 0) {
    console.log(`${C.grn}✔ Aucun fichier applicatif touché — gate ignoré.${C.r}\n`);
    process.exit(0);
  }

  let fails = 0, warns = 0;
  const uncovered = [];

  for (const f of appFiles) {
    // Preuve A : test touché dans la diff
    if (hasMatchingTest(f, all)) {
      console.log(`  ${ICON.PASS} ${C.dim}${f}${C.r}  ${C.grn}test correspondant touché${C.r}`);
      continue;
    }

    // Preuve B : exemption explicite
    if (exemptions[f]) {
      console.log(`  ${ICON.WARN} ${C.dim}${f}${C.r}  ${C.ylw}exempté : ${exemptions[f]}${C.r}`);
      warns++;
      continue;
    }

    // Preuve C : section ## Tests dans le body PR
    if (hasPrTests) {
      console.log(`  ${ICON.WARN} ${C.dim}${f}${C.r}  ${C.ylw}justifié par section ## Tests du body PR${C.r}`);
      warns++;
      continue;
    }

    // Aucune preuve
    console.log(`  ${ICON.FAIL} ${f}  ${C.red}aucun test touché, pas d'exemption, pas de ## Tests PR${C.r}`);
    uncovered.push(f);
    fails++;
  }

  console.log();

  // Résumé
  if (fails === 0 && warns === 0) {
    console.log(`${C.grn}${C.bld}✔ Tous les fichiers applicatifs ont un signal test.${C.r}\n`);
    process.exit(0);
  }

  if (warns > 0 && fails === 0) {
    console.log(`${C.ylw}▲ ${warns} fichier(s) couvert par exemption ou justification PR.${C.r}\n`);
    process.exit(STRICT ? 1 : 0);
  }

  // Fails : guider le correctif
  console.log(`${C.red}${C.bld}✖ ${fails} fichier(s) applicatif(s) sans signal test :${C.r}\n`);
  for (const f of uncovered) {
    const stem = stemOf(f);
    console.log(`  ${C.red}${f}${C.r}`);
    console.log(`    → Créer tests/unit/${stem}.test.js ou tests/integration/${stem}.test.js`);
    console.log(`    → OU ajouter "${f}": "<justification>" dans governance/test-exemptions.json`);
    console.log(`    → OU ajouter une section ## Tests dans le body de la PR\n`);
  }

  if (REPORT) {
    console.log(`${C.ylw}▲ --report : exit 0 (rapport seul).${C.r}\n`);
    process.exit(0);
  }

  process.exit(1);
}

main();
