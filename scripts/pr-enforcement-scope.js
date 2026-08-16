#!/usr/bin/env node
'use strict';

/**
 * Classifie le diff d'une PR pour l'enforcement GitHub ciblé.
 *
 * Lot 1 : backend.
 * Lot 2A : migrations + dump live, sans mélanger Boutique/governance.
 *
 * Usage GitHub Actions :
 *   node scripts/pr-enforcement-scope.js --base <sha> --head <sha> --github-output <path>
 */

const fs = require('fs');
const cp = require('child_process');

const args = process.argv.slice(2);

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

function norm(file) {
  return String(file || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function isBackendFile(file) {
  const f = norm(file);
  return /^(?:server\.js|package(?:-lock)?\.json|jest\.unit\.config\.js)$/i.test(f)
    || /^(?:routes|services|middleware|utils|validators|core|bootstrap|db)\/.+/i.test(f)
    || /^tests\/(?:unit|invariants|contract|notifications)\/.+\.(?:test|spec)\.(?:js|cjs|mjs|ts)$/i.test(f)
    || /^tests\/parcelOptimization\.test\.js$/i.test(f);
}

function isMigrationFile(file) {
  return /^migrations\/.+\.sql$/i.test(norm(file));
}

function isLiveSchemaFile(file) {
  return norm(file) === 'docs/db/railway-live-schema.sql';
}

function classify(files) {
  const changedFiles = [...new Set((files || []).map(norm).filter(Boolean))].sort();
  const backendFiles = changedFiles.filter(isBackendFile);
  const migrationFiles = changedFiles.filter(isMigrationFile);
  const schemaDump = changedFiles.some(isLiveSchemaFile);
  return {
    changedFiles,
    backendFiles,
    migrationFiles,
    backend: backendFiles.length > 0,
    migrations: migrationFiles.length > 0 || schemaDump,
    schemaDump,
  };
}

function diffFiles(base, head) {
  if (!base || !head) throw new Error('Les SHA --base et --head sont obligatoires.');
  const r = cp.spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMR', base, head], {
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(`git diff impossible: ${(r.stderr || r.stdout || '').trim()}`);
  }
  return r.stdout.split(/\r?\n/).map(norm).filter(Boolean);
}

function appendGithubOutput(path, model) {
  if (!path) return;
  const lines = [
    `backend=${model.backend ? 'true' : 'false'}`,
    `backend_files=${model.backendFiles.join(',')}`,
    `migrations=${model.migrations ? 'true' : 'false'}`,
    `migration_files=${model.migrationFiles.join(',')}`,
    `schema_dump=${model.schemaDump ? 'true' : 'false'}`,
    `changed_count=${model.changedFiles.length}`,
  ];
  fs.appendFileSync(path, lines.join('\n') + '\n', 'utf8');
}

function main() {
  const explicit = argValue('--files');
  const files = explicit
    ? explicit.split(',').map(norm).filter(Boolean)
    : diffFiles(argValue('--base'), argValue('--head'));
  const model = classify(files);
  appendGithubOutput(argValue('--github-output'), model);
  process.stdout.write(JSON.stringify(model, null, 2) + '\n');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`PR enforcement scope: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  norm,
  isBackendFile,
  isMigrationFile,
  isLiveSchemaFile,
  classify,
};
