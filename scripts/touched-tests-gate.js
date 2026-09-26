#!/usr/bin/env node
'use strict';

/**
 * touched-tests-gate.js — Gate : code modifié ↔ tests modifiés / justification
 *
 * Toute source applicative touchée doit avoir au moins une preuve :
 *   A) un test correspondant touché dans la diff ;
 *   B) une exemption explicite dans governance/test-exemptions.json ;
 *   C) une section ## Tests dans le body de la PR.
 *
 * En mode --strict, la preuve A active la règle de complétion au contact :
 * la couverture statements + branches de la source doit maintenir le cliquet
 * explicitement défini dans governance/coverage-thresholds.json. Aucun seuil
 * implicite (et notamment aucun 100/100 par défaut) n'est inventé pour un
 * fichier qui n'a pas encore de baseline mesurée.
 * Pour une source CSS, un test correspondant reste obligatoire mais la couverture
 * statements/branches Jest n'est pas applicable ; les gates CSS dédiés portent
 * la preuve de compilation, de cascade et de fraîcheur du bundle.
 *
 * Le mesureur est workspace-aware : les sources Boutique sont exécutées avec
 * le Jest, le cwd et la configuration de public/boutique, au lieu d'être
 * évaluées artificiellement par la configuration Jest du backend racine.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const args = process.argv.slice(2);
const ROOT = path.resolve(argVal('--root') || process.cwd());
const STRICT = args.includes('--strict');
const REPORT = args.includes('--report');

function argVal(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const C = {
  red: '\x1b[31m',
  grn: '\x1b[32m',
  ylw: '\x1b[33m',
  dim: '\x1b[2m',
  bld: '\x1b[1m',
  cyn: '\x1b[36m',
  r: '\x1b[0m',
};

const ICON = {
  PASS: `${C.grn}✔${C.r}`,
  FAIL: `${C.red}✖${C.r}`,
  WARN: `${C.ylw}▲${C.r}`,
};

const ENFORCE_EXT = /\.(js|mjs|cjs|ts|css)$/;
const EXCLUDE = [
  /^archive\//,
  /node_modules\//,
  /\/dist\//,
  /\.github\//,
  /(^|\/)docs\//,
  /\.md$/,
  /\.feature\.js$/,
  /(^|\/)tests?\//,
  /\.spec\.js$/,
  /\.test\.js$/,
  /(^|\/)migrations\//,
  /(^|\/)scripts\//,
  /package(-lock)?\.json$/,
  /\.(config|min)\.(js|cjs|mjs)$/,
  /public\/boutique\/css\/dist\//,
];

function isApplicative(file) {
  return ENFORCE_EXT.test(file) && !EXCLUDE.some(pattern => pattern.test(file));
}

function isTestFile(file) {
  return /\.(test|spec)\.(js|mjs|ts)$/.test(file) || /\btests?\//.test(file);
}

function touchedFiles() {
  const explicit = argVal('--files');
  if (explicit) return explicit.split(',').map(file => file.trim()).filter(Boolean);

  const base = argVal('--base') || 'origin/main';
  try {
    const output = cp.execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.split('\n').map(line => line.trim()).filter(Boolean);
  } catch {
    try {
      const output = cp.execFileSync('git', ['diff', '--name-only', 'HEAD'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.split('\n').map(line => line.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
}

function readJson(relativePath, fallback = {}) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadExemptions() {
  return readJson(path.join('governance', 'test-exemptions.json'));
}

function loadThresholds() {
  return readJson(path.join('governance', 'coverage-thresholds.json'));
}

function prBodyHasTestSection() {
  const body = argVal('--pr-body') || process.env.PR_BODY || '';
  return /^##\s+(tests?|vérification|verification)/im.test(body);
}

function thresholdFor(file, thresholds) {
  const configured = thresholds[file];
  if (!configured || typeof configured !== 'object') return null;

  const stmts = Number(configured.stmts);
  const branch = Number(configured.branch);
  if (!Number.isFinite(stmts) || !Number.isFinite(branch)) return null;

  return { stmts, branch };
}

function stemOf(file) {
  return path.basename(file).replace(/\.(js|mjs|ts|css)$/, '').toLowerCase();
}

function testStem(file) {
  return path.basename(file).replace(/\.(test|spec)\.(js|mjs|ts)$/, '').toLowerCase();
}

function stemsMatch(sourceFile, testFile) {
  const sourceStem = stemOf(sourceFile);
  const candidate = testStem(testFile);
  return candidate === sourceStem
    || candidate.includes(sourceStem)
    || sourceStem.includes(candidate);
}

/**
 * Détermine si le lot de fichiers touchés apporte un signal test pour cette
 * source. Vérifie d'abord stemsMatch (rapide, pas d'accès disque), puis
 * retombe sur le matching par contenu (realConsumers) pour les tests
 * touchés du même workspace nommés par comportement — sinon un fichier
 * touché avec un test réel mais au nom différent du stem serait à tort
 * déclaré « aucun test touché » avant même d'atteindre la mesure de
 * couverture (même angle mort que measureCoverage avant son correctif).
 */
function hasMatchingTest(sourceFile, allTouched) {
  if (allTouched.some(file => isTestFile(file) && stemsMatch(sourceFile, file))) return true;

  const workspace = workspaceFor(sourceFile);
  const candidateAbsPaths = allTouched
    .filter(file => isTestFile(file) && belongsToWorkspace(file, workspace) && /\.(test|spec)\.(js|mjs|ts)$/.test(file))
    .map(file => path.join(ROOT, file));
  return realConsumers(sourceFile, candidateAbsPaths).length > 0;
}

function workspaceFor(sourceFile) {
  const boutiquePrefix = 'public/boutique/';
  if (sourceFile.startsWith(boutiquePrefix)) {
    return {
      name: 'boutique',
      prefix: boutiquePrefix,
      root: path.join(ROOT, 'public', 'boutique'),
      sourceRelative: sourceFile.slice(boutiquePrefix.length),
      testPathspecs: [
        'public/boutique/tests/**/*.test.js',
        'public/boutique/tests/**/*.spec.js',
      ],
    };
  }

  return {
    name: 'root',
    prefix: '',
    root: ROOT,
    sourceRelative: sourceFile,
    testPathspecs: ['tests/**/*.test.js', 'tests/**/*.spec.js'],
  };
}

function belongsToWorkspace(file, workspace) {
  if (workspace.prefix) return file.startsWith(workspace.prefix);
  return file.startsWith('tests/');
}

function listTrackedTests(workspace) {
  try {
    const output = cp.execFileSync('git', ['ls-files', ...workspace.testPathspecs], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.split('\n').map(line => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function toWorkspacePath(repoPath, workspace) {
  return workspace.prefix ? repoPath.slice(workspace.prefix.length) : repoPath;
}

function jestBinary(workspace) {
  const executable = process.platform === 'win32' ? 'jest.cmd' : 'jest';
  return path.join(workspace.root, 'node_modules', '.bin', executable);
}

/**
 * Un test « consomme » réellement une source s'il la require()/import() ET
 * ne la jest.mock()/doMock() pas intégralement dans le même fichier (un mock
 * intégral renvoie un faux module — ça ne prouve aucune exécution du code
 * réel). Complète stemsMatch, qui rate tout test dont le nom de fichier ne
 * partage pas la racine du nom du fichier source (ex. tests/unit/
 * catalog-import-eligibility-evidence.test.js pour catalog-import-orchestrator.js,
 * ou tests nommés par comportement plutôt que par module — cf. incident
 * coverage-thresholds.json du 2026-09-26).
 *
 * Comparaison sur le stem exact du basename de chaque littéral require()/from,
 * pas sur un regex substring : évite le faux positif où le stem d'une source
 * (ex. « main ») apparaît comme suffixe du nom d'une autre source
 * (« domain.js » contient littéralement « main.js »).
 */
function stripCommentsAndStrings(raw) {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/^\s*\*.*$/, '').replace(/\/\/.*$/, ''))
    .join('\n');
}

function literalStem(literal) {
  return literal.split('/').pop().replace(/\.(js|mjs|ts)$/, '');
}

function extractLiterals(content, callRe) {
  const literals = [];
  let match;
  while ((match = callRe.exec(content))) literals.push(match[1]);
  return literals;
}

function testConsumesSourceContent(strippedContent, sourceStem) {
  const requireLiterals = extractLiterals(strippedContent, /require\(\s*['"]([^'"]+)['"]\s*\)/g);
  const importLiterals = extractLiterals(strippedContent, /from\s+['"]([^'"]+)['"]/g);
  const consumed = [...requireLiterals, ...importLiterals].some(literal => literalStem(literal) === sourceStem);
  if (!consumed) return false;

  const mockLiterals = extractLiterals(strippedContent, /jest\.(?:mock|doMock)\(\s*['"]([^'"]+)['"]/g);
  const fullyMocked = mockLiterals.some(literal => literalStem(literal) === sourceStem);
  return !fullyMocked;
}

function realConsumers(sourceFile, candidateTestFiles) {
  const stem = path.basename(sourceFile).replace(/\.(js|mjs|ts)$/, '');
  return candidateTestFiles.filter(testFile => {
    let raw;
    try {
      raw = fs.readFileSync(testFile, 'utf8');
    } catch {
      return false;
    }
    return testConsumesSourceContent(stripCommentsAndStrings(raw), stem);
  });
}

/**
 * Mesure la source avec les tests touchés qui lui correspondent, les tests
 * existants dont le stem correspond, et tout autre test qui la require()/
 * importe réellement sans la mocker intégralement (realConsumers, ci-dessus
 * — filet de rattrapage pour les tests nommés par comportement). Les tests
 * d'un autre workspace ne sont jamais mélangés à la commande.
 */
function measureCoverage(sourceFile, allTouchedTestFiles) {
  const workspace = workspaceFor(sourceFile);
  const allTracked = listTrackedTests(workspace);
  const stemMatches = allTracked.filter(testFile => stemsMatch(sourceFile, testFile));
  const contentMatches = realConsumers(
    sourceFile,
    allTracked.filter(testFile => /\.(test|spec)\.(js|mjs|ts)$/.test(testFile))
      .map(testFile => path.join(ROOT, testFile))
  ).map(absPath => path.relative(ROOT, absPath).split(path.sep).join('/'));
  const trackedMatches = Array.from(new Set([...stemMatches, ...contentMatches]));
  const touchedMatches = allTouchedTestFiles
    .filter(testFile => belongsToWorkspace(testFile, workspace))
    .filter(testFile => stemsMatch(sourceFile, testFile));

  const repoTestTargets = Array.from(new Set([...touchedMatches, ...trackedMatches]));
  if (repoTestTargets.length === 0) return null;

  const binary = jestBinary(workspace);
  if (!fs.existsSync(binary)) {
    console.log(`  ${ICON.WARN} ${C.dim}${sourceFile}${C.r}  ${C.ylw}Jest absent dans le workspace ${workspace.name}${C.r}`);
    return null;
  }

  const coverageKey = `${workspace.name}-${stemOf(sourceFile)}`.replace(/[^a-z0-9-]/gi, '_');
  const coverageDir = path.join(ROOT, '.gate-coverage-tmp', coverageKey);
  fs.rmSync(coverageDir, { recursive: true, force: true });

  const testTargets = repoTestTargets.map(testFile => toWorkspacePath(testFile, workspace));
  const jestArgs = [
    ...testTargets,
    '--runInBand',
    '--coverage',
    `--collectCoverageFrom=${workspace.sourceRelative}`,
    '--coverageReporters=json-summary',
    `--coverageDirectory=${coverageDir}`,
    '--silent',
  ];

  try {
    cp.execFileSync(binary, jestArgs, {
      cwd: workspace.root,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
  } catch {
    // Jest peut produire le résumé même si une assertion échoue. Le résumé est
    // lu ci-dessous ; en son absence, la mesure est déclarée impossible.
  }

  const summaryPath = path.join(coverageDir, 'coverage-summary.json');
  if (!fs.existsSync(summaryPath)) return null;

  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    const normalizedSource = sourceFile.replace(/\\/g, '/');
    const normalizedWorkspaceSource = workspace.sourceRelative.replace(/\\/g, '/');
    const key = Object.keys(summary).find(entry => {
      const normalizedEntry = entry.replace(/\\/g, '/');
      return normalizedEntry.endsWith(normalizedSource)
        || normalizedEntry.endsWith(`/${normalizedWorkspaceSource}`);
    });
    if (!key) return null;

    const coverage = summary[key];
    return {
      stmts: coverage.statements.pct,
      branch: coverage.branches.pct,
    };
  } catch {
    return null;
  }
}

function main() {
  console.log(`\n${C.bld}╔════════════════════════════════════════════════════════════╗${C.r}`);
  console.log(`${C.bld}║  TOUCHED-TESTS GATE — code modifié ↔ signal test requis    ║${C.r}`);
  console.log(`${C.bld}╚════════════════════════════════════════════════════════════╝${C.r}\n`);
  console.log(`${C.dim}racine: ${ROOT}${C.r}\n`);

  const all = touchedFiles();
  const appFiles = all.filter(isApplicative);
  const testFiles = all.filter(isTestFile);
  const exemptions = loadExemptions();
  const thresholds = loadThresholds();
  const hasPrTests = prBodyHasTestSection();
  const checkCompletion = STRICT && !args.includes('--no-completion-check');

  console.log(`${C.dim}Fichiers touchés total : ${all.length}  ·  applicatifs : ${appFiles.length}${C.r}`);
  if (hasPrTests) console.log(`${C.dim}Section ## Tests détectée dans le body PR (preuve C active)${C.r}`);
  if (checkCompletion) console.log(`${C.dim}Règle de complétion au contact : ACTIVE (--strict, cliquets explicites uniquement)${C.r}`);
  console.log();

  if (appFiles.length === 0) {
    console.log(`${C.grn}✔ Aucun fichier applicatif touché — gate ignoré.${C.r}\n`);
    process.exit(0);
  }

  let fails = 0;
  // `blockingWarns` : la preuve A (test touché) existe mais la règle de
  // complétion au contact (--strict) ne peut pas être vérifiée pour le
  // cliquet configuré — ça reste bloquant en strict (cf.
  // touched-tests-gate-coverage-thresholds.test.js).
  let blockingWarns = 0;
  // `advisoryWarns` : preuve B (exemption) ou C (## Tests du body PR).
  // Ce sont des preuves de rang égal à la preuve A selon la doctrine
  // documentée en tête de fichier — --strict ne renforce que la preuve A
  // (complétion au contact), il ne doit donc jamais transformer une preuve
  // B/C valide en échec.
  let advisoryWarns = 0;
  const uncovered = [];
  const incomplete = [];

  for (const file of appFiles) {
    if (hasMatchingTest(file, all)) {
      if (!checkCompletion) {
        console.log(`  ${ICON.PASS} ${C.dim}${file}${C.r}  ${C.grn}test correspondant touché${C.r}`);
        continue;
      }

      // La couverture statements/branches de Jest s'applique aux sources exécutables,
      // pas aux feuilles CSS. Le CSS reste soumis à un test correspondant touché ;
      // compilation, cascade et fraîcheur du bundle sont ensuite prouvées par les
      // gates CSS Boutique dédiés.
      if (file.endsWith('.css')) {
        console.log(`  ${ICON.PASS} ${C.dim}${file}${C.r}  ${C.grn}test CSS correspondant touché — couverture Jest non applicable${C.r}`);
        continue;
      }

      const threshold = thresholdFor(file, thresholds);
      if (threshold === null) {
        console.log(`  ${ICON.PASS} ${C.dim}${file}${C.r}  ${C.grn}test touché — aucun cliquet de couverture explicite${C.r}`);
        continue;
      }

      const coverage = measureCoverage(file, testFiles);

      if (coverage === null) {
        console.log(`  ${ICON.WARN} ${C.dim}${file}${C.r}  ${C.ylw}test touché — couverture non mesurable isolément pour le cliquet configuré${C.r}`);
        blockingWarns++;
        continue;
      }

      if (coverage.stmts >= threshold.stmts && coverage.branch >= threshold.branch) {
        console.log(`  ${ICON.PASS} ${C.dim}${file}${C.r}  ${C.grn}test touché, couverture conforme (${coverage.stmts}%/${coverage.branch}%)${C.r}`);
        continue;
      }

      console.log(`  ${ICON.FAIL} ${file}  ${C.red}couverture sous le cliquet : ${coverage.stmts}% stmts / ${coverage.branch}% branch (minimum ${threshold.stmts}%/${threshold.branch}%)${C.r}`);
      incomplete.push({ file, coverage, threshold });
      fails++;
      continue;
    }

    if (exemptions[file]) {
      console.log(`  ${ICON.WARN} ${C.dim}${file}${C.r}  ${C.ylw}exempté : ${exemptions[file]}${C.r}`);
      advisoryWarns++;
      continue;
    }

    if (hasPrTests) {
      console.log(`  ${ICON.WARN} ${C.dim}${file}${C.r}  ${C.ylw}justifié par section ## Tests du body PR${C.r}`);
      advisoryWarns++;
      continue;
    }

    console.log(`  ${ICON.FAIL} ${file}  ${C.red}aucun test touché, pas d'exemption, pas de ## Tests PR${C.r}`);
    uncovered.push(file);
    fails++;
  }

  console.log();
  const warns = blockingWarns + advisoryWarns;

  if (fails === 0 && warns === 0) {
    console.log(`${C.grn}${C.bld}✔ Tous les fichiers applicatifs ont un signal test conforme.${C.r}\n`);
    process.exit(0);
  }

  if (fails === 0 && blockingWarns === 0) {
    console.log(`${C.ylw}▲ ${advisoryWarns} fichier(s) couvert(s) par exemption ou justification ## Tests (preuves B/C, non affectées par --strict).${C.r}\n`);
    process.exit(0);
  }

  if (warns > 0 && fails === 0) {
    console.log(`${C.ylw}▲ ${blockingWarns} fichier(s) avec couverture non mesurable pour un cliquet configuré, ${advisoryWarns} par exemption/justification.${C.r}\n`);
    process.exit(STRICT ? 1 : 0);
  }

  console.log(`${C.red}${C.bld}✖ ${fails} fichier(s) applicatif(s) en échec :${C.r}\n`);

  for (const file of uncovered) {
    const stem = stemOf(file);
    console.log(`  ${C.red}${file}${C.r}  ${C.dim}(aucun signal test)${C.r}`);
    console.log(`    → Créer tests/unit/${stem}.test.js ou tests/integration/${stem}.test.js`);
    console.log(`    → OU ajouter une exemption documentée dans governance/test-exemptions.json`);
    console.log(`    → OU ajouter une section ## Tests dans le body de la PR\n`);
  }

  for (const { file, coverage, threshold } of incomplete) {
    console.log(`  ${C.red}${file}${C.r}  ${C.dim}(couverture ${coverage.stmts}%/${coverage.branch}%, cliquet ${threshold.stmts}%/${threshold.branch}%)${C.r}`);
    console.log('    → Maintenir ou améliorer le cliquet existant');
    console.log('    → Si le cliquet est factuellement incorrect, le recalibrer avec justification mesurée\n');
  }

  if (REPORT) {
    console.log(`${C.ylw}▲ --report : exit 0 (rapport seul).${C.r}\n`);
    process.exit(0);
  }

  process.exit(1);
}

main();
