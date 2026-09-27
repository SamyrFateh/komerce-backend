/**
 * @komerce-arch-lite
 * @role          aliexpress-golden-commercial-readonly-proof
 * @domain        catalog
 * @layer         tooling
 * @owner         services/sourcing-candidate-actions.js
 * @purpose       Observe the exact imported AliExpress Golden candidate against canonical publication/market gates.
 * @impact-areas  catalog, sourcing, pricing, market-autonomy
 */
'use strict';

const db = require('../db');
const { identityAudit } = require('./aliexpress-golden-e2e-core');
const { validatePublicationUpdate } = require('../services/product-publication-guard');
const { publicCatalogVisibilitySql } = require('../services/catalog-public-view');

const CANDIDATE_ID = '3ae1db7b-856a-4ed9-9e68-6dbee7487cc2';
const SUPPLIER_PRODUCT_ID = '1005012486042806';
const TARGET_MARKET_CODE = 'KM';

function amount(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function reportCandidate(candidate, batchStatus) {
  const scan = candidate.scan_result || {};
  const units = candidate.normalized_source_contract?.sellable_units || [];
  const identity = identityAudit({ sellable_units: units });
  const blockers = [];
  if (candidate.state === 'rejected' || scan.sourcing_decision === 'EXCLUDED') {
    blockers.push('SOURCE_OR_ELIGIBILITY_REJECTED');
  }
  if (!identity.complete) blockers.push('SOURCE_ORDER_IDENTITY_INCOMPLETE');
  if (!candidate.product_id) blockers.push('EXPLICIT_PRICE_AND_CATALOG_DRAFT_DECISION_PENDING');
  return {
    candidate_id: candidate.id,
    supplier_product_id: candidate.supplier_product_id,
    state: candidate.state,
    product_id: candidate.product_id,
    import_status: batchStatus,
    source: {
      price: amount(candidate.purchase_price),
      currency: candidate.currency,
      purchase_price_kmf: amount(candidate.purchase_price_kmf),
      weight_kg: amount(candidate.estimated_weight_kg),
      volume_m3: amount(candidate.estimated_volume_m3),
      identity,
    },
    scanner: {
      sourcing_decision: scan.sourcing_decision ?? null,
      reason: scan.reason ?? null,
      eligibility: scan.eligibility ?? null,
      recommended_price_kmf: amount(scan.recommended_price_kmf),
      test_price_kmf: amount(scan.test_price_kmf),
      variable_cost_complete_kmf: amount(scan.variable_cost_complete_kmf),
      variable_cost_estimated_kmf: amount(scan.variable_cost_estimated_kmf),
      health_status: scan.health_status ?? null,
      market_confidence: scan.market_confidence ?? null,
    },
    blockers,
  };
}

async function reportProduct(q, productId, marketCode = TARGET_MARKET_CODE) {
  const { rows: [product] } = await q.query(
    `SELECT id, product_ref, name, description, category, lifecycle_status, is_active,
            is_available, quality_validated, needs_review, content_source, source_locale,
            price_kmf, stock, image_url, inventory_model
       FROM products WHERE id = $1`,
    [productId]
  );
  if (!product) return { found: false, publication: null, market: null };
  const { rows: [{ media_count: mediaCount }] } = await q.query(
    'SELECT COUNT(*)::int AS media_count FROM catalog_media WHERE product_id = $1 AND is_active = TRUE',
    [productId]
  );
  const publication = validatePublicationUpdate({
    before: product, patch: { is_active: true },
    context: { catalogMediaCount: mediaCount },
  });
  const { rows: [market] } = await q.query(
    `SELECT m.code, m.is_active,
            COALESCE(pme.commercial_exposure, 'DISABLED') AS commercial_exposure,
            EXISTS(
              SELECT 1 FROM product_market_price_drafts pmpd
               WHERE pmpd.market_id = m.id AND pmpd.product_id = $1
                 AND pmpd.status = 'LOCAL_ACTIVE'
            ) AS local_active_price,
            (SELECT COUNT(*)::int FROM product_skus ps
              WHERE ps.product_id = $1 AND ps.is_active = TRUE AND ps.stock > 0)
              AS active_in_stock_skus
       FROM markets m
       LEFT JOIN product_market_exposure pme ON pme.market_id = m.id AND pme.product_id = $1
      WHERE m.code = $2`,
    [productId, marketCode]
  );
  const { rows: [visibility] } = await q.query(
    `SELECT (${publicCatalogVisibilitySql('p', { marketCodeParamIndex: 2 })})
       AS visible FROM products p WHERE p.id = $1`,
    [productId, marketCode]
  );
  return {
    found: true,
    product_id: product.id,
    product_ref: product.product_ref,
    lifecycle_status: product.lifecycle_status,
    is_active: product.is_active,
    is_available: product.is_available,
    quality_validated: product.quality_validated,
    needs_review: product.needs_review,
    content_source: product.content_source,
    source_locale: product.source_locale,
    catalog_price_kmf: amount(product.price_kmf),
    media_count: mediaCount,
    publication_precheck: publication,
    market: {
      code: marketCode,
      active: market?.is_active === true,
      commercial_exposure: market?.commercial_exposure ?? 'DISABLED',
      local_active_price: market?.local_active_price === true,
      active_in_stock_skus: Number(market?.active_in_stock_skus || 0),
      currently_visible: visibility?.visible === true,
    },
  };
}

async function run({ env = process.env, executor = db } = {}) {
  if (env.KOMERCE_ENV !== 'staging') throw new Error('ALI_COMMERCIAL_AUDIT_STAGING_ONLY');
  if (!env.DATABASE_URL) throw new Error('ALI_COMMERCIAL_AUDIT_DATABASE_REQUIRED');
  const q = await executor.getClient();
  try {
    await q.query('BEGIN TRANSACTION READ ONLY');
    const { rows: [candidate] } = await q.query(
      `SELECT id, supplier_name, supplier_product_id, state, product_id, import_id,
              normalized_source_contract, scan_result, purchase_price, purchase_price_kmf,
              currency, estimated_weight_kg, estimated_volume_m3
         FROM sourcing_candidates WHERE id = $1`,
      [CANDIDATE_ID]
    );
    if (!candidate || candidate.supplier_name !== 'AliExpress'
      || candidate.supplier_product_id !== SUPPLIER_PRODUCT_ID) {
      throw new Error('ALI_COMMERCIAL_AUDIT_EXACT_CANDIDATE_NOT_FOUND');
    }
    const { rows: [batch] } = candidate.import_id
      ? await q.query('SELECT status FROM supplier_catalog_imports WHERE id = $1', [candidate.import_id])
      : { rows: [] };
    const source = reportCandidate(candidate, batch?.status ?? null);
    const product = candidate.product_id
      ? await reportProduct(q, candidate.product_id)
      : { found: false, publication_precheck: { ok: false, code: 'catalog_draft_missing' },
          market: { code: TARGET_MARKET_CODE, currently_visible: false,
            commercial_exposure: 'DISABLED', local_active_price: false } };
    await q.query('COMMIT');
    return {
      mode: 'commercial-audit-read-only',
      runtime: 'staging',
      writes: false,
      target_market: TARGET_MARKET_CODE,
      source,
      product,
      commercial_verdict: source.blockers.length || !product.found
        || product.publication_precheck?.ok !== true
        || product.market?.currently_visible !== true
        ? 'NOT_YET_VISIBLE_OR_SELLABLE'
        : 'VISIBLE_IN_TARGET_MARKET',
      purchase_invoked: false,
      publication_performed: false,
    };
  } catch (err) {
    await q.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    q.release();
  }
}

if (require.main === module) {
  run().then(result => process.stdout.write(`[aliexpress-commercial-audit] ${JSON.stringify(result)}\n`))
    .catch(err => { console.error(`[aliexpress-commercial-audit] FAILED: ${err.stack || err}`); process.exitCode = 1; })
    .finally(() => db.pool.end());
}

module.exports = { CANDIDATE_ID, SUPPLIER_PRODUCT_ID, TARGET_MARKET_CODE, amount, reportCandidate, reportProduct, run };
