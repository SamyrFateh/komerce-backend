#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cj-balanced-e2e-500-sync
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        disposable staging DB, CJ access token, provider-independent 500 plan
 * @outputs       exactly 500 real CJ V2 candidates balanced across 21 boutique subcategories
 * @depends       db.js, services/suppliers/connectors/cj-connector.js, services/suppliers/catalog-import-orchestrator.js, services/suppliers/e2e-catalog-500-plan.js
 * @used-by       isolated-cj-balanced-e2e-500.yml
 * @db-read       sourcing_candidates
 * @db-write-via  services/suppliers/catalog-import-orchestrator.js
 * @db-txn        canonical import services own candidate writes
 * @doctrine      real_supplier_data_only, boutique_taxonomy_separate_from_customs, no_auto_publish, no_market_exposure
 * @impact-areas  sourcing, catalog, boutique-e2e
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');
const cj = require('../services/suppliers/connectors/cj-connector');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const { BALANCED_E2E_500_PLAN, planTotal, planByUniverse } = require('../services/suppliers/e2e-catalog-500-plan');

const SUPPLIER_NAME = cj.SUPPLIER_NAME;
const PROVIDER_ID = cj.PROVIDER_ID;
const SYNC_KEY = 'cj-balanced-e2e-500-v1';
const TARGET = 500;
const PAGE_SIZE = 20;
const MAX_SEARCH_PAGES_PER_QUERY = 6;
const RUNTIME_FLAG = 'KOMERCE_ALLOW_CJ_BALANCED_E2E_500';

function runtimeEnvironment(env = process.env) {
  return String(env.KOMERCE_ENV || env.NODE_ENV || '').trim().toLowerCase();
}

function assertRuntime(env = process.env) {
  if (runtimeEnvironment(env) !== 'staging' || env.NODE_ENV !== 'test') {
    throw new Error('REFUS: campagne CJ 500 réservée à staging/test');
  }
  if (env[RUNTIME_FLAG] !== '1') throw new Error(`${RUNTIME_FLAG}=1 requis`);
  if (!env.CJ_ACCESS_TOKEN && !env.CJ_API_KEY) {
    throw new Error('CJ_ACCESS_TOKEN ou CJ_API_KEY requis');
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  const url = new URL(env.DATABASE_URL);
  const dbName = String(url.pathname || '').replace(/^\//, '');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || dbName !== 'komerce_real_catalog_stress') {
    throw new Error('REFUS: base jetable localhost komerce_real_catalog_stress requise');
  }
  if (planTotal(BALANCED_E2E_500_PLAN) !== TARGET) {
    throw new Error(`Plan équilibré invalide: ${planTotal(BALANCED_E2E_500_PLAN)}/${TARGET}`);
  }
}

function positiveStock(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function hasCommandableUnit(product = {}) {
  return Array.isArray(product.sellable_units)
    && product.sellable_units.some((unit) =>
      unit?.is_active === true
      && positiveStock(unit.stock_available)
      && Number(unit.purchase_price) > 0
      && String(unit.supplier_sku || '').trim()
      && String(unit.supplier_unit_ref || '').trim()
      && unit.supplier_order_identity?.provider === PROVIDER_ID
      && Number(unit.supplier_order_identity?.version) >= 1
      && unit.supplier_order_identity?.payload
      && typeof unit.supplier_order_identity.payload === 'object'
    );
}

function basicCleanProduct(product = {}) {
  return Boolean(
    String(product.supplier_product_id || '').trim()
    && String(product.product_name || '').trim()
    && /^https:\/\//i.test(String(product.image_url || ''))
    && Number(product.purchase_price) > 0
    && positiveStock(product.stock_available)
    && Array.isArray(product.media)
    && product.media.some((item) => /^https:\/\//i.test(String(item?.url || '')))
    && hasCommandableUnit(product)
    && String(product.schema_version || '') === '2'
  );
}

function withDiscoveryProvenance(product, { segment, keyword, queryPage }) {
  return {
    ...product,
    raw_payload: {
      ...(product.raw_payload || {}),
      discovery: {
        ...((product.raw_payload || {}).discovery || {}),
        source: 'cj.product.listV2+query',
        campaign: SYNC_KEY,
        segment_id: segment.id,
        target_category: segment.category,
        target_subcategory: segment.subcategory,
        keyword,
        query_page: queryPage,
      },
    },
  };
}

function logicalSearchPage(segment, logicalPage) {
  const queries = Array.isArray(segment?.queries) ? segment.queries : [];
  if (!queries.length) throw new Error(`Segment ${segment?.id || 'unknown'} sans requête`);
  const n = Number.parseInt(logicalPage, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error('logicalPage doit être >= 1');
  const queryIndex = (n - 1) % queries.length;
  return {
    keyword: queries[queryIndex],
    queryPage: Math.floor((n - 1) / queries.length) + 1,
  };
}

async function loadSeenSupplierIds() {
  const { rows } = await db.query(
    `SELECT supplier_product_id
       FROM sourcing_candidates
      WHERE supplier_name=$1
        AND supplier_product_id IS NOT NULL`,
    [SUPPLIER_NAME]
  );
  return new Set(rows.map((row) => row.supplier_product_id).filter(Boolean));
}

async function segmentCount(segmentId) {
  const { rows: [row] } = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM sourcing_candidates sc
      WHERE sc.supplier_name=$1
        AND sc.state IN ('scanned','imported_to_catalog')
        AND sc.raw_payload->'discovery'->>'campaign'=$2
        AND sc.raw_payload->'discovery'->>'segment_id'=$3
        AND sc.supplier_product_id IS NOT NULL
        AND COALESCE(sc.product_name,'') <> ''
        AND sc.image_url ~ '^https://'
        AND sc.purchase_price > 0
        AND COALESCE(sc.normalized_source_contract->>'schema_version','')='2'
        AND (sc.normalized_source_contract->>'stock_available') ~ '^[0-9]+([.][0-9]+)?$'
        AND (sc.normalized_source_contract->>'stock_available')::numeric > 0
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(sc.normalized_source_contract->'sellable_units','[]'::jsonb)) u
          WHERE COALESCE((u->>'is_active')::boolean,FALSE)=TRUE
            AND COALESCE((u->>'stock_available')::numeric,0)>0
            AND NULLIF(BTRIM(u->>'supplier_sku'),'') IS NOT NULL
            AND NULLIF(BTRIM(u->>'supplier_unit_ref'),'') IS NOT NULL
            AND u->'supplier_order_identity'->>'provider'=$4
        )`,
    [SUPPLIER_NAME, SYNC_KEY, segmentId, PROVIDER_ID]
  );
  return Number(row?.n || 0);
}

async function totalCount() {
  let total = 0;
  for (const segment of BALANCED_E2E_500_PLAN) {
    // eslint-disable-next-line no-await-in-loop
    total += await segmentCount(segment.id);
  }
  return total;
}

async function importSubset(segment, logicalPage, subset) {
  if (!subset.length) return { accepted: 0, rejected: 0 };
  const body = {
    supplier_name: SUPPLIER_NAME,
    supplier_id: PROVIDER_ID,
    source_type: 'api',
    source_filename: `cj-balanced-e2e-500/${SYNC_KEY}/${segment.id}/page-${String(logicalPage).padStart(3, '0')}.json`,
    notes: `CJ balanced E2E 500 — ${segment.category}/${segment.subcategory}`,
    is_full_snapshot: false,
  };
  const dispatchSubset = async () => ({
    products: subset,
    invalid: [],
    total: subset.length,
  });
  const result = await catalogImportOrchestrator.importCatalog(body, null, dispatchSubset);
  if (result.status !== 200) {
    throw new Error(`Import CJ ${segment.id} page ${logicalPage} refusé (${result.status}): ${JSON.stringify(result.body).slice(0, 1000)}`);
  }
  if (Array.isArray(result.body?.errors) && result.body.errors.length) {
    throw new Error(`Import CJ ${segment.id} partiel: ${JSON.stringify(result.body.errors).slice(0, 1000)}`);
  }
  return result.body;
}

async function fetchSearchPage(segment, logicalPage) {
  const { keyword, queryPage } = logicalSearchPage(segment, logicalPage);
  const fetched = await cj.fetchProducts({
    keyword,
    page: queryPage,
    size: PAGE_SIZE,
    includeCommandableUnits: true,
    startWarehouseInventory: 1,
  });
  return {
    keyword,
    queryPage,
    requestId: fetched.request_id || null,
    products: (fetched.products || []).map((product) =>
      withDiscoveryProvenance(product, { segment, keyword, queryPage })
    ),
    invalid: fetched.invalid || [],
  };
}

async function runSegment(segment, seenIds) {
  let accepted = await segmentCount(segment.id);
  const maxLogicalPages = segment.queries.length * MAX_SEARCH_PAGES_PER_QUERY;
  let pages = 0;
  let consecutiveEmpty = 0;

  for (let logicalPage = 1; logicalPage <= maxLogicalPages && accepted < segment.target; logicalPage += 1) {
    // eslint-disable-next-line no-await-in-loop
    const page = await fetchSearchPage(segment, logicalPage);
    const remaining = segment.target - accepted;
    const fresh = page.products
      .filter(basicCleanProduct)
      .filter((product) => !seenIds.has(product.supplier_product_id))
      .slice(0, remaining);

    if (!fresh.length) {
      consecutiveEmpty += 1;
      console.log(`[cj-balanced-500] segment=${segment.id} page=${logicalPage} keyword="${page.keyword}" clean=0 invalid=${page.invalid.length}`);
      if (consecutiveEmpty >= Math.max(4, segment.queries.length * 2)) break;
      continue;
    }

    consecutiveEmpty = 0;
    // eslint-disable-next-line no-await-in-loop
    const imported = await importSubset(segment, logicalPage, fresh);
    for (const product of fresh) seenIds.add(product.supplier_product_id);
    // Recount from persisted truth instead of trusting import arithmetic.
    // eslint-disable-next-line no-await-in-loop
    accepted = await segmentCount(segment.id);
    pages += 1;
    console.log(`[cj-balanced-500] segment=${segment.id} page=${logicalPage} keyword="${page.keyword}" accepted=${accepted}/${segment.target} imported=${Number(imported.accepted || 0)}`);
  }

  return {
    id: segment.id,
    category: segment.category,
    subcategory: segment.subcategory,
    target: segment.target,
    accepted,
    complete: accepted === segment.target,
    pages,
  };
}

async function run() {
  assertRuntime();
  const seenIds = await loadSeenSupplierIds();
  const results = [];

  console.log(`[cj-balanced-500] start target=${TARGET} segments=${BALANCED_E2E_500_PLAN.length} universes=${JSON.stringify(planByUniverse(BALANCED_E2E_500_PLAN))}`);

  for (const segment of BALANCED_E2E_500_PLAN) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runSegment(segment, seenIds);
    results.push(result);
    if (!result.complete) {
      throw new Error(`CJ_BALANCED_SEGMENT_SHORTFALL:${segment.id}=${result.accepted}/${segment.target}`);
    }
  }

  const total = await totalCount();
  const byUniverse = {};
  for (const row of results) {
    byUniverse[row.category] = (byUniverse[row.category] || 0) + row.accepted;
  }

  const summary = {
    supplier: SUPPLIER_NAME,
    sync_key: SYNC_KEY,
    target: TARGET,
    total,
    target_reached: total === TARGET,
    universes: byUniverse,
    segments: results,
    real_supplier_only: true,
    commandable_units_required: true,
    auto_publish: false,
    market_exposure_created: false,
  };

  console.log(`[cj-balanced-500] ${JSON.stringify(summary)}`);
  if (!summary.target_reached) throw new Error(`CJ_BALANCED_TARGET_NOT_REACHED:${total}/${TARGET}`);
  return summary;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`[cj-balanced-500] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER_NAME,
  PROVIDER_ID,
  SYNC_KEY,
  TARGET,
  PAGE_SIZE,
  MAX_SEARCH_PAGES_PER_QUERY,
  RUNTIME_FLAG,
  runtimeEnvironment,
  assertRuntime,
  positiveStock,
  hasCommandableUnit,
  basicCleanProduct,
  withDiscoveryProvenance,
  logicalSearchPage,
  run,
};
