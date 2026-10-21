/**
 * @komerce-arch
 * @role          dashboard-pilotage-markets-overview
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   medium
 * @inputs        dashboard_filters (période, simulation_scope)
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

// Supervision globale : TOUS les marchés éligibles (is_active et lifecycle ACTIVE), même sans commande.
// Un zéro est un zéro calculé (aucune commande / aucun incident sur le périmètre) ; une lecture
// impossible n'est jamais convertie en 0 : l'appelant renvoie null (« Non disponible »).
// Mêmes filtres que le reste du Pilotage (période, réel par défaut / RCT1 seul si demandé),
// mêmes définitions que dashboard-orders ; aucune troncature.
async function getMarketsSupervision(filters = {}) {
  const { market_id: _ignored, ...scoped } = filters || {};
  const { where, params } = metrics.buildFiltersClause(scoped);
  const active = metrics.ACTIVE_ORDER_STATUSES.map(s => `'${s}'`).join(', ');
  const { rows } = await db.query(`
    SELECT m.code AS market_code, m.name AS market_name,
           COUNT(DISTINCT o.id) FILTER (WHERE o.status IN (${active}))::int AS orders_active,
           COUNT(DISTINCT o.id) FILTER (WHERE o.payment_status = 'pending'
             AND o.status NOT IN ('cancelled', 'collected', 'refunded'))::int AS cash_to_confirm,
           COUNT(DISTINCT o.id) FILTER (WHERE oi.id IS NOT NULL)::int AS open_incidents
      FROM markets m
      LEFT JOIN orders o ON o.market_id = m.id AND ${where}
      LEFT JOIN order_incidents oi ON oi.order_id = o.id AND oi.status IN ('open', 'in_progress')
     WHERE m.is_active = TRUE AND COALESCE(m.lifecycle_status, 'ACTIVE') = 'ACTIVE'
     GROUP BY m.code, m.name
     ORDER BY orders_active DESC, open_incidents DESC, m.code ASC
  `, params);
  return rows.map(r => ({
    market_code: r.market_code,
    market_name: r.market_name,
    orders_active: Number(r.orders_active) || 0,
    cash_to_confirm: Number(r.cash_to_confirm) || 0,
    open_incidents: Number(r.open_incidents) || 0,
  }));
}

module.exports = { getMarketsSupervision };
