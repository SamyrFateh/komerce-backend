/**
 * @komerce-arch
 * @role          dashboard-metrics-control-tower
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, ./_helpers
 * @used-by       services/dashboard-metrics/index.js
 * @db-read       order_item_cost_imputations, order_item_real_cost_allocations, orders, parcels, scan_events, signals
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

/**
 * KOMERCE — Dashboard Metrics — Tour de contrôle (8 KPIs) — Lot C3
 * ════════════════════════════════════════════════════════════════════════
 * Extrait de services/dashboard-metrics.js (1081L) — Lot B/C Refacto.
 * cmds_actives = status IN (confirmed, ordered, preparation, shipped, in_transit, available)
 *   (PAS pending, PAS collected, PAS cancelled, PAS refunded)
 */

'use strict';

const db = require('../../db');
const {
  buildFiltersClause, buildPreviousPeriod, computeDelta, makeKpi,
  ACTIVE_ORDER_STATUSES, TRANSIT_PARCEL_STATUSES,
  EXPECTED_VARIABLE_COSTS, EXPECTED_FIXED_COSTS, EXPECTED_PAYMENT_COSTS,
} = require('./_helpers');

// ═══════════════════════════════════════════════════════════════════════
// TOUR DE CONTROLE — 8 KPIs
// ═══════════════════════════════════════════════════════════════════════

async function getCAEncaisse(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT COALESCE(SUM(o.total_kmf), 0)::bigint AS value,
           COUNT(*)::int AS items_total
    FROM orders o
    WHERE ${where}
      AND o.payment_status = 'paid'
      AND o.status NOT IN ('cancelled', 'refunded')
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;

  // Delta vs periode anterieure
  let delta = null;
  const prev = buildPreviousPeriod(filters);
  if (prev) {
    const prevQuery = buildFiltersClause(prev);
    const prevSql = `
      SELECT COALESCE(SUM(o.total_kmf), 0)::bigint AS value
      FROM orders o
      WHERE ${prevQuery.where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
    `;
    const prevR = await db.query(prevSql, prevQuery.params);
    delta = computeDelta(value, Number(prevR.rows[0].value), 'periode precedente');
  }

  return makeKpi('ca_encaisse', 'CA encaissé', value, 'KMF', {
    delta,
    itemsTotal,
    itemsWithData: itemsTotal,
    completeness: 'complete',
    drillTo: '/admin/costing',
  });
}


async function getCmdsCreees(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `SELECT COUNT(*)::int AS value FROM orders o WHERE ${where}`; // quality-disable N2-SQL-INJECTION — where is parameterized via buildFiltersClause
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;

  let delta = null;
  const prev = buildPreviousPeriod(filters);
  if (prev) {
    const prevQuery = buildFiltersClause(prev);
    const prevR = await db.query(`SELECT COUNT(*)::int AS value FROM orders o WHERE ${prevQuery.where}`, prevQuery.params); // quality-disable N2-SQL-INJECTION
    delta = computeDelta(value, Number(prevR.rows[0].value), 'periode precedente');
  }

  return makeKpi('cmds_creees', 'Commandes créées', value, 'count', {
    delta,
    drillTo: '/admin/orders-logistics',
  });
}


async function getCmdsActives(filters = {}) {
  // Definition canonique : status IN (confirmed, ordered, preparation, shipped, in_transit, available)
  // PAS pending (paiement non valide)
  // PAS collected (livre)
  // PAS cancelled, refunded
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM orders o
    WHERE ${where}
      AND o.status::text = ANY($${params.length + 1}::text[])
  `;
  const r = await db.query(sql, [...params, ACTIVE_ORDER_STATUSES]);
  const value = Number(r.rows[0].value) || 0;

  return makeKpi('cmds_actives', 'Commandes actives', value, 'count', {
    drillTo: '/admin/orders-logistics?status=active',
  });
}


async function getColisEnTransit(filters = {}) {
  // colis transit : shipped | in_transit | arrived
  // Filtres orders applicables si parcel.order_id pertinent
  const { where, params } = buildFiltersClause(filters, 'o');
  const sql = `
    SELECT COUNT(DISTINCT p.id)::int AS value
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    WHERE ${where}
      AND p.status::text = ANY($${params.length + 1}::text[])
  `;
  const r = await db.query(sql, [...params, TRANSIT_PARCEL_STATUSES]);
  const value = Number(r.rows[0].value) || 0;

  return makeKpi('colis_transit', 'Colis en transit', value, 'count', {
    drillTo: '/admin/orders-logistics?parcel_status=in_transit',
  });
}


async function getAlertesCritiques(filters = {}) {
  // Signaux non resolus, severity critical ou urgent
  // Table: signals (severity: urgent|critical|warning, status: open|acknowledged|snoozed|resolved)
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM signals
    WHERE severity IN ('critical', 'urgent')
      AND status IN ('open', 'acknowledged', 'snoozed')
      ${filters.from ? 'AND created_at >= $1' : ''}
      ${filters.to   ? `AND created_at <= $${filters.from ? 2 : 1}` : ''}
  `;
  const params = [];
  if (filters.from) params.push(filters.from);
  if (filters.to)   params.push(filters.to);

  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;

  return makeKpi('alertes_critiques', 'Alertes critiques', value, 'count', {
    drillTo: '/admin/signals?severity=critical',
    warning: value > 10 ? 'Beaucoup de signaux non resolus' : null,
  });
}


async function getCmdsBloquees(filters = {}) {
  // Commandes payees mais bloquees (paid_but_stock_blocked dans notes)
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM orders o
    WHERE ${where}
      AND o.payment_status = 'paid'
      AND o.notes ILIKE '%paid_but_stock_blocked%'
      AND o.status NOT IN ('cancelled', 'refunded', 'collected')
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;

  return makeKpi('cmds_bloquees', 'Commandes bloquées', value, 'count', {
    drillTo: '/admin/orders-logistics?anomalie=stock_blocked',
    warning: value > 0 ? `${value} commande(s) payée(s) sans stock` : null,
  });
}


async function getTauxCompletudeScans(filters = {}) {
  // Ratio parcels avec >=1 scan / parcels in transit ou apres
  // Table: scan_events (colonne parcel_id — pas de order_id direct)
  const { where, params } = buildFiltersClause(filters, 'o');
  const sql = `
    WITH transit_parcels AS (
      SELECT p.id
      FROM parcels p
      JOIN orders o ON o.id = p.order_id
      WHERE ${where}
        AND p.status::text = ANY($${params.length + 1}::text[])
    )
    SELECT
      (SELECT COUNT(*) FROM transit_parcels)::int AS items_total,
      (SELECT COUNT(DISTINCT se.parcel_id)
       FROM scan_events se
       WHERE se.parcel_id IN (SELECT id FROM transit_parcels))::int AS items_with_data
  `;
  const r = await db.query(sql, [...params, [...TRANSIT_PARCEL_STATUSES, 'available', 'collected']]);
  const itemsTotal = Number(r.rows[0].items_total) || 0;
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const value = itemsTotal > 0 ? Number(((itemsWithData / itemsTotal) * 100).toFixed(2)) : null;

  return makeKpi('taux_completude_scans', 'Taux complétude scans', value, '%', {
    itemsTotal,
    itemsWithData,
    completeness: itemsTotal > 0 ? 'complete' : 'provisional',
    warning: value != null && value < 80 ? 'Taux de scans bas' : null,
  });
}


async function getTauxCompletudeCouts(filters = {}) {
  // Ratio cmds avec cost_status='actual' / total cmds
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    WITH order_set AS (
      SELECT o.id FROM orders o
      WHERE ${where}
        AND o.status NOT IN ('cancelled', 'refunded')
    ),
    actual_orders AS (
      SELECT os.id
      FROM order_set os
      WHERE EXISTS (SELECT 1 FROM order_item_cost_imputations WHERE order_id = os.id)
        AND NOT EXISTS (
          SELECT 1 FROM unnest($${params.length + 1}::text[]) AS expected(t)
          WHERE NOT EXISTS (
            SELECT 1 FROM order_item_real_cost_allocations alc
            WHERE alc.order_id = os.id AND alc.cost_type::text = expected.t
          )
        )
    )
    SELECT
      (SELECT COUNT(*) FROM order_set)::int AS items_total,
      (SELECT COUNT(*) FROM actual_orders)::int AS items_with_data
  `;
  const expectedAll = [...EXPECTED_VARIABLE_COSTS, ...EXPECTED_FIXED_COSTS, ...EXPECTED_PAYMENT_COSTS];
  const r = await db.query(sql, [...params, expectedAll]);
  const itemsTotal = Number(r.rows[0].items_total) || 0;
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const value = itemsTotal > 0 ? Number(((itemsWithData / itemsTotal) * 100).toFixed(2)) : null;

  return makeKpi('taux_completude_couts', 'Taux complétude coûts', value, '%', {
    itemsTotal,
    itemsWithData,
    completeness: itemsTotal > 0 ? (itemsWithData === itemsTotal ? 'complete' : 'partial') : 'provisional',
    warning: value != null && value < 50 ? 'Beaucoup de commandes sans cout consolide' : null,
    drillTo: '/admin/costing?cost_status=incomplete',
  });
}

// ═══════════════════════════════════════════════════════════════════════
// COSTING — 8 KPIs
// ═══════════════════════════════════════════════════════════════════════

// CA vendu = alias semantique de ca_encaisse (INV-1)

module.exports = {
  getCAEncaisse,
  getCmdsCreees,
  getCmdsActives,
  getColisEnTransit,
  getAlertesCritiques,
  getCmdsBloquees,
  getTauxCompletudeScans,
  getTauxCompletudeCouts,
};
