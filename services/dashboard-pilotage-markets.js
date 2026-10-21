/**
 * @komerce-arch
 * @role          dashboard-pilotage-markets-overview
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   medium
 * @inputs        dashboard_filters (simulation_scope uniquement)
 * @outputs       global_markets_supervision_projection
 * @depends       db, services/dashboard-metrics
 * @used-by       routes/admin-dashboard.js
 * @db-read       orders, markets, order_incidents
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, missing_data_never_means_zero, simulation_scope_separated_from_real
 * @impact-areas  admin-dashboard, pilotage
 * @version       2026-10
 */
'use strict';

const db = require('../db');
const metrics = require('./dashboard-metrics');

// Supervision globale : un marché n'apparaît que s'il porte au moins une commande active
// (jamais de ligne à 0 fabriquée). Mêmes définitions que dashboard-orders : actives =
// ACTIVE_ORDER_STATUSES, cash à confirmer = paiement en attente hors terminées.
async function getMarketsSupervision(filters = {}) {
  const scoped = { simulation_scope: filters.simulation_scope || null };
  const { where, params } = metrics.buildFiltersClause(scoped);
  const active = metrics.ACTIVE_ORDER_STATUSES.map(s => `'${s}'`).join(', ');
  const [{ rows }, { rows: inc }] = await Promise.all([
    db.query(`
      SELECT m.code AS market_code, m.name AS market_name,
             COUNT(*) FILTER (WHERE o.status IN (${active}))::int AS orders_active,
             COUNT(*) FILTER (WHERE o.payment_status = 'pending'
               AND o.status NOT IN ('cancelled', 'collected', 'refunded'))::int AS cash_to_confirm
        FROM orders o
        JOIN markets m ON m.id = o.market_id
       WHERE ${where}
       GROUP BY m.code, m.name
      HAVING COUNT(*) FILTER (WHERE o.status IN (${active})) > 0
       ORDER BY orders_active DESC, m.code ASC
       LIMIT 8
    `, params),
    db.query(`
      SELECT m.code AS market_code, COUNT(DISTINCT oi.order_id)::int AS open_incidents
        FROM order_incidents oi
        JOIN orders o ON o.id = oi.order_id
        JOIN markets m ON m.id = o.market_id
       WHERE ${where} AND oi.status IN ('open', 'in_progress')
       GROUP BY m.code
    `, params),
  ]);
  const incidents = new Map(inc.map(r => [r.market_code, Number(r.open_incidents) || 0]));
  return rows.map(r => ({
    market_code: r.market_code,
    market_name: r.market_name,
    orders_active: Number(r.orders_active) || 0,
    cash_to_confirm: Number(r.cash_to_confirm) || 0,
    open_incidents: incidents.get(r.market_code) || 0,
  }));
}

module.exports = { getMarketsSupervision };
