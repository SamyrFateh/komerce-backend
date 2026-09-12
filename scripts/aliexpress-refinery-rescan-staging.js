#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-staging-refinery-rescan
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        DATABASE_URL, KOMERCE_ENV=staging, existing AliExpress Normalized V2 candidates
 * @outputs       refreshed canonical sourcing candidate normalization and refinery scan
 * @depends       db.js, services/supplier-catalog-scanner.js, services/catalog-eligibility.js, services/suppliers/catalog-import-orchestrator.js
 * @used-by       bounded staging operator
 * @db-read       sourcing_candidates, pricing config, eligibility config
 * @db-write-via:catalog-import-orchestrator supplier_catalog_imports, sourcing_candidates, sourcing_candidate_events
 * @db-txn        canonical import owner semantics; no catalog product creation
 * @doctrine      refinery_filters_before_catalog, normalized_v2_is_replayable_source, observe_before_write, no_direct_candidate_mutation
 * @impact-areas  sourcing, catalog, staging
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');
const pricingEngine = require('../services/pricing-engine');
const scanner = require('../services/supplier-catalog-scanner');
const eligibility = require('../services/catalog-eligibility');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const { cleanStockSql } = require('./aliexpress-refinery-audit-staging');

const SUPPLIER = 'AliExpress';
const EXPECTED_CLEAN = 500;
const FLAG = 'KOMERCE_ALLOW_ALIEXPRESS_RESCAN';
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 500;

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function runtimeEnvironment(env = process.env) {
  return String(env.KOMERCE_ENV || '').trim().toLowerCase();
}

function parseArgs(argv = process.argv.slice(2)) {
  let mode = 'dry-run';
  let limit = DEFAULT_LIMIT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') mode = 'dry-run';
    else if (arg === '--execute') mode = 'execute';
    else if (arg === '--limit') limit = Number.parseInt(argv[++i], 10);
    else if (arg.startsWith('--limit=')) limit = Number.parseInt(arg.split('=', 2)[1], 10);
    else throw new Error(`Argument inconnu: ${arg}`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit doit être un entier entre 1 et ${MAX_LIMIT}`);
  }
  return { mode, limit };
}

function assertRuntime({ mode }, env = process.env) {
  const runtime = runtimeEnvironment(env);
  if (runtime !== 'staging') {
    throw new Error(`REFUS: KOMERCE_ENV=staging requis (reçu: ${runtime || '<vide>'})`);
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (mode === 'execute' && !isTruthy(env[FLAG])) {
    throw new Error(`REFUS: ${FLAG}=1 requis pour --execute`);
  }
}

async function loadCleanRows(queryable = db) {
  const { rows } = await queryable.query(
    `SELECT sc.id,
            sc.supplier_product_id,
            sc.product_name,
            sc.state,
            sc.raw_payload,
            sc.normalized_source_contract,
            sc.created_at
       FROM sourcing_candidates sc
      WHERE sc.supplier_name = $1
        AND sc.supplier_product_id IS NOT NULL
        AND sc.state IN ('scanned', 'imported_to_catalog')
        AND COALESCE(sc.product_name, '') <> ''
        AND sc.image_url ~ '^https://'
        AND sc.purchase_price IS NOT NULL
        AND sc.purchase_price > 0
        AND ${cleanStockSql('sc')}
      ORDER BY sc.created_at, sc.id`,
    [SUPPLIER]
  );
  return rows;
}

function reconstructProduct(row) {
  const contract = row?.normalized_source_contract;
  if (!contract || String(contract.schema_version || '') !== '2') {
    throw new Error(`Candidat ${row?.supplier_product_id || row?.id || '?'} sans Normalized V2 replayable`);
  }
  if (!row.raw_payload || typeof row.raw_payload !== 'object') {
    throw new Error(`Candidat ${row?.supplier_product_id || row?.id || '?'} sans raw_payload replayable`);
  }
  return {
    ...JSON.parse(JSON.stringify(contract)),
    raw_payload: JSON.parse(JSON.stringify(row.raw_payload)),
  };
}

function bump(map, key) {
  const normalized = String(key || '<missing>');
  map[normalized] = (map[normalized] || 0) + 1;
}

function positiveStats(values) {
  const nums = (values || []).map(Number).filter(Number.isFinite).filter(v => v > 0);
  if (!nums.length) return { count: 0, min: null, max: null };
  return { count: nums.length, min: Math.min(...nums), max: Math.max(...nums) };
}

async function previewProducts(products) {
  const config = await pricingEngine.loadGlobalConfig();
  const activeExclusions = await eligibility.loadActiveExclusions();
  const decisions = {};
  const categories = {};
  const economicHealth = {};
  const errors = [];
  const rows = [];

  for (const product of products) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const normalized = await scanner.normalizeCandidate(product, { config });
      const verdict = eligibility.checkEligibility(normalized, activeExclusions);
      const isAbsoluteExclusion = verdict?.layer === 'absolute';
      // eslint-disable-next-line no-await-in-loop
      const scan = isAbsoluteExclusion
        ? {
            sourcing_decision: 'EXCLUDED',
            scan_result: null,
            reason: verdict?.label || 'Exclusion absolue',
          }
        : await scanner.scanCandidate(normalized, { config });

      const decision = scan.sourcing_decision || 'UNKNOWN';
      const scanResult = scan.scan_result || {};
      bump(decisions, decision);
      bump(categories, normalized.komerce_category);
      bump(economicHealth, scanResult.economic_test_health_status || scanResult.health_status);
      rows.push({
        supplier_product_id: product.supplier_product_id,
        category: normalized.komerce_category,
        category_source: normalized.data_sources?.category || null,
        decision,
        health_status: scanResult.health_status || null,
        economic_test_health_status: scanResult.economic_test_health_status || null,
        purchase_price_kmf: normalized.purchase_price_kmf,
        variable_cost_complete_kmf: scanResult.variable_cost_complete_kmf ?? null,
        test_price_kmf: scanResult.test_price_kmf ?? null,
        price_authority: scanResult.recommended_price_authority || scanResult.price_authority || null,
        reason: scan.reason || null,
      });
    } catch (error) {
      errors.push({
        supplier_product_id: product?.supplier_product_id || null,
        error: error.message,
      });
    }
  }

  return {
    processed: products.length,
    decisions,
    categories,
    economic_health: economicHealth,
    purchase_price_kmf: positiveStats(rows.map(row => row.purchase_price_kmf)),
    variable_cost_complete_kmf: positiveStats(rows.map(row => row.variable_cost_complete_kmf)),
    test_price_kmf: positiveStats(rows.map(row => row.test_price_kmf)),
    errors,
    sample: rows.slice(0, 12),
  };
}

async function executeCanonicalImport(products) {
  const body = {
    supplier_name: SUPPLIER,
    source_type: 'api',
    source_filename: 'aliexpress-refinery-rescan-staging',
    notes: 'Replay Normalized V2 des candidats AliExpress existants après correction de la Raffinerie. Aucun archivage, aucune promotion catalogue.',
    is_full_snapshot: false,
  };
  return catalogImportOrchestrator.importCatalog(
    body,
    null,
    async () => ({ products, invalid: [], unmapped_columns: [] })
  );
}

async function main() {
  const args = parseArgs();
  assertRuntime(args);

  const allRows = await loadCleanRows();
  if (allRows.length !== EXPECTED_CLEAN) {
    throw new Error(`REFUS: pool AliExpress clean attendu ${EXPECTED_CLEAN}, trouvé ${allRows.length}`);
  }

  const selectedRows = allRows.slice(0, args.limit);
  const products = selectedRows.map(reconstructProduct);
  const preview = await previewProducts(products);

  console.log(`[aliexpress-refinery-rescan] BEFORE ${JSON.stringify({
    mode: args.mode,
    runtime: runtimeEnvironment(),
    clean_total: allRows.length,
    selected: products.length,
    ...preview,
  }, null, 2)}`);

  if (preview.errors.length) {
    throw new Error(`REFUS: ${preview.errors.length} erreur(s) pendant le preview canonique`);
  }

  if (args.mode === 'dry-run') {
    console.log('[aliexpress-refinery-rescan] DRY_RUN aucun changement écrit');
    return { preview, import_result: null };
  }

  const importResult = await executeCanonicalImport(products);
  if (importResult.status !== 200) {
    throw new Error(`Import canonique refusé: ${JSON.stringify(importResult.body)}`);
  }
  if (Number(importResult.body?.rejected || 0) !== 0) {
    throw new Error(`Import canonique partiel: ${JSON.stringify(importResult.body)}`);
  }

  console.log(`[aliexpress-refinery-rescan] EXECUTED ${JSON.stringify(importResult.body, null, 2)}`);
  return { preview, import_result: importResult.body };
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[aliexpress-refinery-rescan] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER,
  EXPECTED_CLEAN,
  FLAG,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  isTruthy,
  runtimeEnvironment,
  parseArgs,
  assertRuntime,
  loadCleanRows,
  reconstructProduct,
  positiveStats,
  previewProducts,
  executeCanonicalImport,
  main,
};