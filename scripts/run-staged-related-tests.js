#!/usr/bin/env node
'use strict';

/**
 * Tier 5 local gate: execute uniquement les tests unitaires relies aux fichiers staged.
 *
 * Resolution double :
 *   1. graphe Jest via --findRelatedTests ;
 *   2. fallback exact source <-> test par stem (ex. normalized-product.js -> normalized-product.test.js).
 *
 * Aucune couverture n'est mesuree ici. Les cliquets explicites de couverture restent
 * la responsabilite du gate touched-tests en certification/CI.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

function argVal(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function normalize(value) {
  return String(value || '').replace(/\\/g, '/');
}

function stagedFiles() {
  const explicit = argVal('--files');
  if (explicit) return explicit.split(',').map(normalize).map(s => s.trim()).filter(Boolean);

  const result = cp.spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git diff staged impossible: ${(result.stderr || '').trim()}`);
  }
  return result.stdout.split(/\r?\n/).map(normalize).map(s => s.trim()).filter(Boolean);
}

function sourceStem(file) {
  return path.basename(file).replace(/\.(js|cjs|mjs|ts)$/i, '').toLowerCase();
}

function testStem(file) {
  return path.basename(file).replace(/\.(test|spec)\.(js|cjs|mjs|ts)$/i, '').toLowerCase();
}

function stemsMatch(sourceFile, testFile) {
  return sourceStem(sourceFile) === testStem(testFile);
}

function isRootSource(file) {
  return /^(server\.js|(?:routes|services|middleware|utils|validators|core|bootstrap|db)\/.+\.(?:js|cjs|mjs|ts))$/i.test(file);
}

// Angle mort n°1 : le graphe require() de Jest ne trace jamais les migrations
// SQL (elles ne sont require()-ees par aucun fichier de test), et pourtant ce
// sont elles qui posent les invariants (NOT NULL, FK...) que des dizaines de
// fixtures a travers tout l'arbre doivent respecter. Impossible de mapper
// "quelle migration casse quelle fixture" finement -> on force la suite
// unitaire backend complete des qu'une migration ou le dump schema bouge,
// plutot que de laisser un faux sentiment de couverture.
function isSchemaOrMigrationChange(file) {
  return /^migrations\/.+\.sql$/i.test(file) || file === 'docs/db/railway-live-schema.sql';
}

function isBoutiqueSource(file) {
  return /^public\/boutique\/js\/.+\.(?:js|cjs|mjs|ts)$/i.test(file);
}

function isRootUnitTest(file) {
  return /^(tests\/(?:unit|invariants|contract|notifications)\/.+\.(?:test|spec)\.(?:js|cjs|mjs|ts)|tests\/parcelOptimization\.test\.js)$/i.test(file);
}

function isBoutiqueUnitTest(file) {
  return /^public\/boutique\/tests\/unit\/.+\.(?:test|spec)\.(?:js|cjs|mjs|ts)$/i.test(file);
}

// Angle mort n°2 : plusieurs tests de "doctrine" ne testent pas un module
// importe mais lisent une source en texte (fs.readFileSync / un helper
// read('routes/xxx.js')) pour asserter sur son contenu litteral. Ce couplage
// est invisible au graphe require() de Jest --findRelatedTests. On rattrape
// ca par une correspondance textuelle : un test est considere lie a un
// fichier stage si son propre code source cite ce chemin litteralement, ou -
// quand le chemin est construit en segments separes (path.join multi-args,
// ex. path.join(CANONICAL_ROOT, 'js', 'app.js')) - si le nom de fichier ET
// tous les segments de dossier non generiques (hors js/ts/src/lib/index)
// apparaissent quelque part dans le fichier.
const GENERIC_PATH_SEGMENTS = new Set(['js', 'ts', 'cjs', 'mjs', 'src', 'lib', 'index']);

function contentReferencesSource(testContent, sourceRelPath) {
  const posix = String(sourceRelPath || '').replace(/\\/g, '/');
  if (!posix) return false;
  if (testContent.includes(posix)) return true;

  const parts = posix.split('/');
  const basename = parts[parts.length - 1];
  if (!basename) return false;
  const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const basenameQuoted = new RegExp(`['"\`]${escaped}['"\`]`).test(testContent);
  if (!basenameQuoted) return false;

  const significantDirs = parts.slice(0, -1).filter(seg => seg && !GENERIC_PATH_SEGMENTS.has(seg.toLowerCase()));
  if (significantDirs.length === 0) return true;
  return significantDirs.every(dir => testContent.includes(dir));
}

function contentRelatedTests(files, tracked) {
  if (files.length === 0) return [];
  const candidates = tracked.filter(isRootUnitTest);
  const matches = [];
  for (const testFile of candidates) {
    const abs = path.resolve(ROOT, testFile);
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch (_e) {
      continue;
    }
    if (files.some(file => contentReferencesSource(content, file))) {
      matches.push(abs);
    }
  }
  return matches;
}

function trackedFiles() {
  const result = cp.spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ls-files impossible: ${(result.stderr || '').trim()}`);
  return result.stdout.split(/\r?\n/).map(normalize).filter(Boolean);
}

function jestInvocation(cwd) {
  const script = path.join(cwd, 'node_modules', 'jest', 'bin', 'jest.js');
  if (!fs.existsSync(script)) {
    throw new Error(`Jest absent pour ${cwd}. Installe les dependances du workspace avant de committer.`);
  }
  return { command: process.execPath, prefixArgs: [script] };
}

function spawnJest(workspace, jestArgs, options = {}) {
  const invocation = jestInvocation(workspace.cwd);
  return cp.spawnSync(invocation.command, [...invocation.prefixArgs, ...jestArgs], {
    cwd: workspace.cwd,
    env: { ...process.env, NODE_ENV: 'test' },
    ...options,
  });
}

function relatedTests(workspace, sourceFiles) {
  if (sourceFiles.length === 0) return [];

  const localSources = sourceFiles.map(file => workspace.prefix ? file.slice(workspace.prefix.length) : file);
  const jestArgs = [];
  if (workspace.config) jestArgs.push('--config', workspace.config);
  jestArgs.push('--listTests', '--findRelatedTests', ...localSources, '--passWithNoTests');

  const result = spawnJest(workspace, jestArgs, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Resolution Jest impossible pour ${workspace.name}:\n${result.stderr || result.stdout || ''}`);
  }

  return result.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(test => path.resolve(test));
}

function fallbackTests(workspace, sourceFiles, tracked) {
  if (sourceFiles.length === 0) return [];
  const candidates = tracked.filter(workspace.isUnitTest);
  const matches = candidates.filter(test => sourceFiles.some(source => stemsMatch(source, test)));
  return matches.map(file => path.resolve(ROOT, file));
}

function directStagedTests(workspace, files) {
  return files
    .filter(workspace.isUnitTest)
    .map(file => path.resolve(ROOT, file))
    .filter(file => fs.existsSync(file));
}

function runWorkspace(workspace, files, tracked) {
  const sources = files.filter(workspace.isSource);
  const directTests = directStagedTests(workspace, files);
  const contentMatches = workspace.contentAware ? contentRelatedTests(files, tracked) : [];
  if (sources.length === 0 && directTests.length === 0 && contentMatches.length === 0) return { ran: false, tests: 0 };

  jestInvocation(workspace.cwd);

  const tests = Array.from(new Set([
    ...relatedTests(workspace, sources),
    ...fallbackTests(workspace, sources, tracked),
    ...directTests,
    ...contentMatches,
  ].map(test => path.resolve(test))));

  if (tests.length === 0) {
    console.log(`WARN Tests cibles ${workspace.name}: aucun test unitaire relie a ${sources.length} source(s) staged.`);
    return { ran: false, tests: 0, warned: true };
  }

  const jestArgs = [];
  if (workspace.config) jestArgs.push('--config', workspace.config);
  jestArgs.push('--runTestsByPath', ...tests, '--runInBand');

  console.log(`Tests cibles ${workspace.name}: ${tests.length} suite(s) pour ${sources.length} source(s) staged.`);
  const result = spawnJest(workspace, jestArgs, { stdio: 'inherit' });
  if (result.status !== 0) return { ran: true, tests: tests.length, failed: true, status: result.status || 1 };
  return { ran: true, tests: tests.length, failed: false };
}

function runFullBackendSuite(workspace, reason) {
  console.log(`Tests cibles ${workspace.name}: ${reason} — suite unitaire backend complete forcee (pas de mapping fin fiable).`);
  const jestArgs = [];
  if (workspace.config) jestArgs.push('--config', workspace.config);
  jestArgs.push('--runInBand');
  const result = spawnJest(workspace, jestArgs, { stdio: 'inherit' });
  if (result.status !== 0) return { ran: true, tests: -1, failed: true, status: result.status || 1 };
  return { ran: true, tests: -1, failed: false };
}

function main() {
  const files = stagedFiles();
  const tracked = trackedFiles();
  const schemaChanged = files.some(isSchemaOrMigrationChange);
  const workspaces = [
    {
      name: 'backend',
      cwd: ROOT,
      prefix: '',
      config: 'jest.unit.config.js',
      isSource: isRootSource,
      isUnitTest: isRootUnitTest,
      contentAware: true,
    },
    {
      name: 'boutique',
      cwd: path.join(ROOT, 'public', 'boutique'),
      prefix: 'public/boutique/',
      config: null,
      isSource: isBoutiqueSource,
      isUnitTest: isBoutiqueUnitTest,
      contentAware: false,
    },
  ];

  let ran = 0;
  let warnings = 0;
  for (const workspace of workspaces) {
    const result = (workspace.name === 'backend' && schemaChanged)
      ? runFullBackendSuite(workspace, 'migration(s)/schema staged')
      : runWorkspace(workspace, files, tracked);
    if (result.ran) ran += result.tests;
    if (result.warned) warnings++;
    if (result.failed) return result.status || 1;
  }

  if (ran === 0 && warnings === 0) console.log('Tests cibles staged: aucun perimetre unitaire concerne.');
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`ECHEC Tests cibles staged: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  sourceStem,
  testStem,
  stemsMatch,
  isRootSource,
  isBoutiqueSource,
  isRootUnitTest,
  isBoutiqueUnitTest,
  isSchemaOrMigrationChange,
  contentReferencesSource,
};
