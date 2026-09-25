#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cj-broad-catalog-stress-fill
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        disposable staging DB, CJ access token
 * @outputs       up to 1000 real CJ sourcing candidates via canonical orchestrator
 * @depends       db.js, services/suppliers/connectors/cj-connector.js, services/suppliers/catalog-import-orchestrator.js
 * @used-by       isolated-real-cj-1000-catalog-stress.yml
 * @db-read       sourcing_candidates
 * @db-write-via  catalog-import-orchestrator
 * @db-txn        canonical owners
 * @doctrine      disposable_db_only, provider_real_data, no_publication, no_order
 * @impact-areas  sourcing, catalog, staging
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const cjConnector = require('../services/suppliers/connectors/cj-connector');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');

const SUPPLIER = 'CJdropshipping';
const FLAG = 'KOMERCE_ALLOW_CJ_BROAD_STRESS_FILL';
const TARGET = 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const DEFAULT_QUOTA_WAIT_MS = 100000;
const MAX_QUOTA_WAITS = 40;

function intEnv(name, fallback, min, max, env = process.env) {
  const raw = env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} doit être un entier entre ${min} et ${max}`);
  }
  return n;
}

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function runtimeEnvironment(env = process.env) {
  return String(env.KOMERCE_ENV || '').trim().toLowerCase();
}

function assertDisposableRuntime(env = process.env) {
  if (runtimeEnvironment(env) !== 'staging' || env.NODE_ENV !== 'test') {
    throw new Error('REFUS: KOMERCE_ENV=staging et NODE_ENV=test requis');
  }
  if (!isTruthy(env[FLAG])) throw new Error(`REFUS: ${FLAG}=1 requis`);
  if (!env.CJ_ACCESS_TOKEN && !env.CJ_API_KEY) {
    throw new Error('CJ_ACCESS_TOKEN ou CJ_API_KEY requis');
  }
  const url = new URL(env.DATABASE_URL || '');
  const hostOk = ['127.0.0.1', 'localhost'].includes(url.hostname);
  const dbName = String(url.pathname || '').replace(/^\//, '');
  if (!hostOk || dbName !== 'komerce_real_catalog_stress') {
    throw new Error('REFUS: base jetable localhost komerce_real_catalog_stress requise');
  }
}

function isQuotaError(error) {
  return /(?:HTTP\s*)?429|insufficient api points|16900500|too many requests|rate.?limit/i.test(
    String(error?.message || error || '')
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function countClean() {
  const { rows: [row] } = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM sourcing_candidates
      WHERE supplier_name=$1
        AND supplier_product_id IS NOT NULL
        AND state IN ('scanned','imported_to_catalog')
        AND COALESCE(product_name,'') <> ''
        AND image_url ~ '^https://'
        AND purchase_price IS NOT NULL
        AND purchase_price > 0
        AND COALESCE(normalized_source_contract->>'schema_version','')='2'`,
    [SUPPLIER]
  );
  return Number(row?.count || 0);
}

async function loadSeenIds() {
  const { rows } = await db.query(
    `SELECT supplier_product_id
       FROM sourcing_candidates
      WHERE supplier_name=$1
        AND supplier_product_id IS NOT NULL`,
    [SUPPLIER]
  );
  return new Set(rows.map(r => r.supplier_product_id).filter(Boolean));
}

async function importPage(page, products) {
  if (!products.length) return { accepted: 0, rejected: 0 };
  const result = await catalogImportOrchestrator.importCatalog(
    {
      supplier_name: SUPPLIER,
      supplier_id: 'cj',
      source_type: 'api',
      source_filename: `cj-broad-stress/page-${String(page).padStart(4, '0')}.json`,
      notes: 'Isolated CJ broad stress fill — disposable CI database only',
      is_full_snapshot: false,
    },
    null,
    async () => ({ products, invalid: [], total: products.length })
  );
  if (result.status !== 200) {
    throw new Error(`CJ broad import page ${page} refusé (${result.status})`);
  }
  if (Number(result.body?.rejected || 0) > 0) {
    throw new Error(`CJ broad import page ${page} partiel: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function run() {
  assertDisposableRuntime();
  const target = intEnv('KOMERCE_CJ_BROAD_STRESS_TARGET', TARGET, 1, TARGET);
  const quotaWaitMs = intEnv(
    'KOMERCE_CJ_BROAD_STRESS_QUOTA_WAIT_MS',
    DEFAULT_QUOTA_WAIT_MS,
    1000,
    300000
  );
  const maxQuotaWaits = intEnv(
    'KOMERCE_CJ_BROAD_STRESS_MAX_QUOTA_WAITS',
    MAX_QUOTA_WAITS,
    0,
    100
  );

  const seen = await loadSeenIds();
  let clean = await countClean();
  let page = 1;
  let listCalls = 0;
  let quotaWaits = 0;
  let emptyPages = 0;

  console.log(`[cj-broad-stress] start=${clean} target=${target} page_size=${PAGE_SIZE}`);

  while (clean < target && page <= MAX_PAGES) {
    let fetched;
    try {
      // No category lookup: each expensive listV2 call can return up to 100
      // products, which makes this stress campaign point-efficient.
      // eslint-disable-next-line no-await-in-loop
      fetched = await cjConnector.fetchProducts({ page, size: PAGE_SIZE });
      listCalls += 1;
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      if (quotaWaits >= maxQuotaWaits) {
        throw new Error(`CJ_QUOTA_WAIT_BUDGET_EXHAUSTED waits=${quotaWaits} clean=${clean}/${target}`);
      }
      quotaWaits += 1;
      console.log(`[cj-broad-stress] quota_wait=${quotaWaits} wait_ms=${quotaWaitMs} page=${page} clean=${clean}`);
      // CJ points replenish continuously; retry the same page rather than
      // advancing the cursor and silently dropping data.
      // eslint-disable-next-line no-await-in-loop
      await sleep(quotaWaitMs);
      continue;
    }

    const remaining = target - clean;
    const fresh = (fetched.products || [])
      .filter(p => p?.supplier_product_id
        && String(p.product_name || '').trim()
        && /^https:\/\//i.test(String(p.image_url || ''))
        && Number(p.purchase_price) > 0)
      .filter(p => !seen.has(p.supplier_product_id))
      .slice(0, remaining);

    if (!fresh.length) {
      emptyPages += 1;
    } else {
      // eslint-disable-next-line no-await-in-loop
      const imported = await importPage(page, fresh);
      for (const p of fresh) seen.add(p.supplier_product_id);
      // eslint-disable-next-line no-await-in-loop
      clean = await countClean();
      console.log(`[cj-broad-stress] page=${page} accepted=${Number(imported.accepted || 0)} clean=${clean}/${target}`);
    }

    const announced = Number(fetched.total_records || 0);
    const totalPages = announced > 0 ? Math.ceil(announced / PAGE_SIZE) : null;
    if (totalPages !== null && page >= totalPages) break;
    if (emptyPages >= 3 && clean === 0) break;
    page += 1;
  }

  const summary = {
    final_clean: clean,
    target,
    target_reached: clean >= target,
    last_page: page,
    list_calls: listCalls,
    quota_waits: quotaWaits,
    page_size: PAGE_SIZE,
  };
  console.log(`[cj-broad-stress] FINAL ${JSON.stringify(summary)}`);
  if (!summary.target_reached) {
    throw new Error(`CJ_BROAD_TARGET_NOT_REACHED:${clean}/${target}`);
  }
  return summary;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[cj-broad-stress] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER,
  FLAG,
  TARGET,
  PAGE_SIZE,
  MAX_PAGES,
  DEFAULT_QUOTA_WAIT_MS,
  MAX_QUOTA_WAITS,
  intEnv,
  assertDisposableRuntime,
  isQuotaError,
  run,
};
