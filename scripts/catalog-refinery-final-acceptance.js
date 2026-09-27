#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-refinery-final-acceptance
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        disposable CJ catalog checkpoint
 * @outputs       definitive Raffinerie→catalog acceptance report
 * @depends       db.js, services/catalog-certification.js
 * @used-by       isolated-catalog-refinery-final-acceptance.yml
 * @db-read       sourcing_candidates, products, catalog_media, product_skus, product_market_exposure, boutique_categories, boutique_subcategories
 * @db-write      none
 * @db-txn        none
 * @doctrine      refinery_is_complete_only_when_catalog_candidate_is_traceable_reviewable_and_fail_closed
 * @impact-areas  sourcing, catalog, admin-dashboard, market-catalog
 * @version       2026-09-v1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const e2eRuntime = require('../services/suppliers/e2e-isolated-runtime');
const { evaluateCatalogProductCertification } = require('../services/catalog-certification');

const SUPPLIER = 'CJdropshipping';
const DEFAULT_EXPECTED = 974;
const DEFAULT_OUTPUT = path.resolve('artifacts/catalog-refinery-final-acceptance/report.json');

function intValue(value, fallback, min, max, label) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} doit être un entier entre ${min} et ${max}`);
  }
  return parsed;
}

function parseArgs(argv = process.argv.slice(2)) {
  let mode = 'preflight';
  let expected = DEFAULT_EXPECTED;
  let output = DEFAULT_OUTPUT;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') mode = String(argv[++i] || '').trim();
    else if (arg.startsWith('--mode=')) mode = String(arg.split('=', 2)[1] || '').trim();
    else if (arg === '--expected') expected = intValue(argv[++i], DEFAULT_EXPECTED, 1, 100000, '--expected');
    else if (arg.startsWith('--expected=')) expected = intValue(arg.split('=', 2)[1], DEFAULT_EXPECTED, 1, 100000, '--expected');
    else if (arg === '--output') output = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--output=')) output = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else throw new Error(`Argument inconnu: ${arg}`);
  }

  if (!['preflight', 'final'].includes(mode)) {
    throw new Error('--mode doit être preflight ou final');
  }
  return { mode, expected, output };
}

function assertDisposableRuntime(env = process.env) {
  if (String(env.KOMERCE_ENV || '').trim().toLowerCase() !== 'staging' || env.NODE_ENV !== 'test') {
    throw new Error('REFUS: KOMERCE_ENV=staging et NODE_ENV=test requis');
  }
  e2eRuntime.assertIsolatedE2eRuntime(env);
}

async function loadRows() {
  const { rows } = await db.query(
    `WITH media AS (
       SELECT product_id,
              COUNT(*) FILTER (WHERE is_active=TRUE)::int AS active_media
         FROM catalog_media
        GROUP BY product_id
     ),
     sku AS (
       SELECT product_id,
              COUNT(*) FILTER (
                WHERE source='SUPPLIER'
              )::int AS supplier_skus,
              COUNT(*) FILTER (
                WHERE source='SUPPLIER'
                  AND supplier_unit_ref IS NOT NULL
                  AND supplier_order_identity IS NOT NULL
              )::int AS complete_soi_skus,
              COUNT(*) FILTER (
                WHERE source='SUPPLIER' AND is_active=TRUE
              )::int AS active_supplier_skus,
              COUNT(*) FILTER (
                WHERE source='SUPPLIER'
                  AND is_active=TRUE
                  AND supplier_unit_ref IS NOT NULL
                  AND supplier_order_identity IS NOT NULL
              )::int AS active_complete_soi_skus
         FROM product_skus
        GROUP BY product_id
     ),
     exposure AS (
       SELECT product_id,
              COUNT(*)::int AS market_decisions,
              COUNT(*) FILTER (WHERE commercial_exposure='ENABLED')::int AS enabled_markets
         FROM product_market_exposure
        GROUP BY product_id
     )
     SELECT p.id AS product_id,
            sc.supplier_name,
            p.product_ref,
            p.name,
            p.description,
            p.name_source,
            p.description_source,
            p.source_locale,
            p.category,
            p.subcategory,
            p.boutique_category_key,
            p.boutique_subcategory_key,
            CASE WHEN bc.key IS NOT NULL AND bs.key IS NOT NULL THEN TRUE ELSE FALSE END AS taxonomy_active,
            p.price_kmf,
            p.stock,
            p.content_source,
            p.needs_review,
            p.lifecycle_status,
            p.is_active,
            p.is_available,
            sc.supplier_product_id,
            sc.normalized_source_contract,
            UPPER(COALESCE(sc.scan_result->>'sourcing_decision','UNKNOWN')) AS sourcing_decision,
            COALESCE(media.active_media,0)::int AS active_media,
            COALESCE(sku.supplier_skus,0)::int AS supplier_skus,
            COALESCE(sku.complete_soi_skus,0)::int AS complete_soi_skus,
            COALESCE(sku.active_supplier_skus,0)::int AS active_supplier_skus,
            COALESCE(sku.active_complete_soi_skus,0)::int AS active_complete_soi_skus,
            COALESCE(exposure.market_decisions,0)::int AS market_decisions,
            COALESCE(exposure.enabled_markets,0)::int AS enabled_markets
       FROM sourcing_candidates sc
       JOIN products p ON p.id=sc.product_id
       LEFT JOIN media ON media.product_id=p.id
       LEFT JOIN sku ON sku.product_id=p.id
       LEFT JOIN exposure ON exposure.product_id=p.id
       LEFT JOIN boutique_categories bc
         ON bc.key=p.boutique_category_key AND bc.is_active=TRUE
       LEFT JOIN boutique_subcategories bs
         ON bs.category_key=bc.key
        AND bs.key=p.boutique_subcategory_key
        AND bs.is_active=TRUE
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

function sourceTruthReady(row) {
  const contract = row.normalized_source_contract || {};
  return String(contract.schema_version || '') === '2'
    && String(row.supplier_product_id || '').trim().length > 0
    && String(contract.product_name || row.name_source || '').trim().length > 0;
}

function approvalQueueVisible(row) {
  return row.lifecycle_status === 'candidate'
    && row.is_active === false
    && ['connector_raw', 'ai_enriched', 'manual'].includes(String(row.content_source || ''));
}

function editorialReady(row) {
  const locale = String(row.source_locale || '').trim().toLowerCase().replace('_', '-');
  const nativeFr = row.content_source === 'connector_raw'
    && (locale === 'fr' || locale.startsWith('fr-'));
  return row.needs_review === false
    && (row.content_source === 'manual' || row.content_source === 'ai_enriched' || nativeFr);
}

function classify(row) {
  const structural = [];

  if (!sourceTruthReady(row)) structural.push('source_truth_or_normalized_v2_missing');
  if (!(Number(row.active_media) >= 1)) structural.push('media_missing');
  if (!(Number(row.supplier_skus) >= 1)) structural.push('supplier_sku_missing');
  if (!(Number(row.complete_soi_skus) >= 1)) structural.push('supplier_order_identity_missing');
  if (Number(row.complete_soi_skus) < Number(row.supplier_skus)) {
    structural.push('supplier_order_identity_partial');
  }
  if (!String(row.category || '').trim()) structural.push('category_missing');
  if (!String(row.boutique_category_key || '').trim()) structural.push('boutique_category_missing');
  if (!String(row.boutique_subcategory_key || '').trim()) structural.push('boutique_subcategory_missing');
  if (row.taxonomy_active !== true) structural.push('boutique_taxonomy_inactive_or_invalid');
  if (!approvalQueueVisible(row)) structural.push('approval_queue_not_visible');
  if (row.lifecycle_status !== 'candidate' || row.is_active === true) structural.push('not_inactive_candidate');
  if (Number(row.enabled_markets) > 0) structural.push('market_exposure_enabled_before_global_publication');

  const canonical = evaluateCatalogProductCertification({
    ...row,
    complete_supplier_skus: Number(row.active_complete_soi_skus || 0),
  });

  return {
    structural_ok: structural.length === 0,
    final_ok: structural.length === 0 && canonical.certified,
    structural,
    final: canonical.reasons,
    publication_guard: canonical.publication_guard,
    certification_version: canonical.certification_version,
  };
}

function countReasons(rows, key) {
  const counts = {};
  for (const row of rows) {
    for (const reason of row[key] || []) counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

async function run(options = parseArgs()) {
  assertDisposableRuntime();
  const rows = await loadRows();
  const products = rows.map(row => {
    const verdict = classify(row);
    return {
      product_ref: row.product_ref,
      supplier_product_id: row.supplier_product_id,
      sourcing_decision: row.sourcing_decision,
      category: row.category,
      subcategory: row.subcategory,
      boutique_category_key: row.boutique_category_key,
      boutique_subcategory_key: row.boutique_subcategory_key,
      taxonomy_active: row.taxonomy_active,
      content_source: row.content_source,
      needs_review: row.needs_review,
      active_media: Number(row.active_media || 0),
      supplier_skus: Number(row.supplier_skus || 0),
      complete_soi_skus: Number(row.complete_soi_skus || 0),
      active_supplier_skus: Number(row.active_supplier_skus || 0),
      active_complete_soi_skus: Number(row.active_complete_soi_skus || 0),
      market_decisions: Number(row.market_decisions || 0),
      enabled_markets: Number(row.enabled_markets || 0),
      ...verdict,
    };
  });

  const structuralReady = products.filter(p => p.structural_ok).length;
  const finalReady = products.filter(p => p.final_ok).length;
  const summary = {
    mode: options.mode,
    expected_products: options.expected,
    total_products: products.length,
    structural_ready: structuralReady,
    structural_blocked: products.length - structuralReady,
    editorial_ready: rows.filter(editorialReady).length,
    approval_queue_visible: rows.filter(approvalQueueVisible).length,
    publication_guard_pass: products.filter(p => p.publication_guard === 'PASS').length,
    final_ready_for_human_publication_review: finalReady,
    products_with_media: rows.filter(row => Number(row.active_media) >= 1).length,
    products_with_supplier_sku: rows.filter(row => Number(row.supplier_skus) >= 1).length,
    products_with_complete_soi: rows.filter(row =>
      Number(row.complete_soi_skus) >= 1
      && Number(row.complete_soi_skus) === Number(row.supplier_skus)
    ).length,
    products_with_active_supplier_sku: rows.filter(row => Number(row.active_supplier_skus) >= 1).length,
    products_with_category: rows.filter(row => String(row.category || '').trim()).length,
    products_with_subcategory: rows.filter(row => String(row.subcategory || '').trim()).length,
    products_with_boutique_category: rows.filter(row => String(row.boutique_category_key || '').trim()).length,
    products_with_boutique_subcategory: rows.filter(row => String(row.boutique_subcategory_key || '').trim()).length,
    products_with_active_boutique_taxonomy: rows.filter(row => row.taxonomy_active === true).length,
    products_with_source_truth_v2: rows.filter(sourceTruthReady).length,
    products_with_enabled_market_exposure: rows.filter(row => Number(row.enabled_markets) > 0).length,
    structural_reasons: countReasons(products, 'structural'),
    final_reasons: countReasons(products, 'final'),
  };

  const accepted = options.mode === 'preflight'
    ? (
      summary.total_products === options.expected
      && summary.structural_ready === options.expected
      && summary.products_with_enabled_market_exposure === 0
    )
    : (
      summary.total_products === options.expected
      && summary.final_ready_for_human_publication_review === options.expected
      && summary.products_with_enabled_market_exposure === 0
    );

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    authority: options.mode === 'preflight'
      ? 'RAFFINERIE_TO_CATALOG_STRUCTURAL_ACCEPTANCE'
      : 'READY_FOR_HUMAN_PUBLICATION_REVIEW_ACCEPTANCE',
    accepted,
    summary,
    blocked_samples: products
      .filter(product => options.mode === 'preflight' ? !product.structural_ok : !product.final_ok)
      .slice(0, 100),
    products,
  };

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n');
  console.log(`[catalog-refinery-final-acceptance] ${JSON.stringify({ accepted, ...summary })}`);

  if (!accepted) {
    throw new Error(
      `CATALOG_REFINERY_ACCEPTANCE_FAILED mode=${options.mode} structural=${structuralReady}/${options.expected} final=${finalReady}/${options.expected}`
    );
  }
  return report;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[catalog-refinery-final-acceptance] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER,
  DEFAULT_EXPECTED,
  parseArgs,
  assertDisposableRuntime,
  sourceTruthReady,
  approvalQueueVisible,
  editorialReady,
  classify,
  countReasons,
  run,
};
