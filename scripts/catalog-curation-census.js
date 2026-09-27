#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-curation-census
 * @domain        catalog
 * @layer         tooling
 * @criticality   medium
 * @inputs        disposable accepted CJ catalog checkpoint
 * @outputs       explainable curation-signal census + read-only review-order preview
 * @depends       db.js
 * @used-by       isolated-catalog-curation-census.yml
 * @db-read       sourcing_candidates, products
 * @db-write      none
 * @db-txn        none
 * @doctrine      human_approval_remains_authority_review_order_is_informative_value_density_unavailable_until_calibrated
 * @impact-areas  catalog, sourcing, admin-dashboard
 * @version       2026-09-v1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');

const SUPPLIER = 'CJdropshipping';
const DEFAULT_EXPECTED = 974;
const DEFAULT_OUTPUT = path.resolve('artifacts/catalog-curation-census/report.json');

const DECISION_ORDER = Object.freeze(['PRIORITY', 'TEST', 'WATCH', 'AVOID', 'LOSS', 'UNKNOWN']);
const CONFIDENCE_ORDER = Object.freeze(['high', 'medium', 'low', 'unknown']);
const HEALTH_ORDER = Object.freeze(['strong', 'healthy', 'fragile', 'danger', 'loss', 'unknown']);

function intValue(value, fallback, min, max, label) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} doit être un entier entre ${min} et ${max}`);
  }
  return parsed;
}

function parseArgs(argv = process.argv.slice(2)) {
  let expected = DEFAULT_EXPECTED;
  let output = DEFAULT_OUTPUT;
  let preview = 120;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--expected') expected = intValue(argv[++i], DEFAULT_EXPECTED, 1, 100000, '--expected');
    else if (arg.startsWith('--expected=')) expected = intValue(arg.split('=', 2)[1], DEFAULT_EXPECTED, 1, 100000, '--expected');
    else if (arg === '--preview') preview = intValue(argv[++i], 120, 1, 1000, '--preview');
    else if (arg.startsWith('--preview=')) preview = intValue(arg.split('=', 2)[1], 120, 1, 1000, '--preview');
    else if (arg === '--output') output = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--output=')) output = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else throw new Error(`Argument inconnu: ${arg}`);
  }
  return { expected, output, preview };
}

function assertDisposableRuntime(env = process.env) {
  if (String(env.KOMERCE_ENV || '').trim().toLowerCase() !== 'staging' || env.NODE_ENV !== 'test') {
    throw new Error('REFUS: KOMERCE_ENV=staging et NODE_ENV=test requis');
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  const url = new URL(env.DATABASE_URL);
  const dbName = String(url.pathname || '').replace(/^\//, '');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || dbName !== 'komerce_real_catalog_stress') {
    throw new Error('REFUS: base jetable localhost komerce_real_catalog_stress requise');
  }
}

function normalized(value, allowed, fallback = 'unknown') {
  const v = String(value || '').trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

function normalizedDecision(value) {
  const v = String(value || '').trim().toUpperCase();
  return DECISION_ORDER.includes(v) ? v : 'UNKNOWN';
}

function rankOf(order, value) {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function marginBand(value) {
  const n = numberOrNull(value);
  if (n == null) return 'unknown';
  if (n < 0) return '<0';
  if (n < 15) return '0-14.9';
  if (n < 25) return '15-24.9';
  if (n <= 40) return '25-40';
  return '>40';
}

function compareReviewPriority(a, b) {
  const decision = rankOf(DECISION_ORDER, normalizedDecision(a.sourcing_decision))
    - rankOf(DECISION_ORDER, normalizedDecision(b.sourcing_decision));
  if (decision) return decision;

  const confidenceA = normalized(a.sourcing_confidence, CONFIDENCE_ORDER);
  const confidenceB = normalized(b.sourcing_confidence, CONFIDENCE_ORDER);
  const confidence = rankOf(CONFIDENCE_ORDER, confidenceA) - rankOf(CONFIDENCE_ORDER, confidenceB);
  if (confidence) return confidence;

  const healthA = normalized(a.economic_health_status, HEALTH_ORDER);
  const healthB = normalized(b.economic_health_status, HEALTH_ORDER);
  const health = rankOf(HEALTH_ORDER, healthA) - rankOf(HEALTH_ORDER, healthB);
  if (health) return health;

  const stockA = Number(a.supplier_stock) > 0 ? 1 : 0;
  const stockB = Number(b.supplier_stock) > 0 ? 1 : 0;
  if (stockA !== stockB) return stockB - stockA;

  const marginA = numberOrNull(a.economic_test_margin_pct);
  const marginB = numberOrNull(b.economic_test_margin_pct);
  if (marginA != null || marginB != null) {
    if (marginA == null) return 1;
    if (marginB == null) return -1;
    if (marginA !== marginB) return marginB - marginA;
  }

  const editorialA = numberOrNull(a.enrichment_confidence);
  const editorialB = numberOrNull(b.enrichment_confidence);
  if (editorialA != null || editorialB != null) {
    if (editorialA == null) return 1;
    if (editorialB == null) return -1;
    if (editorialA !== editorialB) return editorialB - editorialA;
  }

  const rawStockA = numberOrNull(a.supplier_stock) || 0;
  const rawStockB = numberOrNull(b.supplier_stock) || 0;
  if (rawStockA !== rawStockB) return rawStockB - rawStockA;

  return String(a.product_ref || '').localeCompare(String(b.product_ref || ''));
}

function countBy(rows, getter, keys) {
  const out = Object.fromEntries(keys.map(key => [key, 0]));
  for (const row of rows) {
    const raw = getter(row);
    const key = Object.prototype.hasOwnProperty.call(out, raw) ? raw : 'unknown';
    if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = 0;
    out[key] += 1;
  }
  return out;
}

function categoryCounts(rows) {
  const out = {};
  for (const row of rows) {
    const key = String(row.category || 'unknown').trim() || 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function buildCensus(rows, previewLimit = 120) {
  const normalizedRows = rows.map(row => ({
    product_ref: row.product_ref,
    category: row.category || null,
    sourcing_decision: normalizedDecision(row.sourcing_decision),
    sourcing_confidence: normalized(row.sourcing_confidence, CONFIDENCE_ORDER),
    economic_health_status: normalized(row.economic_health_status, HEALTH_ORDER),
    economic_test_margin_pct: numberOrNull(row.economic_test_margin_pct),
    supplier_stock: numberOrNull(row.supplier_stock),
    enrichment_confidence: numberOrNull(row.enrichment_confidence),
  }));

  const ranked = [...normalizedRows].sort(compareReviewPriority);
  const preview = ranked.slice(0, previewLimit);

  return {
    total: normalizedRows.length,
    by_sourcing_decision: countBy(normalizedRows, row => row.sourcing_decision, DECISION_ORDER),
    by_sourcing_confidence: countBy(normalizedRows, row => row.sourcing_confidence, CONFIDENCE_ORDER),
    by_economic_health: countBy(normalizedRows, row => row.economic_health_status, HEALTH_ORDER),
    by_margin_band: countBy(
      normalizedRows,
      row => marginBand(row.economic_test_margin_pct),
      ['<0', '0-14.9', '15-24.9', '25-40', '>40', 'unknown']
    ),
    supplier_stock: {
      positive: normalizedRows.filter(row => Number(row.supplier_stock) > 0).length,
      zero: normalizedRows.filter(row => Number(row.supplier_stock) === 0).length,
      unknown: normalizedRows.filter(row => row.supplier_stock == null).length,
    },
    categories: categoryCounts(normalizedRows),
    preview_count: preview.length,
    preview_categories: categoryCounts(preview),
    review_order_preview: preview,
  };
}

async function loadRows() {
  const { rows } = await db.query(
    `SELECT p.product_ref,
            p.category,
            p.enrichment_confidence,
            sc.confidence AS sourcing_confidence,
            sc.stock_available AS supplier_stock,
            UPPER(COALESCE(sc.scan_result->>'sourcing_decision','UNKNOWN')) AS sourcing_decision,
            LOWER(COALESCE(sc.scan_result->>'economic_test_health_status','unknown')) AS economic_health_status,
            NULLIF(sc.scan_result->>'economic_test_margin_pct','')::numeric AS economic_test_margin_pct
       FROM sourcing_candidates sc
       JOIN products p ON p.id=sc.product_id
      WHERE sc.supplier_name=$1
        AND sc.state='imported_to_catalog'
        AND sc.product_id IS NOT NULL
        AND p.lifecycle_status='candidate'
        AND p.is_active=FALSE
      ORDER BY p.product_ref`,
    [SUPPLIER]
  );
  return rows;
}

async function run(options = parseArgs()) {
  assertDisposableRuntime();
  const rows = await loadRows();
  if (rows.length !== options.expected) {
    throw new Error(`REFUS: population attendue ${options.expected}, trouvée ${rows.length}`);
  }

  const census = buildCensus(rows, options.preview);
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    authority: 'READ_ONLY_CURATION_CENSUS',
    supplier: SUPPLIER,
    expected_products: options.expected,
    accepted_population: rows.length === options.expected,
    mutation_authority: 'NONE',
    human_publication_authority_preserved: true,
    value_density_used: false,
    review_order_semantics: [
      'sourcing_decision',
      'sourcing_confidence',
      'economic_health_status',
      'supplier_stock_positive',
      'economic_test_margin_pct',
      'enrichment_confidence',
      'supplier_stock',
      'product_ref',
    ],
    census,
  };

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n');
  console.log(`[catalog-curation-census] ${JSON.stringify({
    total: census.total,
    by_sourcing_decision: census.by_sourcing_decision,
    by_sourcing_confidence: census.by_sourcing_confidence,
    by_economic_health: census.by_economic_health,
    by_margin_band: census.by_margin_band,
    supplier_stock: census.supplier_stock,
    preview_categories: census.preview_categories,
  })}`);
  return report;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[catalog-curation-census] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER,
  DEFAULT_EXPECTED,
  DECISION_ORDER,
  CONFIDENCE_ORDER,
  HEALTH_ORDER,
  parseArgs,
  assertDisposableRuntime,
  marginBand,
  compareReviewPriority,
  buildCensus,
  run,
};
