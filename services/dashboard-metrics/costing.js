/**
 * @komerce-arch
 * @role          dashboard-metrics-costing
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, ./_helpers, ./control-tower (getCAEncaisse, INV-1)
 * @used-by       services/dashboard-metrics/index.js
 * @db-read       order_item_cost_imputations, order_item_real_cost_allocations, orders
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard, admin-costing
 * @version       2026-06
 */

/**
 * KOMERCE — Dashboard Metrics — Costing (8 KPIs) — Lot C3
 * ════════════════════════════════════════════════════════════════════════
 * Extrait de services/dashboard-metrics.js (1081L) — Lot B/C Refacto.
 *
 * ENUM cost_status (canonique Sprint 1) :
 *   estimated     = snapshot pricing-engine seul, aucun cout reel
 *   partial_real  = couts variables alloues mais types attendus manquants
 *   actual        = tous les types attendus alloues (ex-'complete')
 *   incomplete    = imputation absente / cas pathologique
 *
 * getCAVendu est un alias semantique de getCAEncaisse (INV-1) —
 * dependance volontaire vers control-tower.js, pas de duplication SQL.
 */

'use strict';

const db = require('../../db');
const {
  buildFiltersClause, buildPreviousPeriod, computeDelta, makeKpi,
  EXPECTED_VARIABLE_COSTS, EXPECTED_FIXED_COSTS, EXPECTED_PAYMENT_COSTS,
} = require('./_helpers');
const { getCAEncaisse } = require('./control-tower');

// ═══════════════════════════════════════════════════════════════════════
// COSTING — 8 KPIs
// ═══════════════════════════════════════════════════════════════════════

async function getCAVendu(filters = {}) {
  const ca = await getCAEncaisse(filters);
  return { ...ca, key: 'ca_vendu', label: 'CA vendu' };
}


async function getCoutEstime(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT
      COALESCE(SUM(imp.estimated_business_complete_cost_kmf), 0)::bigint AS value,
      COUNT(DISTINCT imp.order_id)::int AS items_with_data,
      (SELECT COUNT(*)::int FROM orders o WHERE ${where} AND o.status NOT IN ('cancelled','refunded')) AS items_total
    FROM order_item_cost_imputations imp
    JOIN orders o ON o.id = imp.order_id
    WHERE ${where}
      AND o.status NOT IN ('cancelled', 'refunded')
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;

  return makeKpi('cout_estime', 'Coût estimé', value, 'KMF', {
    itemsTotal,
    itemsWithData,
    completeness: itemsWithData === itemsTotal && itemsTotal > 0 ? 'complete' : 'partial',
    warning: itemsTotal > 0 && itemsWithData < itemsTotal
      ? `${itemsTotal - itemsWithData} commande(s) sans snapshot pricing-engine`
      : null,
  });
}


async function getCoutReel(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT
      COALESCE(SUM(alc.amount_kmf), 0)::bigint AS value,
      COUNT(DISTINCT alc.order_id)::int AS items_with_data,
      (SELECT COUNT(*)::int FROM orders o WHERE ${where} AND o.status NOT IN ('cancelled','refunded')) AS items_total
    FROM order_item_real_cost_allocations alc
    JOIN orders o ON o.id = alc.order_id
    WHERE ${where}
      AND o.status NOT IN ('cancelled', 'refunded')
      AND alc.is_actual = TRUE
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;

  return makeKpi('cout_reel', 'Coût réel', value, 'KMF', {
    itemsTotal,
    itemsWithData,
    completeness: itemsTotal === 0 ? 'provisional' : (itemsWithData === itemsTotal ? 'complete' : 'partial'),
    warning: itemsTotal > 0 && itemsWithData < itemsTotal
      ? `Reel partiel : ${itemsWithData}/${itemsTotal} commandes ventilees`
      : null,
  });
}


async function getMargeEstimee(filters = {}) {
  // Marge estimee = CA - cout_estime (sur cmds avec snapshot)
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    WITH order_aggs AS (
      SELECT
        o.id,
        o.total_kmf,
        COALESCE((SELECT SUM(estimated_business_complete_cost_kmf) FROM order_item_cost_imputations WHERE order_id = o.id), NULL) AS est_cost
      FROM orders o
      WHERE ${where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
    )
    SELECT
      COALESCE(SUM(total_kmf - est_cost), 0)::bigint AS margin_kmf,
      COALESCE(SUM(total_kmf), 0)::bigint AS revenue_kmf,
      COUNT(*) FILTER (WHERE est_cost IS NOT NULL)::int AS items_with_data,
      COUNT(*)::int AS items_total
    FROM order_aggs
  `;
  const r = await db.query(sql, params);
  const margin = Number(r.rows[0].margin_kmf) || 0;
  const revenue = Number(r.rows[0].revenue_kmf) || 0;
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;
  const pct = revenue > 0 ? Number(((margin / revenue) * 100).toFixed(2)) : null;

  return makeKpi('marge_estimee', 'Marge estimée', margin, 'KMF', {
    itemsTotal,
    itemsWithData,
    completeness: itemsWithData === itemsTotal && itemsTotal > 0 ? 'complete' : 'partial',
    warning: pct != null ? `${pct}% sur ${itemsWithData}/${itemsTotal} cmds` : null,
  });
}


async function getMargeVariableReelle(filters = {}) {
  // Marge variable reelle = CA - SUM(real allocations cost_type IN variable cost types)
  // Sur cmds qui ont AU MOINS les 5 cost_types variables alloues
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    WITH order_set AS (
      SELECT o.id, o.total_kmf
      FROM orders o
      WHERE ${where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
    ),
    orders_with_variable AS (
      SELECT os.id, os.total_kmf,
        (SELECT SUM(amount_kmf) FROM order_item_real_cost_allocations
         WHERE order_id = os.id AND cost_type::text = ANY($${params.length + 1}::text[])) AS variable_real
      FROM order_set os
      WHERE NOT EXISTS (
        SELECT 1 FROM unnest($${params.length + 1}::text[]) AS expected(t)
        WHERE NOT EXISTS (
          SELECT 1 FROM order_item_real_cost_allocations
          WHERE order_id = os.id AND cost_type::text = expected.t
        )
      )
    )
    SELECT
      COALESCE(SUM(total_kmf - variable_real), 0)::bigint AS margin_kmf,
      COALESCE(SUM(total_kmf), 0)::bigint AS revenue_kmf,
      COUNT(*)::int AS items_with_data,
      (SELECT COUNT(*) FROM order_set)::int AS items_total
    FROM orders_with_variable
  `;
  const r = await db.query(sql, [...params, EXPECTED_VARIABLE_COSTS]);
  const margin = Number(r.rows[0].margin_kmf) || 0;
  const revenue = Number(r.rows[0].revenue_kmf) || 0;
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;
  const pct = revenue > 0 ? Number(((margin / revenue) * 100).toFixed(2)) : null;

  return makeKpi('marge_variable_reelle', 'Marge variable réelle', margin, 'KMF', {
    itemsTotal,
    itemsWithData,
    completeness: itemsTotal === 0 ? 'provisional' : (itemsWithData === itemsTotal ? 'complete' : 'partial'),
    warning: itemsWithData < itemsTotal
      ? `${pct != null ? pct + '% sur ' : ''}${itemsWithData}/${itemsTotal} cmds avec couts variables alloues`
      : null,
  });
}


async function getMargeConsolidee(filters = {}) {
  // Marge consolidee = CA - cout reel total
  // UNIQUEMENT sur cmds avec cost_status='actual'
  // (toutes les categories attendues alloues : variables + fixes + payment)
  const { where, params } = buildFiltersClause(filters);
  const expectedAll = [...EXPECTED_VARIABLE_COSTS, ...EXPECTED_FIXED_COSTS, ...EXPECTED_PAYMENT_COSTS];
  const sql = `
    WITH order_set AS (
      SELECT o.id, o.total_kmf
      FROM orders o
      WHERE ${where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
    ),
    actual_orders AS (
      SELECT os.id, os.total_kmf,
        (SELECT SUM(amount_kmf) FROM order_item_real_cost_allocations WHERE order_id = os.id) AS real_total
      FROM order_set os
      WHERE EXISTS (SELECT 1 FROM order_item_cost_imputations WHERE order_id = os.id)
        AND NOT EXISTS (
          SELECT 1 FROM unnest($${params.length + 1}::text[]) AS expected(t)
          WHERE NOT EXISTS (
            SELECT 1 FROM order_item_real_cost_allocations
            WHERE order_id = os.id AND cost_type::text = expected.t
          )
        )
    )
    SELECT
      COALESCE(SUM(total_kmf - real_total), 0)::bigint AS margin_kmf,
      COALESCE(SUM(total_kmf), 0)::bigint AS revenue_kmf,
      COUNT(*)::int AS items_with_data,
      (SELECT COUNT(*) FROM order_set)::int AS items_total
    FROM actual_orders
  `;
  const r = await db.query(sql, [...params, expectedAll]);
  const margin = Number(r.rows[0].margin_kmf) || 0;
  const revenue = Number(r.rows[0].revenue_kmf) || 0;
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;
  const pct = revenue > 0 ? Number(((margin / revenue) * 100).toFixed(2)) : null;

  return makeKpi('marge_consolidee', 'Marge consolidée', margin, 'KMF', {
    itemsTotal,
    itemsWithData,
    completeness: itemsTotal === 0
      ? 'provisional'
      : (itemsWithData === itemsTotal ? 'complete' : 'partial'),
    warning: itemsWithData < itemsTotal
      ? `${pct != null ? pct + '% sur ' : ''}${itemsWithData}/${itemsTotal} cmds finalisees (cost_status=actual)`
      : null,
  });
}


async function getCmdsCoutIncompletCount(filters = {}) {
  // Count des cmds dont cost_status != 'actual'
  // = cmds sans imputation OU avec couts attendus manquants
  const { where, params } = buildFiltersClause(filters);
  const expectedAll = [...EXPECTED_VARIABLE_COSTS, ...EXPECTED_FIXED_COSTS, ...EXPECTED_PAYMENT_COSTS];
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM orders o
    WHERE ${where}
      AND o.status NOT IN ('cancelled', 'refunded')
      AND (
        NOT EXISTS (SELECT 1 FROM order_item_cost_imputations WHERE order_id = o.id)
        OR EXISTS (
          SELECT 1 FROM unnest($${params.length + 1}::text[]) AS expected(t)
          WHERE NOT EXISTS (
            SELECT 1 FROM order_item_real_cost_allocations
            WHERE order_id = o.id AND cost_type::text = expected.t
          )
        )
      )
  `;
  const r = await db.query(sql, [...params, expectedAll]);
  const value = Number(r.rows[0].value) || 0;

  return makeKpi('cmds_cout_incomplet', 'Commandes coût incomplet', value, 'count', {
    drillTo: '/admin/costing?cost_status=incomplete,partial_real,estimated',
    warning: value > 0 ? 'Cliquer pour voir le detail' : null,
  });
}

/**
 * Retourne les order_ids correspondant a getCmdsCoutIncompletCount
 * Pour drill-down / table / export.
 */
async function getCmdsCoutIncompletIds(filters = {}, options = {}) {
  const limit = Math.min(1000, options.limit || 200);
  const { where, params } = buildFiltersClause(filters);
  const expectedAll = [...EXPECTED_VARIABLE_COSTS, ...EXPECTED_FIXED_COSTS, ...EXPECTED_PAYMENT_COSTS];
  const sql = `
    SELECT o.id, o.reference, o.status, o.payment_status, o.total_kmf, o.created_at
    FROM orders o
    WHERE ${where}
      AND o.status NOT IN ('cancelled', 'refunded')
      AND (
        NOT EXISTS (SELECT 1 FROM order_item_cost_imputations WHERE order_id = o.id)
        OR EXISTS (
          SELECT 1 FROM unnest($${params.length + 1}::text[]) AS expected(t)
          WHERE NOT EXISTS (
            SELECT 1 FROM order_item_real_cost_allocations
            WHERE order_id = o.id AND cost_type::text = expected.t
          )
        )
      )
    ORDER BY o.created_at DESC
    LIMIT $${params.length + 2}
  `;
  const r = await db.query(sql, [...params, expectedAll, limit]);
  return r.rows;
}


async function getCoutMoyParCmd(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    WITH order_set AS (
      SELECT o.id
      FROM orders o
      WHERE ${where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
    )
    SELECT
      COALESCE(AVG(
        (SELECT COALESCE(SUM(estimated_business_complete_cost_kmf), 0)
         FROM order_item_cost_imputations WHERE order_id = os.id)
      ), 0)::bigint AS value,
      COUNT(*)::int AS items_total
    FROM order_set os
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;

  return makeKpi('cout_moy_par_cmd', 'Coût moyen par commande', value, 'KMF', {
    itemsTotal,
    itemsWithData: itemsTotal,
    completeness: itemsTotal > 0 ? 'complete' : 'provisional',
  });
}

module.exports = {
  getCAVendu,
  getCoutEstime,
  getCoutReel,
  getMargeEstimee,
  getMargeVariableReelle,
  getMargeConsolidee,
  getCmdsCoutIncompletCount,
  getCmdsCoutIncompletIds,
  getCoutMoyParCmd,
};
