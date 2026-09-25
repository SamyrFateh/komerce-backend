#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          real-supplier-1000-staging-stress
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        staging DB, existing AliExpress/CJ NormalizedSupplierProduct V2 candidates
 * @outputs       audit/refinery stress summaries, inactive drafts, optional FR enrichment
 * @depends       db.js, services/supplier-catalog-scanner.js, services/catalog-eligibility.js,
 *                services/sourcing-candidate-actions.js, services/catalog-enrichment.js
 * @used-by       bounded staging operator workflow
 * @db-read       sourcing_candidates, products, product_skus, product_market_exposure
 * @db-write-via  sourcing-candidate-actions, catalog-enrichment (promote/enrich operations only)
 * @db-txn        canonical owners
 * @doctrine      supplier_agnostic_core, inactive_drafts_only, no_auto_publish, staging_only
 * @impact-areas  sourcing, catalog, staging
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const pricingEngine = require('../services/pricing-engine');
const scanner = require('../services/supplier-catalog-scanner');
const eligibility = require('../services/catalog-eligibility');
const { promoteCandidate } = require('../services/sourcing-candidate-actions');
const catalogEnrichment = require('../services/catalog-enrichment');

const SUPPLIERS = Object.freeze(['AliExpress', 'CJdropshipping']);
const TARGET_PER_SUPPLIER = 500;
const TARGET_TOTAL = 1000;
const MAX_LIMIT = 1000;
const PROMOTION_FLAG = 'KOMERCE_ALLOW_REAL_SUPPLIER_STRESS_PROMOTION';
const ENRICH_FLAG = 'KOMERCE_ALLOW_REAL_SUPPLIER_STRESS_ENRICH';
const ALLOWED_DECISIONS = new Set(['TEST', 'PRIORITY']);
const EXPECTED_PRICE_AUTHORITY = 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION';

function runtimeEnvironment(env = process.env) {
  return String(env.KOMERCE_ENV || '').trim().toLowerCase();
}

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function parseArgs(argv = process.argv.slice(2)) {
  let operation = 'audit';
  let limit = TARGET_TOTAL;
  let concurrency = 5;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--operation') operation = String(argv[++i] || '').trim();
    else if (arg.startsWith('--operation=')) operation = arg.split('=', 2)[1];
    else if (arg === '--limit') limit = Number.parseInt(argv[++i], 10);
    else if (arg.startsWith('--limit=')) limit = Number.parseInt(arg.split('=', 2)[1], 10);
    else if (arg === '--concurrency') concurrency = Number.parseInt(argv[++i], 10);
    else if (arg.startsWith('--concurrency=')) concurrency = Number.parseInt(arg.split('=', 2)[1], 10);
    else throw new Error(`Argument inconnu: ${arg}`);
  }
  if (!['audit', 'refinery-audit', 'promote', 'enrich-fr'].includes(operation)) {
    throw new Error('operation doit être audit, refinery-audit, promote ou enrich-fr');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit doit être 1..${MAX_LIMIT}`);
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
    throw new Error('--concurrency doit être 1..10');
  }
  return { operation, limit, concurrency };
}

function assertRuntime(args, env = process.env) {
  if (runtimeEnvironment(env) !== 'staging' || env.NODE_ENV !== 'test') {
    throw new Error('REFUS: KOMERCE_ENV=staging et NODE_ENV=test requis');
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (args.operation === 'promote' && !isTruthy(env[PROMOTION_FLAG])) {
    throw new Error(`REFUS: ${PROMOTION_FLAG}=1 requis`);
  }
  if (args.operation === 'enrich-fr' && !isTruthy(env[ENRICH_FLAG])) {
    throw new Error(`REFUS: ${ENRICH_FLAG}=1 requis`);
  }
}

function cleanPredicate(alias = 'sc') {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error('alias SQL invalide');
  return `
    ${alias}.supplier_product_id IS NOT NULL
    AND COALESCE(${alias}.product_name, '') <> ''
    AND ${alias}.image_url ~ '^https://'
    AND ${alias}.purchase_price IS NOT NULL
    AND ${alias}.purchase_price > 0
    AND COALESCE(${alias}.normalized_source_contract->>'schema_version','') = '2'
    AND (
      ${alias}.supplier_name <> 'AliExpress'
      OR (
        ${alias}.normalized_source_contract ? 'stock_available'
        AND (${alias}.normalized_source_contract->>'stock_available') ~ '^[0-9]+([.][0-9]+)?$'
        AND (${alias}.normalized_source_contract->>'stock_available')::numeric > 0
      )
    )
  `;
}

function bump(map, key) {
  const normalized = String(key == null || key === '' ? '<missing>' : key);
  map[normalized] = (map[normalized] || 0) + 1;
}

function decisionOf(row) {
  return String(row?.scan_result?.sourcing_decision || '').trim().toUpperCase() || 'UNKNOWN';
}

function testPriceOf(row) {
  const n = Number(row?.scan_result?.test_price_kmf);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function priceAuthorityOf(row) {
  const scan = row?.scan_result || {};
  return String(scan.recommended_price_authority || scan.price_authority || '').trim() || null;
}

async function loadCandidates(limit = TARGET_TOTAL) {
  const { rows } = await db.query(`
    WITH ranked AS (
      SELECT sc.*,
             row_number() OVER (PARTITION BY sc.supplier_name ORDER BY sc.created_at, sc.id) AS supplier_rank
        FROM sourcing_candidates sc
       WHERE sc.supplier_name = ANY($1::text[])
         AND sc.state IN ('scanned','imported_to_catalog')
         AND ${cleanPredicate('sc')}
    )
    SELECT id, supplier_name, supplier_product_id, product_name, supplier_category,
           komerce_category, state, product_id, raw_payload, normalized_source_contract,
           scan_result, purchase_price_kmf, created_at
      FROM ranked
     ORDER BY supplier_rank, supplier_name
  `, [SUPPLIERS]);
  return rows.slice(0, limit);
}

async function audit() {
  const { rows: counts } = await db.query(`
    SELECT supplier_name,
           COUNT(*) FILTER (WHERE state IN ('scanned','imported_to_catalog'))::int AS candidate_total,
           COUNT(*) FILTER (WHERE state IN ('scanned','imported_to_catalog') AND ${cleanPredicate('sc')})::int AS clean_total,
           COUNT(*) FILTER (WHERE state='scanned' AND ${cleanPredicate('sc')})::int AS clean_scanned,
           COUNT(*) FILTER (WHERE state='imported_to_catalog' AND product_id IS NOT NULL AND ${cleanPredicate('sc')})::int AS clean_promoted
      FROM sourcing_candidates sc
     WHERE supplier_name = ANY($1::text[])
     GROUP BY supplier_name
     ORDER BY supplier_name
  `, [SUPPLIERS]);

  const { rows: products } = await db.query(`
    SELECT sc.supplier_name, p.lifecycle_status, p.is_active, p.content_source, p.needs_review,
           COUNT(DISTINCT p.id)::int AS n
      FROM sourcing_candidates sc
      JOIN products p ON p.id = sc.product_id
     WHERE sc.supplier_name = ANY($1::text[])
       AND sc.state = 'imported_to_catalog'
     GROUP BY sc.supplier_name, p.lifecycle_status, p.is_active, p.content_source, p.needs_review
     ORDER BY sc.supplier_name, p.lifecycle_status, p.is_active, p.content_source, p.needs_review
  `, [SUPPLIERS]);

  const { rows: [enrich] } = await db.query(`
    SELECT COUNT(DISTINCT p.id)::int AS eligible_fr
      FROM sourcing_candidates sc
      JOIN products p ON p.id = sc.product_id
     WHERE sc.supplier_name = ANY($1::text[])
       AND sc.state='imported_to_catalog'
       AND p.lifecycle_status='candidate'
       AND p.is_active=FALSE
       AND p.content_source='connector_raw'
       AND p.source_locale IS NOT NULL
       AND lower(p.source_locale) NOT LIKE 'fr%'
  `, [SUPPLIERS]);

  const bySupplier = Object.fromEntries(SUPPLIERS.map(name => [name, {
    candidate_total: 0, clean_total: 0, clean_scanned: 0, clean_promoted: 0,
  }]));
  for (const row of counts) bySupplier[row.supplier_name] = row;
  const cleanTotal = SUPPLIERS.reduce((n, supplier) => n + Number(bySupplier[supplier]?.clean_total || 0), 0);
  return {
    target: { total: TARGET_TOTAL, diversity_reference_per_supplier: TARGET_PER_SUPPLIER },
    suppliers: bySupplier,
    clean_total_across_suppliers: cleanTotal,
    target_reached: cleanTotal >= TARGET_TOTAL,
    linked_product_breakdown: products,
    french_enrichment_eligible: Number(enrich?.eligible_fr || 0),
  };
}

function reconstructProduct(row) {
  const contract = row?.normalized_source_contract;
  if (!contract || String(contract.schema_version || '') !== '2') {
    throw new Error(`${row?.supplier_name || '?'}:${row?.supplier_product_id || '?'} sans V2`);
  }
  if (!row.raw_payload || typeof row.raw_payload !== 'object') {
    throw new Error(`${row?.supplier_name || '?'}:${row?.supplier_product_id || '?'} sans raw_payload`);
  }
  return { ...JSON.parse(JSON.stringify(contract)), raw_payload: JSON.parse(JSON.stringify(row.raw_payload)) };
}

async function refineryAudit(limit) {
  const rows = await loadCandidates(limit);
  const config = await pricingEngine.loadGlobalConfig();
  const exclusions = await eligibility.loadActiveExclusions();
  const decisions = {};
  const categories = {};
  const suppliers = {};
  const errors = [];
  let persistedDecisionDrift = 0;

  for (const row of rows) {
    try {
      const product = reconstructProduct(row);
      // eslint-disable-next-line no-await-in-loop
      const normalized = await scanner.normalizeCandidate(product, { config });
      const verdict = eligibility.checkEligibility(normalized, exclusions);
      const absolute = verdict?.layer === 'absolute';
      // eslint-disable-next-line no-await-in-loop
      const scan = absolute
        ? { sourcing_decision: 'EXCLUDED', scan_result: null }
        : await scanner.scanCandidate(normalized, { config });
      const computed = String(scan.sourcing_decision || 'UNKNOWN').toUpperCase();
      bump(decisions, computed);
      bump(categories, normalized.komerce_category);
      bump(suppliers, row.supplier_name);
      if (computed !== decisionOf(row)) persistedDecisionDrift += 1;
    } catch (error) {
      errors.push({
        supplier: row.supplier_name,
        supplier_product_id: row.supplier_product_id,
        error: String(error.message || error).slice(0, 240),
      });
    }
  }
  return {
    processed: rows.length,
    suppliers,
    decisions,
    categories,
    errors_count: errors.length,
    persisted_decision_drift: persistedDecisionDrift,
    error_sample: errors.slice(0, 20),
  };
}

function classifyForPromotion(row) {
  if (row.state === 'imported_to_catalog' && row.product_id) return { status: 'already_promoted' };
  if (row.state !== 'scanned' || row.product_id) return { status: 'blocked', reason: 'state_or_product_link' };
  const decision = decisionOf(row);
  if (!ALLOWED_DECISIONS.has(decision)) return { status: 'blocked', reason: `decision:${decision}` };
  if (String(row?.normalized_source_contract?.schema_version || '') !== '2') {
    return { status: 'blocked', reason: 'contract_v2_missing' };
  }
  const price = testPriceOf(row);
  if (!(price > 0)) return { status: 'blocked', reason: 'test_price_missing' };
  const authority = priceAuthorityOf(row);
  if (authority !== EXPECTED_PRICE_AUTHORITY) {
    return { status: 'blocked', reason: `price_authority:${authority || 'missing'}` };
  }
  return { status: 'promotable', price_kmf: price, decision };
}

function roundRobinPromotable(rows, limit) {
  const bySupplier = new Map(SUPPLIERS.map(s => [s, []]));
  for (const row of rows) {
    const classification = classifyForPromotion(row);
    if (classification.status === 'promotable') bySupplier.get(row.supplier_name)?.push({ row, classification });
  }
  const selected = [];
  let cursor = 0;
  while (selected.length < limit) {
    const supplier = SUPPLIERS[cursor % SUPPLIERS.length];
    const bucket = bySupplier.get(supplier);
    if (bucket?.length) selected.push(bucket.shift());
    if (SUPPLIERS.every(s => !(bySupplier.get(s)?.length))) break;
    cursor += 1;
  }
  return selected;
}

async function promote(limit) {
  const rows = await loadCandidates(TARGET_TOTAL);
  const selected = roundRobinPromotable(rows, limit);
  const promoted = [];
  const failures = [];

  for (const item of selected) {
    try {
      // Deliberately source_only: French conversion is the next separate stress phase.
      // eslint-disable-next-line no-await-in-loop
      const result = await promoteCandidate(item.row.id, {
        price_kmf: item.classification.price_kmf,
        enrichment_mode: 'source_only',
      }, null);
      promoted.push({
        supplier: item.row.supplier_name,
        candidate_id: item.row.id,
        product_id: result.product_id,
        supplier_product_id: item.row.supplier_product_id,
      });
    } catch (error) {
      failures.push({
        supplier: item.row.supplier_name,
        supplier_product_id: item.row.supplier_product_id,
        error: String(error.message || error).slice(0, 240),
      });
    }
  }

  const ids = promoted.map(x => x.product_id);
  let guard = { active: 0, exposed: 0, wrong_lifecycle: 0 };
  if (ids.length) {
    const { rows: [row] } = await db.query(`
      SELECT COUNT(*) FILTER (WHERE p.is_active=TRUE)::int AS active,
             COUNT(*) FILTER (WHERE p.lifecycle_status IS DISTINCT FROM 'candidate')::int AS wrong_lifecycle,
             COUNT(DISTINCT pme.product_id)::int AS exposed
        FROM products p
        LEFT JOIN product_market_exposure pme ON pme.product_id=p.id
       WHERE p.id = ANY($1::uuid[])
    `, [ids]);
    guard = {
      active: Number(row?.active || 0),
      exposed: Number(row?.exposed || 0),
      wrong_lifecycle: Number(row?.wrong_lifecycle || 0),
    };
  }
  if (guard.active || guard.exposed || guard.wrong_lifecycle) {
    throw new Error(`REFUS: promotion stress a créé une exposition inattendue ${JSON.stringify(guard)}`);
  }
  const supplierCounts = {};
  for (const p of promoted) bump(supplierCounts, p.supplier);
  const result = {
    requested_limit: limit,
    selected: selected.length,
    promoted: promoted.length,
    promoted_by_supplier: supplierCounts,
    failures_count: failures.length,
    failures: failures.slice(0, 20),
    guard,
  };
  if (failures.length) {
    const error = new Error(`PROMOTION_STRESS_INCOMPLETE:${failures.length}/${selected.length}`);
    error.result = result;
    throw error;
  }
  return result;
}

async function loadEnrichmentDrafts(limit) {
  const { rows } = await db.query(`
    WITH eligible AS (
      SELECT DISTINCT p.id, p.product_ref, p.name, p.source_locale, p.content_source,
             sc.supplier_name, p.created_at,
             row_number() OVER (PARTITION BY sc.supplier_name ORDER BY p.created_at, p.id) AS supplier_rank
        FROM sourcing_candidates sc
        JOIN products p ON p.id = sc.product_id
       WHERE sc.supplier_name = ANY($1::text[])
         AND sc.state='imported_to_catalog'
         AND p.lifecycle_status='candidate'
         AND p.is_active=FALSE
         AND p.content_source='connector_raw'
         AND p.source_locale IS NOT NULL
         AND lower(p.source_locale) NOT LIKE 'fr%'
    )
    SELECT * FROM eligible
     ORDER BY supplier_rank, supplier_name
     LIMIT $2
  `, [SUPPLIERS, limit]);
  return rows;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function enrichFr(limit, concurrency) {
  const drafts = await loadEnrichmentDrafts(limit);
  const results = [];
  for (let i = 0; i < drafts.length; i += concurrency) {
    const batch = drafts.slice(i, i + concurrency);
    // eslint-disable-next-line no-await-in-loop
    const out = await Promise.all(batch.map(async d => {
      try {
        const result = await catalogEnrichment.enrichAndApply(d.id);
        return {
          supplier: d.supplier_name,
          product_ref: d.product_ref,
          status: result.status || 'failed',
          confidence: result.confidence ?? null,
          needs_review: result.needsReview ?? result.needs_review ?? null,
          error: result.error || null,
        };
      } catch (error) {
        return {
          supplier: d.supplier_name,
          product_ref: d.product_ref,
          status: 'error',
          confidence: null,
          needs_review: null,
          error: String(error.message || error).slice(0, 240),
        };
      }
    }));
    results.push(...out);
    if (i + concurrency < drafts.length) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(1000);
    }
  }

  const successStatuses = new Set(['ok', 'low_confidence']);
  const success = results.filter(r => successStatuses.has(r.status));
  const failed = results.filter(r => !successStatuses.has(r.status));
  const bySupplier = {};
  const reviewBySupplier = {};
  for (const r of success) {
    bump(bySupplier, r.supplier);
    if (r.needs_review) bump(reviewBySupplier, r.supplier);
  }

  const ids = drafts.map(d => d.id);
  let persisted = { ai_enriched: 0, still_connector_raw: 0, active: 0 };
  if (ids.length) {
    const { rows: [row] } = await db.query(`
      SELECT COUNT(*) FILTER (WHERE content_source='ai_enriched')::int AS ai_enriched,
             COUNT(*) FILTER (WHERE content_source='connector_raw')::int AS still_connector_raw,
             COUNT(*) FILTER (WHERE is_active=TRUE)::int AS active
        FROM products WHERE id = ANY($1::uuid[])
    `, [ids]);
    persisted = {
      ai_enriched: Number(row?.ai_enriched || 0),
      still_connector_raw: Number(row?.still_connector_raw || 0),
      active: Number(row?.active || 0),
    };
  }
  if (persisted.active !== 0) throw new Error('REFUS: enrichissement a activé un produit');
  const result = {
    selected: drafts.length,
    success: success.length,
    failed: failed.length,
    success_by_supplier: bySupplier,
    needs_review_by_supplier: reviewBySupplier,
    persisted,
    failures: failed.slice(0, 30),
  };
  if (failed.length) {
    const error = new Error(`FRENCH_ENRICHMENT_STRESS_INCOMPLETE:${failed.length}/${drafts.length}`);
    error.result = result;
    throw error;
  }
  return result;
}

async function main() {
  const args = parseArgs();
  assertRuntime(args);
  let result;
  if (args.operation === 'audit') result = await audit();
  else if (args.operation === 'refinery-audit') result = await refineryAudit(args.limit);
  else if (args.operation === 'promote') result = await promote(args.limit);
  else result = await enrichFr(args.limit, args.concurrency);
  console.log(`[real-supplier-1000-stress] ${args.operation.toUpperCase()} ${JSON.stringify(result)}`);
  return result;
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      if (error?.result) {
        console.error('[real-supplier-1000-stress] PARTIAL ' + JSON.stringify(error.result));
      }
      console.error(`[real-supplier-1000-stress] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIERS,
  TARGET_PER_SUPPLIER,
  TARGET_TOTAL,
  parseArgs,
  assertRuntime,
  cleanPredicate,
  classifyForPromotion,
  roundRobinPromotable,
  audit,
  refineryAudit,
  promote,
  enrichFr,
  main,
};
