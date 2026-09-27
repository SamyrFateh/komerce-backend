#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          unified-catalog-e2e-700-acceptance
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        isolated dataset containing AliExpress +200 and CJ balanced +500
 * @outputs       one canonical 700-product E2E acceptance report
 * @depends       db.js, services/suppliers/e2e-isolated-runtime.js, scripts/aliexpress-incremental-e2e-200.js, scripts/catalog-refinery-final-acceptance.js
 * @used-by       Railway isolated catalog E2E worker
 * @db-read       sourcing_candidates, products, product_market_exposure
 * @db-write      none
 * @db-txn        none
 * @doctrine      exactly_700_clean, supplier_cohorts_explicit, watch_not_counted, no_market_exposure
 * @impact-areas  catalog, sourcing, staging-e2e
 * @version       2026-09-v1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const e2eRuntime = require('../services/suppliers/e2e-isolated-runtime');
const ali = require('./aliexpress-incremental-e2e-200');
const cjFinal = require('./catalog-refinery-final-acceptance');

const ALI_TARGET = 200;
const CJ_TARGET = 500;
const TOTAL_TARGET = ALI_TARGET + CJ_TARGET;
const CJ_CAMPAIGN = 'cj-balanced-e2e-500-v1';
const DEFAULT_OUTPUT = path.resolve('artifacts/catalog-e2e-700/final-acceptance.json');

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

async function cohortIntegrity() {
  const { rows: [row] } = await db.query(
    `WITH accepted AS (
       SELECT sc.product_id, sc.supplier_name
         FROM sourcing_candidates sc
        WHERE sc.state='imported_to_catalog'
          AND sc.product_id IS NOT NULL
          AND (
            (
              sc.supplier_name='AliExpress'
              AND sc.raw_payload #>> '{discovery,wave}'=$1
              AND COALESCE(sc.scan_result->>'sourcing_decision','UNKNOWN') IN ('TEST','PRIORITY')
              AND sc.komerce_category IS NOT NULL
            )
            OR
            (
              sc.supplier_name='CJdropshipping'
              AND sc.raw_payload #>> '{discovery,campaign}'=$2
              AND sc.raw_payload #>> '{discovery,semantic_relevance,relevant}'='true'
              AND COALESCE(sc.scan_result->>'sourcing_decision','UNKNOWN') IN ('TEST','PRIORITY')
              AND sc.komerce_category IS NOT NULL
            )
          )
     )
     SELECT
       COUNT(DISTINCT product_id)::int AS accepted_distinct_products,
       COUNT(DISTINCT product_id) FILTER (WHERE supplier_name='AliExpress')::int AS ali_products,
       COUNT(DISTINCT product_id) FILTER (WHERE supplier_name='CJdropshipping')::int AS cj_products,
       (
         SELECT COUNT(*)::int
           FROM sourcing_candidates sc
          WHERE sc.supplier_name='CJdropshipping'
            AND sc.raw_payload #>> '{discovery,campaign}'=$2
            AND sc.raw_payload #>> '{discovery,semantic_relevance,relevant}'='true'
       ) AS cj_semantic_positive,
       (
         SELECT COUNT(*)::int
           FROM sourcing_candidates sc
          WHERE sc.supplier_name='CJdropshipping'
            AND sc.raw_payload #>> '{discovery,campaign}'=$2
            AND COALESCE(sc.raw_payload #>> '{discovery,semantic_relevance,relevant}','false') <> 'true'
       ) AS cj_semantic_invalid,
       (
         SELECT COUNT(*)::int
           FROM sourcing_candidates sc
          WHERE sc.supplier_name='AliExpress'
            AND sc.raw_payload #>> '{discovery,wave}'=$1
            AND (
              COALESCE(sc.scan_result->>'sourcing_decision','UNKNOWN') NOT IN ('TEST','PRIORITY')
              OR sc.komerce_category IS NULL
            )
       ) AS ali_quarantined_not_counted,
       (
         SELECT COUNT(DISTINCT pme.product_id)::int
           FROM accepted a
           JOIN product_market_exposure pme ON pme.product_id=a.product_id
          WHERE pme.commercial_exposure='ENABLED'
       ) AS enabled_market_exposure
       FROM accepted`,
    [ali.WAVE_ID, CJ_CAMPAIGN]
  );
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, Number(value || 0)]));
}

async function run(options = parseArgs()) {
  const runtime = e2eRuntime.assertIsolatedE2eRuntime();
  const aliReadiness = await ali.collectAcceptance();
  const cjReport = await cjFinal.run({
    mode: 'final',
    expected: CJ_TARGET,
    output: path.resolve('artifacts/catalog-e2e-700/cj-final-acceptance.json'),
  });
  const integrity = await cohortIntegrity();

  const aliAccepted = aliReadiness.total === ALI_TARGET
    && aliReadiness.ready === ALI_TARGET
    && aliReadiness.with_active_supplier_sku === ALI_TARGET
    && aliReadiness.with_complete_soi === ALI_TARGET;
  const cjAccepted = cjReport.accepted === true
    && Number(cjReport.summary?.total_products || 0) === CJ_TARGET
    && Number(cjReport.summary?.final_ready_for_human_publication_review || 0) === CJ_TARGET;

  const accepted = aliAccepted
    && cjAccepted
    && integrity.accepted_distinct_products === TOTAL_TARGET
    && integrity.ali_products === ALI_TARGET
    && integrity.cj_products === CJ_TARGET
    && integrity.cj_semantic_positive === CJ_TARGET
    && integrity.cj_semantic_invalid === 0
    && integrity.enabled_market_exposure === 0;

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    dataset_id: e2eRuntime.CANONICAL_700_DATASET,
    target: TOTAL_TARGET,
    accepted,
    runtime,
    cohorts: {
      AliExpress: {
        target: ALI_TARGET,
        accepted: aliAccepted,
        readiness: aliReadiness,
        quarantined_not_counted: integrity.ali_quarantined_not_counted,
      },
      CJdropshipping: {
        target: CJ_TARGET,
        accepted: cjAccepted,
        semantic_positive: integrity.cj_semantic_positive,
        semantic_invalid: integrity.cj_semantic_invalid,
        final_summary: cjReport.summary,
      },
    },
    integrity,
    auto_publish: false,
    market_exposure_created: false,
    paid_ai_required: false,
  };

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n');
  console.log(`[catalog-e2e-700] ACCEPT ${JSON.stringify({
    accepted,
    target: TOTAL_TARGET,
    ali_ready: aliReadiness.ready,
    cj_ready: cjReport.summary?.final_ready_for_human_publication_review,
    cj_semantic_positive: integrity.cj_semantic_positive,
    quarantined_not_counted: integrity.ali_quarantined_not_counted,
    enabled_market_exposure: integrity.enabled_market_exposure,
  })}`);

  if (!accepted) {
    throw new Error(
      `CATALOG_E2E_700_ACCEPTANCE_FAILED ali=${aliReadiness.ready}/${ALI_TARGET} cj=${cjReport.summary?.final_ready_for_human_publication_review || 0}/${CJ_TARGET} distinct=${integrity.accepted_distinct_products}/${TOTAL_TARGET}`
    );
  }
  return report;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`[catalog-e2e-700] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  ALI_TARGET,
  CJ_TARGET,
  TOTAL_TARGET,
  CJ_CAMPAIGN,
  parseArgs,
  cohortIntegrity,
  run,
};
