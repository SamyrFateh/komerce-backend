#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-e2e-712-identity-authority
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        certified CJ 500 snapshot or persisted certified provenance, reconciled CJ new12 ids
 * @outputs       exact immutable identity set for catalog-e2e-712-v1
 * @depends       scripts/catalog-cj-certified-500-materialize.js, scripts/cj-reconcile-current-new-12-promote.js
 * @used-by       catalog-e2e-712-acceptance.js, catalog-712-transfer.js, catalog-712-production-exclusion-audit.js
 * @db-read       sourcing_candidates
 * @db-write      none
 * @db-txn        none
 * @doctrine      exact_certified_identity_set, campaign_membership_is_not_certification
 * @impact-areas  catalog, sourcing, staging-e2e, production-catalog
 * @version       2026-09-v1
 */
'use strict';

const { decodeCertifiedIds, CERTIFIED_RUN_ID, SNAPSHOT_ENV } = require('./catalog-cj-certified-500-materialize');
const { NEW_UNIQUE_IDS } = require('./cj-reconcile-current-new-12-promote');

const CJ_HISTORICAL_TARGET = 500;
const CJ_NEW_TARGET = 12;
const CJ_TARGET = CJ_HISTORICAL_TARGET + CJ_NEW_TARGET;
const ALI_TARGET = 200;
const TOTAL_TARGET = CJ_TARGET + ALI_TARGET;
const DATASET_ID = 'catalog-e2e-712-v1';

function assembleExpectedCjIds(historicalIds) {
  const historical = (historicalIds || []).map(String);
  const additions = NEW_UNIQUE_IDS.map(String);
  const all = [...historical, ...additions];

  if (historical.length !== CJ_HISTORICAL_TARGET) {
    throw new Error(`CATALOG_712_HISTORICAL_COUNT_INVALID:${historical.length}/${CJ_HISTORICAL_TARGET}`);
  }
  if (new Set(historical).size !== CJ_HISTORICAL_TARGET) {
    throw new Error('CATALOG_712_HISTORICAL_DUPLICATE_ID');
  }
  if (additions.length !== CJ_NEW_TARGET) {
    throw new Error(`CATALOG_712_NEW12_COUNT_INVALID:${additions.length}/${CJ_NEW_TARGET}`);
  }
  if (new Set(all).size !== CJ_TARGET) {
    throw new Error(`CATALOG_712_CJ_ID_OVERLAP:${all.length - new Set(all).size}`);
  }

  return Object.freeze({
    historical: Object.freeze([...historical]),
    additions: Object.freeze([...additions]),
    all: Object.freeze([...all]),
  });
}

function buildExpectedCjIds(env = process.env) {
  return assembleExpectedCjIds(decodeCertifiedIds(env));
}

async function resolveExpectedCjIds({ env = process.env, executor = null } = {}) {
  if (String(env[SNAPSHOT_ENV] || '').trim()) {
    return Object.freeze({
      ...buildExpectedCjIds(env),
      authority: 'certified_snapshot_env',
      certified_run_id: CERTIFIED_RUN_ID,
    });
  }

  if (!executor || typeof executor.query !== 'function') {
    throw new Error(`${SNAPSHOT_ENV} requis ou executor DB pour provenance certifiée persistée`);
  }

  const authority = `github-actions-run-${CERTIFIED_RUN_ID}`;
  const { rows } = await executor.query(
    `SELECT supplier_product_id
       FROM sourcing_candidates
      WHERE supplier_name='CJdropshipping'
        AND state='imported_to_catalog'
        AND raw_payload #>> '{discovery,certified_run_id}'=$1
        AND raw_payload #>> '{discovery,source}'='certified-artifact+exact-product-query'
        AND raw_payload #>> '{discovery,semantic_relevance,authority}'=$2
        AND raw_payload #>> '{discovery,semantic_relevance,evidence}'='historical_final_acceptance_500_of_500'
      ORDER BY supplier_product_id`,
    [String(CERTIFIED_RUN_ID), authority]
  );

  return Object.freeze({
    ...assembleExpectedCjIds(rows.map(row => row.supplier_product_id)),
    authority: 'persisted_certified_run_id',
    certified_run_id: CERTIFIED_RUN_ID,
  });
}

module.exports = {
  CJ_HISTORICAL_TARGET,
  CJ_NEW_TARGET,
  CJ_TARGET,
  ALI_TARGET,
  TOTAL_TARGET,
  DATASET_ID,
  assembleExpectedCjIds,
  buildExpectedCjIds,
  resolveExpectedCjIds,
};
