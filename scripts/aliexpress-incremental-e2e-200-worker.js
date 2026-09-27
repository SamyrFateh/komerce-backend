#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          supplier-catalog-isolated-e2e-worker-launcher
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        KOMERCE_ALI_E2E_200_WORKER_MODE
 * @outputs       selected isolated catalog campaign action, including canonical 700 build
 * @depends       scripts/aliexpress-wave2-sourcing.js, scripts/aliexpress-incremental-e2e-200.js, scripts/aliexpress-incremental-e2e-200-taxonomy-repair.js, scripts/cj-500-e2e-catalog-sync.js, scripts/catalog-e2e-700-acceptance.js
 * @used-by       railway.ali-e2e-200.json
 * @db-read       delegated
 * @db-write      delegated
 * @db-txn        delegated
 * @doctrine      isolated_staging_only, explicit_worker_mode, no_hidden_fallback
 * @impact-areas  catalog, sourcing, supplier-import, refinery, staging
 * @version       2026-09-v1
 */
'use strict';

const { spawnSync } = require('child_process');

const MODES = Object.freeze([
  'idle',
  'campaign',
  'taxonomy-audit',
  'taxonomy-apply-and-accept',
  'taxonomy-repair-topup',
  'catalog-700-build',
  'catalog-700-local-audit',
  'catalog-cj-reconcile-promote-local',
]);

function resolveMode(env = process.env) {
  const mode = String(env.KOMERCE_ALI_E2E_200_WORKER_MODE || 'idle').trim().toLowerCase();
  if (!MODES.includes(mode)) {
    throw new Error(`KOMERCE_ALI_E2E_200_WORKER_MODE invalide: ${mode}. Attendu: ${MODES.join(', ')}`);
  }
  return mode;
}

function commandPlan(mode = resolveMode()) {
  if (mode === 'idle') return [];
  if (mode === 'catalog-cj-reconcile-promote-local') {
    return [
      ['scripts/cj-reconcile-current-new-12-promote.js'],
    ];
  }
  if (mode === 'catalog-700-local-audit') {
    return [
      ['scripts/real-supplier-1000-stress-staging.js', '--operation=supplier-slice-audit', '--supplier=CJdropshipping', '--limit=500'],
    ];
  }
  if (mode === 'catalog-700-build') {
    return [
      ['scripts/cj-500-e2e-catalog-sync.js'],
      ['scripts/real-supplier-1000-stress-staging.js', '--operation=refinery-audit', '--limit=715'],
      ['scripts/real-supplier-1000-stress-staging.js', '--operation=promote', '--limit=500'],
      ['scripts/catalog-fr-free-e2e-preparation.js', '--limit=1000'],
      ['scripts/cj-refinery-commandability-continuation.js', '--limit=500', '--chunk=20', '--output=artifacts/catalog-e2e-700/cj-commandability.json'],
      ['scripts/aliexpress-incremental-e2e-200.js', '--operation=accept', '--output=artifacts/catalog-e2e-700/ali-final-acceptance.json'],
      ['scripts/catalog-e2e-700-acceptance.js', '--output=artifacts/catalog-e2e-700/final-acceptance.json'],
    ];
  }
  if (mode === 'taxonomy-audit') {
    return [
      ['scripts/aliexpress-incremental-e2e-200-taxonomy-repair.js', '--operation=audit'],
    ];
  }
  if (mode === 'taxonomy-repair-topup') {
    return [
      ['scripts/aliexpress-incremental-e2e-200-taxonomy-repair.js', '--operation=apply'],
      ['scripts/aliexpress-wave2-sourcing.js'],
      ['scripts/aliexpress-incremental-e2e-200.js', '--operation=refinery-audit'],
      ['scripts/aliexpress-incremental-e2e-200.js', '--operation=promote'],
      ['scripts/aliexpress-incremental-e2e-200.js', '--operation=prepare-fr'],
      ['scripts/aliexpress-incremental-e2e-200.js', '--operation=accept', '--output=artifacts/aliexpress-incremental-e2e-200/final-acceptance.json'],
    ];
  }
  if (mode === 'taxonomy-apply-and-accept') {
    return [
      ['scripts/aliexpress-incremental-e2e-200-taxonomy-repair.js', '--operation=apply'],
      ['scripts/aliexpress-incremental-e2e-200.js', '--operation=refinery-audit'],
      ['scripts/aliexpress-incremental-e2e-200.js', '--operation=accept', '--output=artifacts/aliexpress-incremental-e2e-200/final-acceptance.json'],
    ];
  }
  return [
    ['scripts/aliexpress-wave2-sourcing.js'],
    ['scripts/aliexpress-incremental-e2e-200.js', '--operation=refinery-audit'],
    ['scripts/aliexpress-incremental-e2e-200.js', '--operation=promote'],
    ['scripts/aliexpress-incremental-e2e-200.js', '--operation=prepare-fr'],
    ['scripts/aliexpress-incremental-e2e-200.js', '--operation=accept', '--output=artifacts/aliexpress-incremental-e2e-200/final-acceptance.json'],
  ];
}

function runPlan(plan = commandPlan()) {
  for (const args of plan) {
    const result = spawnSync(process.execPath, args, {
      stdio: 'inherit',
      env: process.env,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`ALI_E2E_200_WORKER_STEP_FAILED status=${result.status} args=${JSON.stringify(args)}`);
    }
  }
}

function main() {
  const mode = resolveMode();
  console.log(`[ali-e2e-200-worker] mode=${mode}`);
  runPlan(commandPlan(mode));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[ali-e2e-200-worker] FAILED: ${error.stack || error.message || error}`);
    process.exit(1);
  }
}

module.exports = { MODES, resolveMode, commandPlan, runPlan, main };
