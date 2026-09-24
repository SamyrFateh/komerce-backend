#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role          cj-three-real-staging-refinery-proof
 * @domain        catalog
 * @layer         tooling
 * @owner         services/suppliers/catalog-import-orchestrator.js
 * @purpose       Import exactly three live CJ offers into an isolated, disposable CI PostgreSQL database.
 * @impact-areas  catalog, sourcing, supplier-import, staging
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const db = require('../db');
const cj = require('../services/suppliers/connectors/cj-connector');
const orchestrator = require('../services/suppliers/catalog-import-orchestrator');

const ISOLATED_DATABASE_URL =
  'postgresql://komerce:komerce@127.0.0.1:5432/komerce_cj_three_pilot';
const MAX_EXACT_PRODUCT_READS = 3;
// These are the exact three CJ identities proven in runs 3–5. Do not
// substitute newly ranked search results for this inventory proof.
const EXACT_PIDS = Object.freeze([
  '166757A7-7890-4603-B39A-1FB23936757F',
  '2407180832421610200',
  '7C59DE5B-A511-4920-88A8-C808B21476EE',
]);
const STOCK_PATH = '/product/stock/getInventoryByPid';

function safeId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : null;
}

async function assertIsolatedDatabase() {
  if (process.env.DATABASE_URL !== ISOLATED_DATABASE_URL
      || process.env.KOMERCE_ENV !== 'staging'
      || process.env.NODE_ENV !== 'test'
      || process.env.KOMERCE_DISABLE_CRONS !== 'true'
      || process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('REFUS: ISOLATED_CI_DATABASE_AND_RUNTIME_REQUIRED');
  }
  const { rows: [target] } = await db.query(
    'SELECT current_database() AS name, inet_server_addr()::text AS host'
  );
  // The CI runner connects to 127.0.0.1:5432, which Docker forwards into
  // the ephemeral PostgreSQL container. inet_server_addr() reports the
  // container-side bridge address, not the runner's 127.0.0.1. Keep the
  // exact localhost DATABASE_URL, CI-only runtime and database-name gates;
  // require a TCP server address without incorrectly equating the two ends.
  if (target?.name !== 'komerce_cj_three_pilot' || !target?.host) {
    throw new Error('REFUS: DATABASE_TARGET_NOT_LOCAL_CI');
  }
}

// A schema-only CI snapshot cannot carry the production reference rows.
// Restore the existing, versioned customs-category reference seed ONLY in the
// disposable, positively identified CI database, before requesting CJ data.
// This is a historical CI pricing reference, NOT verified live country tax
// rates or evidence of a sellable category / current market price.
async function ensureIsolatedCiCategories() {
  const { rows: [before] } = await db.query(
    'SELECT count(*)::int AS count FROM customs_categories WHERE is_active = TRUE'
  );
  let referenceSource = 'preexisting_ci_reference';
  if (before.count === 0) {
    const seed = fs.readFileSync(
      path.join(__dirname, '../migrations/036b_seed_customs_categories.sql'), 'utf8'
    );
    await db.query(seed);
    referenceSource = 'migrations/036b_seed_customs_categories.sql:ci_reference_only';
  }
  const { rows } = await db.query(
    'SELECT key FROM customs_categories WHERE is_active = TRUE ORDER BY key'
  );
  const keys = rows.map(row => row.key);
  if (!keys.includes('phones') || !keys.includes('electro')) {
    throw new Error('REFUS: CI_CANONICAL_CATEGORIES_MISSING');
  }
  console.log('CJ_CI_REFERENCE_CATEGORIES ' + JSON.stringify({
    count: keys.length, phones: true, electro: true, reference_source: referenceSource,
  }));
  return referenceSource;
}

function stockInt(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

// CJ documents product-level GET inventory with variantInventories[] and
// inventory[] by country. Never treat a missing VID/warehouse/number as zero;
// CJ-managed stock and factory-managed stock are separate supply channels.
// This snapshot does not authorize checkout, shipping or stock persistence.
async function readThreeInventorySnapshots(products, accessToken) {
  const snapshots = new Map();
  for (const product of products) {
    const pid = safeId(product.supplier_product_id);
    if (!EXACT_PIDS.includes(pid)) throw new Error('CJ_STOCK_UNEXPECTED_PID');
    const units = Array.isArray(product.sellable_units) ? product.sellable_units : [];
    const vids = units.map(unit => safeId(unit.supplier_unit_ref));
    if (!vids.length || vids.some(vid => !vid) || new Set(vids).size !== vids.length) {
      throw new Error('CJ_STOCK_SOURCE_VID_IDENTITY_MISSING');
    }
    // Leave >=1s between the last detail read and each stock read.
    await sleep(1200);
    const url = new URL(cj.BASE_URL + STOCK_PATH);
    url.searchParams.set('pid', pid);
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'CJ-Access-Token': accessToken },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error('CJ_STOCK_HTTP_' + response.status);
    const body = await response.json();
    if (body?.result === false || body?.success === false
      || !Array.isArray(body?.data?.variantInventories)) {
      throw new Error('CJ_STOCK_VARIANT_CONTRACT_UNAVAILABLE');
    }
    const byVid = new Map();
    for (const row of body.data.variantInventories) {
      const vid = safeId(row?.vid);
      if (!vid) continue;
      if (byVid.has(vid)) throw new Error('CJ_STOCK_DUPLICATE_VID');
      byVid.set(vid, row);
    }
    snapshots.set(pid, {
      provider_endpoint: STOCK_PATH,
      checked_at: new Date().toISOString(),
      // Endpoint returned no row for a VID => unknown, never 0.
      units: vids.map(vid => {
        const row = byVid.get(vid);
        const warehouses = Array.isArray(row?.inventory) ? row.inventory : [];
        const country_stock = warehouses.map(warehouse => ({
          country_code: /^[A-Z]{2}$/.test(String(warehouse?.countryCode || '').toUpperCase())
            ? String(warehouse.countryCode).toUpperCase() : null,
          verified_warehouse: warehouse?.verifiedWarehouse === 1 ? true
            : warehouse?.verifiedWarehouse === 2 ? false : null,
          cj_warehouse_quantity: stockInt(warehouse?.cjInventory),
          factory_quantity: stockInt(warehouse?.factoryInventory),
          supplier_reported_total: stockInt(warehouse?.totalInventory),
        }));
        return {
          vid,
          observation: !row ? 'VID_NOT_RETURNED'
            : !warehouses.length ? 'WAREHOUSE_STOCK_NOT_RETURNED'
              : country_stock.every(stock => stock.country_code !== null
                && stock.cj_warehouse_quantity !== null
                && stock.factory_quantity !== null
                && stock.supplier_reported_total !== null)
                ? 'WAREHOUSE_BREAKDOWN_REPORTED' : 'WAREHOUSE_BREAKDOWN_PARTIAL',
          country_stock,
        };
      }),
    });
  }
  return snapshots;
}

function publicVerdict(row) {
  const snap = row.normalized_source_contract || {};
  return {
    supplier_product_id: safeId(row.supplier_product_id),
    candidate_id: row.id,
    state: row.state,
    catalog_product_id: row.product_id || null,
    purchase_price: row.purchase_price == null ? null : Number(row.purchase_price),
    currency: row.currency || null,
    // Normalized CJ provenance only; category is a provisional pricing profile,
    // not a binding customs classification or a storefront approval.
    supplier_category: typeof row.supplier_category === 'string'
      ? row.supplier_category.replace(/[\r\n\t]/g, ' ').slice(0, 120) : null,
    komerce_category: row.komerce_category || null,
    media_count: Array.isArray(snap.media) ? snap.media.length : 0,
    sellable_unit_count: Array.isArray(snap.sellable_units) ? snap.sellable_units.length : 0,
    // Read only the persisted facts needed to explain WATCH. No raw CJ
    // payload, API credential, price recommendation or invented stock.
    stock_known: row.stock_available != null,
    unit_stock_known_count: Array.isArray(snap.sellable_units)
      ? snap.sellable_units.filter(unit => unit.stock_available != null).length : 0,
    purchase_price_kmf_known: row.purchase_price_kmf != null && Number(row.purchase_price_kmf) > 0,
    category_source: row.data_sources?.category || null,
    weight_source: row.data_sources?.weight || null,
    volume_source: row.data_sources?.volume || null,
    refinery_decision: row.scan_result?.sourcing_decision || null,
    decision_reason: typeof row.scan_result?.reason === 'string'
      ? row.scan_result.reason.replace(/[\r\n\t]/g, ' ').slice(0, 240) : null,
    economic_health: row.scan_result?.economic_test_health_status || null,
    pricing_health: row.scan_result?.health_status || null,
    market_confidence: row.scan_result?.market_confidence || null,
    rejected_reason: row.rejected_reason || null,
  };
}

async function run() {
  await assertIsolatedDatabase();
  const ciReferenceSource = await ensureIsolatedCiCategories();
  const accessToken = process.env.CJ_ACCESS_TOKEN;
  if (!accessToken) throw new Error('REFUS: DEDICATED_CJ_READ_TOKEN_MISSING');

  // No new discovery list or product selection: the original 3 PIDs only.
  // Exactly three product-detail GETs and three stock-by-PID GETs.
  // The token stays exclusively in provider request headers.
  const exactIds = [...EXACT_PIDS];

  const detailed = await cj.fetchProducts({
    productIds: exactIds,
    env: { CJ_ACCESS_TOKEN: accessToken },
    detailDelayMs: 1100,
    detailRetries: 0,
  });
  if (detailed.products.length !== MAX_EXACT_PRODUCT_READS
      || detailed.invalid.length !== 0) {
    console.log('CJ_DETAIL_GATE ' + JSON.stringify({
      ids: exactIds,
      valid: detailed.products.length,
      invalid_count: detailed.invalid.length,
    }));
    throw new Error('CJ_THREE_EXACT_DETAIL_CONTRACT_NOT_PROVEN');
  }
  const byId = new Map(detailed.products.map(p => [safeId(p.supplier_product_id), p]));
  const three = exactIds.map(id => byId.get(id));
  if (three.some(p => !p)) throw new Error('CJ_DETAIL_IDENTITY_MISMATCH');
  const inventorySnapshots = await readThreeInventorySnapshots(three, accessToken);

  const importResult = await orchestrator.importCatalog({
    supplier_name: cj.SUPPLIER_NAME,
    supplier_id: cj.PROVIDER_ID,
    source_type: 'api',
    source_filename: 'cj-three-real-staging-proof/2026-09',
    notes: 'Three real CJ catalogue offers; disposable CI-only candidate/refinery proof; no publication',
    is_full_snapshot: false,
  }, null, async () => ({
    products: three, invalid: [], total: three.length,
  }));

  const importId = importResult.body?.import_id || null;
  const { rows: candidates } = importId
    ? await db.query(
      'SELECT id, supplier_product_id, supplier_category, komerce_category, state, product_id, purchase_price, currency, stock_available, purchase_price_kmf, data_sources, scan_result, rejected_reason, normalized_source_contract ' +
      'FROM sourcing_candidates WHERE import_id = $1 ORDER BY supplier_product_id ASC',
      [importId]
    ) : { rows: [] };
  const report = {
    environment: 'isolated_github_actions_postgresql',
    supplier: 'CJdropshipping',
    ci_reference_source: ciReferenceSource,
    ci_category_decision_authority: 'PROVISIONAL_TEST_ONLY_NOT_CUSTOMS_OR_MARKET_VALIDATION',
    actual_source_reads: exactIds.length * 2,
    source_read_scope: 'THREE_EXACT_PRODUCT_DETAILS_AND_THREE_STOCK_BY_PID',
    inventory_authority: 'READ_ONLY_SNAPSHOT_NOT_CHECKOUT_OR_FULFILMENT_APPROVAL',
    exact_ids: exactIds,
    imported_candidates: candidates.length,
    published_products: candidates.filter(x => Boolean(x.product_id)).length,
    pipeline_status: importResult.body?.pipeline_status || null,
    canonical_resolved: importResult.body?.canonical_resolved === true,
    shadow_status: importResult.body?.shadow_ingestion?.status || null,
    accepted: importResult.body?.accepted || 0,
    rejected: importResult.body?.rejected || 0,
    products: candidates.map(row => ({
      ...publicVerdict(row),
      stock_snapshot: inventorySnapshots.get(safeId(row.supplier_product_id)) || null,
    })),
  };
  // Data provenance is real provider GET; this is NOT a stock-authority or
  // sellability proof. No catalog approval, checkout, PO or production writes.
  console.log('CJ_THREE_REAL_REFINERY_PILOT ' + JSON.stringify(report));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '## CJ — three real products / staging-only refinery\n\n' +
      'Isolated ephemeral PostgreSQL, source GETs: ' + report.actual_source_reads +
      ', persisted candidates: ' + report.imported_candidates + '/3, published: 0.\n\n' +
      'Exact source IDs: ' + exactIds.join(', ') + '.\n\n' +
      'Pipeline: ' + report.pipeline_status +
      '; shadow: ' + report.shadow_status +
      '; canonical resolved: ' + report.canonical_resolved + '.\n\n' +
      'Inventory by exact PID: ' + inventorySnapshots.size + '/3. This is a time-bound provider snapshot; no stock persistence or fulfilment approval.\\n\\n' +
      'No production DB, no publication, no order, no active stock mutation.\\n');
  }

  if (importResult.status !== 200
      || report.accepted !== MAX_EXACT_PRODUCT_READS
      || report.rejected !== 0
      || candidates.length !== MAX_EXACT_PRODUCT_READS
      || report.published_products !== 0) {
    throw new Error('CJ_STAGING_THREE_CANDIDATE_GATE_NOT_PASSED');
  }
  return report;
}

if (require.main === module) {
  run()
    .catch(error => {
      // Never print provider HTTP bodies, token-bearing errors or sensitive
      // untrusted supplier payloads; only controlled blocker identifiers.
      const code = /^CJ_|^REFUS:/.test(error.message)
        ? error.message : 'CJ_STAGING_PILOT_INTERNAL_ERROR';
      console.error('[cj-three-real-staging-pilot] ' + code);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { run, safeId, publicVerdict, ISOLATED_DATABASE_URL };
