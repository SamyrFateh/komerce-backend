#!/usr/bin/env node
'use strict';

/**
 * Classifie le diff d'une PR pour l'enforcement GitHub ciblé.
 *
 * Lot 1  : backend + tests backend racine.
 * Lot 2A : migrations + dump live.
 * Lot 2B : Boutique runtime source + unit tests, sans css/dist ni E2E.
 * Lot 3  : governance / feature-first + workflows GitHub Actions actifs.
 * CI FAST-2 : Golden CDR intégré au runner Backend existant quand pertinent.
 *
 * Tous les statuts Git du diff sont pris en compte. Une suppression doit
 * réveiller le même domaine qu'une création/modification du même chemin.
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
    || /^tests\/.+/i.test(f);
}

function isMigrationFile(file) {
  return /^migrations\/.+\.sql$/i.test(norm(file));
}

function isLiveSchemaFile(file) {
  return norm(file) === 'docs/db/railway-live-schema.sql';
}

// Parité économique CURRENT. Cette liste reprend exactement l'ancien
// path-filter de .github/workflows/golden-cdr.yml ; elle vit désormais dans
// le classifier unique pour éviter un second runner checkout/setup/npm-ci.
function isGoldenCdrFile(file) {
  const f = norm(file);
  return /^(?:services\/(?:pricing-cdr|pricing-engine|pricing-recommend|transport-pricing|transport-rails)\.js|routes\/(?:admin-pricing-matrices|admin-finance-config|economic)\.js|services\/(?:economic-engine-queries|dashboard-ops-queries)\.js|services\/cost-allocation\/allocate\.js|utils\/(?:eco-bridge|rates|relay-commission)\.js|tools\/golden-cdr\/(?:golden-cdr|witnesses)\.js)$/i.test(f)
    || /^tools\/golden-cdr\/(?:fixtures|golden)\/.+/i.test(f);
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

function isBusinessManifestSource(file) {
  const f = norm(file);
  return /^features\/.+\.feature\.js$/i.test(f)
    || /^public\/boutique\/features\/.+\.feature\.js$/i.test(f)
    || /^public\/dashboards\/features\/.+\.feature\.js$/i.test(f)
    || /^public\/features\/.+\.feature\.js$/i.test(f)
    || /^docs\/doctrine\/(?:FEATURE_DOCTRINE|APP_FEATURE_REGISTRY)\.md$/i.test(f);
}

// Le Business Graph O5 rescane les imports locaux des fichiers JS gouvernés
// dans les trois scopes (backend, Boutique, Dash). Une modification de source
// gouvernée peut donc rendre BUSINESS_FEATURE_GRAPH stale même si aucun manifest
// ne change. Régression révélée par #807 : b-passkey-step-up.js a changé son
// import/depends sans réveiller Governance, et le stale n'a été découvert qu'à
// la PR suivante.
function isBusinessGraphRuntimeSource(file) {
  const f = norm(file);
  return isBoutiqueJsSource(f)
    || /^public\/dashboards\/.+\.(?:js|cjs|mjs|ts)$/i.test(f)
    || /^public\/js\/.+\.(?:js|cjs|mjs|ts)$/i.test(f)
    || f === 'public/sw.js';
}

// Lot 3 — governance / feature-first : cartes, baselines/ontologie, logique des
// gates, capabilities, workflows GitHub Actions actifs et projections canoniques
// dérivées. Tout fichier backend reconnu par Lot 1 réveille également la
// gouvernance : un nouveau routes/services/middleware/utils/test ne doit jamais
// pouvoir entrer sans que le registre feature et Feature 360 vérifient son
// ownership. Régression découverte sur AUTH-8a : utils/auth-cookie.js était
// backend=true mais governance=false, donc l'orphelin n'a été vu qu'à la PR suivante.
//
// AUTH-3 a révélé le même défaut sur les sources de vérité multi-scope du
// Business Graph : les manifests Boutique/Dash et les doctrines de registre
// étaient chargés par le générateur mais ne réveillaient pas Governance. Toute
// source déclarative OU runtime réellement rescannée par Business Graph doit
// donc être classée ici.
function isGovernanceFile(file) {
  const f = norm(file);
  return isBackendFile(f)
    || isBusinessManifestSource(f)
    || isBusinessGraphRuntimeSource(f)
    || /^governance\/.+/i.test(f)
    || /^scripts\/.+\.(?:js|cjs|mjs)$/i.test(f)
    || /^capabilities\/.+\.(?:js|cjs|mjs)$/i.test(f)
    || /^\.github\/workflows\/.+/i.test(f)
    || /^docs\/(?:FEATURE_360|BUSINESS_FEATURE_GRAPH|O6_INVENTORY)\.(?:json|md)$/i.test(f);
}

function classify(files) {
  const changedFiles = [...new Set((files || []).map(norm).filter(Boolean))].sort();
  const backendFiles = changedFiles.filter(isBackendFile);
  const goldenFiles = changedFiles.filter(isGoldenCdrFile);
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
    goldenFiles,
    migrationFiles,
    boutiqueFiles,
    boutiqueTestFiles,
    governanceFiles,
    backend: backendFiles.length > 0,
    golden: goldenFiles.length > 0,
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
  // Aucun --diff-filter : créations, modifications, renommages, suppressions et
  // changements de type doivent tous être visibles par le classifier.
  const r = cp.spawnSync('git', ['diff', '--name-only', base, head], {
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
    `golden=${model.golden ? 'true' : 'false'}`,
    `golden_files=${model.goldenFiles.join(',')}`,
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
  isGoldenCdrFile,
  isBoutiqueCssSource,
  isBoutiqueJsSource,
  isBoutiqueHtml,
  isBoutiqueUnitTest,
  isBoutiquePackageFile,
  isBoutiqueRelevant,
  isBusinessManifestSource,
  isBusinessGraphRuntimeSource,
  isGovernanceFile,
  classify,
  diffFiles,
};
