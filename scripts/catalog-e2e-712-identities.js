#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-e2e-712-identity-authority
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        certified CJ 500 snapshot, reconciled CJ new12 ids
 * @outputs       exact immutable identity set for catalog-e2e-712-v1
 * @depends       scripts/catalog-cj-certified-500-materialize.js, scripts/cj-reconcile-current-new-12-promote.js
 * @used-by       catalog-e2e-712-acceptance.js, catalog-712-transfer.js, catalog-712-production-exclusion-audit.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      exact_certified_identity_set, campaign_membership_is_not_certification
 * @impact-areas  catalog, sourcing, staging-e2e, production-catalog
 * @version       2026-09-v1
 */
'use strict';

const { decodeCertifiedIds } = require('./catalog-cj-certified-500-materialize');
const { NEW_UNIQUE_IDS } = require('./cj-reconcile-current-new-12-promote');

const CJ_HISTORICAL_TARGET = 500;
const CJ_NEW_TARGET = 12;
const CJ_TARGET = CJ_HISTORICAL_TARGET + CJ_NEW_TARGET;
const ALI_TARGET = 200;
const TOTAL_TARGET = CJ_TARGET + ALI_TARGET;
const DATASET_ID = 'catalog-e2e-712-v1';

function buildExpectedCjIds(env = process.env) {
  const historical = decodeCertifiedIds(env).map(String);
  const additions = NEW_UNIQUE_IDS.map(String);
  const all = [...historical, ...additions];

  if (historical.length !== CJ_HISTORICAL_TARGET) {
    throw new Error(`CATALOG_712_HISTORICAL_COUNT_INVALID:${historical.length}/${CJ_HISTORICAL_TARGET}`);
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

module.exports = {
  CJ_HISTORICAL_TARGET,
  CJ_NEW_TARGET,
  CJ_TARGET,
  ALI_TARGET,
  TOTAL_TARGET,
  DATASET_ID,
  buildExpectedCjIds,
};
