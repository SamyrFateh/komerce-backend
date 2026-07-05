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
 *   RÈGLE DE COMPLÉTION AU CONTACT (doctrine QUALITY_PYRAMID_DOCTRINE.md — N3) :
 *   Quand la Preuve A s'applique (le test du fichier est lui-même touché dans
 *   la diff), ce n'est plus une simple présence qui est exigée mais une
 *   COMPLÉTION : la couverture stmts + branch du fichier source doit atteindre
 *   le seuil cible (100/100 par défaut, governance/coverage-thresholds.json
 *   pour override par fichier) une fois les tests touchés/nouveaux exécutés
 *   en combinaison avec la suite existante qui cible ce même fichier.
 *   Objectif : interdire le "je retouche un test existant sans finaliser la
 *   couverture du fichier que je viens de modifier" — plus de dette qui
 *   s'accumule silencieusement sur un fichier déjà partiellement couvert.
 *   Ce check est coûteux (spawn Jest par fichier) : actif uniquement en
 *   --strict, désactivable ponctuellement avec --no-completion-check.
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
 *   node scripts/touched-tests-gate.js --strict          # exit 1 si WARN + complétion active
 *   node scripts/touched-tests-gate.js --report          # rapport seul, exit 0
 *   node scripts/touched-tests-gate.js --no-completion-check  # désactive le check de complétion
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

// ── Seuils de complétion (Règle de complétion au contact) ───────────────────
const DEFAULT_THRESHOLD = { stmts: 100, branch: 100 };

function loadThresholds() {
  const f = path.join(ROOT, 'governance', 'coverage-thresholds.json');
  if (!fs.existsSync(f)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    return raw;
  } catch {
    return {};
  }
}

function thresholdFor(file, thresholds) {
  const override = thresholds[file];
  if (override) return { ...DEFAULT_THRESHOLD, ...override };
  return DEFAULT_THRESHOLD;
}

// Mesure la couverture réelle d'un fichier source en exécutant les fichiers
// de test qui le ciblent (touchés dans la diff + tout test existant dont le
// stem correspond), pour éviter de pénaliser un fichier déjà couvert par une
// suite préexistante non modifiée dans cette diff.
function measureCoverage(sourceFile, allTouchedTestFiles) {
  const stem = stemOf(sourceFile);
  let existingMatches = [];
  try {
    const out = cp.execSync(
      `git ls-files "tests/**/*.test.js" "tests/**/*.spec.js"`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    existingMatches = out.split('\n').map(l => l.trim()).filter(Boolean).filter(t => {
      const tstem = path.basename(t).replace(/\.(test|spec)\.(js|mjs|ts)$/, '').toLowerCase();
      return tstem === stem || tstem.includes(stem) || stem.includes(tstem);
    });
  } catch {
    existingMatches = [];
  }

  const testTargets = Array.from(new Set([...allTouchedTestFiles, ...existingMatches]));
  if (testTargets.length === 0) return null;

  const coverageDir = path.join(ROOT, '.gate-coverage-tmp', stem.replace(/[^a-z0-9-]/gi, '_'));
  const jestBin = path.join(ROOT, 'node_modules', '.bin', 'jest');

  try {
    cp.execSync(
      [
        `"${jestBin}"`,
        ...testTargets.map(t => `"${t}"`),
        `--coverage`,
        `--collectCoverageFrom="${sourceFile}"`,
        `--coverageReporters=json-summary`,
        `--coverageDirectory="${coverageDir}"`,
        `--silent`,
      ].join(' '),
      { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch {
    // Tests peuvent échouer sans empêcher la génération du rapport de couverture ;
    // on continue et on lit le résumé s'il existe.
  }

  const summaryPath = path.join(coverageDir, 'coverage-summary.json');
  if (!fs.existsSync(summaryPath)) return null; // impossible à mesurer isolément

  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    const key = Object.keys(summary).find(k => k.replace(/\\/g, '/').endsWith(sourceFile));
    if (!key) return null;
    const s = summary[key];
    return { stmts: s.statements.pct, branch: s.branches.pct };
  } catch {
    return null;
  }
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
  const testFiles   = all.filter(isTestFile);
  const exemptions  = loadExemptions();
  const thresholds  = loadThresholds();
  const hasPrTests  = prBodyHasTestSection();
  const checkCompletion = STRICT && !args.includes('--no-completion-check');

  console.log(`${C.dim}Fichiers touchés total : ${all.length}  ·  applicatifs : ${appFiles.length}${C.r}`);
  if (hasPrTests) console.log(`${C.dim}Section ## Tests détectée dans le body PR (preuve C active)${C.r}`);
  if (checkCompletion) console.log(`${C.dim}Règle de complétion au contact : ACTIVE (--strict)${C.r}`);
  console.log();

  if (appFiles.length === 0) {
    console.log(`${C.grn}✔ Aucun fichier applicatif touché — gate ignoré.${C.r}\n`);
    process.exit(0);
  }

  let fails = 0, warns = 0;
  const uncovered = [];
  const incomplete = [];

  for (const f of appFiles) {
    // Preuve A : test touché dans la diff
    if (hasMatchingTest(f, all)) {
      if (!checkCompletion) {
        console.log(`  ${ICON.PASS} ${C.dim}${f}${C.r}  ${C.grn}test correspondant touché${C.r}`);
        continue;
      }

      const cov = measureCoverage(f, testFiles);
      const th = thresholdFor(f, thresholds);

      if (cov === null) {
        console.log(`  ${ICON.WARN} ${C.dim}${f}${C.r}  ${C.ylw}test touché — couverture non mesurable isolément, non bloquant${C.r}`);
        warns++;
        continue;
      }

      if (cov.stmts >= th.stmts && cov.branch >= th.branch) {
        console.log(`  ${ICON.PASS} ${C.dim}${f}${C.r}  ${C.grn}test touché, couverture complète (${cov.stmts}%/${cov.branch}%)${C.r}`);
        continue;
      }

      console.log(`  ${ICON.FAIL} ${f}  ${C.red}test touché mais couverture incomplète : ${cov.stmts}% stmts / ${cov.branch}% branch (cible ${th.stmts}%/${th.branch}%)${C.r}`);
      incomplete.push({ file: f, cov, th });
      fails++;
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
  console.log(`${C.red}${C.bld}✖ ${fails} fichier(s) applicatif(s) en échec :${C.r}\n`);
  for (const f of uncovered) {
    const stem = stemOf(f);
    console.log(`  ${C.red}${f}${C.r}  ${C.dim}(aucun signal test)${C.r}`);
    console.log(`    → Créer tests/unit/${stem}.test.js ou tests/integration/${stem}.test.js`);
    console.log(`    → OU ajouter "${f}": "<justification>" dans governance/test-exemptions.json`);
    console.log(`    → OU ajouter une section ## Tests dans le body de la PR\n`);
  }
  for (const { file, cov, th } of incomplete) {
    console.log(`  ${C.red}${file}${C.r}  ${C.dim}(couverture incomplète : ${cov.stmts}%/${cov.branch}%, cible ${th.stmts}%/${th.branch}%)${C.r}`);
    console.log(`    → Finaliser les tests du fichier (branches manquantes, cas d'erreur) avant merge`);
    console.log(`    → OU ajouter "${file}": { "stmts": X, "branch": Y } dans governance/coverage-thresholds.json avec justification en commentaire adjacent`);
    console.log(`    → Ne pas re-toucher un test existant sans amener le fichier au seuil : c'est la règle de complétion au contact\n`);
  }

  if (REPORT) {
    console.log(`${C.ylw}▲ --report : exit 0 (rapport seul).${C.r}\n`);
    process.exit(0);
  }

  process.exit(1);
}

main();
