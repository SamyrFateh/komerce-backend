/**
 * @komerce-arch
 * @role          economic-engine-admin-costing
 * @domain        economic-engine
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       customs_shipments, finance_config, order_item_cost_imputations, order_item_real_cost_allocations, order_items, orders, parcels, products, relais
 * @db-write      finance_config
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine, admin-dashboard
 * @version       2026-06
 */

/**
 * KOMERCE — Routes admin /api/admin/costing (D-FULL)
 * ════════════════════════════════════════════════════════════════════════
 *
 * D-FULL : endpoints enrichis avec estimé + réel + variance + cost_status.
 *
 * 4 endpoints (admin only) :
 *   GET /api/admin/costing/orders                 - liste avec marge estimée + réelle
 *   GET /api/admin/costing/orders/:orderId        - détail complet (delegue a getOrderCostTruth)
 *   GET /api/admin/costing/products               - agrégé par produit
 *   GET /api/admin/costing/relais                 - agrégé par relais
 *
 * BONUS endpoints D-full :
 *   POST /api/admin/costing/shipments/:id/allocate    - declenche reventilation shipment
 *   POST /api/admin/costing/parcels/:id/allocate      - declenche reventilation parcel
 *   GET  /api/admin/costing/recalibration-proposal    - proposition de recalibrage moyennes
 *   POST /api/admin/costing/recalibration-apply       - applique apres validation
 *   POST /api/admin/costing/monthly-fixed/:yearMonth  - alloue les fixes mensuels
 *
 * Doctrine "verite economique" :
 *   - cost_status indique TOUJOURS la qualite des donnees
 *   - missing_cost_fields liste les couts non encore alloues
 *   - real.margin_kmf est NULL tant que cost_status != 'actual'
 *   - on n'affiche JAMAIS un 0 pour un cout manquant
 */

'use strict';

const express = require('express');
const db = require('../db');
const costAllocation = require('../services/cost-allocation');
const dashboardCache = require('../services/dashboard-cache');
const { authenticate, requireAdmin } = require('../middleware/auth');
const log = require('../utils/logger').child({ module: 'admin-costing' });

const router = express.Router();

function _round(n) { return n != null && !isNaN(n) ? Math.round(Number(n)) : null; }
function _pct(n) { return n != null && !isNaN(n) ? Number(Number(n).toFixed(2)) : null; }

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/costing/orders
// ═══════════════════════════════════════════════════════════════════════
router.get('/orders', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const limit  = Math.min(200, parseInt(req.query.limit, 10)  || 50);
    const offset = Math.max(0,  parseInt(req.query.offset, 10) || 0);
    const status = req.query.status || null;
    const fromDate = req.query.from || null;
    const toDate   = req.query.to   || null;

    const where = ['1=1'];
    const params = [];
    let i = 1;
    if (status)   { where.push(`o.status = $${i++}`); params.push(status); }
    if (fromDate) { where.push(`o.created_at >= $${i++}`); params.push(fromDate); }
    if (toDate)   { where.push(`o.created_at <= $${i++}`); params.push(toDate); }
    params.push(limit); const limitIdx = i++;
    params.push(offset); const offsetIdx = i++;

    const sql = `
      SELECT
        o.id, o.reference, o.status, o.payment_status,
        o.total_kmf, o.relais_id, r.name AS relais_name,
        o.destination_island, o.created_at,
        (SELECT SUM(estimated_landed_relay_cost_kmf)
         FROM order_item_cost_imputations WHERE order_id = o.id) AS est_landed,
        (SELECT SUM(estimated_business_complete_cost_kmf)
         FROM order_item_cost_imputations WHERE order_id = o.id) AS est_business,
        (SELECT COUNT(*)
         FROM order_item_cost_imputations WHERE order_id = o.id) AS imputations_count,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS items_count,
        (SELECT SUM(amount_kmf)
         FROM order_item_real_cost_allocations WHERE order_id = o.id) AS real_total
      FROM orders o
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE ${where.join(' AND ')}
      ORDER BY o.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;
    const { rows } = await db.query(sql, params);

    // Enrichissement par appel a getOrderCostTruth pour les details (heavyweight,
    // donc on ne le fait QUE pour les 50 commandes affichees ; pas pour count).
    // Pour la liste, on utilise les agregats SQL directs et on appelle truth seulement
    // pour les commandes ou on a du reel (eviter le N+1 quand 100% provisional)
    const orders = await Promise.all(rows.map(async o => {
      const sale = Number(o.total_kmf) || 0;
      const estB = o.est_business != null ? Number(o.est_business) : null;
      const estL = o.est_landed != null ? Number(o.est_landed) : null;
      const realTotal = o.real_total != null ? Number(o.real_total) : null;

      const estMargin = (estB != null) ? (sale - estB) : null;
      const estMarginPct = (estMargin != null && sale > 0) ? Number(((estMargin / sale) * 100).toFixed(2)) : null;

      const hasImputations = Number(o.imputations_count) > 0;
      const itemsCount = Number(o.items_count);
      const allItemsImputed = hasImputations && Number(o.imputations_count) === itemsCount;
      const hasReal = realTotal != null && realTotal > 0;

      // Pour cost_status precis on appelle getOrderCostTruth uniquement si reel present
      let costStatus = !hasImputations
        ? 'incomplete'
        : (hasReal ? 'partial_real' : 'estimated');
      let missingFields = !hasImputations
        ? ['cost_imputations']
        : (hasReal ? ['fixed_overhead', 'payment'] : ['real_costs']);

      let realData = null;
      let variance = null;

      if (hasReal && allItemsImputed) {
        const truth = await costAllocation.getOrderCostTruth(o.id);
        if (truth) {
          costStatus = truth.cost_status;
          missingFields = truth.missing_cost_fields;
          realData = truth.real;
          variance = truth.variance;
        }
      }

      return {
        order_id: o.id,
        reference: o.reference,
        status: o.status,
        payment_status: o.payment_status,
        relais_id: o.relais_id,
        relais_name: o.relais_name,
        destination_island: o.destination_island,
        created_at: o.created_at,
        sale_total_kmf: _round(sale),
        estimated: {
          landed_relay_cost_kmf: _round(estL),
          business_complete_cost_kmf: _round(estB),
          margin_kmf: _round(estMargin),
          margin_pct: estMarginPct,
        },
        real: realData || (hasReal ? {
          total_kmf: _round(realTotal),
          margin_kmf: null,
          margin_pct: null,
          by_cost_type: {},
        } : null),
        variance,
        cost_status: costStatus,
        missing_cost_fields: missingFields,
      };
    }));

    const countSql = `SELECT COUNT(*) FROM orders o WHERE ${where.join(' AND ')}`;
    const countRes = await db.query(countSql, params.slice(0, -2));

    res.json({
      orders,
      pagination: { total: Number(countRes.rows[0].count), limit, offset },
      doctrine_phase: 'D-full',
    });
  } catch (err) {
    log.error('[admin-costing] GET /orders error:', err);
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/costing/orders/:orderId — verite complete
// Delegue a costAllocation.getOrderCostTruth + items details
// ═══════════════════════════════════════════════════════════════════════
router.get('/orders/:orderId', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const truth = await costAllocation.getOrderCostTruth(orderId);
    if (!truth) return res.status(404).json({ error: 'Commande introuvable' });

    // Charger les details order_items pour le breakdown
    const itemsRes = await db.query(
      `SELECT
         oi.id AS order_item_id, oi.product_id, oi.quantity, oi.price_kmf,
         p.name AS product_name, p.category,
         imp.id AS imputation_id,
         imp.estimated_landed_relay_cost_kmf,
         imp.estimated_business_complete_cost_kmf,
         imp.estimated_margin_kmf, imp.estimated_margin_pct,
         imp.cost_breakdown, imp.allocations, imp.allocation_averages,
         imp.allocation_confidence, imp.data_quality, imp.pricing_source
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN order_item_cost_imputations imp ON imp.order_item_id = oi.id
       WHERE oi.order_id = $1
       ORDER BY oi.created_at`,
      [orderId]
    );

    // Charger les real allocations par order_item
    const allocsRes = await db.query(
      `SELECT order_item_id, cost_type, amount_kmf, allocation_method,
              source, is_actual, confidence, parcel_id, shipment_id
       FROM order_item_real_cost_allocations
       WHERE order_id = $1
       ORDER BY created_at`,
      [orderId]
    );

    const allocsByItem = {};
    for (const a of allocsRes.rows) {
      if (!allocsByItem[a.order_item_id]) allocsByItem[a.order_item_id] = [];
      allocsByItem[a.order_item_id].push({
        cost_type: a.cost_type,
        amount_kmf: _round(a.amount_kmf),
        allocation_method: a.allocation_method,
        source: a.source,
        is_actual: a.is_actual,
        confidence: a.confidence,
        parcel_id: a.parcel_id,
        shipment_id: a.shipment_id,
      });
    }

    const items = itemsRes.rows.map(it => {
      const realAllocs = allocsByItem[it.order_item_id] || [];
      const realTotal = realAllocs.reduce((s, a) => s + Number(a.amount_kmf), 0);
      const estTotal = Number(it.estimated_business_complete_cost_kmf) || 0;
      const variance = realTotal > 0 && estTotal > 0 ? Math.round(realTotal - estTotal) : null;

      return {
        order_item_id: it.order_item_id,
        product_id: it.product_id,
        product_name: it.product_name,
        category: it.category,
        quantity: it.quantity,
        sale_unit_price_kmf: _round(it.price_kmf),
        sale_total_kmf: _round(Number(it.price_kmf) * it.quantity),
        estimated: it.imputation_id ? {
          landed_relay_cost_kmf: _round(it.estimated_landed_relay_cost_kmf),
          business_complete_cost_kmf: _round(it.estimated_business_complete_cost_kmf),
          margin_kmf: _round(it.estimated_margin_kmf),
          margin_pct: it.estimated_margin_pct != null ? Number(it.estimated_margin_pct) : null,
          cost_breakdown: it.cost_breakdown,
          allocations: it.allocations,
          allocation_averages: it.allocation_averages,
          allocation_confidence: it.allocation_confidence,
          data_quality: it.data_quality,
          pricing_source: it.pricing_source,
        } : null,
        real_allocations: realAllocs,
        real_total_kmf: realTotal > 0 ? _round(realTotal) : null,
        variance_kmf: variance,
      };
    });

    res.json({
      ...truth,
      items,
      doctrine_phase: 'D-full',
    });
  } catch (err) {
    log.error('[admin-costing] GET /orders/:id error:', err);
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/costing/products
// ═══════════════════════════════════════════════════════════════════════
router.get('/products', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 100);
    const fromDate = req.query.from || null;
    const toDate   = req.query.to   || null;

    const where = ['imp.estimated_business_complete_cost_kmf IS NOT NULL'];
    const params = [];
    let i = 1;
    if (fromDate) { where.push(`imp.created_at >= $${i++}`); params.push(fromDate); }
    if (toDate)   { where.push(`imp.created_at <= $${i++}`); params.push(toDate); }
    params.push(limit); const limitIdx = i++;

    const sql = `
      SELECT
        imp.product_id,
        p.name AS product_name,
        p.category,
        SUM(imp.quantity)::int             AS quantity_sold,
        SUM(imp.sale_total_kmf)            AS revenue_kmf,
        AVG(imp.sale_unit_price_kmf)       AS avg_unit_price_kmf,
        SUM(imp.estimated_landed_relay_cost_kmf)      AS total_estimated_landed_kmf,
        SUM(imp.estimated_business_complete_cost_kmf) AS total_estimated_business_kmf,
        AVG(imp.estimated_margin_pct)      AS avg_estimated_margin_pct,
        COALESCE((
          SELECT SUM(alc.amount_kmf)
          FROM order_item_real_cost_allocations alc
          JOIN order_items oi ON oi.id = alc.order_item_id
          WHERE oi.product_id = imp.product_id
        ), 0) AS total_real_kmf,
        COUNT(DISTINCT imp.order_id)::int AS orders_count
      FROM order_item_cost_imputations imp
      LEFT JOIN products p ON p.id = imp.product_id
      WHERE ${where.join(' AND ')}
      GROUP BY imp.product_id, p.name, p.category
      ORDER BY total_estimated_business_kmf DESC NULLS LAST
      LIMIT $${limitIdx}
    `;
    const { rows } = await db.query(sql, params);

    res.json({
      products: rows.map(r => {
        const revenue = Number(r.revenue_kmf) || 0;
        const estB = Number(r.total_estimated_business_kmf) || 0;
        const real = Number(r.total_real_kmf) || 0;
        const estMargin = revenue - estB;
        const realMargin = real > 0 && estB > 0 && real >= estB * 0.5
          ? revenue - real  // n'affiche real margin que si real est plausible
          : null;
        return {
          product_id: r.product_id,
          product_name: r.product_name,
          category: r.category,
          quantity_sold: r.quantity_sold,
          orders_count: r.orders_count,
          revenue_kmf: _round(revenue),
          avg_unit_price_kmf: _round(r.avg_unit_price_kmf),
          estimated: {
            total_landed_kmf: _round(r.total_estimated_landed_kmf),
            total_business_kmf: _round(estB),
            margin_kmf: _round(estMargin),
            avg_margin_pct: _pct(r.avg_estimated_margin_pct),
          },
          real: real > 0 ? {
            total_kmf: _round(real),
            margin_kmf: realMargin != null ? _round(realMargin) : null,
            margin_pct: realMargin != null && revenue > 0 ? Number(((realMargin / revenue) * 100).toFixed(2)) : null,
          } : null,
          variance: real > 0 && estB > 0 ? {
            total_kmf: _round(real - estB),
            total_pct: Number((((real - estB) / estB) * 100).toFixed(2)),
          } : null,
          cost_status: real > 0 ? 'partial_real' : 'estimated',
        };
      }),
      doctrine_phase: 'D-full',
    });
  } catch (err) {
    log.error('[admin-costing] GET /products error:', err);
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/costing/relais
// ═══════════════════════════════════════════════════════════════════════
router.get('/relais', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const fromDate = req.query.from || null;
    const toDate   = req.query.to   || null;

    const where = ['o.relais_id IS NOT NULL'];
    const params = [];
    let i = 1;
    if (fromDate) { where.push(`o.created_at >= $${i++}`); params.push(fromDate); }
    if (toDate)   { where.push(`o.created_at <= $${i++}`); params.push(toDate); }

    const sql = `
      SELECT
        o.relais_id, r.name AS relais_name,
        COUNT(DISTINCT o.id)::int  AS orders_count,
        SUM(o.total_kmf)::int      AS revenue_kmf,
        SUM(imp_agg.sum_landed)    AS total_estimated_landed_kmf,
        SUM(imp_agg.sum_business)  AS total_estimated_business_kmf,
        SUM(real_agg.sum_real)     AS total_real_kmf,
        COUNT(*) FILTER (
          WHERE imp_agg.imp_count IS NULL OR imp_agg.imp_count < imp_agg.items_count
        )::int AS incomplete_imputations_count,
        COUNT(*) FILTER (
          WHERE real_agg.real_count IS NULL OR real_agg.real_count = 0
        )::int AS no_real_cost_count
      FROM orders o
      LEFT JOIN relais r ON r.id = o.relais_id
      LEFT JOIN LATERAL (
        SELECT
          SUM(imp.estimated_landed_relay_cost_kmf)      AS sum_landed,
          SUM(imp.estimated_business_complete_cost_kmf) AS sum_business,
          COUNT(imp.id)::int AS imp_count,
          (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS items_count
        FROM order_item_cost_imputations imp WHERE imp.order_id = o.id
      ) imp_agg ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(amount_kmf) AS sum_real, COUNT(*)::int AS real_count
        FROM order_item_real_cost_allocations WHERE order_id = o.id
      ) real_agg ON TRUE
      WHERE ${where.join(' AND ')}
      GROUP BY o.relais_id, r.name
      ORDER BY revenue_kmf DESC NULLS LAST
    `;
    const { rows } = await db.query(sql, params);

    res.json({
      relais: rows.map(r => {
        const revenue = Number(r.revenue_kmf) || 0;
        const estB = Number(r.total_estimated_business_kmf) || 0;
        const real = Number(r.total_real_kmf) || 0;
        const estMargin = estB > 0 ? revenue - estB : null;
        return {
          relais_id: r.relais_id,
          relais_name: r.relais_name,
          orders_count: r.orders_count,
          revenue_kmf: _round(revenue),
          estimated: {
            landed_cost_kmf: _round(r.total_estimated_landed_kmf),
            business_cost_kmf: _round(estB),
            margin_kmf: _round(estMargin),
            margin_pct: estMargin != null && revenue > 0
              ? Number(((estMargin / revenue) * 100).toFixed(2))
              : null,
          },
          real: real > 0 ? {
            total_kmf: _round(real),
          } : null,
          variance: real > 0 && estB > 0 ? {
            total_kmf: _round(real - estB),
            total_pct: Number((((real - estB) / estB) * 100).toFixed(2)),
          } : null,
          incomplete_imputations_count: r.incomplete_imputations_count,
          no_real_cost_count: r.no_real_cost_count,
        };
      }),
      doctrine_phase: 'D-full',
    });
  } catch (err) {
    log.error('[admin-costing] GET /relais error:', err);
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/admin/costing/shipments/:id/allocate — declenche reventilation
// ═══════════════════════════════════════════════════════════════════════
router.post('/shipments/:id/allocate', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const result = await costAllocation.allocateShipmentRealCosts(req.params.id);
    dashboardCache.invalidateAllDashboards();   // ← Sprint 1 : auto-invalidation
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('[admin-costing] POST /shipments/:id/allocate error:', err);
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/admin/costing/parcels/:id/allocate — distribution + relay
// ═══════════════════════════════════════════════════════════════════════
router.post('/parcels/:id/allocate', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const result = await costAllocation.allocateParcelRealCosts(req.params.id);
    dashboardCache.invalidateAllDashboards();
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('[admin-costing] POST /parcels/:id/allocate error:', err);
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/admin/costing/orders/:id/lock-purchase — alloue achat AED
// ═══════════════════════════════════════════════════════════════════════
router.post('/orders/:id/lock-purchase', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const result = await costAllocation.allocateProductPurchaseCosts(req.params.id);
    dashboardCache.invalidateAllDashboards();
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('[admin-costing] POST /orders/:id/lock-purchase error:', err);
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/admin/costing/monthly-fixed/:yearMonth — alloue les fixes
// Body: { dryRun?: boolean }
// ═══════════════════════════════════════════════════════════════════════
router.post('/monthly-fixed/:yearMonth', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { yearMonth } = req.params;
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      return res.status(400).json({ error: 'yearMonth doit être au format YYYY-MM' });
    }
    const dryRun = !!(req.body && req.body.dryRun);
    const result = await costAllocation.allocateMonthlyFixedCosts(yearMonth, { dryRun });
    if (!dryRun) dashboardCache.invalidateAllDashboards();   // dryRun ne change rien
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('[admin-costing] POST /monthly-fixed error:', err);
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// PHASE E — Recalibrage des moyennes d'allocation
// ═══════════════════════════════════════════════════════════════════════

// GET /api/admin/costing/recalibration-proposal
// Calcule une proposition basee sur les 90 derniers jours (PROPOSE seulement, n'applique pas)
router.get('/recalibration-proposal', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const daysParam = parseInt(req.query.days, 10);
    const periodDays = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 90;

    // Periode
    const sinceDate = new Date(Date.now() - periodDays * 86400000).toISOString().slice(0, 10);

    // Compter
    const r = await db.query(
      `SELECT
         COUNT(DISTINCT o.id)::int                     AS orders_count,
         COUNT(oi.id)::int                              AS items_count,
         (SELECT COUNT(DISTINCT id)::int FROM parcels   WHERE created_at >= $1) AS parcels_count,
         (SELECT COUNT(DISTINCT id)::int FROM customs_shipments WHERE created_at >= $1) AS shipments_count
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.created_at >= $1
         AND o.status NOT IN ('cancelled', 'refunded')`,
      [sinceDate]
    );
    const data = r.rows[0];

    // Etat actuel
    const currentRes = await db.query(
      `SELECT
         avg_articles_per_order, avg_articles_per_parcel,
         avg_articles_per_shipment, avg_orders_per_month,
         allocation_confidence, allocation_calibrated_at, allocation_notes
       FROM finance_config LIMIT 1`
    );
    const current = currentRes.rows[0] || {};

    // Calculs proposes
    const ordersCount = Number(data.orders_count) || 0;
    const itemsCount = Number(data.items_count) || 0;
    const parcelsCount = Number(data.parcels_count) || 0;
    const shipmentsCount = Number(data.shipments_count) || 0;

    const avgArticlesPerOrder    = ordersCount > 0    ? Number((itemsCount / ordersCount).toFixed(2))    : null;
    const avgArticlesPerParcel   = parcelsCount > 0   ? Number((itemsCount / parcelsCount).toFixed(2))   : null;
    const avgArticlesPerShipment = shipmentsCount > 0 ? Number((itemsCount / shipmentsCount).toFixed(2)) : null;
    const avgOrdersPerMonth      = Number((ordersCount / (periodDays / 30)).toFixed(2));

    // Confidence base sur le volume
    let confidence = 'low';
    if (ordersCount >= 200 && parcelsCount >= 30 && shipmentsCount >= 5) confidence = 'high';
    else if (ordersCount >= 50 && parcelsCount >= 10) confidence = 'medium';

    res.json({
      based_on: {
        period_days: periodDays,
        since: sinceDate,
        orders_count: ordersCount,
        items_count: itemsCount,
        parcels_count: parcelsCount,
        shipments_count: shipmentsCount,
      },
      current: {
        avg_articles_per_order:    Number(current.avg_articles_per_order),
        avg_articles_per_parcel:   Number(current.avg_articles_per_parcel),
        avg_articles_per_shipment: Number(current.avg_articles_per_shipment),
        avg_orders_per_month:      Number(current.avg_orders_per_month),
        allocation_confidence:     current.allocation_confidence,
        allocation_calibrated_at:  current.allocation_calibrated_at,
        allocation_notes:          current.allocation_notes,
      },
      proposal: {
        avg_articles_per_order:    avgArticlesPerOrder,
        avg_articles_per_parcel:   avgArticlesPerParcel,
        avg_articles_per_shipment: avgArticlesPerShipment,
        avg_orders_per_month:      avgOrdersPerMonth,
        allocation_confidence:     confidence,
      },
      delta: {
        avg_articles_per_order:    avgArticlesPerOrder    != null ? Number((avgArticlesPerOrder    - Number(current.avg_articles_per_order || 0)).toFixed(2)) : null,
        avg_articles_per_parcel:   avgArticlesPerParcel   != null ? Number((avgArticlesPerParcel   - Number(current.avg_articles_per_parcel || 0)).toFixed(2)) : null,
        avg_articles_per_shipment: avgArticlesPerShipment != null ? Number((avgArticlesPerShipment - Number(current.avg_articles_per_shipment || 0)).toFixed(2)) : null,
        avg_orders_per_month:      Number((avgOrdersPerMonth - Number(current.avg_orders_per_month || 0)).toFixed(2)),
      },
      notes: 'Validation admin requise. POST /api/admin/costing/recalibration-apply pour appliquer.',
    });
  } catch (err) {
    log.error('[admin-costing] GET /recalibration-proposal error:', err);
    next(err);
  }
});

// POST /api/admin/costing/recalibration-apply
// Body: { avg_articles_per_order, avg_articles_per_parcel, avg_articles_per_shipment, avg_orders_per_month, allocation_confidence, allocation_notes }
router.post('/recalibration-apply', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const {
      avg_articles_per_order,
      avg_articles_per_parcel,
      avg_articles_per_shipment,
      avg_orders_per_month,
      allocation_confidence,
      allocation_notes,
    } = req.body || {};

    // Validation basique
    const FINANCE_CONFIG_NUMERIC_COLS = ['avg_articles_per_order', 'avg_articles_per_parcel', 'avg_articles_per_shipment', 'avg_orders_per_month']; // AUD-07
    const fields = { avg_articles_per_order, avg_articles_per_parcel, avg_articles_per_shipment, avg_orders_per_month };
    const updates = [];
    const params = [];
    let i = 1;
    for (const [key, value] of Object.entries(fields)) {
      if (!FINANCE_CONFIG_NUMERIC_COLS.includes(key)) continue; // AUD-07: allowlist guard
      if (value != null && Number.isFinite(Number(value)) && Number(value) > 0) {
        updates.push(`${key} = $${i++}`);
        params.push(Number(value));
      }
    }
    if (allocation_confidence && ['low', 'medium', 'high'].includes(allocation_confidence)) {
      updates.push(`allocation_confidence = $${i++}`);
      params.push(allocation_confidence);
    }
    if (allocation_notes != null) {
      updates.push(`allocation_notes = $${i++}`);
      params.push(String(allocation_notes));
    }
    updates.push(`allocation_calibrated_at = NOW()`);

    if (updates.length === 1) {
      return res.status(400).json({ error: 'Aucun champ valide a appliquer' });
    }

    await db.query(`UPDATE finance_config SET ${updates.join(', ')} WHERE id = (SELECT id FROM finance_config ORDER BY id LIMIT 1)`, params); // AUD-07: updates[] contains allowlisted column names; values remain bound in params

    const r = await db.query(`SELECT
      avg_articles_per_order, avg_articles_per_parcel,
      avg_articles_per_shipment, avg_orders_per_month,
      allocation_confidence, allocation_calibrated_at, allocation_notes
      FROM finance_config LIMIT 1`);

    dashboardCache.invalidateAllDashboards();
    res.json({ ok: true, applied: r.rows[0] });
  } catch (err) {
    log.error('[admin-costing] POST /recalibration-apply error:', err);
    next(err);
  }
});

module.exports = router;
