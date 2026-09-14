#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          sourcing-product-projection-trial-staging
 * @domain        sourcing
 * @layer         script
 * @criticality   medium
 * @inputs        shadow_proof_gate, canonical_product_projection
 * @outputs       product_projection_trial_report
 * @depends       db.js, services/sourcing-shadow-proof-service.js, services/sourcing-canonical-product-projection.js
 * @db-read       sourcing_sources, sourcing_captures, sourcing_observations, sourcing_observation_evidence, sourcing_canonical_entities, sourcing_resolution_bindings, sourcing_resolution_decisions
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCE_PRODUCT_PROJECTION_TRIAL.md
 * @impact-areas  sourcing, catalog
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const proof = require('../services/sourcing-shadow-proof-service');
const projection = require('../services/sourcing-canonical-product-projection');

const TRIAL_VERSION = 'canonical-product-projection-trial-report-v1';

function buildReport(proofReport, projectionReport) {
  const products = projectionReport.products || [];
  const crossSource = products.filter((product) => product.source_count >= 2);
  const hardFailures = [];

  if (!proofReport?.verdict?.ready_for_product_projection_trial) {
    hardFailures.push('shadow_proof_not_ready');
  }
  if (!products.length) hardFailures.push('no_canonical_product_projection');
  if (!crossSource.length) hardFailures.push('no_cross_source_product_projection');

  const forbidden = new Set(projectionReport.forbidden_economic_fields || []);
  const leaked = [];
  for (const product of products) {
    for (const field of Object.keys(product.resolved || {})) {
      if (forbidden.has(field)) leaked.push({ canonical_product_id: product.canonical_product_id, field });
    }
  }
  if (leaked.length) hardFailures.push('economic_field_leaked_into_product_projection');

  const conflictPreservationFailures = products
    .filter((product) => (product.conflicts || []).some((field) => product.resolved?.[field] !== undefined))
    .map((product) => product.canonical_product_id);
  if (conflictPreservationFailures.length) hardFailures.push('conflict_collapsed_silently');

  return {
    trial_version: TRIAL_VERSION,
    generated_at: new Date().toISOString(),
    authority: 'shadow_read_only',
    historical_catalog_authority_unchanged: true,
    proof_gate: proofReport.verdict,
    summary: {
      canonical_products: products.length,
      cross_source_products: crossSource.length,
      consensus_products: products.filter((product) => product.projection_status === 'CONSENSUS').length,
      partial_conflict_preserved_products: products.filter((product) => product.projection_status === 'PARTIAL_CONFLICT_PRESERVED').length,
    },
    safety: {
      economic_field_leaks: leaked,
      conflict_preservation_failures: conflictPreservationFailures,
    },
    cross_source_samples: crossSource.slice(0, 10),
    verdict: {
      status: hardFailures.length ? 'FAIL' : 'PASS',
      hard_failures: hardFailures,
      ready_for_parallel_product_read_comparison: hardFailures.length === 0,
    },
  };
}

async function run() {
  const proofReport = await proof.collectShadowProof();
  const projectionReport = await projection.collectCanonicalProductProjections();
  const report = buildReport(proofReport, projectionReport);
  console.log(JSON.stringify(report));
  if (report.verdict.status !== 'PASS') process.exitCode = 2;
  return report;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`[sourcing-product-projection-trial] FAILED: ${error.stack || error}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { TRIAL_VERSION, buildReport, run };
