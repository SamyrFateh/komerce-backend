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
const db = require('../db');
const cj = require('../services/suppliers/connectors/cj-connector');
const orchestrator = require('../services/suppliers/catalog-import-orchestrator');

const ISOLATED_DATABASE_URL =
  'postgresql://komerce:komerce@127.0.0.1:5432/komerce_cj_three_pilot';
const MAX_EXACT_PRODUCT_READS = 3;

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

function publicVerdict(row) {
  const snap = row.normalized_source_contract || {};
  return {
    supplier_product_id: safeId(row.supplier_product_id),
    candidate_id: row.id,
    state: row.state,
    catalog_product_id: row.product_id || null,
    purchase_price: row.purchase_price == null ? null : Number(row.purchase_price),
    currency: row.currency || null,
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
  const accessToken = process.env.CJ_ACCESS_TOKEN;
  if (!accessToken) throw new Error('REFUS: DEDICATED_CJ_READ_TOKEN_MISSING');

  // Exactly one live CJ search GET, then at most three exact product-detail GETs.
  // The token is used only as a request header, never logged, stored or forwarded
  // into the canonical import envelope.
  const listUrl = cj.buildProductListUrl({
    keyword: 'phone stand', page: 1, size: 12,
  });
  const response = await fetch(listUrl, {
    method: 'GET',
    headers: { Accept: 'application/json', 'CJ-Access-Token': accessToken },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('CJ_LIST_HTTP_' + response.status);
  const listBody = await response.json();
  if (listBody?.result !== true) throw new Error('CJ_LIST_CONTRACT_REFUSED');

  const exactIds = [...new Set(cj.flattenProductList(listBody)
    .map(row => safeId(row?.id || row?.pid))
    .filter(Boolean))].slice(0, MAX_EXACT_PRODUCT_READS);
  if (exactIds.length !== MAX_EXACT_PRODUCT_READS) {
    throw new Error('CJ_DISTINCT_EXACT_PRODUCTS_NOT_FOUND_' + exactIds.length);
  }

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
      'SELECT id, supplier_product_id, state, product_id, purchase_price, currency, stock_available, purchase_price_kmf, data_sources, scan_result, rejected_reason, normalized_source_contract ' +
      'FROM sourcing_candidates WHERE import_id = $1 ORDER BY supplier_product_id ASC',
      [importId]
    ) : { rows: [] };
  const report = {
    environment: 'isolated_github_actions_postgresql',
    supplier: 'CJdropshipping',
    actual_source_reads: 1 + exactIds.length,
    exact_ids: exactIds,
    imported_candidates: candidates.length,
    published_products: candidates.filter(x => Boolean(x.product_id)).length,
    pipeline_status: importResult.body?.pipeline_status || null,
    canonical_resolved: importResult.body?.canonical_resolved === true,
    shadow_status: importResult.body?.shadow_ingestion?.status || null,
    accepted: importResult.body?.accepted || 0,
    rejected: importResult.body?.rejected || 0,
    products: candidates.map(publicVerdict),
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
      'No production DB, no publication, no order, no active stock mutation.\n');
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
