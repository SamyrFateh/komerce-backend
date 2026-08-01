/**
 * @komerce-arch
 * @role          dashboard-admin-dashboard
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       customs_shipments, order_item_cost_imputations, order_item_real_cost_allocations, orders, parcels, relais, signals
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

/**
 * KOMERCE — Routes /api/admin/dashboard/* (Sprint 1)
 * ════════════════════════════════════════════════════════════════════════
 *
 * 4 endpoints agregateurs :
 *   GET /control-tower
 *   GET /costing
 *   GET /logistics
 *   GET /unified
 *
 * Plus :
 *   POST /cache/clear    invalidation manuelle (admin)
 *
 * DOCTRINE :
 *   - Tous les endpoints utilisent dashboard-metrics.js (source unique)
 *   - Cache 120s avec metadata is_cached / cache_age_seconds
 *   - Format de reponse standardise : kpis, charts, tables, alerts, drilldown_links, data_quality
 *   - Aucun SQL inline ici : delegate a metrics.js
 *   - PERF : tout en Promise.all — zero await sequentiel
 */

'use strict';

const express = require('express');
const db = require('../db');
const metrics = require('../services/dashboard-metrics');
const cache = require('../services/dashboard-cache');
const { authenticate, requireAdmin } = require('../middleware/auth');
const log = require('../utils/logger').child({ module: 'admin-dashboard' });

const router = express.Router();

// ─── Helpers ────────────────────────────────────────────────────────────

function parseFilters(req) {
  return {
    from: req.query.from || null,
    to: req.query.to || null,
    island: req.query.island || null,
    relais_id: req.query.relais_id || null,
    status: req.query.status || null,
    payment_status: req.query.payment_status || null,
    cost_status: req.query.cost_status || null,
    channel: req.query.channel || null,
    origin: req.query.origin || null,
  };
}

function makeDataQuality(filters, sourceTables, options = {}) {
  return {
    generated_at: new Date().toISOString(),
    cache_ttl_seconds: 120,
    filters,
    warnings: options.warnings || [],
    incomplete_fields: options.incompleteFields || [],
    source_tables: sourceTables,
    // is_cached et cache_age_seconds seront ajoutes par le middleware cache
  };
}

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/dashboard/control-tower
// ═══════════════════════════════════════════════════════════════════════
router.get(
  '/control-tower',
  authenticate, requireAdmin,
  cache.cacheMiddleware('control-tower'),
  async (req, res, next) => {
    try {
      const filters = parseFilters(req);

      // PERF : KPIs + charts + tables + alerts tous en parallele
      const [
        [
          caEncaisse, cmdsCreees, cmdsActives, colisTransit,
          alertesCritiques, cmdsBloquees, tauxScans, tauxCouts,
        ],
        charts,
        tables,
        alerts,
      ] = await Promise.all([
        Promise.all([
          metrics.getCAEncaisse(filters),
          metrics.getCmdsCreees(filters),
          metrics.getCmdsActives(filters),
          metrics.getColisEnTransit(filters),
          metrics.getAlertesCritiques(filters),
          metrics.getCmdsBloquees(filters),
          metrics.getTauxCompletudeScans(filters),
          metrics.getTauxCompletudeCouts(filters),
        ]),
        _buildControlTowerCharts(filters),
        _buildControlTowerTables(filters),
        _fetchTopAlerts(5),
      ]);

      // Warnings data_quality
      const warnings = [];
      if (tauxCouts.value != null && tauxCouts.value < 50) {
        warnings.push(`Couts incomplets : ${tauxCouts.value}% des commandes finalisees`);
      }
      if (cmdsBloquees.value > 0) {
        warnings.push(`${cmdsBloquees.value} commande(s) payee(s) avec stock bloque`);
      }

      res.json({
        kpis: [
          caEncaisse, cmdsCreees, cmdsActives, colisTransit,
          alertesCritiques, cmdsBloquees, tauxScans, tauxCouts,
        ],
        charts,
        tables,
        alerts,
        drilldown_links: {
          ca_encaisse: '/admin/costing',
          cmds_actives: '/admin/orders-logistics?status=active',
          colis_transit: '/admin/orders-logistics?parcel_status=in_transit',
          alertes_critiques: '/admin/alerts',
          cmds_bloquees: '/admin/orders-logistics?anomalie=stock_blocked',
          taux_completude_couts: '/admin/costing?cost_status=incomplete,partial_real,estimated',
        },
        data_quality: makeDataQuality(filters, [
          'orders', 'parcels', 'scan_events', 'signals',
          'order_item_cost_imputations', 'order_item_real_cost_allocations',
        ], { warnings }),
      });
    } catch (err) {
      log.error('[admin-dashboard] /control-tower error:', err);
      next(err);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/dashboard/costing
// ═══════════════════════════════════════════════════════════════════════
router.get(
  '/costing',
  authenticate, requireAdmin,
  cache.cacheMiddleware('costing'),
  async (req, res, next) => {
    try {
      const filters = parseFilters(req);

      // PERF : KPIs + charts + alerts tous en parallele
      const [
        [
          caVendu, coutEstime, coutReel,
          margeEstimee, margeVariableReelle, margeConsolidee,
          cmdsCoutIncomplet, coutMoy,
        ],
        charts,
        alerts,
      ] = await Promise.all([
        Promise.all([
          metrics.getCAVendu(filters),
          metrics.getCoutEstime(filters),
          metrics.getCoutReel(filters),
          metrics.getMargeEstimee(filters),
          metrics.getMargeVariableReelle(filters),
          metrics.getMargeConsolidee(filters),
          metrics.getCmdsCoutIncompletCount(filters),
          metrics.getCoutMoyParCmd(filters),
        ]),
        _buildCostingCharts(filters),
        _buildCostingAlerts(),
      ]);

      const warnings = [];
      if (margeConsolidee.data_quality.items_with_data === 0
          && margeConsolidee.data_quality.items_total > 0) {
        warnings.push('Aucune commande finalisee (cost_status=actual) — allouer fixes mensuels et frais paiement');
      }
      if (margeEstimee.data_quality.items_with_data < margeEstimee.data_quality.items_total) {
        const missing = margeEstimee.data_quality.items_total - margeEstimee.data_quality.items_with_data;
        warnings.push(`${missing} commande(s) sans snapshot pricing-engine`);
      }

      const incompleteFields = [];
      if (margeConsolidee.data_quality.items_with_data === 0) {
        incompleteFields.push('fixed_overhead', 'payment');
      }

      res.json({
        kpis: [
          caVendu, coutEstime, coutReel,
          margeEstimee, margeVariableReelle, margeConsolidee,
          cmdsCoutIncomplet, coutMoy,
        ],
        charts,
        tables: {},
        alerts,
        drilldown_links: {
          ca_vendu: '/admin/control-tower',
          cmds_cout_incomplet: '/admin/costing/orders?cost_status=incomplete,partial_real,estimated',
          marge_consolidee: '/admin/costing/orders?cost_status=actual',
        },
        data_quality: makeDataQuality(filters, [
          'orders', 'order_item_cost_imputations', 'order_item_real_cost_allocations',
        ], { warnings, incompleteFields }),
      });
    } catch (err) {
      log.error('[admin-dashboard] /costing error:', err);
      next(err);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/dashboard/logistics
// ═══════════════════════════════════════════════════════════════════════
router.get(
  '/logistics',
  authenticate, requireAdmin,
  cache.cacheMiddleware('logistics'),
  async (req, res, next) => {
    try {
      const filters = parseFilters(req);

      // PERF : KPIs + charts en parallele
      const [
        [
          cmdsAujourdhui, paiementsAttente, colisPrep, colisTransit,
          disponiblesRelais, retardsCrit, tauxScans, tauxCollecte,
        ],
        charts,
      ] = await Promise.all([
        Promise.all([
          metrics.getCmdsAujourdhui(filters),
          metrics.getPaiementsEnAttente(filters),
          metrics.getColisPreparation(filters),
          metrics.getColisEnTransit(filters),
          metrics.getDisponiblesRelais(filters),
          metrics.getRetardsCritiques(filters),
          metrics.getTauxCompletudeScans(filters),
          metrics.getTauxCollecteRelais(filters),
        ]),
        _buildLogisticsCharts(filters),
      ]);

      const warnings = [];
      if (retardsCrit.value > 0) {
        warnings.push(`${retardsCrit.value} colis en retard critique (>14 jours)`);
      }

      res.json({
        kpis: [
          cmdsAujourdhui, paiementsAttente, colisPrep, colisTransit,
          disponiblesRelais, retardsCrit, tauxScans, tauxCollecte,
        ],
        charts,
        tables: {},
        alerts: [],
        drilldown_links: {},
        data_quality: makeDataQuality(filters, ['orders', 'parcels', 'scan_events'], { warnings }),
      });
    } catch (err) {
      log.error('[admin-dashboard] /logistics error:', err);
      next(err);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/dashboard/unified
// ═══════════════════════════════════════════════════════════════════════
router.get(
  '/unified',
  authenticate, requireAdmin,
  cache.cacheMiddleware('unified'),
  async (req, res, next) => {
    try {
      const filters = parseFilters(req);

      // PERF : TOUS les 17 KPIs + alerts en UN SEUL Promise.all
      // Avant : 6 paralleles + 11 await sequentiels dans les array literals
      // Apres : 18 requetes 100% paralleles
      const [
        ca, cmdsActives, margeConsolidee, alertesCritiques, tauxCouts,
        coutReel, cmdsCoutIncomplet, coutMoyParCmd,
        cmdsAujourdhui, colisEnTransit, disponiblesRelais, retardsCritiques, tauxCompletudeScans,
        topAlerts,
      ] = await Promise.all([
        metrics.getCAEncaisse(filters),
        metrics.getCmdsActives(filters),
        metrics.getMargeConsolidee(filters),
        metrics.getAlertesCritiques(filters),
        metrics.getTauxCompletudeCouts(filters),
        metrics.getCoutReel(filters),
        metrics.getCmdsCoutIncompletCount(filters),
        metrics.getCoutMoyParCmd(filters),
        metrics.getCmdsAujourdhui(filters),
        metrics.getColisEnTransit(filters),
        metrics.getDisponiblesRelais(filters),
        metrics.getRetardsCritiques(filters),
        metrics.getTauxCompletudeScans(filters),
        _fetchTopAlerts(10),
      ]);

      // Resume par vue (5 KPIs chacune) — ZERO await ici
      const view_blocks = [
        {
          view: 'control_tower',
          title: 'Tour de contrôle',
          subtitle: 'Voir, comprendre, décider',
          url: '/admin/control-tower',
          kpis_summary: [ca, cmdsActives, alertesCritiques, margeConsolidee, tauxCouts],
        },
        {
          view: 'costing',
          title: 'Coût rendu relais',
          subtitle: 'Dire la vérité économique',
          url: '/admin/costing',
          kpis_summary: [ca, coutReel, margeConsolidee, cmdsCoutIncomplet, coutMoyParCmd],
        },
        {
          view: 'orders_logistics',
          title: 'Commandes & logistique',
          subtitle: 'Exécuter sans friction',
          url: '/admin/orders-logistics',
          kpis_summary: [cmdsAujourdhui, colisEnTransit, disponiblesRelais, retardsCritiques, tauxCompletudeScans],
        },
      ];

      const economic_flow = {
        stages: [
          { key: 'estimated_price', label: 'Prix estimé', url: '/admin/pricing' },
          { key: 'order', label: 'Commande', url: '/admin/orders-logistics' },
          { key: 'payment', label: 'Paiement', url: '/admin/orders-logistics?payment_status=paid' },
          { key: 'parcels_scans', label: 'Colis & scans', url: '/admin/orders-logistics?parcel_status=in_transit' },
          { key: 'real_cost', label: 'Coût réel reventilé', url: '/admin/costing' },
          { key: 'real_margin', label: 'Marge consolidée', url: '/admin/costing?cost_status=actual' },
          { key: 'recalibration', label: 'Recalibrage pricing', url: '/admin/costing/recalibration' },
        ],
      };

      const principles = [
        'Une seule source de vérité par KPI',
        'Pas de coût manquant à 0',
        'Pas de commande sans paiement sécurisé',
        'cost_status visible : estimated, partial_real, actual, incomplete',
        'Le dashboard doit aider à décider',
      ];

      res.json({
        kpis_global: [ca, cmdsActives, margeConsolidee, alertesCritiques, tauxCouts],
        view_blocks,
        economic_flow,
        principles,
        system_alerts: topAlerts,
        data_quality: makeDataQuality(filters, ['(toutes)']),
      });
    } catch (err) {
      log.error('[admin-dashboard] /unified error:', err);
      next(err);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════
// POST /api/admin/dashboard/cache/clear
// ═══════════════════════════════════════════════════════════════════════
router.post('/cache/clear', authenticate, requireAdmin, (req, res) => {
  const prefix = req.body && req.body.prefix ? String(req.body.prefix) : null;
  const cleared = cache.clear(prefix);
  res.json({ ok: true, cleared, prefix: prefix || 'all' });
});

// ═══════════════════════════════════════════════════════════════════════
// HELPERS internes pour charts/tables/alerts
// ═══════════════════════════════════════════════════════════════════════

async function _buildControlTowerCharts(filters) {
  const { where, params } = metrics.buildFiltersClause(filters);
  const sql = `
    SELECT DATE(o.created_at) AS day,
           COUNT(*)::int AS orders_count,
           COALESCE(SUM(o.total_kmf) FILTER (WHERE o.payment_status='paid'), 0)::bigint AS ca_kmf
    FROM orders o
    WHERE ${where}
    GROUP BY DATE(o.created_at)
    ORDER BY day
  `;
  const statusSql = `
    SELECT status, COUNT(*)::int AS count
    FROM orders o
    WHERE ${where}
    GROUP BY status
    ORDER BY count DESC
  `;

  const [r, sR] = await Promise.all([
    db.query(sql, params),
    db.query(statusSql, params),
  ]);

  const x = r.rows.map(row => row.day);
  const orders_series = r.rows.map(row => Number(row.orders_count));
  const ca_series = r.rows.map(row => Number(row.ca_kmf));
  const totalCount = sR.rows.reduce((s, r) => s + Number(r.count), 0);
  const status_breakdown = sR.rows.map(row => ({
    status: row.status,
    count: Number(row.count),
    pct: totalCount > 0 ? Number(((Number(row.count) / totalCount) * 100).toFixed(2)) : 0,
  }));

  return {
    activity_timeline: {
      type: 'multi-line',
      x,
      series: [
        { key: 'orders', label: 'Commandes', values: orders_series },
        { key: 'ca_kmf', label: 'CA (KMF)', values: ca_series },
      ],
    },
    status_breakdown: {
      type: 'donut',
      items: status_breakdown,
    },
  };
}

async function _buildControlTowerTables(filters) {
  const { where, params } = metrics.buildFiltersClause(filters);
  const sql = `
    SELECT o.id, o.reference, o.status, o.payment_status, o.total_kmf, o.created_at,
           o.relais_id, r.name AS relais_name
    FROM orders o
    LEFT JOIN relais r ON r.id = o.relais_id
    WHERE ${where}
      AND (o.payment_status = 'pending' OR o.notes ILIKE '%paid_but_stock_blocked%')
      AND o.status NOT IN ('cancelled', 'refunded', 'collected')
    ORDER BY o.created_at DESC
    LIMIT 10
  `;
  const relaisSql = `
    SELECT r.id AS relais_id, r.name AS relais_name,
      COUNT(DISTINCT o.id)::int AS orders_count,
      COUNT(DISTINCT p.id) FILTER (WHERE p.status='available')::int AS available,
      COUNT(DISTINCT p.id) FILTER (WHERE p.status='collected')::int AS collected,
      ROUND(
        100.0 * COUNT(DISTINCT p.id) FILTER (WHERE p.status='collected')
        / NULLIF(COUNT(DISTINCT p.id) FILTER (WHERE p.status IN ('available','collected')), 0),
        2
      ) AS taux_retrait_pct
    FROM relais r
    LEFT JOIN orders o ON o.relais_id = r.id AND o.created_at >= NOW() - INTERVAL '7 days'
    LEFT JOIN parcels p ON p.order_id = o.id
    GROUP BY r.id, r.name
    ORDER BY orders_count DESC NULLS LAST
    LIMIT 10
  `;

  const [r, relaisR] = await Promise.all([
    db.query(sql, params),
    db.query(relaisSql),
  ]);

  return {
    orders_to_handle: r.rows,
    relais_performance: relaisR.rows,
  };
}

async function _buildCostingCharts(filters) {
  const { where, params } = metrics.buildFiltersClause(filters);
  const sql = `
    WITH order_set AS (
      SELECT o.id, DATE(o.created_at) AS day, o.total_kmf, o.payment_status
      FROM orders o
      WHERE ${where}
    ),
    ca_by_day AS (
      SELECT
        day,
        COALESCE(SUM(total_kmf) FILTER (WHERE payment_status = 'paid'), 0)::bigint AS ca_kmf
      FROM order_set
      GROUP BY day
    ),
    est_by_day AS (
      SELECT
        os.day,
        COALESCE(SUM(imp.estimated_business_complete_cost_kmf), 0)::bigint AS cost_estimated_kmf
      FROM order_set os
      LEFT JOIN order_item_cost_imputations imp ON imp.order_id = os.id
      GROUP BY os.day
    ),
    real_by_day AS (
      SELECT
        os.day,
        COALESCE(SUM(alc.amount_kmf) FILTER (WHERE alc.is_actual = TRUE), 0)::bigint AS cost_real_kmf
      FROM order_set os
      LEFT JOIN order_item_real_cost_allocations alc ON alc.order_id = os.id
      GROUP BY os.day
    )
    SELECT
      ca.day,
      ca.ca_kmf,
      COALESCE(est.cost_estimated_kmf, 0)::bigint AS cost_estimated_kmf,
      COALESCE(real.cost_real_kmf, 0)::bigint AS cost_real_kmf
    FROM ca_by_day ca
    LEFT JOIN est_by_day est ON est.day = ca.day
    LEFT JOIN real_by_day real ON real.day = ca.day
    ORDER BY ca.day
  `;
  const familySql = `
    SELECT alc.cost_type, COALESCE(SUM(alc.amount_kmf), 0)::bigint AS amount_kmf
    FROM order_item_real_cost_allocations alc
    JOIN orders o ON o.id = alc.order_id
    WHERE ${where}
      AND alc.is_actual = TRUE
    GROUP BY alc.cost_type
    ORDER BY amount_kmf DESC
  `;

  const [r, fR] = await Promise.all([
    db.query(sql, params),
    db.query(familySql, params),
  ]);

  const total = fR.rows.reduce((s, r) => s + Number(r.amount_kmf), 0);

  return {
    ca_cost_margin_timeline: {
      type: 'multi-line',
      x: r.rows.map(row => row.day),
      series: [
        { key: 'ca', label: 'CA vendu', values: r.rows.map(row => Number(row.ca_kmf)) },
        { key: 'cost_est', label: 'Coût estimé', values: r.rows.map(row => Number(row.cost_estimated_kmf)) },
        { key: 'cost_real', label: 'Coût réel', values: r.rows.map(row => Number(row.cost_real_kmf)) },
      ],
    },
    real_cost_by_family: {
      type: 'donut',
      items: fR.rows.map(row => ({
        cost_type: row.cost_type,
        amount_kmf: Number(row.amount_kmf),
        pct: total > 0 ? Number(((Number(row.amount_kmf) / total) * 100).toFixed(2)) : 0,
        status: 'actual',
      })),
    },
  };
}

async function _buildCostingAlerts() {
  const alerts = [];

  const fixedSql = `
    SELECT COUNT(DISTINCT o.id)::int AS count
    FROM orders o
    WHERE o.created_at >= date_trunc('month', NOW())
      AND o.payment_status = 'paid'
      AND o.status NOT IN ('cancelled', 'refunded')
      AND NOT EXISTS (
        SELECT 1 FROM order_item_real_cost_allocations
        WHERE order_id = o.id AND cost_type = 'fixed_overhead'
      )
  `;
  const customsSql = `
    SELECT COUNT(DISTINCT cs.id)::int AS count
    FROM customs_shipments cs
    WHERE cs.is_active = TRUE
      AND cs.customs_paid_kmf > 0
      AND NOT EXISTS (
        SELECT 1 FROM order_item_real_cost_allocations
        WHERE shipment_id = cs.id
      )
  `;
  const paySql = `
    SELECT COUNT(DISTINCT o.id)::int AS count
    FROM orders o
    WHERE o.payment_status = 'paid'
      AND o.status NOT IN ('cancelled', 'refunded')
      AND EXISTS (SELECT 1 FROM order_item_cost_imputations WHERE order_id = o.id)
      AND NOT EXISTS (
        SELECT 1 FROM order_item_real_cost_allocations
        WHERE order_id = o.id AND cost_type = 'payment'
      )
  `;

  // Lancer les 3 alertes en parallele
  const [fR, cR, pR] = await Promise.all([
    db.query(fixedSql),
    db.query(customsSql).catch(() => ({ rows: [{ count: 0 }] })), // table optionnelle
    db.query(paySql),
  ]);

  if (Number(fR.rows[0].count) > 0) {
    alerts.push({
      key: 'fixed_overhead_not_allocated',
      level: 'warning',
      label: 'Frais fixes non alloués (mois courant)',
      count: Number(fR.rows[0].count),
      action_url: '/admin/costing/recalibration',
      action_label: 'Allouer les frais du mois',
    });
  }
  if (Number(cR.rows[0].count) > 0) {
    alerts.push({
      key: 'customs_shipment_not_allocated',
      level: 'warning',
      label: 'Shipments non ventilés',
      count: Number(cR.rows[0].count),
      action_url: '/admin/customs-shipments',
      action_label: 'Voir les shipments',
    });
  }
  if (Number(pR.rows[0].count) > 0) {
    alerts.push({
      key: 'payment_fees_missing',
      level: 'info',
      label: 'Frais de paiement non saisis',
      count: Number(pR.rows[0].count),
    });
  }

  return alerts;
}

async function _buildLogisticsCharts(filters) {
  const { where, params } = metrics.buildFiltersClause(filters);
  const sql = `
    SELECT status, COUNT(*)::int AS count
    FROM orders o
    WHERE ${where}
      AND status IN ('confirmed','ordered','preparation','shipped','in_transit','available','collected')
    GROUP BY status
    ORDER BY
      CASE status
        WHEN 'confirmed' THEN 1
        WHEN 'ordered' THEN 2
        WHEN 'preparation' THEN 3
        WHEN 'shipped' THEN 4
        WHEN 'in_transit' THEN 5
        WHEN 'available' THEN 6
        WHEN 'collected' THEN 7
      END
  `;
  const parcelSql = `
    SELECT p.status, COUNT(*)::int AS count
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    WHERE ${where}
    GROUP BY p.status
  `;

  const [r, pR] = await Promise.all([
    db.query(sql, params),
    db.query(parcelSql, params),
  ]);

  return {
    ops_pipeline: { type: 'funnel', stages: r.rows },
    parcel_flow: { type: 'funnel', stages: pR.rows },
  };
}

/**
 * _fetchTopAlerts — lit les N signaux actifs les plus critiques
 * Table : signals (migration 051)
 * Colonnes : severity (info/warning/critical/urgent), status (open/acknowledged/snoozed/resolved/expired)
 */
async function _fetchTopAlerts(limit = 5) {
  const sql = `
    SELECT id,
           severity        AS level,
           source_module   AS source,
           title           AS message,
           meta            AS payload,
           created_at
    FROM signals
    WHERE status IN ('open', 'acknowledged', 'snoozed')
      AND severity IN ('critical', 'urgent')
    ORDER BY
      CASE severity WHEN 'critical' THEN 1 WHEN 'urgent' THEN 2 ELSE 3 END,
      created_at DESC
    LIMIT $1
  `;
  try {
    const r = await db.query(sql, [limit]);
    return r.rows.map(row => ({
      id:         row.id,
      level:      row.level,
      source:     row.source,
      message:    row.message,
      created_at: row.created_at,
    }));
  } catch (e) {
    log.warn({ err: e }, '[admin-dashboard] _fetchTopAlerts non-fatal:');
    return [];
  }
}

module.exports = router;
