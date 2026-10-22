/**
 * @komerce-arch
 * @role          dashboard-metrics-control-tower
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, ./_helpers, ../cost-allocation/cost-expectation
 * @used-by       services/dashboard-metrics/index.js
 * @db-read       alerts, cash_collections, order_item_cost_imputations, order_item_real_cost_allocations, incidents, order_items, orders, parcels, scan_events, signals
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      server_market_scope_is_authority
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-09
 */

/**
 * KOMERCE — Dashboard Metrics — Tour de contrôle (8 KPIs)
 *
 * `ca_encaisse` conserve sa clé API historique, mais sa période est une cohorte
 * de commandes créées devenues payées tant qu'aucun timestamp universel de
 * capture/encaissement n'est persisté pour tous les moyens de paiement.
 */

'use strict';

const costExpectation = require('../cost-allocation/cost-expectation');

const db = require('../../db');
const { EXCLUDE_SIMULATED_ORDER_SIGNALS_SQL } = require('../signal-simulation-scope');
const {
  buildFiltersClause, buildPreviousPeriod, computeDelta, makeKpi,
  ACTIVE_ORDER_STATUSES, TRANSIT_PARCEL_STATUSES,
} = require('./_helpers');

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

  return makeKpi('ca_encaisse', 'CA commandes payées', value, 'KMF', {
    delta,
    itemsTotal,
    itemsWithData: itemsTotal,
    completeness: 'complete',
    drillTo: '/admin/costing',
  });
}

async function getCmdsCreees(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `SELECT COUNT(*)::int AS value FROM orders o WHERE ${where}`; // AUD-07: buildFiltersClause emits server-controlled SQL fragments; values remain parameterized
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;

  let delta = null;
  const prev = buildPreviousPeriod(filters);
  if (prev) {
    const prevQuery = buildFiltersClause(prev);
    const prevSql = 'SELECT COUNT(*)::int AS value FROM orders o WHERE ' + prevQuery.where;
    const prevR = await db.query(prevSql, prevQuery.params);
    delta = computeDelta(value, Number(prevR.rows[0].value), 'periode precedente');
  }

  return makeKpi('cmds_creees', 'Commandes créées', value, 'count', {
    delta,
    drillTo: '/admin/operations',
  });
}

async function getProduitsActifsVendus(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT COUNT(DISTINCT oi.product_id)::int AS value
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE ${where}
      AND o.payment_status = 'paid'
      AND o.status NOT IN ('cancelled', 'refunded')
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;

  let delta = null;
  const prev = buildPreviousPeriod(filters);
  if (prev) {
    const prevQuery = buildFiltersClause(prev);
    const prevSql = `
      SELECT COUNT(DISTINCT oi.product_id)::int AS value
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE ${prevQuery.where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
    `;
    const prevR = await db.query(prevSql, prevQuery.params);
    delta = computeDelta(value, Number(prevR.rows[0].value), 'periode precedente');
  }

  return makeKpi('produits_actifs_vendus', 'Produits actifs vendus', value, 'count', {
    delta,
    drillTo: '/admin/workspaces/catalog',
  });
}

async function getCmdsActives(filters = {}) {
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
    drillTo: '/admin/operations#operations-control-chain',
  });
}

async function getColisEnTransit(filters = {}) {
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
    drillTo: '/admin/operations#operations-control-chain',
  });
}

// DASH-04 — le compteur Pilotage lit EXACTEMENT le même périmètre que la liste
// Action Center (signal-admin-service.listSignals) : statuts open/acknowledged,
// global = market_id NULL, marché = signals.market_id exact. Pas de filtre
// période : un signal actif est un stock, pas un flux.
function actionCenterScope(filters = {}) {
  if (!filters.market_id) return { where: 's.market_id IS NULL', params: [] };
  return { where: 's.market_id = $1::uuid', params: [filters.market_id] };
}

async function getAlertesCritiques(filters = {}) {
  const scope = actionCenterScope(filters);
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM signals s
    WHERE s.severity IN ('critical', 'urgent')
      AND s.status IN ('open', 'acknowledged')
      AND ${EXCLUDE_SIMULATED_ORDER_SIGNALS_SQL}
      AND ${scope.where}
  `;

  const r = await db.query(sql, scope.params);
  const value = Number(r.rows[0].value) || 0;

  return makeKpi('alertes_critiques', 'Alertes critiques', value, 'count', {
    drillTo: '/admin/action-center?severity=critical,urgent',
    warning: value > 10 ? 'Beaucoup de signaux non resolus' : null,
  });
}

// Miroir exact de getAlertesCritiques, sévérité 'warning' au lieu de
// 'critical'/'urgent'. Ajouté car "Points d'attention" côté Pilotage
// comptait auparavant un sous-ensemble de system_alerts (limité à 5
// lignes, lui-même filtré sur critical/urgent) — structurellement
// incapable de contenir un item 'warning', donc toujours 0. Un vrai
// COUNT(*) dédié, comme pour les critiques, plutôt qu'un comptage
// approximatif reconstruit côté navigateur depuis une liste tronquée.
async function getPointsAttention(filters = {}) {
  const scope = actionCenterScope(filters);
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM signals s
    WHERE s.severity = 'warning'
      AND s.status IN ('open', 'acknowledged')
      AND ${EXCLUDE_SIMULATED_ORDER_SIGNALS_SQL}
      AND ${scope.where}
  `;

  const r = await db.query(sql, scope.params);
  const value = Number(r.rows[0].value) || 0;

  return makeKpi('points_attention', 'Points d’attention', value, 'count', {
    drillTo: '/admin/action-center?severity=warning',
  });
}

// S4 (audit dashboards) : source canonique des blocages. Plus aucune lecture du texte de
// orders.notes : un blocage est un fait persisté (alerte non résolue ou incident ouvert).
const BLOCKING_INCIDENT_TYPES = Object.freeze([
  'blocked', 'quantity_mismatch', 'hub_purchase_identity_conflict', 'hub_purchase_quantity_conflict',
]);
const BLOCKED_REASON_LABELS = Object.freeze({
  paid_but_stock_blocked: 'payée sans stock',
  blocked: 'colis bloqué',
  quantity_mismatch: 'écart de quantité',
  hub_purchase_identity_conflict: 'conflit achat / Hub',
  hub_purchase_quantity_conflict: 'conflit achat / Hub',
});

async function getCmdsBloquees(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const typesParam = `$${params.length + 1}`;
  const sql = `
    WITH blocked AS (
      SELECT o.id AS order_id, a.type AS reason
        FROM orders o
        JOIN alerts a ON a.entity_type = 'order'
                     AND a.entity_id::text = o.id::text
                     AND a.type = 'paid_but_stock_blocked'
                     AND a.resolved_at IS NULL
       WHERE ${where}
         AND o.payment_status = 'paid'
         AND o.status NOT IN ('cancelled', 'refunded', 'collected')
      UNION ALL
      SELECT o.id AS order_id, i.incident_type AS reason
        FROM incidents i
        LEFT JOIN parcels ip ON ip.id = i.parcel_id
        JOIN orders o ON o.id = COALESCE(i.order_id, ip.order_id)
       WHERE ${where}
         AND i.status IN ('open', 'investigating')
         AND i.incident_type = ANY(${typesParam}::text[])
         AND o.payment_status = 'paid'
         AND o.status NOT IN ('cancelled', 'refunded', 'collected')
    )
    SELECT reason, COUNT(DISTINCT order_id)::int AS n,
           (SELECT COUNT(DISTINCT order_id) FROM blocked)::int AS total
      FROM blocked
     GROUP BY reason
     ORDER BY n DESC, reason
  `;
  const r = await db.query(sql, [...params, BLOCKING_INCIDENT_TYPES]);
  const rows = r.rows || [];
  const value = rows.length ? Number(rows[0].total) || 0 : 0;
  const breakdown = rows.map((row) => ({
    reason: row.reason,
    label: BLOCKED_REASON_LABELS[row.reason] || row.reason,
    count: Number(row.n) || 0,
  }));
  const detail = breakdown.map((b) => `${b.label} : ${b.count}`).join(' · ');

  const kpi = makeKpi('cmds_bloquees', 'Commandes bloquées', value, 'count', {
    drillTo: '/admin/operations#operations-control-chain',
    warning: value > 0 ? `${value} commande(s) payée(s) bloquée(s) — motifs : ${detail} (une commande peut en cumuler plusieurs)` : null,
  });
  kpi.breakdown = breakdown;
  return kpi;
}

async function getTauxCompletudeScans(filters = {}) {
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
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    WITH order_set AS (
      SELECT o.id, o.status, o.payment_mode, o.relais_id FROM orders o
      WHERE ${where}
        AND o.status NOT IN ('cancelled', 'refunded')
        AND NOT ${costExpectation.nothingExpectedYetSql('o')}
    ),
    actual_orders AS (
      SELECT os.id
      FROM order_set os
      WHERE EXISTS (SELECT 1 FROM order_item_cost_imputations WHERE order_id = os.id)
        AND NOT ${costExpectation.hasMissingExpectedSql('os')}
    )
    SELECT
      (SELECT COUNT(*) FROM order_set)::int AS items_total,
      (SELECT COUNT(*) FROM actual_orders)::int AS items_with_data,
      (SELECT COUNT(*) FROM order_set os
        WHERE EXISTS (SELECT 1 FROM order_item_cost_imputations WHERE order_id = os.id)
          AND ${costExpectation.finalMarginReadySql('os')})::int AS final_margin_ready
  `;
  const r = await db.query(sql, params);
  const itemsTotal = Number(r.rows[0].items_total) || 0;
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const value = itemsTotal > 0 ? Number(((itemsWithData / itemsTotal) * 100).toFixed(2)) : null;

  const finalMarginReady = Number(r.rows[0].final_margin_ready) || 0;

  return makeKpi('taux_completude_couts', 'Coûts attendus présents à leur stade', value, '%', {
    itemsTotal,
    itemsWithData,
    // Notion distincte : avoir tous les coûts attendus à son stade ne rend pas la marge finale calculable.
    extra: { final_margin_ready: finalMarginReady, final_margin_note: 'Marge réelle finale calculable : commande remise au client, coûts attendus présents, douane connue.' },
    completeness: itemsTotal > 0 ? (itemsWithData === itemsTotal ? 'complete' : 'partial') : 'provisional',
    warning: value != null && value < 50 ? 'Beaucoup de commandes sans coût consolidé' : null,
    drillTo: '/admin/finance#finance-incomplete-costs',
  });
}

module.exports = {
  getCAEncaisse,
  getCmdsCreees,
  getProduitsActifsVendus,
  getCmdsActives,
  getColisEnTransit,
  getAlertesCritiques,
  getPointsAttention,
  getCmdsBloquees,
  getTauxCompletudeScans,
  getTauxCompletudeCouts,
};
