#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cj-reconciled-local-promotion
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        12 CJ supplier ids proved unique against historical certified 500
 * @outputs       rescanned local candidates promoted to inactive catalog drafts
 * @depends       db.js, services/sourcing-candidate-actions.js, services/suppliers/e2e-isolated-runtime.js
 * @used-by       Railway isolated catalog reconciliation
 * @db-read       sourcing_candidates, products, product_skus, product_market_exposure
 * @db-write-via  services/sourcing-candidate-actions.js
 * @db-txn        canonical promotion authority
 * @doctrine      no_provider_calls, exact_supplier_identity, inactive_drafts_only
 * @impact-areas  sourcing, catalog, staging
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');
const actions = require('../services/sourcing-candidate-actions');
const e2eRuntime = require('../services/suppliers/e2e-isolated-runtime');

const SUPPLIER = 'CJdropshipping';
const FLAG = 'KOMERCE_ALLOW_REAL_SUPPLIER_STRESS_PROMOTION';
const HISTORICAL_RUN_ID = 36299995007;
const NEW_UNIQUE_IDS = Object.freeze([
  '1783345230016684032',
  '2507280321201618700',
  '2502200219471617900',
  '2408220931351615400',
  '1364030928963375104',
  'C051067B-BA9B-42D7-A66A-84EE522BDB70',
  '2601200707441623200',
  '1902534514986078209',
  '1860152662499938304',
  '1797173666921328640',
  '2501240208281622000',
  '2407280755171603100',
]);

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function assertRuntime(env = process.env) {
  if (String(env.KOMERCE_ENV || '').trim().toLowerCase() !== 'staging' || env.NODE_ENV !== 'test') {
    throw new Error('REFUS: promotion CJ reconciliée réservée à staging/test');
  }
  if (!isTruthy(env[FLAG])) throw new Error(`REFUS: ${FLAG}=1 requis`);
  e2eRuntime.assertIsolatedE2eRuntime(env);
}

function explicitTestPrice(row) {
  const value = Number(row?.scan_result?.test_price_kmf);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

async function loadRows() {
  const { rows } = await db.query(
    `SELECT id, supplier_name, supplier_product_id, state, product_id,
            komerce_category, scan_result, normalized_source_contract
       FROM sourcing_candidates
      WHERE supplier_name=$1
        AND supplier_product_id = ANY($2::text[])
      ORDER BY supplier_product_id`,
    [SUPPLIER, [...NEW_UNIQUE_IDS]]
  );
  return rows;
}

async function finalAudit() {
  const { rows } = await db.query(
    `SELECT sc.supplier_product_id, sc.state, sc.product_id,
            p.lifecycle_status, p.is_active, p.content_source,
            COUNT(DISTINCT ps.id) FILTER (WHERE ps.source='SUPPLIER' AND ps.is_active=TRUE)::int AS active_supplier_skus,
            COUNT(DISTINCT cm.id) FILTER (WHERE cm.is_active=TRUE)::int AS active_media,
            COUNT(DISTINCT pme.product_id) FILTER (WHERE pme.commercial_exposure='ENABLED')::int AS enabled_exposure
       FROM sourcing_candidates sc
       LEFT JOIN products p ON p.id=sc.product_id
       LEFT JOIN product_skus ps ON ps.product_id=p.id
       LEFT JOIN catalog_media cm ON cm.product_id=p.id
       LEFT JOIN product_market_exposure pme ON pme.product_id=p.id
      WHERE sc.supplier_name=$1
        AND sc.supplier_product_id = ANY($2::text[])
      GROUP BY sc.supplier_product_id, sc.state, sc.product_id,
               p.lifecycle_status, p.is_active, p.content_source
      ORDER BY sc.supplier_product_id`,
    [SUPPLIER, [...NEW_UNIQUE_IDS]]
  );
  return rows;
}

async function run() {
  assertRuntime();
  const before = await loadRows();
  const found = new Set(before.map(r => String(r.supplier_product_id)));
  const missing = NEW_UNIQUE_IDS.filter(id => !found.has(id));
  if (missing.length) throw new Error(`CJ_RECONCILE_IDS_MISSING:${missing.join(',')}`);

  const promoted = [];
  const already = [];
  const blocked = [];

  for (const row of before) {
    if (row.state === 'imported_to_catalog' && row.product_id) {
      already.push(row.supplier_product_id);
      continue;
    }

    // Recompute and persist the canonical local scan before promotion.
    // No provider call is performed.
    // eslint-disable-next-line no-await-in-loop
    const rescanned = await actions.scanCandidate(row.id, null);
    const decision = String(rescanned?.scan_result?.sourcing_decision || '').trim().toUpperCase();
    const price = explicitTestPrice(rescanned);
    const authority = String(
      rescanned?.scan_result?.recommended_price_authority
      || rescanned?.scan_result?.price_authority
      || ''
    ).trim();

    if (!['TEST', 'PRIORITY'].includes(decision)) {
      blocked.push({ supplier_product_id: row.supplier_product_id, reason: `decision:${decision || 'UNKNOWN'}` });
      continue;
    }
    if (!String(rescanned.komerce_category || '').trim()) {
      blocked.push({ supplier_product_id: row.supplier_product_id, reason: 'komerce_category_missing' });
      continue;
    }
    if (!price) {
      blocked.push({ supplier_product_id: row.supplier_product_id, reason: 'test_price_missing' });
      continue;
    }
    if (authority !== 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION') {
      blocked.push({ supplier_product_id: row.supplier_product_id, reason: `price_authority:${authority || 'missing'}` });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const result = await actions.promoteCandidate(row.id, {
      price_kmf: price,
      enrichment_mode: 'source_only',
    }, null);
    promoted.push({ supplier_product_id: row.supplier_product_id, product_id: result.product_id });
  }

  const after = await finalAudit();
  const catalogReady = after.filter(row =>
    row.state === 'imported_to_catalog'
    && row.product_id
    && row.lifecycle_status === 'candidate'
    && row.is_active === false
    && Number(row.enabled_exposure || 0) === 0
  );

  const summary = {
    supplier: SUPPLIER,
    historical_run_id: HISTORICAL_RUN_ID,
    reconciled_new_unique_target: NEW_UNIQUE_IDS.length,
    provider_api_calls: 0,
    found: before.length,
    promoted_now: promoted.length,
    already_in_catalog: already.length,
    blocked: blocked.length,
    catalog_ready: catalogReady.length,
    with_active_supplier_sku: after.filter(r => Number(r.active_supplier_skus || 0) > 0).length,
    with_active_media: after.filter(r => Number(r.active_media || 0) > 0).length,
    enabled_market_exposure: after.reduce((n,r)=>n+Number(r.enabled_exposure || 0),0),
  };

  console.log(`[cj-reconcile-promote] ${JSON.stringify({ summary, promoted, already, blocked, products: after })}`);
  if (blocked.length || catalogReady.length !== NEW_UNIQUE_IDS.length) {
    throw new Error(`CJ_RECONCILE_PROMOTION_INCOMPLETE:${catalogReady.length}/${NEW_UNIQUE_IDS.length}`);
  }
  return { summary, promoted, already, blocked, products: after };
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[cj-reconcile-promote] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER,
  HISTORICAL_RUN_ID,
  NEW_UNIQUE_IDS,
  assertRuntime,
  explicitTestPrice,
  loadRows,
  finalAudit,
  run,
};
