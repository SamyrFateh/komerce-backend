#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-one-shot-router
 * @domain        purchasing
 * @layer         tooling
 * @criticality   high
 * @inputs        staging runtime, optional contract-refresh, SOI-replay, market-exposure or Golden E2E operation flags
 * @outputs       historical prepayment proof or delegated catalog maintenance/Golden operation
 * @depends       db.js, scripts/aliexpress-prepayment-proof-core.js, scripts/aliexpress-refresh-imported-contracts.js, scripts/replay-soi.js, scripts/aliexpress-market-exposure-pilot.js, scripts/aliexpress-golden-e2e.js
 * @used-by       Railway aliexpress-pool-once
 * @db-read       delegated operation only
 * @db-write      delegated operation only; execute routes require independent explicit guards
 * @db-txn        delegated operation owns transactions
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md, docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
 * @impact-areas  purchasing, supplier-integration, catalog, staging
 * @version       2026-09-one-shot-router-v4
 */
'use strict';

const { spawnSync } = require('node:child_process');
const db = require('../db');
const core = require('./aliexpress-prepayment-proof-core');

const CONTRACT_REFRESH_RUN_FLAG = 'KOMERCE_ALIEXPRESS_CONTRACT_REFRESH_RUN';
const SOI_REPLAY_RUN_FLAG = 'KOMERCE_ALIEXPRESS_SOI_REPLAY_RUN';
const SOI_REPLAY_ALLOW_FLAG = 'KOMERCE_ALLOW_ALIEXPRESS_SOI_REPLAY';
const MARKET_EXPOSURE_RUN_FLAG = 'KOMERCE_ALIEXPRESS_MARKET_EXPOSURE_RUN';
const MARKET_EXPOSURE_ALLOW_FLAG = 'KOMERCE_ALLOW_ALIEXPRESS_MARKET_EXPOSURE';
const GOLDEN_E2E_RUN_FLAG = 'KOMERCE_ALIEXPRESS_GOLDEN_E2E_RUN';
const GOLDEN_E2E_ALLOW_FLAG = 'KOMERCE_ALLOW_ALIEXPRESS_GOLDEN_E2E';
const MAX_REFRESH_LIMIT = 500;
const MAX_REPLAY_LIMIT = 500;
const MAX_MARKET_EXPOSURE_LIMIT = 5;

function parseOperationFlag(flagName, maxLimit, env = process.env) {
  const raw = String(env[flagName] || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(dry-run|execute):(\d+)$/);
  if (!match) throw new Error(`${flagName} doit être dry-run:N ou execute:N`);
  const limit = Number.parseInt(match[2], 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new Error(`${flagName}: N doit être un entier 1..${maxLimit}`);
  }
  return { mode: match[1], limit };
}

function parseContractRefreshRun(env = process.env) {
  return parseOperationFlag(CONTRACT_REFRESH_RUN_FLAG, MAX_REFRESH_LIMIT, env);
}

function parseSoiReplayRun(env = process.env) {
  return parseOperationFlag(SOI_REPLAY_RUN_FLAG, MAX_REPLAY_LIMIT, env);
}

function parseMarketExposureRun(env = process.env) {
  const operation = parseOperationFlag(MARKET_EXPOSURE_RUN_FLAG, MAX_MARKET_EXPOSURE_LIMIT, env);
  if (operation && operation.limit !== 5) {
    throw new Error(`${MARKET_EXPOSURE_RUN_FLAG}: le pilote est figé à 5 références exactes`);
  }
  return operation;
}

function parseGoldenE2ERun(env = process.env) {
  const raw = String(env[GOLDEN_E2E_RUN_FLAG] || '').trim();
  if (!raw) return null;
  if (raw === 'dry-run') return { mode: 'dry-run', supplierProductId: null };
  const match = raw.match(/^import:(\d{5,20})$/);
  if (!match) throw new Error(`${GOLDEN_E2E_RUN_FLAG} doit être dry-run ou import:<supplier_product_id>`);
  return { mode: 'import', supplierProductId: match[1] };
}

function assertStaging(env = process.env) {
  const runtime = String(env.KOMERCE_ENV || '').trim().toLowerCase();
  if (runtime !== 'staging') throw new Error(`REFUS: KOMERCE_ENV=staging requis (reçu: ${runtime || '<vide>'})`);
}

function spawnChild(label, args, env = process.env) {
  console.log(`[aliexpress-one-shot] delegate ${label} args=${JSON.stringify(args.slice(1))}`);
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${label} interrompu par signal ${result.signal}`);
  if (result.status !== 0) throw new Error(`${label} terminé avec code ${result.status}`);
  return result.status;
}

function runChild(label, script, operation, env = process.env) {
  const args = [
    script,
    operation.mode === 'execute' ? '--execute' : '--dry-run',
    `--limit=${operation.limit}`,
  ];
  const status = spawnChild(label, args, env);
  return { delegated: label, ...operation, status };
}

function runContractRefresh(operation, env = process.env) {
  return runChild('contract-refresh', './scripts/aliexpress-refresh-imported-contracts.js', operation, env);
}

function runSoiReplay(operation, env = process.env) {
  assertStaging(env);
  if (operation.mode === 'execute' && env[SOI_REPLAY_ALLOW_FLAG] !== '1') {
    throw new Error(`${SOI_REPLAY_ALLOW_FLAG}=1 requis pour execute`);
  }
  return runChild('soi-replay', './scripts/replay-soi.js', operation, env);
}

function runMarketExposure(operation, env = process.env) {
  assertStaging(env);
  if (operation.mode === 'execute' && env[MARKET_EXPOSURE_ALLOW_FLAG] !== '1') {
    throw new Error(`${MARKET_EXPOSURE_ALLOW_FLAG}=1 requis pour execute`);
  }
  return runChild('market-exposure', './scripts/aliexpress-market-exposure-pilot.js', operation, env);
}

function runGoldenE2E(operation, env = process.env) {
  assertStaging(env);
  if (operation.mode === 'import' && env[GOLDEN_E2E_ALLOW_FLAG] !== '1') {
    throw new Error(`${GOLDEN_E2E_ALLOW_FLAG}=1 requis pour import`);
  }
  const args = operation.mode === 'import'
    ? ['./scripts/aliexpress-golden-e2e.js', '--execute-import', `--supplier-product-id=${operation.supplierProductId}`]
    : ['./scripts/aliexpress-golden-e2e.js', '--dry-run'];
  const status = spawnChild('golden-e2e', args, env);
  return { delegated: 'golden-e2e', ...operation, status };
}

async function main(env = process.env) {
  const contractRefresh = parseContractRefreshRun(env);
  const soiReplay = parseSoiReplayRun(env);
  const marketExposure = parseMarketExposureRun(env);
  const goldenE2E = parseGoldenE2ERun(env);
  const selected = [contractRefresh, soiReplay, marketExposure, goldenE2E].filter(Boolean);
  if (selected.length > 1) {
    throw new Error(`REFUS: ${CONTRACT_REFRESH_RUN_FLAG}, ${SOI_REPLAY_RUN_FLAG}, ${MARKET_EXPOSURE_RUN_FLAG} et ${GOLDEN_E2E_RUN_FLAG} sont mutuellement exclusifs`);
  }
  if (contractRefresh) return runContractRefresh(contractRefresh, env);
  if (soiReplay) return runSoiReplay(soiReplay, env);
  if (marketExposure) return runMarketExposure(marketExposure, env);
  if (goldenE2E) return runGoldenE2E(goldenE2E, env);
  return core.run(env);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`[aliexpress-one-shot] FAILED: ${error.stack || error}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  ...core,
  CONTRACT_REFRESH_RUN_FLAG,
  SOI_REPLAY_RUN_FLAG,
  SOI_REPLAY_ALLOW_FLAG,
  MARKET_EXPOSURE_RUN_FLAG,
  MARKET_EXPOSURE_ALLOW_FLAG,
  GOLDEN_E2E_RUN_FLAG,
  GOLDEN_E2E_ALLOW_FLAG,
  MAX_REFRESH_LIMIT,
  MAX_REPLAY_LIMIT,
  MAX_MARKET_EXPOSURE_LIMIT,
  parseOperationFlag,
  parseContractRefreshRun,
  parseSoiReplayRun,
  parseMarketExposureRun,
  parseGoldenE2ERun,
  assertStaging,
  runContractRefresh,
  runSoiReplay,
  runMarketExposure,
  runGoldenE2E,
  main,
};
