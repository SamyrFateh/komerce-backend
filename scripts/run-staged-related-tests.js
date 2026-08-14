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

function isBoutiqueSource(file) {
  return /^public\/boutique\/js\/.+\.(?:js|cjs|mjs|ts)$/i.test(file);
}

function isRootUnitTest(file) {
  return /^(tests\/(?:unit|invariants|contract|notifications)\/.+\.(?:test|spec)\.(?:js|cjs|mjs|ts)|tests\/parcelOptimization\.test\.js)$/i.test(file);
}

function isBoutiqueUnitTest(file) {
  return /^public\/boutique\/tests\/unit\/.+\.(?:test|spec)\.(?:js|cjs|mjs|ts)$/i.test(file);
}

function trackedFiles() {
  const result = cp.spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ls-files impossible: ${(result.stderr || '').trim()}`);
  return result.stdout.split(/\r?\n/).map(normalize).filter(Boolean);
}

function jestBinary(cwd) {
  const executable = process.platform === 'win32' ? 'jest.cmd' : 'jest';
  return path.join(cwd, 'node_modules', '.bin', executable);
}

function relatedTests(workspace, sourceFiles) {
  if (sourceFiles.length === 0) return [];
  const binary = jestBinary(workspace.cwd);
  if (!fs.existsSync(binary)) {
    throw new Error(`Jest absent pour ${workspace.name}. Installe les dependances du workspace avant de committer.`);
  }

  const localSources = sourceFiles.map(file => workspace.prefix ? file.slice(workspace.prefix.length) : file);
  const jestArgs = [];
  if (workspace.config) jestArgs.push('--config', workspace.config);
  jestArgs.push('--listTests', '--findRelatedTests', ...localSources, '--passWithNoTests');

  const result = cp.spawnSync(binary, jestArgs, {
    cwd: workspace.cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
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
  return files.filter(workspace.isUnitTest).map(file => path.resolve(ROOT, file));
}

function runWorkspace(workspace, files, tracked) {
  const sources = files.filter(workspace.isSource);
  const directTests = directStagedTests(workspace, files);
  if (sources.length === 0 && directTests.length === 0) return { ran: false, tests: 0 };

  const binary = jestBinary(workspace.cwd);
  if (!fs.existsSync(binary)) {
    throw new Error(`Jest absent pour ${workspace.name}. Installe les dependances du workspace avant de committer.`);
  }

  const tests = Array.from(new Set([
    ...relatedTests(workspace, sources),
    ...fallbackTests(workspace, sources, tracked),
    ...directTests,
  ].map(test => path.resolve(test))));

  if (tests.length === 0) {
    console.log(`WARN Tests cibles ${workspace.name}: aucun test unitaire relie a ${sources.length} source(s) staged.`);
    return { ran: false, tests: 0, warned: true };
  }

  const jestArgs = [];
  if (workspace.config) jestArgs.push('--config', workspace.config);
  jestArgs.push('--runTestsByPath', ...tests, '--runInBand');

  console.log(`Tests cibles ${workspace.name}: ${tests.length} suite(s) pour ${sources.length} source(s) staged.`);
  const result = cp.spawnSync(binary, jestArgs, {
    cwd: workspace.cwd,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
  });
  if (result.status !== 0) return { ran: true, tests: tests.length, failed: true, status: result.status || 1 };
  return { ran: true, tests: tests.length, failed: false };
}

function main() {
  const files = stagedFiles();
  const tracked = trackedFiles();
  const workspaces = [
    {
      name: 'backend',
      cwd: ROOT,
      prefix: '',
      config: 'jest.unit.config.js',
      isSource: isRootSource,
      isUnitTest: isRootUnitTest,
    },
    {
      name: 'boutique',
      cwd: path.join(ROOT, 'public', 'boutique'),
      prefix: 'public/boutique/',
      config: null,
      isSource: isBoutiqueSource,
      isUnitTest: isBoutiqueUnitTest,
    },
  ];

  let ran = 0;
  let warnings = 0;
  for (const workspace of workspaces) {
    const result = runWorkspace(workspace, files, tracked);
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
};
