/**
 * @komerce-arch
 * @role          canonical-product-360-service
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        stable_product_ref, server_market_scope, global_authority
 * @outputs       product_360_projection
 * @depends       db
 * @used-by       routes/admin-product-360.js
 * @db-read       products, product_variants, product_skus, order_items, orders, markets, order_item_cost_imputations, order_item_real_cost_allocations, product_suppliers, suppliers, price_history, alerts, users
 * @db-write      none
 * @db-txn        none
 * @doctrine      entity_360_reunites_without_recomputing, server_market_scope_is_authority, product_ref_is_business_identity, sourcing_and_audit_global_only
 * @impact-areas  admin-dashboard, catalog, commerce, inventory, sourcing, economic-engine, market-authorization
 * @version       2026-08
 */

'use strict';

const db = require('../db');

const PRODUCT_REF = /^KPR-\d{6,}$/i;

function normalizeProductRef(value) {
  const ref = String(value || '').trim().toUpperCase();
  return PRODUCT_REF.test(ref) ? ref : null;
}

function marketFilter(alias, marketIds, startIndex) {
  if (marketIds === null) return { sql: '', params: [] };
  if (!Array.isArray(marketIds) || marketIds.length === 0) return { sql: ' AND FALSE', params: [] };
  return {
    sql: ` AND ${alias}.market_id = ANY($${startIndex}::uuid[])`,
    params: [marketIds],
  };
}

async function resolveProduct(productRef) {
  const normalized = normalizeProductRef(productRef);
  if (!normalized) return { invalid: true, product: null };

  const { rows } = await db.query(`
    SELECT
      id, product_ref, sku, name, description, category, subcategory,
      price_kmf, stock, inventory_model, is_active, is_available,
      has_variants, lifecycle_status, content_source, enrichment_version,
      sourcing_source, fragility, weight_kg, dimensions_cm, image_url,
      created_at, updated_at
    FROM products
    WHERE UPPER(product_ref) = UPPER($1)
    LIMIT 1
  `, [normalized]);

  return {
    invalid: false,
    product: rows[0] ? Object.freeze({ ...rows[0], normalized_ref: normalized }) : null,
  };
}

function publicIdentity(product) {
  return Object.freeze({
    product_ref: product.product_ref,
    sku: product.sku || null,
    name: product.name,
    description: product.description || null,
    category: product.category || null,
    subcategory: product.subcategory || null,
    price_kmf: Number(product.price_kmf) || 0,
    lifecycle_status: product.lifecycle_status || null,
    is_active: Boolean(product.is_active),
    is_available: Boolean(product.is_available),
    inventory_model: product.inventory_model || 'LEGACY_VARIANTS',
    has_variants: Boolean(product.has_variants),
    fragility: product.fragility || null,
    weight_kg: product.weight_kg == null ? null : Number(product.weight_kg),
    dimensions_cm: product.dimensions_cm || null,
    image_url: product.image_url || null,
    created_at: product.created_at,
    updated_at: product.updated_at,
  });
}

function buildScope(mode, rows) {
  return Object.freeze({
    mode,
    markets: Object.freeze((rows || []).map(row => Object.freeze({
      code: row.code,
      name: row.name,
      currency: row.currency,
    }))),
  });
}

async function loadProduct360(product, options = {}) {
  if (!product || !product.id) throw new Error('product_360_resolved_product_required');

  const marketIds = options.marketIds === undefined ? null : options.marketIds;
  const includeCentral = Boolean(options.includeCentral);
  const mode = marketIds === null ? 'global' : 'market';
  const productId = product.id;
  const perfScope = marketFilter('o', marketIds, 2);
  const costScope = marketFilter('o', marketIds, 2);
  const realScope = marketFilter('o', marketIds, 2);

  const variantsPromise = db.query(`
    SELECT variant_type, variant_value, sku, stock, price_kmf, image_url, display_order
    FROM product_variants
    WHERE product_id = $1::uuid
    ORDER BY display_order ASC, variant_type ASC, variant_value ASC
  `, [productId]);

  const skusPromise = db.query(`
    SELECT sku, variant_combo, stock, price_kmf, is_active, created_at, updated_at
    FROM product_skus
    WHERE product_id = $1::uuid
    ORDER BY is_active DESC, created_at ASC
  `, [productId]);

  const performancePromise = db.query(`
    SELECT
      m.code, m.name, m.currency,
      COUNT(DISTINCT o.id)::int AS orders_count,
      COALESCE(SUM(oi.quantity), 0)::int AS quantity_sold,
      COALESCE(SUM(oi.price_kmf * oi.quantity), 0) AS revenue_kmf,
      COUNT(DISTINCT o.user_id)::int AS customers_count,
      MAX(o.created_at) AS last_order_at
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN markets m ON m.id = o.market_id
    WHERE oi.product_id = $1::uuid
      AND o.status NOT IN ('cancelled', 'refunded')
      ${perfScope.sql}
    GROUP BY m.code, m.name, m.currency
    ORDER BY revenue_kmf DESC
  `, [productId, ...perfScope.params]);

  const economicsPromise = db.query(`
    SELECT
      COUNT(*)::int AS imputation_lines,
      COALESCE(SUM(imp.quantity), 0)::int AS quantity_costed,
      COALESCE(SUM(imp.sale_total_kmf), 0) AS revenue_costed_kmf,
      COALESCE(SUM(imp.estimated_landed_relay_cost_kmf), 0) AS estimated_landed_kmf,
      COALESCE(SUM(imp.estimated_business_complete_cost_kmf), 0) AS estimated_business_kmf,
      COALESCE(SUM(imp.estimated_margin_kmf), 0) AS estimated_margin_kmf,
      AVG(imp.estimated_margin_pct) AS avg_estimated_margin_pct,
      MAX(imp.created_at) AS last_imputation_at
    FROM order_item_cost_imputations imp
    JOIN orders o ON o.id = imp.order_id
    WHERE imp.product_id = $1::uuid
      ${costScope.sql}
  `, [productId, ...costScope.params]);

  const realCostsPromise = db.query(`
    SELECT
      COUNT(*)::int AS allocations_count,
      COUNT(DISTINCT alc.order_item_id)::int AS lines_with_real_cost,
      COALESCE(SUM(alc.amount_kmf), 0) AS real_allocated_kmf,
      MAX(alc.created_at) AS last_real_allocation_at
    FROM order_item_real_cost_allocations alc
    JOIN order_items oi ON oi.id = alc.order_item_id
    JOIN orders o ON o.id = alc.order_id
    WHERE oi.product_id = $1::uuid
      ${realScope.sql}
  `, [productId, ...realScope.params]);

  const suppliersPromise = includeCentral
    ? db.query(`
        SELECT
          s.name AS supplier_name,
          s.platform,
          ps.supplier_sku,
          ps.supplier_url,
          ps.supplier_price_aed,
          ps.min_order_qty,
          ps.priority,
          ps.is_active,
          ps.last_checked_at,
          ps.notes
        FROM product_suppliers ps
        JOIN suppliers s ON s.id = ps.supplier_id
        WHERE ps.product_id = $1::uuid
          AND ps.deleted_at IS NULL
          AND s.deleted_at IS NULL
        ORDER BY ps.is_active DESC, ps.priority ASC, s.name ASC
      `, [productId])
    : Promise.resolve({ rows: [] });

  const priceAuditPromise = includeCentral
    ? db.query(`
        SELECT
          ph.old_price_kmf,
          ph.new_price_kmf,
          ph.source,
          ph.applied_at,
          u.full_name AS applied_by_name
        FROM price_history ph
        LEFT JOIN users u ON u.id = ph.applied_by
        WHERE ph.product_id = $1::uuid
        ORDER BY ph.applied_at DESC
        LIMIT 50
      `, [productId])
    : Promise.resolve({ rows: [] });

  const stockAuditPromise = includeCentral
    ? db.query(`
        SELECT severity, created_at, resolved_at
        FROM alerts
        WHERE entity_type = 'product'
          AND entity_id = $1::uuid
          AND type = 'product_stock_audit'
        ORDER BY created_at DESC
        LIMIT 50
      `, [productId])
    : Promise.resolve({ rows: [] });

  const [variantsResult, skusResult, performanceResult, economicsResult, realCostsResult,
    suppliersResult, priceAuditResult, stockAuditResult] = await Promise.all([
    variantsPromise,
    skusPromise,
    performancePromise,
    economicsPromise,
    realCostsPromise,
    suppliersPromise,
    priceAuditPromise,
    stockAuditPromise,
  ]);

  const variants = variantsResult.rows.map(row => Object.freeze({
    variant_type: row.variant_type,
    variant_value: row.variant_value,
    sku: row.sku || null,
    stock: Number(row.stock) || 0,
    price_kmf: row.price_kmf == null ? null : Number(row.price_kmf),
    image_url: row.image_url || null,
    display_order: Number(row.display_order) || 0,
  }));

  const skus = skusResult.rows.map(row => Object.freeze({
    sku: row.sku || null,
    variant_combo: row.variant_combo || null,
    stock: Number(row.stock) || 0,
    price_kmf: row.price_kmf == null ? null : Number(row.price_kmf),
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  const inventoryModel = product.inventory_model || 'LEGACY_VARIANTS';
  // Le modèle est l'autorité. En LEGACY_VARIANTS, les lignes de variantes
  // décrivent des axes historiques et ne constituent pas nécessairement des
  // unités vendables combinatoires : les additionner peut doubler le stock.
  const stockTotal = inventoryModel === 'SKU'
    ? skus.filter(row => row.is_active).reduce((sum, row) => sum + row.stock, 0)
    : (Number(product.stock) || 0);

  const performance = performanceResult.rows.map(row => Object.freeze({
    market: Object.freeze({ code: row.code || null, name: row.name || null, currency: row.currency || null }),
    orders_count: Number(row.orders_count) || 0,
    quantity_sold: Number(row.quantity_sold) || 0,
    revenue_kmf: Number(row.revenue_kmf) || 0,
    customers_count: Number(row.customers_count) || 0,
    last_order_at: row.last_order_at || null,
  }));

  // Les clients distincts restent une mesure PAR MARCHÉ. Les additionner au
  // niveau consolidé compterait deux fois un même client ayant acheté sur deux
  // marchés. Product 360 n'invente donc pas de total cross-market.
  const summary = performance.reduce((acc, row) => {
    acc.orders_count += row.orders_count;
    acc.quantity_sold += row.quantity_sold;
    acc.revenue_kmf += row.revenue_kmf;
    return acc;
  }, { orders_count: 0, quantity_sold: 0, revenue_kmf: 0 });

  const e = economicsResult.rows[0] || {};
  const r = realCostsResult.rows[0] || {};

  const suppliers = suppliersResult.rows.map(row => Object.freeze({
    name: row.supplier_name,
    platform: row.platform,
    supplier_sku: row.supplier_sku,
    supplier_url: row.supplier_url || null,
    supplier_price_aed: Number(row.supplier_price_aed) || 0,
    min_order_qty: Number(row.min_order_qty) || 1,
    priority: Number(row.priority) || 1,
    is_active: Boolean(row.is_active),
    last_checked_at: row.last_checked_at || null,
    notes: row.notes || null,
  }));

  const priceHistory = priceAuditResult.rows.map(row => Object.freeze({
    old_price_kmf: row.old_price_kmf == null ? null : Number(row.old_price_kmf),
    new_price_kmf: row.new_price_kmf == null ? null : Number(row.new_price_kmf),
    source: row.source || null,
    applied_at: row.applied_at,
    applied_by: row.applied_by_name || null,
  }));

  const stockHistory = stockAuditResult.rows.map(row => Object.freeze({
    type: 'stock_change',
    severity: row.severity || 'low',
    occurred_at: row.created_at,
    resolved_at: row.resolved_at || null,
  }));

  const timeline = [];
  timeline.push(Object.freeze({
    type: 'catalog',
    occurred_at: product.created_at,
    title: 'Produit créé',
    detail: product.product_ref,
  }));
  if (product.updated_at && String(product.updated_at) !== String(product.created_at)) {
    timeline.push(Object.freeze({
      type: 'catalog',
      occurred_at: product.updated_at,
      title: 'Produit mis à jour',
      detail: product.lifecycle_status || null,
    }));
  }
  priceHistory.forEach(row => timeline.push(Object.freeze({
    type: 'price',
    occurred_at: row.applied_at,
    title: 'Prix modifié',
    detail: [
      row.source,
      row.old_price_kmf == null ? null : `${row.old_price_kmf} → ${row.new_price_kmf} KMF`,
      row.applied_by,
    ].filter(Boolean).join(' · '),
  })));
  stockHistory.forEach(row => timeline.push(Object.freeze({
    type: 'stock',
    occurred_at: row.occurred_at,
    title: 'Stock modifié',
    detail: 'Audit catalogue',
  })));
  timeline.sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0));

  return Object.freeze({
    product: publicIdentity(product),
    scope: buildScope(mode, performance.map(row => row.market)),
    summary: Object.freeze({
      ...summary,
      stock_total: stockTotal,
      variants: variants.length,
      skus: skus.length,
      suppliers: suppliers.length,
    }),
    inventory: Object.freeze({
      model: inventoryModel,
      stock_total: stockTotal,
      legacy_base_stock: Number(product.stock) || 0,
      variants: Object.freeze(variants),
      skus: Object.freeze(skus),
    }),
    performance: Object.freeze(performance),
    economics: Object.freeze({
      imputation_lines: Number(e.imputation_lines) || 0,
      quantity_costed: Number(e.quantity_costed) || 0,
      revenue_costed_kmf: Number(e.revenue_costed_kmf) || 0,
      estimated_landed_kmf: Number(e.estimated_landed_kmf) || 0,
      estimated_business_kmf: Number(e.estimated_business_kmf) || 0,
      estimated_margin_kmf: Number(e.estimated_margin_kmf) || 0,
      avg_estimated_margin_pct: e.avg_estimated_margin_pct == null ? null : Number(e.avg_estimated_margin_pct),
      last_imputation_at: e.last_imputation_at || null,
      real_allocations_count: Number(r.allocations_count) || 0,
      real_lines_covered: Number(r.lines_with_real_cost) || 0,
      real_allocated_kmf: Number(r.real_allocated_kmf) || 0,
      last_real_allocation_at: r.last_real_allocation_at || null,
      doctrine: 'persisted_cost_truth_only',
    }),
    central: includeCentral
      ? Object.freeze({
          visibility: 'global',
          catalog_provenance: Object.freeze({
            content_source: product.content_source || null,
            enrichment_version: product.enrichment_version || null,
            sourcing_source: product.sourcing_source || null,
          }),
          suppliers: Object.freeze(suppliers),
          price_history: Object.freeze(priceHistory),
          stock_audit_count: stockHistory.length,
        })
      : Object.freeze({ visibility: 'restricted' }),
    timeline: Object.freeze(timeline.slice(0, 100)),
    data_quality: Object.freeze({
      generated_at: new Date().toISOString(),
      scope_mode: mode,
      central_scope: includeCentral ? 'global' : 'restricted',
      stock_truth: inventoryModel === 'SKU' ? 'product_skus' : 'products.stock',
      legacy_variant_stock_rule: inventoryModel === 'SKU' ? null : 'variant_rows_not_summed',
      cross_market_customer_rule: 'customers_count_is_per_market_only',
      cost_truth: 'order_item_cost_imputations + order_item_real_cost_allocations',
      source_tables: Object.freeze([
        'products', 'product_variants', 'product_skus', 'order_items', 'orders', 'markets',
        'order_item_cost_imputations', 'order_item_real_cost_allocations',
        'product_suppliers', 'suppliers', 'price_history', 'alerts', 'users',
      ]),
    }),
  });
}

module.exports = {
  PRODUCT_REF,
  normalizeProductRef,
  marketFilter,
  resolveProduct,
  publicIdentity,
  loadProduct360,
};
