#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-incremental-e2e-200-worker-launcher
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        KOMERCE_ALI_E2E_200_WORKER_MODE
 * @outputs       selected isolated +200 campaign action
 * @depends       scripts/aliexpress-wave2-sourcing.js, scripts/aliexpress-incremental-e2e-200.js, scripts/aliexpress-incremental-e2e-200-taxonomy-repair.js
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
  'campaign',
  'taxonomy-audit',
  'taxonomy-apply-and-accept',
]);

function resolveMode(env = process.env) {
  const mode = String(env.KOMERCE_ALI_E2E_200_WORKER_MODE || 'campaign').trim().toLowerCase();
  if (!MODES.includes(mode)) {
    throw new Error(`KOMERCE_ALI_E2E_200_WORKER_MODE invalide: ${mode}. Attendu: ${MODES.join(', ')}`);
  }
  return mode;
}

function commandPlan(mode = resolveMode()) {
  if (mode === 'taxonomy-audit') {
    return [
      ['scripts/aliexpress-incremental-e2e-200-taxonomy-repair.js', '--operation=audit'],
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
