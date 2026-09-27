#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-cj-certified-500-materializer
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        certified CJ 500 supplier-id snapshot, exact CJ detail API, isolated Railway E2E DB
 * @outputs       500 historical CJ products materialized as inactive commandable catalog drafts
 * @depends       db.js, services/suppliers/connectors/cj-connector.js, services/suppliers/catalog-import-orchestrator.js, services/sourcing-candidate-actions.js, services/catalog-promotion.js, services/catalog-overrides.js, scripts/catalog-fr-free-e2e-preparation.js, scripts/aliexpress-incremental-e2e-200.js, services/suppliers/e2e-isolated-runtime.js, services/suppliers/e2e-catalog-500-plan.js, scripts/cj-reconcile-current-new-12-promote.js
 * @used-by       ali-e2e-200-worker catalog-712-materialize mode
 * @db-read       sourcing_candidates, products, product_skus, catalog_media, product_market_exposure, boutique_categories, boutique_subcategories
 * @db-write-via:catalog-import-orchestrator supplier_catalog_imports, sourcing_candidates, sourcing_candidate_events
 * @db-write-via:sourcing-candidate-actions sourcing_candidates, sourcing_candidate_events, products
 * @db-write-via:catalog-promotion catalog_media, product_variants, product_skus, product_sku_media
 * @db-write-via:catalog-overrides catalog_field_overrides, products
 * @db-txn        canonical owners
 * @doctrine      certified_identity_restore, exact_detail_only, no_discovery, no_auto_publish, dynamic_taxonomy_fail_closed
 * @impact-areas  catalog, sourcing, supplier-import, staging-e2e
 * @version       2026-09-v1
 */
'use strict';

const zlib = require('zlib');
const db = require('../db');
const cj = require('../services/suppliers/connectors/cj-connector');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const { promoteCandidate } = require('../services/sourcing-candidate-actions');
const { promoteCatalog } = require('../services/catalog-promotion');
const catalogOverrides = require('../services/catalog-overrides');
const freeFr = require('./catalog-fr-free-e2e-preparation');
const ali = require('./aliexpress-incremental-e2e-200');
const e2eRuntime = require('../services/suppliers/e2e-isolated-runtime');
const { BALANCED_E2E_500_PLAN, planTotal } = require('../services/suppliers/e2e-catalog-500-plan');
const { NEW_UNIQUE_IDS } = require('./cj-reconcile-current-new-12-promote');

const SUPPLIER = 'CJdropshipping';
const CAMPAIGN = 'cj-balanced-e2e-500-v1';
const CERTIFIED_RUN_ID = 36299995007;
const TARGET = 500;
const FLAG = 'KOMERCE_ALLOW_CJ_CERTIFIED_500_MATERIALIZE';
const SNAPSHOT_ENV = 'KOMERCE_CJ_CERTIFIED_500_IDS_GZIP_B64';
const DEFAULT_DETAIL_DELAY_MS = 1100;
const MAX_DETAIL_DELAY_MS = 10000;
const ALLOWED_DECISIONS = new Set(['TEST', 'PRIORITY']);
const EXPECTED_PRICE_AUTHORITY = 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION';

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function intValue(value, fallback, min, max, label) {
  if (value == null || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} doit être ${min}..${max}`);
  return n;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function isQuotaError(error) {
  return Number(error?.status) === 429
    || /(?:HTTP\s*)?429|insufficient api points|16900500|too many requests|rate.?limit/i.test(
      String(error?.message || error || '')
    );
}

function assertRuntime(env = process.env) {
  if (!isTruthy(env[FLAG])) throw new Error(`REFUS: ${FLAG}=1 requis`);
  if (!env.CJ_ACCESS_TOKEN && !env.CJ_API_KEY) throw new Error('CJ_ACCESS_TOKEN ou CJ_API_KEY requis');
  return e2eRuntime.assertIsolatedE2eRuntime(env);
}

function decodeCertifiedIds(env = process.env) {
  const raw = String(env[SNAPSHOT_ENV] || '').trim();
  if (!raw) throw new Error(`${SNAPSHOT_ENV} requis`);
  let ids;
  try {
    const json = zlib.gunzipSync(Buffer.from(raw, 'base64')).toString('utf8');
    ids = JSON.parse(json);
  } catch (error) {
    throw new Error(`CJ_CERTIFIED_SNAPSHOT_INVALID: ${error.message}`);
  }
  if (!Array.isArray(ids) || ids.length !== TARGET) {
    throw new Error(`CJ_CERTIFIED_SNAPSHOT_COUNT:${Array.isArray(ids) ? ids.length : 'invalid'}/${TARGET}`);
  }
  const normalized = ids.map(id => String(id || '').trim());
  if (normalized.some(id => !id)) throw new Error('CJ_CERTIFIED_SNAPSHOT_EMPTY_ID');
  if (new Set(normalized).size !== TARGET) throw new Error('CJ_CERTIFIED_SNAPSHOT_DUPLICATE_ID');
  return normalized;
}

function buildAssignments(ids, plan = BALANCED_E2E_500_PLAN) {
  if (planTotal(plan) !== TARGET) throw new Error(`CJ_CERTIFIED_PLAN_TOTAL:${planTotal(plan)}/${TARGET}`);
  if (!Array.isArray(ids) || ids.length !== TARGET) throw new Error(`CJ_CERTIFIED_ASSIGNMENT_IDS:${ids?.length || 0}/${TARGET}`);

  const assignments = [];
  let cursor = 0;
  for (const segment of plan) {
    for (let i = 0; i < segment.target; i += 1) {
      const supplierProductId = ids[cursor];
      assignments.push({
        supplier_product_id: supplierProductId,
        certified_product_ref: `KPR-${String(cursor + 1).padStart(6, '0')}`,
        segment_id: segment.id,
        target_category: segment.category,
        target_subcategory: segment.subcategory,
      });
      cursor += 1;
    }
  }
  if (cursor !== TARGET) throw new Error(`CJ_CERTIFIED_ASSIGNMENT_TOTAL:${cursor}/${TARGET}`);
  return assignments;
}

function withCertifiedProvenance(product, assignment) {
  return {
    ...product,
    raw_payload: {
      ...(product.raw_payload || {}),
      discovery: {
        ...((product.raw_payload || {}).discovery || {}),
        source: 'certified-artifact+exact-product-query',
        campaign: CAMPAIGN,
        segment_id: assignment.segment_id,
        target_category: assignment.target_category,
        target_subcategory: assignment.target_subcategory,
        certified_run_id: CERTIFIED_RUN_ID,
        certified_product_ref: assignment.certified_product_ref,
        semantic_relevance: {
          relevant: true,
          authority: `github-actions-run-${CERTIFIED_RUN_ID}`,
          evidence: 'historical_final_acceptance_500_of_500',
        },
      },
    },
  };
}

async function assertTaxonomy(assignments) {
  const pairs = [...new Map(assignments.map(item => [
    `${item.target_category}\u0000${item.target_subcategory}`,
    { category: item.target_category, subcategory: item.target_subcategory },
  ])).values()];

  const invalid = [];
  for (const pair of pairs) {
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await db.query(
      `SELECT 1
         FROM boutique_categories bc
         JOIN boutique_subcategories bs
           ON bs.category_key=bc.key
          AND bs.key=$2
          AND bs.is_active=TRUE
        WHERE bc.key=$1
          AND bc.is_active=TRUE
        LIMIT 1`,
      [pair.category, pair.subcategory]
    );
    if (!rows.length) invalid.push(pair);
  }
  if (invalid.length) throw new Error(`CJ_CERTIFIED_TAXONOMY_INVALID:${JSON.stringify(invalid)}`);
  return { pairs: pairs.length, valid: pairs.length };
}

async function aliPreflight() {
  const readiness = await ali.collectAcceptance();
  const ok = readiness.total === ali.TARGET
    && readiness.ready === ali.TARGET
    && readiness.with_active_supplier_sku === ali.TARGET
    && readiness.with_complete_soi === ali.TARGET;
  if (!ok) {
    throw new Error(`CATALOG_712_ALI_PREFLIGHT_FAILED ready=${readiness.ready}/${ali.TARGET} total=${readiness.total}/${ali.TARGET} reasons=${JSON.stringify(readiness.reasons || {})}`);
  }
  return readiness;
}

async function new12Preflight() {
  const { rows: [row] } = await db.query(
    `WITH expected AS (
       SELECT unnest($1::text[]) AS supplier_product_id
     ), ready AS (
       SELECT sc.supplier_product_id,
              p.id AS product_id,
              p.lifecycle_status,
              p.is_active,
              p.content_source,
              p.needs_review,
              p.boutique_category_key,
              p.boutique_subcategory_key,
              COUNT(DISTINCT ps.id) FILTER (
                WHERE ps.source='SUPPLIER' AND ps.is_active=TRUE
              )::int AS active_skus,
              COUNT(DISTINCT ps.id) FILTER (
                WHERE ps.source='SUPPLIER' AND ps.is_active=TRUE
                  AND ps.supplier_unit_ref IS NOT NULL
                  AND ps.supplier_order_identity IS NOT NULL
              )::int AS complete_skus
         FROM sourcing_candidates sc
         JOIN products p ON p.id=sc.product_id
         LEFT JOIN product_skus ps ON ps.product_id=p.id
        WHERE sc.supplier_name=$2
          AND sc.supplier_product_id = ANY($1::text[])
          AND sc.state='imported_to_catalog'
        GROUP BY sc.supplier_product_id,p.id
     )
     SELECT COUNT(e.supplier_product_id)::int AS expected,
            COUNT(r.supplier_product_id)::int AS present,
            COUNT(r.supplier_product_id) FILTER (
              WHERE r.lifecycle_status='candidate'
                AND r.is_active=FALSE
                AND r.content_source='manual'
                AND r.needs_review=FALSE
                AND r.boutique_category_key IS NOT NULL
                AND r.boutique_subcategory_key IS NOT NULL
                AND r.active_skus>0
                AND r.complete_skus=r.active_skus
            )::int AS ready
       FROM expected e
       LEFT JOIN ready r USING (supplier_product_id)`,
    [NEW_UNIQUE_IDS, SUPPLIER]
  );
  const out = {
    expected: Number(row?.expected || 0),
    present: Number(row?.present || 0),
    ready: Number(row?.ready || 0),
  };
  if (out.expected !== NEW_UNIQUE_IDS.length || out.ready !== NEW_UNIQUE_IDS.length) {
    throw new Error(`CATALOG_712_CJ_NEW12_PREFLIGHT_FAILED:${JSON.stringify(out)}`);
  }
  return out;
}

async function loadStatusMap(ids) {
  const { rows } = await db.query(
    `WITH sku AS (
       SELECT product_id,
              COUNT(*) FILTER (WHERE source='SUPPLIER' AND is_active=TRUE)::int AS active_skus,
              COUNT(*) FILTER (
                WHERE source='SUPPLIER' AND is_active=TRUE
                  AND supplier_unit_ref IS NOT NULL
                  AND supplier_order_identity IS NOT NULL
              )::int AS complete_skus
         FROM product_skus
        GROUP BY product_id
     )
     SELECT sc.id AS candidate_id, sc.supplier_product_id, sc.state, sc.product_id,
            sc.scan_result, sc.normalized_source_contract,
            p.lifecycle_status, p.is_active, p.content_source, p.needs_review,
            p.boutique_category_key, p.boutique_subcategory_key,
            COALESCE(sku.active_skus,0)::int AS active_skus,
            COALESCE(sku.complete_skus,0)::int AS complete_skus
       FROM sourcing_candidates sc
       LEFT JOIN products p ON p.id=sc.product_id
       LEFT JOIN sku ON sku.product_id=p.id
      WHERE sc.supplier_name=$1
        AND sc.supplier_product_id = ANY($2::text[])`,
    [SUPPLIER, ids]
  );
  return new Map(rows.map(row => [String(row.supplier_product_id), row]));
}

function fullyMaterialized(row) {
  return Boolean(
    row
    && row.state === 'imported_to_catalog'
    && row.product_id
    && row.lifecycle_status === 'candidate'
    && row.is_active === false
    && Number(row.active_skus || 0) > 0
    && Number(row.complete_skus || 0) === Number(row.active_skus || 0)
    && String(row.boutique_category_key || '').trim()
    && String(row.boutique_subcategory_key || '').trim()
  );
}

function testPriceOf(row) {
  const n = Number(row?.scan_result?.test_price_kmf);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function priceAuthorityOf(row) {
  const scan = row?.scan_result || {};
  return String(scan.recommended_price_authority || scan.price_authority || '').trim() || null;
}

async function importExactChunk(products, chunkNo) {
  const result = await catalogImportOrchestrator.importCatalog(
    {
      supplier_name: SUPPLIER,
      supplier_id: cj.PROVIDER_ID,
      source_type: 'api',
      source_filename: `catalog-712/cj-certified-500/chunk-${String(chunkNo).padStart(3, '0')}.json`,
      notes: `Restore certified CJ 500 from GitHub Actions run ${CERTIFIED_RUN_ID}; exact product detail only`,
      is_full_snapshot: false,
    },
    null,
    async () => ({ products, invalid: [], total: products.length })
  );
  if (result.status !== 200 || Number(result.body?.rejected || 0) > 0) {
    throw new Error(`CJ_CERTIFIED_IMPORT_CHUNK_FAILED:${chunkNo}:${JSON.stringify(result.body || {})}`);
  }
  return result.body;
}

async function loadCandidateRows(ids) {
  const { rows } = await db.query(
    `SELECT id, supplier_product_id, state, product_id, scan_result, normalized_source_contract
       FROM sourcing_candidates
      WHERE supplier_name=$1
        AND supplier_product_id = ANY($2::text[])
      ORDER BY supplier_product_id`,
    [SUPPLIER, ids]
  );
  return rows;
}

async function replayOrPromote(row) {
  const decision = String(row?.scan_result?.sourcing_decision || '').trim().toUpperCase();
  if (!ALLOWED_DECISIONS.has(decision)) {
    return { status: 'blocked', reason: `decision:${decision || 'UNKNOWN'}` };
  }
  const contract = row.normalized_source_contract;
  if (!contract || String(contract.schema_version || '') !== '2') {
    return { status: 'blocked', reason: 'normalized_v2_missing' };
  }

  if (row.state === 'imported_to_catalog' && row.product_id) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const promotion = await promoteCatalog(client, {
        productId: row.product_id,
        normalizedSourceContract: contract,
      });
      await client.query('COMMIT');
      return { status: 'replayed', product_id: row.product_id, promotion };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  if (row.state !== 'scanned' || row.product_id) {
    return { status: 'blocked', reason: `state:${row.state || 'unknown'}` };
  }
  const price = testPriceOf(row);
  if (!(price > 0)) return { status: 'blocked', reason: 'test_price_missing' };
  const authority = priceAuthorityOf(row);
  if (authority !== EXPECTED_PRICE_AUTHORITY) {
    return { status: 'blocked', reason: `price_authority:${authority || 'missing'}` };
  }
  const result = await promoteCandidate(row.id, {
    price_kmf: price,
    enrichment_mode: 'source_only',
  }, null);
  return { status: 'promoted', product_id: result.product_id };
}

async function prepareFrenchExact(ids) {
  const { rows } = await db.query(
    `SELECT p.id,p.product_ref,p.name,p.name_source,p.description_source,p.source_locale,
            p.category,p.subcategory,p.content_source,p.needs_review,
            sc.supplier_name,sc.supplier_product_id,
            cc.label AS category_label
       FROM sourcing_candidates sc
       JOIN products p ON p.id=sc.product_id
       LEFT JOIN customs_categories cc ON cc.key=p.category AND cc.is_active=TRUE
      WHERE sc.supplier_name=$1
        AND sc.supplier_product_id = ANY($2::text[])
        AND sc.state='imported_to_catalog'
        AND p.lifecycle_status='candidate'
        AND p.is_active=FALSE
        AND p.content_source='connector_raw'
        AND p.source_locale IS NOT NULL
        AND lower(p.source_locale) NOT LIKE 'fr%'
      ORDER BY p.product_ref`,
    [SUPPLIER, ids]
  );

  let prepared = 0;
  for (const row of rows) {
    const fields = freeFr.prepareFrenchFields(row);
    // eslint-disable-next-line no-await-in-loop
    const result = await catalogOverrides.upsertOverrides(
      db,
      row.id,
      { name: fields.name, description: fields.description },
      { reason: 'Préparation FR gratuite — restauration CJ 500 certifiée E2E', setBy: null }
    );
    if (result.product?.content_source !== 'manual' || result.product?.needs_review !== false) {
      throw new Error(`CJ_CERTIFIED_FR_NOT_READY:${row.supplier_product_id}`);
    }
    prepared += 1;
  }
  return { selected: rows.length, prepared, api_calls: 0 };
}

async function finalAudit(ids) {
  const { rows: [row] } = await db.query(
    `WITH expected AS (
       SELECT unnest($1::text[]) AS supplier_product_id
     ), media AS (
       SELECT product_id,COUNT(*) FILTER (WHERE is_active=TRUE)::int AS active_media
         FROM catalog_media GROUP BY product_id
     ), sku AS (
       SELECT product_id,
              COUNT(*) FILTER (WHERE source='SUPPLIER' AND is_active=TRUE)::int AS active_skus,
              COUNT(*) FILTER (
                WHERE source='SUPPLIER' AND is_active=TRUE
                  AND supplier_unit_ref IS NOT NULL
                  AND supplier_order_identity IS NOT NULL
              )::int AS complete_skus
         FROM product_skus GROUP BY product_id
     ), actual AS (
       SELECT sc.supplier_product_id,p.id AS product_id,p.lifecycle_status,p.is_active,
              p.content_source,p.needs_review,p.boutique_category_key,p.boutique_subcategory_key,
              COALESCE(media.active_media,0)::int AS active_media,
              COALESCE(sku.active_skus,0)::int AS active_skus,
              COALESCE(sku.complete_skus,0)::int AS complete_skus,
              COUNT(DISTINCT pme.product_id) FILTER (WHERE pme.commercial_exposure='ENABLED')::int AS exposed
         FROM sourcing_candidates sc
         JOIN products p ON p.id=sc.product_id
         LEFT JOIN media ON media.product_id=p.id
         LEFT JOIN sku ON sku.product_id=p.id
         LEFT JOIN product_market_exposure pme ON pme.product_id=p.id
        WHERE sc.supplier_name=$2
          AND sc.supplier_product_id = ANY($1::text[])
          AND sc.state='imported_to_catalog'
        GROUP BY sc.supplier_product_id,p.id,media.active_media,sku.active_skus,sku.complete_skus
     )
     SELECT COUNT(e.supplier_product_id)::int AS expected,
            COUNT(a.supplier_product_id)::int AS present,
            COUNT(DISTINCT a.product_id)::int AS distinct_products,
            COUNT(a.supplier_product_id) FILTER (
              WHERE a.lifecycle_status='candidate' AND a.is_active=FALSE
                AND a.content_source='manual' AND a.needs_review=FALSE
                AND a.boutique_category_key IS NOT NULL
                AND a.boutique_subcategory_key IS NOT NULL
                AND a.active_media>0 AND a.active_skus>0
                AND a.complete_skus=a.active_skus
                AND a.exposed=0
            )::int AS ready
       FROM expected e
       LEFT JOIN actual a USING (supplier_product_id)`,
    [ids, SUPPLIER]
  );
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, Number(value || 0)]));
}

async function run(env = process.env) {
  const runtime = assertRuntime(env);
  const ids = decodeCertifiedIds(env);
  const assignments = buildAssignments(ids);

  const aliReadiness = await aliPreflight();
  const cjNew12 = await new12Preflight();
  const taxonomy = await assertTaxonomy(assignments);

  const statusMap = await loadStatusMap(ids);
  const beforeReady = ids.filter(id => fullyMaterialized(statusMap.get(id))).length;
  const pendingAssignments = assignments.filter(item => !fullyMaterialized(statusMap.get(item.supplier_product_id)));

  const delayMs = intValue(
    env.KOMERCE_CJ_712_DETAIL_DELAY_MS,
    DEFAULT_DETAIL_DELAY_MS,
    0,
    MAX_DETAIL_DELAY_MS,
    'KOMERCE_CJ_712_DETAIL_DELAY_MS'
  );
  const accessToken = pendingAssignments.length ? await cj.getAccessToken({ env }) : null;

  let detailCalls = 0;
  let imported = 0;
  let promoted = 0;
  let replayed = 0;
  let skippedReady = beforeReady;
  let pausedReason = null;
  const detailErrors = [];
  const blocked = [];
  const CHUNK = 20;

  for (let offset = 0; offset < pendingAssignments.length; offset += CHUNK) {
    const slice = pendingAssignments.slice(offset, offset + CHUNK);
    const products = [];

    for (let i = 0; i < slice.length; i += 1) {
      const assignment = slice[i];
      if (detailCalls > 0 && delayMs > 0) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(delayMs);
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const detail = await cj.fetchProductDetail(assignment.supplier_product_id, { env, accessToken });
        detailCalls += 1;
        const normalized = cj.normalizeCjProduct(detail.product);
        if (String(normalized.supplier_product_id) !== assignment.supplier_product_id) {
          throw new Error(`CJ_DETAIL_ID_MISMATCH expected=${assignment.supplier_product_id} actual=${normalized.supplier_product_id}`);
        }
        products.push(withCertifiedProvenance(normalized, assignment));
      } catch (error) {
        detailCalls += 1;
        if (isQuotaError(error)) {
          pausedReason = 'quota-paused';
          detailErrors.push({ supplier_product_id: assignment.supplier_product_id, error: String(error.message || error).slice(0, 300) });
          break;
        }
        throw error;
      }
    }

    if (products.length) {
      const chunkNo = Math.floor(offset / CHUNK) + 1;
      // eslint-disable-next-line no-await-in-loop
      const importedResult = await importExactChunk(products, chunkNo);
      imported += Number(importedResult.accepted || 0);
      const chunkIds = products.map(product => product.supplier_product_id);
      // eslint-disable-next-line no-await-in-loop
      const rows = await loadCandidateRows(chunkIds);
      for (const row of rows) {
        // eslint-disable-next-line no-await-in-loop
        const result = await replayOrPromote(row);
        if (result.status === 'promoted') promoted += 1;
        else if (result.status === 'replayed') replayed += 1;
        else blocked.push({ supplier_product_id: row.supplier_product_id, reason: result.reason });
      }
      console.log(`[catalog-712-cj500] chunk=${chunkNo} exact=${products.length} imported=${imported} promoted=${promoted} replayed=${replayed}`);
    }

    if (pausedReason) break;
  }

  const fr = await prepareFrenchExact(ids);
  const audit = await finalAudit(ids);
  const complete = !pausedReason
    && blocked.length === 0
    && audit.expected === TARGET
    && audit.present === TARGET
    && audit.distinct_products === TARGET
    && audit.ready === TARGET;

  const summary = {
    runtime,
    certified_run_id: CERTIFIED_RUN_ID,
    target: TARGET,
    ali_preflight: { total: aliReadiness.total, ready: aliReadiness.ready },
    cj_new12_preflight: cjNew12,
    taxonomy,
    already_materialized_before: beforeReady,
    pending_at_start: pendingAssignments.length,
    skipped_ready: skippedReady,
    detail_calls: detailCalls,
    imported_exact: imported,
    promoted_now: promoted,
    replayed_now: replayed,
    fr,
    blocked: blocked.length,
    paused_reason: pausedReason,
    audit,
    complete,
  };

  console.log(`[catalog-712-cj500] FINAL ${JSON.stringify(summary)}`);
  if (!complete) {
    const error = new Error(`CATALOG_712_CJ500_INCOMPLETE:${JSON.stringify({ pausedReason, blocked: blocked.slice(0, 10), detailErrors: detailErrors.slice(0, 10), audit })}`);
    error.summary = summary;
    throw error;
  }
  return summary;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      if (error?.summary) console.error(`[catalog-712-cj500] PARTIAL ${JSON.stringify(error.summary)}`);
      console.error(`[catalog-712-cj500] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER,
  CAMPAIGN,
  CERTIFIED_RUN_ID,
  TARGET,
  FLAG,
  SNAPSHOT_ENV,
  decodeCertifiedIds,
  buildAssignments,
  withCertifiedProvenance,
  fullyMaterialized,
  finalAudit,
  run,
};
