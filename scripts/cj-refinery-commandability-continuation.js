#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cj-refinery-commandability-continuation
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        disposable catalog checkpoint, CJ exact product detail API
 * @outputs       enriched normalized_source_contract, canonical media/axes/SKUs/SOI, readiness report
 * @depends       db.js, services/suppliers/connectors/cj-connector.js,
 *                services/suppliers/catalog-import-orchestrator.js, services/catalog-promotion.js,
 *                services/product-publication-guard.js
 * @used-by       isolated-cj-refinery-continuation.yml
 * @db-read       sourcing_candidates, products, product_skus, catalog_media, product_market_exposure
 * @db-write-via  catalog-import-orchestrator, catalog-promotion
 * @db-txn        one promotion transaction per product
 * @doctrine      continuation_of_refinery, exact_supplier_identity, no_publication, no_order, disposable_db_only
 * @impact-areas  sourcing, catalog, purchasing, staging
 * @version       2026-09-v1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const cjConnector = require('../services/suppliers/connectors/cj-connector');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const { promoteCatalog } = require('../services/catalog-promotion');
const { validatePublicationUpdate } = require('../services/product-publication-guard');

const SUPPLIER = 'CJdropshipping';
const FLAG = 'KOMERCE_ALLOW_CJ_REFINERY_CONTINUATION';
const DEFAULT_LIMIT = 974;
const MAX_LIMIT = 1000;
const DEFAULT_CHUNK = 20;
const MAX_CHUNK = 20;
const DEFAULT_DETAIL_DELAY_MS = 1100;
const DEFAULT_QUOTA_WAIT_MS = 60000;
const DEFAULT_MAX_QUOTA_WAITS = 15;
const ALLOWED_DECISIONS = new Set(['TEST', 'PRIORITY']);

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function intValue(raw, fallback, min, max, label) {
  if (raw == null || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} doit être un entier entre ${min} et ${max}`);
  }
  return value;
}

function parseArgs(argv = process.argv.slice(2)) {
  let limit = DEFAULT_LIMIT;
  let chunk = DEFAULT_CHUNK;
  let output = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--limit') limit = intValue(argv[++i], DEFAULT_LIMIT, 1, MAX_LIMIT, '--limit');
    else if (arg.startsWith('--limit=')) limit = intValue(arg.split('=', 2)[1], DEFAULT_LIMIT, 1, MAX_LIMIT, '--limit');
    else if (arg === '--chunk') chunk = intValue(argv[++i], DEFAULT_CHUNK, 1, MAX_CHUNK, '--chunk');
    else if (arg.startsWith('--chunk=')) chunk = intValue(arg.split('=', 2)[1], DEFAULT_CHUNK, 1, MAX_CHUNK, '--chunk');
    else if (arg === '--output') output = String(argv[++i] || '').trim();
    else if (arg.startsWith('--output=')) output = String(arg.split('=', 2)[1] || '').trim();
    else throw new Error(`Argument inconnu: ${arg}`);
  }

  return {
    limit,
    chunk,
    output: output ? path.resolve(output) : null,
  };
}

function assertDisposableRuntime(env = process.env) {
  if (String(env.KOMERCE_ENV || '').trim().toLowerCase() !== 'staging' || env.NODE_ENV !== 'test') {
    throw new Error('REFUS: KOMERCE_ENV=staging et NODE_ENV=test requis');
  }
  if (!isTruthy(env[FLAG])) throw new Error(`REFUS: ${FLAG}=1 requis`);
  if (!env.CJ_ACCESS_TOKEN && !env.CJ_API_KEY) {
    throw new Error('CJ_ACCESS_TOKEN ou CJ_API_KEY requis');
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');

  const url = new URL(env.DATABASE_URL);
  const dbName = String(url.pathname || '').replace(/^\//, '');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || dbName !== 'komerce_real_catalog_stress') {
    throw new Error('REFUS: base jetable localhost komerce_real_catalog_stress requise');
  }
}

function isQuotaError(error) {
  return Number(error?.status) === 429
    || /(?:HTTP\s*)?429|insufficient api points|16900500|too many requests|rate.?limit/i.test(
      String(error?.message || error || '')
    );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function decisionOf(row) {
  return String(row?.scan_result?.sourcing_decision || '').trim().toUpperCase() || 'UNKNOWN';
}

function classifyReadiness(row) {
  const reasons = [];
  const decision = String(row.sourcing_decision || '').trim().toUpperCase();
  const sourceLocale = String(row.source_locale || '').trim().toLowerCase().replace('_', '-');
  const nativeFr = row.content_source === 'connector_raw'
    && (sourceLocale === 'fr' || sourceLocale.startsWith('fr-'));
  const editorialReady = row.needs_review === false
    && (row.content_source === 'manual' || row.content_source === 'ai_enriched' || nativeFr);

  if (!ALLOWED_DECISIONS.has(decision)) reasons.push(`decision:${decision || 'UNKNOWN'}`);
  if (!editorialReady) reasons.push('editorial_not_ready');
  if (!(Number(row.active_media) >= 1)) reasons.push('media_missing');
  if (!(Number(row.active_supplier_skus) >= 1)) reasons.push('active_supplier_sku_missing');
  if (!(Number(row.complete_soi_skus) >= 1)) reasons.push('supplier_order_identity_missing');
  if (Number(row.complete_soi_skus) < Number(row.active_supplier_skus)) reasons.push('supplier_order_identity_partial');
  if (!String(row.category || '').trim()) reasons.push('category_missing');

  const publication = validatePublicationUpdate({
    before: {
      ...row,
      is_active: false,
      is_available: false,
      stock: row.stock,
      price_kmf: row.price_kmf,
      name: row.name,
      description: row.description,
      category: row.category,
      content_source: row.content_source,
      source_locale: row.source_locale,
    },
    patch: { is_active: true },
    context: { catalogMediaCount: Number(row.active_media || 0) },
  });
  if (!publication.ok) reasons.push(`publication_guard:${publication.code}`);

  return {
    ready: reasons.length === 0,
    reasons,
    publication_guard: publication.ok ? 'PASS' : publication.code,
  };
}

async function loadPending(limit) {
  const { rows } = await db.query(
    `SELECT sc.id AS candidate_id,
            sc.product_id,
            sc.supplier_product_id,
            sc.scan_result,
            p.product_ref
       FROM sourcing_candidates sc
       JOIN products p ON p.id=sc.product_id
      WHERE sc.supplier_name=$1
        AND sc.state='imported_to_catalog'
        AND sc.product_id IS NOT NULL
        AND p.lifecycle_status='candidate'
        AND p.is_active=FALSE
        AND UPPER(COALESCE(sc.scan_result->>'sourcing_decision','')) = ANY($2::text[])
        AND NOT EXISTS (
          SELECT 1
            FROM product_skus ps
           WHERE ps.product_id=sc.product_id
             AND ps.source='SUPPLIER'
             AND ps.is_active=TRUE
             AND ps.supplier_unit_ref IS NOT NULL
             AND ps.supplier_order_identity IS NOT NULL
        )
      ORDER BY p.product_ref
      LIMIT $3`,
    [SUPPLIER, [...ALLOWED_DECISIONS], limit]
  );
  return rows;
}

async function importExactChunk(products, chunkNo) {
  if (!products.length) return { accepted: 0, rejected: 0 };
  const result = await catalogImportOrchestrator.importCatalog(
    {
      supplier_name: SUPPLIER,
      supplier_id: 'cj',
      source_type: 'api',
      source_filename: `cj-refinery-continuation/exact-${String(chunkNo).padStart(4, '0')}.json`,
      notes: 'CJ exact detail continuation of Raffinerie — disposable CI database only',
      is_full_snapshot: false,
    },
    null,
    async () => ({ products, invalid: [], total: products.length })
  );

  if (result.status !== 200) {
    throw new Error(`CJ exact import chunk ${chunkNo} refusé (${result.status}): ${JSON.stringify(result.body || {})}`);
  }
  if (Number(result.body?.rejected || 0) > 0) {
    throw new Error(`CJ exact import chunk ${chunkNo} partiel: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function loadImportedRows(supplierProductIds) {
  if (!supplierProductIds.length) return [];
  const { rows } = await db.query(
    `SELECT id AS candidate_id, product_id, supplier_product_id,
            normalized_source_contract, scan_result
       FROM sourcing_candidates
      WHERE supplier_name=$1
        AND supplier_product_id = ANY($2::text[])
      ORDER BY supplier_product_id`,
    [SUPPLIER, supplierProductIds]
  );
  return rows;
}

async function replayPromotion(row) {
  if (!row.product_id) return { status: 'blocked', reason: 'product_id_missing' };
  const decision = decisionOf(row);
  if (!ALLOWED_DECISIONS.has(decision)) {
    return { status: 'blocked', reason: `decision:${decision}` };
  }
  const contract = row.normalized_source_contract;
  if (!contract || String(contract.schema_version || '') !== '2') {
    return { status: 'blocked', reason: 'normalized_v2_missing' };
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const promoted = await promoteCatalog(client, {
      productId: row.product_id,
      normalizedSourceContract: contract,
    });
    await client.query('COMMIT');
    return {
      status: 'promoted',
      skus: Number(promoted?.skus?.count || 0),
      media: Number(promoted?.media || 0),
      variants: Number(promoted?.variants || 0),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return { status: 'error', reason: String(error.message || error).slice(0, 300) };
  } finally {
    client.release();
  }
}

async function collectReadiness() {
  const { rows } = await db.query(
    `SELECT p.id AS product_id, p.product_ref, p.name, p.description, p.category, p.subcategory,
            p.price_kmf, p.stock, p.content_source, p.needs_review, p.source_locale,
            p.lifecycle_status, p.is_active,
            sc.supplier_product_id,
            UPPER(COALESCE(sc.scan_result->>'sourcing_decision','UNKNOWN')) AS sourcing_decision,
            COUNT(DISTINCT cm.id) FILTER (WHERE cm.is_active=TRUE)::int AS active_media,
            COUNT(DISTINCT ps.id) FILTER (
              WHERE ps.source='SUPPLIER' AND ps.is_active=TRUE
            )::int AS active_supplier_skus,
            COUNT(DISTINCT ps.id) FILTER (
              WHERE ps.source='SUPPLIER'
                AND ps.is_active=TRUE
                AND ps.supplier_unit_ref IS NOT NULL
                AND ps.supplier_order_identity IS NOT NULL
            )::int AS complete_soi_skus
       FROM sourcing_candidates sc
       JOIN products p ON p.id=sc.product_id
       LEFT JOIN catalog_media cm ON cm.product_id=p.id
       LEFT JOIN product_skus ps ON ps.product_id=p.id
      WHERE sc.supplier_name=$1
        AND sc.state='imported_to_catalog'
        AND sc.product_id IS NOT NULL
        AND p.lifecycle_status='candidate'
        AND p.is_active=FALSE
        AND UPPER(COALESCE(sc.scan_result->>'sourcing_decision','')) = ANY($2::text[])
      GROUP BY p.id, p.product_ref, p.name, p.description, p.category, p.subcategory,
               p.price_kmf, p.stock, p.content_source, p.needs_review, p.source_locale,
               p.lifecycle_status, p.is_active, sc.supplier_product_id, sc.scan_result
      ORDER BY p.product_ref`,
    [SUPPLIER, [...ALLOWED_DECISIONS]]
  );

  const products = rows.map(row => {
    const readiness = classifyReadiness(row);
    return {
      product_ref: row.product_ref,
      supplier_product_id: row.supplier_product_id,
      category: row.category,
      subcategory: row.subcategory,
      active_media: Number(row.active_media || 0),
      active_supplier_skus: Number(row.active_supplier_skus || 0),
      complete_soi_skus: Number(row.complete_soi_skus || 0),
      content_source: row.content_source,
      needs_review: row.needs_review,
      sourcing_decision: row.sourcing_decision,
      ready: readiness.ready,
      reasons: readiness.reasons,
      publication_guard: readiness.publication_guard,
    };
  });

  const reasonCounts = {};
  const categoryCounts = {};
  for (const product of products) {
    categoryCounts[product.category || '<missing>'] = (categoryCounts[product.category || '<missing>'] || 0) + 1;
    for (const reason of product.reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }

  return {
    total: products.length,
    ready: products.filter(p => p.ready).length,
    not_ready: products.filter(p => !p.ready).length,
    with_active_supplier_sku: products.filter(p => p.active_supplier_skus > 0).length,
    with_complete_soi: products.filter(p => p.complete_soi_skus > 0).length,
    with_multiple_media: products.filter(p => p.active_media >= 2).length,
    missing_subcategory: products.filter(p => !p.subcategory).length,
    reasons: reasonCounts,
    categories: categoryCounts,
    products,
  };
}

async function finalSafetyAudit() {
  const { rows: [row] } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE p.is_active=TRUE)::int AS active,
            COUNT(DISTINCT pme.product_id)::int AS exposed,
            COUNT(*) FILTER (WHERE p.lifecycle_status IS DISTINCT FROM 'candidate')::int AS wrong_lifecycle
       FROM sourcing_candidates sc
       JOIN products p ON p.id=sc.product_id
       LEFT JOIN product_market_exposure pme ON pme.product_id=p.id
      WHERE sc.supplier_name=$1
        AND sc.state='imported_to_catalog'`,
    [SUPPLIER]
  );
  return {
    active: Number(row?.active || 0),
    exposed: Number(row?.exposed || 0),
    wrong_lifecycle: Number(row?.wrong_lifecycle || 0),
  };
}

async function run(options = parseArgs(), env = process.env) {
  assertDisposableRuntime(env);

  const delayMs = intValue(
    env.KOMERCE_CJ_REFINERY_DETAIL_DELAY_MS,
    DEFAULT_DETAIL_DELAY_MS,
    0,
    10000,
    'KOMERCE_CJ_REFINERY_DETAIL_DELAY_MS'
  );
  const quotaWaitMs = intValue(
    env.KOMERCE_CJ_REFINERY_QUOTA_WAIT_MS,
    DEFAULT_QUOTA_WAIT_MS,
    1000,
    300000,
    'KOMERCE_CJ_REFINERY_QUOTA_WAIT_MS'
  );
  const maxQuotaWaits = intValue(
    env.KOMERCE_CJ_REFINERY_MAX_QUOTA_WAITS,
    DEFAULT_MAX_QUOTA_WAITS,
    0,
    100,
    'KOMERCE_CJ_REFINERY_MAX_QUOTA_WAITS'
  );

  const pending = await loadPending(options.limit);
  const accessToken = await cjConnector.getAccessToken({ env });
  const detailErrors = [];
  const promotionErrors = [];
  let detailCalls = 0;
  let quotaWaits = 0;
  let imported = 0;
  let promoted = 0;
  let pausedReason = null;

  console.log(`[cj-refinery-continuation] pending=${pending.length} limit=${options.limit} chunk=${options.chunk}`);

  for (let offset = 0; offset < pending.length; offset += options.chunk) {
    const slice = pending.slice(offset, offset + options.chunk);
    const normalizedProducts = [];

    for (let index = 0; index < slice.length; index += 1) {
      const candidate = slice[index];
      if (index > 0 || offset > 0) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(delayMs);
      }

      while (true) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const detail = await cjConnector.fetchProductDetail(candidate.supplier_product_id, { env, accessToken });
          detailCalls += 1;
          const normalized = cjConnector.normalizeCjProduct(detail.product);
          if (String(normalized.supplier_product_id || '') !== String(candidate.supplier_product_id)) {
            throw new Error(`CJ_DETAIL_ID_MISMATCH expected=${candidate.supplier_product_id} actual=${normalized.supplier_product_id}`);
          }
          normalizedProducts.push(normalized);
          break;
        } catch (error) {
          detailCalls += 1;
          if (isQuotaError(error)) {
            if (quotaWaits >= maxQuotaWaits) {
              pausedReason = 'quota-paused';
              break;
            }
            quotaWaits += 1;
            console.log(`[cj-refinery-continuation] quota_wait=${quotaWaits} wait_ms=${quotaWaitMs} pid=${candidate.supplier_product_id}`);
            // eslint-disable-next-line no-await-in-loop
            await sleep(quotaWaitMs);
            continue;
          }
          detailErrors.push({
            supplier_product_id: candidate.supplier_product_id,
            error: String(error.message || error).slice(0, 300),
          });
          break;
        }
      }

      if (pausedReason) break;
    }

    if (normalizedProducts.length) {
      const chunkNo = Math.floor(offset / options.chunk) + 1;
      // eslint-disable-next-line no-await-in-loop
      const importedResult = await importExactChunk(normalizedProducts, chunkNo);
      imported += Number(importedResult.accepted || 0);

      const ids = normalizedProducts.map(product => product.supplier_product_id);
      // eslint-disable-next-line no-await-in-loop
      const rows = await loadImportedRows(ids);
      for (const row of rows) {
        // eslint-disable-next-line no-await-in-loop
        const result = await replayPromotion(row);
        if (result.status === 'promoted') {
          promoted += 1;
        } else if (result.status === 'error') {
          promotionErrors.push({
            supplier_product_id: row.supplier_product_id,
            error: result.reason,
          });
        }
      }
      console.log(`[cj-refinery-continuation] chunk=${chunkNo} exact=${normalizedProducts.length} imported=${imported} promoted=${promoted}`);
    }

    if (pausedReason) break;
  }

  const readiness = await collectReadiness();
  const safety = await finalSafetyAudit();
  if (safety.active || safety.exposed || safety.wrong_lifecycle) {
    throw new Error(`SAFETY_AUDIT_FAILED:${JSON.stringify(safety)}`);
  }

  const summary = {
    selected_pending: pending.length,
    detail_calls: detailCalls,
    detail_errors: detailErrors.length,
    imported_exact: imported,
    replay_promoted: promoted,
    promotion_errors: promotionErrors.length,
    quota_waits: quotaWaits,
    paused_reason: pausedReason,
    readiness: {
      total: readiness.total,
      ready: readiness.ready,
      not_ready: readiness.not_ready,
      with_active_supplier_sku: readiness.with_active_supplier_sku,
      with_complete_soi: readiness.with_complete_soi,
      with_multiple_media: readiness.with_multiple_media,
      missing_subcategory: readiness.missing_subcategory,
      reasons: readiness.reasons,
    },
    safety,
  };

  const report = {
    schema_version: 1,
    authority: 'ISOLATED_REFINERY_CONTINUATION_NOT_PUBLICATION',
    generated_at: new Date().toISOString(),
    supplier: SUPPLIER,
    summary,
    detail_errors: detailErrors,
    promotion_errors: promotionErrors,
    readiness,
  };

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }

  console.log(`[cj-refinery-continuation] FINAL ${JSON.stringify(summary)}`);
  return report;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[cj-refinery-continuation] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER,
  FLAG,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  DEFAULT_CHUNK,
  MAX_CHUNK,
  parseArgs,
  assertDisposableRuntime,
  isQuotaError,
  decisionOf,
  classifyReadiness,
  loadPending,
  collectReadiness,
  finalSafetyAudit,
  run,
};
