#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-e2e-taxonomy-bootstrap
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        canonical migrations/migrate-categories-v2.sql + migrations/250_boutique_subcategory_customs_affinity.sql, isolated E2E DB
 * @outputs       active canonical boutique taxonomy + customs affinity required by catalog E2E
 * @depends       db.js, services/suppliers/e2e-isolated-runtime.js, services/suppliers/e2e-catalog-500-plan.js
 * @used-by       ali-e2e-200-worker catalog-712-materialize mode
 * @db-read       boutique_categories, boutique_subcategories
 * @db-write      boutique_categories, boutique_subcategories
 * @db-txn        migrate-categories-v2.sql owns transaction
 * @doctrine      isolated_runtime_only, canonical_taxonomy_source_reused, no_embedded_taxonomy_copy
 * @impact-areas  catalog, staging-e2e
 * @version       2026-09-v1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const e2eRuntime = require('../services/suppliers/e2e-isolated-runtime');
const { BALANCED_E2E_500_PLAN } = require('../services/suppliers/e2e-catalog-500-plan');

const FLAG = 'KOMERCE_ALLOW_CATALOG_E2E_TAXONOMY_BOOTSTRAP';
const SQL_PATH = path.resolve(__dirname, '..', 'migrations', 'migrate-categories-v2.sql');
const AFFINITY_SQL_PATH = path.resolve(__dirname, '..', 'migrations', '250_boutique_subcategory_customs_affinity.sql');

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function expectedPairs(plan = BALANCED_E2E_500_PLAN) {
  return [...new Map(
    plan.map(segment => [
      `${segment.category}\u0000${segment.subcategory}`,
      { category: segment.category, subcategory: segment.subcategory },
    ])
  ).values()];
}

function assertRuntime(env = process.env) {
  const runtime = e2eRuntime.assertIsolatedE2eRuntime(env);
  if (!isTruthy(env[FLAG])) throw new Error(`REFUS: ${FLAG}=1 requis`);
  return runtime;
}

async function audit(plan = BALANCED_E2E_500_PLAN) {
  const pairs = expectedPairs(plan);
  let rows;
  try {
    ({ rows } = await db.query(
      `SELECT bc.key AS category, bs.key AS subcategory, bs.customs_category_key
         FROM boutique_categories bc
         JOIN boutique_subcategories bs
           ON bs.category_key=bc.key
          AND bs.is_active=TRUE
        WHERE bc.is_active=TRUE`
    ));
  } catch (error) {
    if (error?.code !== '42703') throw error;
    ({ rows } = await db.query(
      `SELECT bc.key AS category, bs.key AS subcategory, NULL::text AS customs_category_key
         FROM boutique_categories bc
         JOIN boutique_subcategories bs
           ON bs.category_key=bc.key
          AND bs.is_active=TRUE
        WHERE bc.is_active=TRUE`
    ));
  }
  const byPair = new Map(rows.map(row => [`${row.category}\u0000${row.subcategory}`, row]));
  const missing = pairs.filter(pair => !byPair.has(`${pair.category}\u0000${pair.subcategory}`));
  const missingAffinity = pairs.filter(pair => {
    const row = byPair.get(`${pair.category}\u0000${pair.subcategory}`);
    return row && !String(row.customs_category_key || '').trim();
  });
  return {
    expected_pairs: pairs.length,
    active_pairs_found: pairs.length - missing.length,
    affinity_pairs_found: pairs.length - missingAffinity.length,
    missing,
    missing_affinity: missingAffinity,
    ready: missing.length === 0 && missingAffinity.length === 0,
  };
}

async function run(env = process.env) {
  const runtime = assertRuntime(env);
  const before = await audit();

  if (!fs.existsSync(SQL_PATH)) throw new Error(`CANONICAL_TAXONOMY_SQL_MISSING:${SQL_PATH}`);
  if (!fs.existsSync(AFFINITY_SQL_PATH)) throw new Error(`CANONICAL_AFFINITY_SQL_MISSING:${AFFINITY_SQL_PATH}`);
  const sql = fs.readFileSync(SQL_PATH, 'utf8');
  const affinitySql = fs.readFileSync(AFFINITY_SQL_PATH, 'utf8');
  if (!/INSERT INTO boutique_categories/.test(sql) || !/INSERT INTO boutique_subcategories/.test(sql)) {
    throw new Error('CANONICAL_TAXONOMY_SQL_INVALID');
  }
  if (!/customs_category_key/.test(affinitySql)) {
    throw new Error('CANONICAL_AFFINITY_SQL_INVALID');
  }

  await db.query(sql);
  await db.query(affinitySql);
  const after = await audit();
  const summary = {
    runtime,
    canonical_source: ['migrations/migrate-categories-v2.sql', 'migrations/250_boutique_subcategory_customs_affinity.sql'],
    before,
    after,
  };
  console.log(`[catalog-e2e-taxonomy-bootstrap] ${JSON.stringify(summary)}`);
  if (!after.ready) {
    throw new Error(`CATALOG_E2E_TAXONOMY_BOOTSTRAP_INCOMPLETE:${JSON.stringify(after.missing)}`);
  }
  return summary;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[catalog-e2e-taxonomy-bootstrap] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  FLAG,
  SQL_PATH,
  AFFINITY_SQL_PATH,
  expectedPairs,
  assertRuntime,
  audit,
  run,
};
