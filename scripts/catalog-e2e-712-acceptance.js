#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          unified-catalog-e2e-712-acceptance
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        isolated dataset containing 200 AliExpress + 500 certified CJ + 12 reconciled CJ
 * @outputs       definitive 712-product E2E catalog acceptance
 * @depends       db.js, services/suppliers/e2e-isolated-runtime.js, services/product-publication-guard.js, scripts/catalog-cj-certified-500-materialize.js, scripts/aliexpress-incremental-e2e-200.js, scripts/cj-reconcile-current-new-12-promote.js
 * @used-by       Railway isolated catalog E2E worker
 * @db-read       sourcing_candidates, products, catalog_media, product_skus, product_market_exposure, boutique_categories, boutique_subcategories
 * @db-write      none
 * @db-txn        none
 * @doctrine      exact_supplier_union, distinct_catalog_product, commandable, french_ready, dynamic_taxonomy, no_market_exposure
 * @impact-areas  catalog, sourcing, staging-e2e
 * @version       2026-09-v1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const e2eRuntime = require('../services/suppliers/e2e-isolated-runtime');
const { validatePublicationUpdate } = require('../services/product-publication-guard');
const ali = require('./aliexpress-incremental-e2e-200');
const { NEW_UNIQUE_IDS } = require('./cj-reconcile-current-new-12-promote');
const {
  decodeCertifiedIds,
  CERTIFIED_RUN_ID,
} = require('./catalog-cj-certified-500-materialize');

const CJ_SUPPLIER = 'CJdropshipping';
const ALI_SUPPLIER = 'AliExpress';
const CJ_HISTORICAL_TARGET = 500;
const CJ_NEW_TARGET = 12;
const CJ_TARGET = CJ_HISTORICAL_TARGET + CJ_NEW_TARGET;
const ALI_TARGET = 200;
const TOTAL_TARGET = CJ_TARGET + ALI_TARGET;
const DATASET_ID = 'catalog-e2e-712-v1';
const DEFAULT_OUTPUT = path.resolve('artifacts/catalog-e2e-712/final-acceptance.json');

function parseArgs(argv = process.argv.slice(2)) {
  let output = DEFAULT_OUTPUT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') output = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--output=')) output = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else throw new Error(`Argument inconnu: ${arg}`);
  }
  return { output };
}

function buildExpectedCjIds(env = process.env) {
  const historical = decodeCertifiedIds(env);
  const additions = NEW_UNIQUE_IDS.map(String);
  const all = [...historical, ...additions];
  if (historical.length !== CJ_HISTORICAL_TARGET) throw new Error('CATALOG_712_HISTORICAL_COUNT_INVALID');
  if (additions.length !== CJ_NEW_TARGET) throw new Error('CATALOG_712_NEW12_COUNT_INVALID');
  if (new Set(all).size !== CJ_TARGET) {
    throw new Error(`CATALOG_712_CJ_ID_OVERLAP:${all.length - new Set(all).size}`);
  }
  return { historical, additions, all };
}

async function loadAcceptedRows(cjIds) {
  const { rows } = await db.query(
    `WITH media AS (
       SELECT product_id,COUNT(*) FILTER (WHERE is_active=TRUE)::int AS active_media
         FROM catalog_media GROUP BY product_id
     ), sku AS (
       SELECT product_id,
              COUNT(*) FILTER (WHERE source='SUPPLIER' AND is_active=TRUE)::int AS active_supplier_skus,
              COUNT(*) FILTER (
                WHERE source='SUPPLIER' AND is_active=TRUE
                  AND supplier_unit_ref IS NOT NULL
                  AND supplier_order_identity IS NOT NULL
              )::int AS complete_supplier_skus
         FROM product_skus GROUP BY product_id
     ), exposure AS (
       SELECT product_id,
              COUNT(*) FILTER (WHERE commercial_exposure='ENABLED')::int AS enabled_markets
         FROM product_market_exposure GROUP BY product_id
     ), accepted AS (
       SELECT sc.supplier_name,sc.supplier_product_id,sc.product_id,
              sc.normalized_source_contract,
              UPPER(COALESCE(sc.scan_result->>'sourcing_decision','UNKNOWN')) AS sourcing_decision,
              p.product_ref,p.name,p.description,p.category,p.subcategory,
              p.boutique_category_key,p.boutique_subcategory_key,
              p.price_kmf,p.stock,p.content_source,p.needs_review,p.source_locale,
              p.lifecycle_status,p.is_active,p.is_available,
              COALESCE(media.active_media,0)::int AS active_media,
              COALESCE(sku.active_supplier_skus,0)::int AS active_supplier_skus,
              COALESCE(sku.complete_supplier_skus,0)::int AS complete_supplier_skus,
              COALESCE(exposure.enabled_markets,0)::int AS enabled_markets,
              CASE WHEN bc.key IS NOT NULL AND bs.key IS NOT NULL THEN TRUE ELSE FALSE END AS taxonomy_active
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
        WHERE sc.state='imported_to_catalog'
          AND sc.product_id IS NOT NULL
          AND (
            (sc.supplier_name=$1 AND sc.supplier_product_id = ANY($2::text[]))
            OR
            (sc.supplier_name=$3
             AND sc.raw_payload #>> '{discovery,wave}'=$4
             AND UPPER(COALESCE(sc.scan_result->>'sourcing_decision','UNKNOWN')) IN ('TEST','PRIORITY')
             AND sc.komerce_category IS NOT NULL)
          )
     )
     SELECT * FROM accepted ORDER BY supplier_name,supplier_product_id`,
    [CJ_SUPPLIER, cjIds, ALI_SUPPLIER, ali.WAVE_ID]
  );
  return rows;
}

function classify(row) {
  const reasons = [];
  const locale = String(row.source_locale || '').trim().toLowerCase().replace('_', '-');
  const editorial = row.needs_review === false
    && (row.content_source === 'manual'
      || row.content_source === 'ai_enriched'
      || (row.content_source === 'connector_raw' && (locale === 'fr' || locale.startsWith('fr-'))));

  if (!['TEST', 'PRIORITY'].includes(String(row.sourcing_decision || ''))) reasons.push('decision_not_accepted');
  if (String(row?.normalized_source_contract?.schema_version || '') !== '2') reasons.push('source_contract_v2_missing');
  if (!String(row.name || '').trim()) reasons.push('name_missing');
  if (!String(row.description || '').trim()) reasons.push('description_missing');
  if (!editorial) reasons.push('french_editorial_not_ready');
  if (!String(row.category || '').trim()) reasons.push('customs_category_missing');
  if (!String(row.boutique_category_key || '').trim()) reasons.push('boutique_category_missing');
  if (!String(row.boutique_subcategory_key || '').trim()) reasons.push('boutique_subcategory_missing');
  if (row.taxonomy_active !== true) reasons.push('boutique_taxonomy_inactive_or_invalid');
  if (Number(row.active_media || 0) < 1) reasons.push('media_missing');
  if (Number(row.active_supplier_skus || 0) < 1) reasons.push('active_supplier_sku_missing');
  if (Number(row.complete_supplier_skus || 0) !== Number(row.active_supplier_skus || 0)) {
    reasons.push('supplier_order_identity_incomplete');
  }
  if (row.lifecycle_status !== 'candidate' || row.is_active === true) reasons.push('not_inactive_candidate');
  if (Number(row.enabled_markets || 0) > 0) reasons.push('market_exposure_enabled');

  const publication = validatePublicationUpdate({
    before: {
      ...row,
      is_active: false,
      is_available: false,
    },
    patch: { is_active: true },
    context: { catalogMediaCount: Number(row.active_media || 0) },
  });
  if (!publication.ok) reasons.push(`publication_guard:${publication.code}`);

  return { ready: reasons.length === 0, reasons, publication_guard: publication.ok ? 'PASS' : publication.code };
}

function aggregate(rows, expectedCjIds) {
  const products = rows.map(row => ({ ...row, ...classify(row) }));
  const aliRows = products.filter(row => row.supplier_name === ALI_SUPPLIER);
  const cjRows = products.filter(row => row.supplier_name === CJ_SUPPLIER);
  const reasonCounts = {};
  for (const row of products) {
    for (const reason of row.reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }

  const supplierIdentityKeys = products.map(row => `${row.supplier_name}\u0000${row.supplier_product_id}`);
  const productIds = products.map(row => String(row.product_id || '')).filter(Boolean);
  const cjActualIds = new Set(cjRows.map(row => String(row.supplier_product_id)));
  const missingCjIds = expectedCjIds.filter(id => !cjActualIds.has(id));

  return {
    products,
    summary: {
      target: TOTAL_TARGET,
      total_rows: products.length,
      ready: products.filter(row => row.ready).length,
      ali_total: aliRows.length,
      ali_ready: aliRows.filter(row => row.ready).length,
      cj_total: cjRows.length,
      cj_ready: cjRows.filter(row => row.ready).length,
      distinct_supplier_identities: new Set(supplierIdentityKeys).size,
      distinct_product_ids: new Set(productIds).size,
      duplicate_supplier_identities: supplierIdentityKeys.length - new Set(supplierIdentityKeys).size,
      duplicate_product_links: productIds.length - new Set(productIds).size,
      missing_cj_ids: missingCjIds.length,
      enabled_market_exposure: products.filter(row => Number(row.enabled_markets || 0) > 0).length,
      invalid_taxonomy: products.filter(row => row.taxonomy_active !== true).length,
      reasons: reasonCounts,
    },
    missingCjIds,
  };
}

async function run(options = parseArgs(), env = process.env) {
  const runtime = e2eRuntime.assertIsolatedE2eRuntime(env);
  const expected = buildExpectedCjIds(env);
  const rows = await loadAcceptedRows(expected.all);
  const result = aggregate(rows, expected.all);
  const s = result.summary;

  const accepted = s.total_rows === TOTAL_TARGET
    && s.ready === TOTAL_TARGET
    && s.ali_total === ALI_TARGET
    && s.ali_ready === ALI_TARGET
    && s.cj_total === CJ_TARGET
    && s.cj_ready === CJ_TARGET
    && s.distinct_supplier_identities === TOTAL_TARGET
    && s.distinct_product_ids === TOTAL_TARGET
    && s.duplicate_supplier_identities === 0
    && s.duplicate_product_links === 0
    && s.missing_cj_ids === 0
    && s.enabled_market_exposure === 0
    && s.invalid_taxonomy === 0;

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    dataset_id: DATASET_ID,
    runtime_dataset_id: runtime.dataset_id,
    certified_cj_run_id: CERTIFIED_RUN_ID,
    target: TOTAL_TARGET,
    accepted,
    cohorts: {
      AliExpress: { target: ALI_TARGET, total: s.ali_total, ready: s.ali_ready, wave: ali.WAVE_ID },
      CJdropshipping: {
        target: CJ_TARGET,
        historical_target: CJ_HISTORICAL_TARGET,
        additions_target: CJ_NEW_TARGET,
        total: s.cj_total,
        ready: s.cj_ready,
      },
    },
    integrity: {
      distinct_supplier_identities: s.distinct_supplier_identities,
      distinct_product_ids: s.distinct_product_ids,
      duplicate_supplier_identities: s.duplicate_supplier_identities,
      duplicate_product_links: s.duplicate_product_links,
      missing_cj_ids: s.missing_cj_ids,
      enabled_market_exposure: s.enabled_market_exposure,
      invalid_taxonomy: s.invalid_taxonomy,
      reasons: s.reasons,
    },
    auto_publish: false,
    market_exposure_created: false,
    paid_ai_required: false,
    blocked_samples: result.products.filter(row => !row.ready).slice(0, 50).map(row => ({
      supplier_name: row.supplier_name,
      supplier_product_id: row.supplier_product_id,
      product_ref: row.product_ref,
      reasons: row.reasons,
    })),
  };

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n');
  console.log(`[catalog-e2e-712] ${accepted ? 'ACCEPT' : 'REJECT'} ${JSON.stringify({ accepted, ...s })}`);

  if (!accepted) {
    throw new Error(`CATALOG_E2E_712_ACCEPTANCE_FAILED:${JSON.stringify(s)}`);
  }
  return report;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[catalog-e2e-712] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  CJ_HISTORICAL_TARGET,
  CJ_NEW_TARGET,
  CJ_TARGET,
  ALI_TARGET,
  TOTAL_TARGET,
  DATASET_ID,
  parseArgs,
  buildExpectedCjIds,
  classify,
  aggregate,
  run,
};
