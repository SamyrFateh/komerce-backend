/**
 * @komerce-arch
 * @role          catalog-commercial-assortment-projection
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        closed_kir_business_truth, approved_for_sale_products
 * @outputs       global_commercial_assortment
 * @depends       db.js
 * @used-by       services/catalog-workspace.js
 * @db-read       import_runtime_runs, sourcing_candidates, products, markets, product_market_exposure, product_market_price_drafts
 * @db-write      none
 * @db-txn        none
 * @doctrine      commercial_catalog_is_union_of_approved_products_from_closed_kirs, technical_product_store_is_not_commercial_assortment, approval_requires_exposure_and_local_active_price, browser_never_recomputes_closure
 * @impact-areas  catalog, sourcing, market-delegation, pricing, admin-dashboard
 * @version       2026-09
 */

'use strict';

const db = require('../db');

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function projectRow(row) {
  return {
    product_ref: row.product_ref,
    name: row.name,
    description: row.description || null,
    category: row.category || null,
    subcategory: row.subcategory || null,
    price_kmf: numberOrNull(row.price_kmf),
    price_aed: numberOrNull(row.price_aed),
    stock: row.stock == null ? null : Number(row.stock),
    image_url: row.image_url || null,
    badge: row.badge || null,
    emoji: row.emoji || null,
    promo_pct: numberOrNull(row.promo_pct),
    is_active: Boolean(row.is_active),
    is_available: Boolean(row.is_available),
    lifecycle_status: row.lifecycle_status || null,
    content_source: row.content_source || null,
    needs_review: Boolean(row.needs_review),
    enrichment_confidence: numberOrNull(row.enrichment_confidence),
    approved_markets: Array.isArray(row.approved_markets) ? row.approved_markets : [],
    source_lots: Array.isArray(row.source_lots) ? row.source_lots : [],
    first_closed_at: row.first_closed_at || null,
    updated_at: row.updated_at || null,
  };
}

async function listCommercialAssortment({
  search = null,
  category = null,
  limit = 200,
} = {}, executor = db) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const params = [];
  const filters = [
    'p.is_active = TRUE',
    "p.lifecycle_status = 'active'",
  ];
  if (search) {
    params.push(`%${String(search).trim()}%`);
    filters.push(`(p.name ILIKE $${params.length} OR p.product_ref ILIKE $${params.length})`);
  }
  if (category) {
    params.push(String(category));
    filters.push(`p.category = $${params.length}`);
  }
  params.push(safeLimit);
  const limitParam = params.length;

  const { rows } = await executor.query(`
    WITH active_markets AS (
      SELECT id, code
        FROM markets
       WHERE is_active = TRUE
    ),
    market_count AS (
      SELECT COUNT(*)::int AS total FROM active_markets
    ),
    promoted AS (
      SELECT DISTINCT r.id AS run_id,
             r.run_ref,
             r.status AS run_status,
             r.intake,
             r.finished_at,
             sc.product_id
        FROM import_runtime_runs r
        JOIN sourcing_candidates sc
          ON sc.import_id = r.import_id
       WHERE sc.state = 'imported_to_catalog'
         AND sc.product_id IS NOT NULL
    ),
    product_terminal AS (
      SELECT pr.run_id,
             pr.run_ref,
             pr.run_status,
             pr.intake,
             pr.finished_at,
             pr.product_id,
             EXISTS (
               SELECT 1
                 FROM active_markets m
                 JOIN product_market_exposure pme
                   ON pme.market_id = m.id
                  AND pme.product_id = pr.product_id
                  AND pme.commercial_exposure = 'ENABLED'
                 JOIN product_market_price_drafts pp
                   ON pp.market_id = m.id
                  AND pp.product_id = pr.product_id
                  AND pp.status = 'LOCAL_ACTIVE'
             ) AS approved_for_sale,
             (
               p.lifecycle_status = 'rejected'
               OR (
                 (SELECT total FROM market_count) > 0
                 AND NOT EXISTS (
                   SELECT 1
                     FROM active_markets m
                    WHERE NOT EXISTS (
                      SELECT 1
                        FROM product_market_exposure pme
                       WHERE pme.market_id = m.id
                         AND pme.product_id = pr.product_id
                         AND pme.commercial_exposure = 'DISABLED'
                    )
                 )
               )
             ) AS not_retained
        FROM promoted pr
        JOIN products p ON p.id = pr.product_id
    ),
    closed_runs AS (
      SELECT pt.run_id
        FROM product_terminal pt
       WHERE pt.run_status = 'COMPLETED'
         AND COALESCE(NULLIF(pt.intake->>'quarantined','')::int, 0) = 0
       GROUP BY pt.run_id
      HAVING COUNT(pt.product_id) = COUNT(pt.product_id) FILTER (
               WHERE pt.approved_for_sale OR pt.not_retained
             )
    ),
    approved_products AS (
      SELECT DISTINCT pt.product_id,
             pt.run_ref,
             pt.finished_at
        FROM product_terminal pt
        JOIN closed_runs cr ON cr.run_id = pt.run_id
       WHERE pt.approved_for_sale = TRUE
    ),
    approved_market_codes AS (
      SELECT p.id AS product_id,
             ARRAY_AGG(DISTINCT m.code ORDER BY m.code) AS approved_markets
        FROM products p
        JOIN active_markets m ON TRUE
        JOIN product_market_exposure pme
          ON pme.product_id = p.id
         AND pme.market_id = m.id
         AND pme.commercial_exposure = 'ENABLED'
        JOIN product_market_price_drafts pp
          ON pp.product_id = p.id
         AND pp.market_id = m.id
         AND pp.status = 'LOCAL_ACTIVE'
       GROUP BY p.id
    ),
    provenance AS (
      SELECT ap.product_id,
             ARRAY_AGG(DISTINCT ap.run_ref ORDER BY ap.run_ref) AS source_lots,
             MIN(ap.finished_at) AS first_closed_at
        FROM approved_products ap
       GROUP BY ap.product_id
    )
    SELECT p.product_ref, p.name, p.description, p.category, p.subcategory,
           p.price_kmf, p.price_aed, p.stock, p.image_url, p.badge, p.emoji,
           p.promo_pct, p.is_active, p.is_available, p.lifecycle_status,
           p.content_source, p.needs_review, p.enrichment_confidence, p.updated_at,
           amc.approved_markets,
           provenance.source_lots,
           provenance.first_closed_at
      FROM provenance
      JOIN products p ON p.id = provenance.product_id
      JOIN approved_market_codes amc ON amc.product_id = p.id
     WHERE ${filters.join(' AND ')}
     ORDER BY provenance.first_closed_at DESC NULLS LAST, p.updated_at DESC NULLS LAST
     LIMIT $${limitParam}
  `, params);

  return rows.map(projectRow);
}

async function summarizeCommercialAssortment(executor = db) {
  const rows = await listCommercialAssortment({ limit: 500 }, executor);
  return {
    approved_products: rows.length,
    markets: [...new Set(rows.flatMap(row => row.approved_markets || []))].length,
    closed_lots: [...new Set(rows.flatMap(row => row.source_lots || []))].length,
  };
}

module.exports = {
  projectRow,
  listCommercialAssortment,
  summarizeCommercialAssortment,
};
