#!/usr/bin/env node
'use strict';

/**
 * Classifie le diff d'une PR pour l'enforcement GitHub ciblé.
 *
 * Lot 1  : backend.
 * Lot 2A : migrations + dump live.
 * Lot 2B : Boutique runtime source + unit tests, sans css/dist ni E2E.
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

function isBoutiqueCssSource(file) {
  return /^public\/boutique\/css\/(?!dist\/).+\.css$/i.test(norm(file));
}

function isBoutiqueJsSource(file) {
  return /^public\/boutique\/js\/.+\.(?:js|cjs|mjs|ts)$/i.test(norm(file));
}

function isBoutiqueHtml(file) {
  return norm(file) === 'public/boutique/index.html';
}

function isBoutiqueUnitTest(file) {
  return /^public\/boutique\/tests\/unit\/.+\.(?:test|spec)\.(?:js|cjs|mjs|ts)$/i.test(norm(file));
}

function isBoutiquePackageFile(file) {
  return /^public\/boutique\/package(?:-lock)?\.json$/i.test(norm(file));
}

function isBoutiqueRelevant(file) {
  return isBoutiqueCssSource(file)
    || isBoutiqueJsSource(file)
    || isBoutiqueHtml(file)
    || isBoutiqueUnitTest(file)
    || isBoutiquePackageFile(file);
}

// Lot 3 — governance / feature-first : cartes, baselines/ontologie, logique des
// gates, capabilities, et les projections canoniques dérivées. Une PR qui ne
// touche que ces fichiers doit rejouer feature-guard + business-graph --check +
// feature-360 --check (mode check, jamais --write), sinon le domaine gouvernance
// n'est pas enforced (Required verdict passait à vide auparavant).
function isGovernanceFile(file) {
  const f = norm(file);
  return /^features\/.+\.feature\.js$/i.test(f)
    || /^governance\/.+/i.test(f)
    || /^scripts\/.+\.(?:js|cjs|mjs)$/i.test(f)
    || /^capabilities\/.+\.(?:js|cjs|mjs)$/i.test(f)
    || /^docs\/(?:FEATURE_360|BUSINESS_FEATURE_GRAPH|O6_INVENTORY)\.(?:json|md)$/i.test(f);
}

function classify(files) {
  const changedFiles = [...new Set((files || []).map(norm).filter(Boolean))].sort();
  const backendFiles = changedFiles.filter(isBackendFile);
  const migrationFiles = changedFiles.filter(isMigrationFile);
  const schemaDump = changedFiles.some(isLiveSchemaFile);
  const boutiqueFiles = changedFiles.filter(isBoutiqueRelevant);
  const boutiqueCss = changedFiles.some(isBoutiqueCssSource);
  const boutiqueJs = changedFiles.some(isBoutiqueJsSource);
  const boutiqueHtml = changedFiles.some(isBoutiqueHtml);
  const boutiqueUnit = changedFiles.some(isBoutiqueUnitTest);
  const boutiquePackage = changedFiles.some(isBoutiquePackageFile);
  const boutiqueTestFiles = boutiqueFiles.filter(file => isBoutiqueJsSource(file) || isBoutiqueUnitTest(file));
  const governanceFiles = changedFiles.filter(isGovernanceFile);

  return {
    changedFiles,
    backendFiles,
    migrationFiles,
    boutiqueFiles,
    boutiqueTestFiles,
    governanceFiles,
    backend: backendFiles.length > 0,
    migrations: migrationFiles.length > 0 || schemaDump,
    schemaDump,
    boutique: boutiqueFiles.length > 0,
    boutiqueCss,
    boutiqueJs,
    boutiqueHtml,
    boutiqueUnit,
    boutiquePackage,
    governance: governanceFiles.length > 0,
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
    `boutique=${model.boutique ? 'true' : 'false'}`,
    `boutique_files=${model.boutiqueFiles.join(',')}`,
    `boutique_test_files=${model.boutiqueTestFiles.join(',')}`,
    `boutique_css=${model.boutiqueCss ? 'true' : 'false'}`,
    `boutique_js=${model.boutiqueJs ? 'true' : 'false'}`,
    `boutique_html=${model.boutiqueHtml ? 'true' : 'false'}`,
    `boutique_unit=${model.boutiqueUnit ? 'true' : 'false'}`,
    `boutique_package=${model.boutiquePackage ? 'true' : 'false'}`,
    `governance=${model.governance ? 'true' : 'false'}`,
    `governance_files=${model.governanceFiles.join(',')}`,
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
  isBoutiqueCssSource,
  isBoutiqueJsSource,
  isBoutiqueHtml,
  isBoutiqueUnitTest,
  isBoutiquePackageFile,
  isBoutiqueRelevant,
  isGovernanceFile,
  classify,
};
