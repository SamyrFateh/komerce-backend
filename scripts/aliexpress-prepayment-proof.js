#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-one-shot-router
 * @domain        purchasing
 * @layer         tooling
 * @criticality   high
 * @inputs        staging runtime, optional KOMERCE_ALIEXPRESS_CONTRACT_REFRESH_RUN
 * @outputs       historical prepayment proof or delegated authoritative contract refresh
 * @depends       db.js, scripts/aliexpress-prepayment-proof-core.js, scripts/aliexpress-refresh-imported-contracts.js
 * @used-by       Railway aliexpress-pool-once
 * @db-read       delegated operation only
 * @db-write      delegated operation only; refresh execute remains independently guarded
 * @db-txn        delegated operation owns transactions
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md, docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
 * @impact-areas  purchasing, supplier-integration, catalog, staging
 * @version       2026-09-one-shot-router-v1
 */
'use strict';

const { spawnSync } = require('node:child_process');
const db = require('../db');
const core = require('./aliexpress-prepayment-proof-core');

const CONTRACT_REFRESH_RUN_FLAG = 'KOMERCE_ALIEXPRESS_CONTRACT_REFRESH_RUN';
const MAX_REFRESH_LIMIT = 500;

function parseContractRefreshRun(env = process.env) {
  const raw = String(env[CONTRACT_REFRESH_RUN_FLAG] || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(dry-run|execute):(\d+)$/);
  if (!match) {
    throw new Error(`${CONTRACT_REFRESH_RUN_FLAG} doit être dry-run:N ou execute:N`);
  }
  const limit = Number.parseInt(match[2], 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_REFRESH_LIMIT) {
    throw new Error(`${CONTRACT_REFRESH_RUN_FLAG}: N doit être un entier 1..${MAX_REFRESH_LIMIT}`);
  }
  return { mode: match[1], limit };
}

function runContractRefresh(operation, env = process.env) {
  const args = [
    './scripts/aliexpress-refresh-imported-contracts.js',
    operation.mode === 'execute' ? '--execute' : '--dry-run',
    `--limit=${operation.limit}`,
  ];
  console.log(`[aliexpress-one-shot] delegate contract-refresh ${JSON.stringify(operation)}`);
  const result = spawnSync(process.execPath, args, {
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`contract-refresh interrompu par signal ${result.signal}`);
  if (result.status !== 0) throw new Error(`contract-refresh terminé avec code ${result.status}`);
  return { delegated: 'contract-refresh', ...operation, status: result.status };
}

async function main(env = process.env) {
  const operation = parseContractRefreshRun(env);
  if (operation) return runContractRefresh(operation, env);
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
  MAX_REFRESH_LIMIT,
  parseContractRefreshRun,
  runContractRefresh,
  main,
};