/**
 * @komerce-arch
 * @role          radar-commerce-signals
 * @domain        decision-signals
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context
 * @outputs       response_or_domain_result
 * @depends       db.js
 * @used-by       services/radar-queries.js
 * @db-read       orders, incidents, products
 * @db-write      none
 * @db-txn        none
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  decision-signals
 * @version       2026-08
 */

'use strict';

/**
 * services/radar-alerts/commerce-signals.js
 *
 * Alertes Radar liées à l'activité commerciale et au catalogue.
 * Extrait de services/radar-queries.js::getAlerts() (checks G, H, I, J).
 */

async function checkCancelRate(db, cancelRatePct) {
  const { rows: cancelStats } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS total_7d,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days' AND status = 'cancelled') AS cancelled_7d
    FROM orders
  `);
  const total7d = Number(cancelStats[0].total_7d);
  const cancelled7d = Number(cancelStats[0].cancelled_7d);

  if (total7d <= 0) return null;

  const ratePct = (cancelled7d / total7d) * 100;
  if (ratePct < cancelRatePct) return null;

  return {
    level: 'critical',
    icon: '📉',
    code: 'CANCEL_RATE_HIGH',
    title: `Taux annulation 7j: ${ratePct.toFixed(1)}% (seuil ${cancelRatePct}%)`,
    value_pct: Number(ratePct.toFixed(1)),
    count: cancelled7d,
    action: 'Analyser les causes',
    target_view: 'orders',
    target_filter: { status: 'cancelled' },
  };
}

async function checkOpenIncidents(db) {
  const { rows: incidents } = await db.query(`
    SELECT COUNT(*) AS cnt
    FROM incidents
    WHERE status = 'open'
      AND (severity = 'critical' OR severity = 'high')
  `).catch(() => ({ rows: [{ cnt: 0 }] }));

  if (Number(incidents[0].cnt) <= 0) return null;

  return {
    level: 'critical',
    icon: '🔥',
    code: 'INCIDENTS_OPEN',
    title: `${incidents[0].cnt} incident(s) critique(s) ouvert(s)`,
    count: Number(incidents[0].cnt),
    action: 'Traiter',
    target_view: 'incidents',
    target_filter: { status: 'open' },
  };
}

async function checkLowStock(db, stockLowThresh) {
  const { rows: lowStock } = await db.query(`
    SELECT COUNT(*) AS cnt
    FROM products
    WHERE is_active = TRUE
      AND stock > 0
      AND stock <= $1
  `, [stockLowThresh]).catch(() => ({ rows: [{ cnt: 0 }] }));

  if (Number(lowStock[0].cnt) <= 0) return null;

  return {
    level: 'signal',
    icon: '📉',
    code: 'STOCK_LOW',
    title: `${lowStock[0].cnt} produit(s) stock bas (≤ ${stockLowThresh})`,
    count: Number(lowStock[0].cnt),
    action: 'Réapprovisionner',
    target_view: 'inventory',
    target_filter: {},
  };
}

async function checkStockOut(db) {
  const { rows: ruptures } = await db.query(`
    SELECT COUNT(*) AS cnt
    FROM products
    WHERE is_active = TRUE AND stock = 0
  `).catch(() => ({ rows: [{ cnt: 0 }] }));

  if (Number(ruptures[0].cnt) <= 0) return null;

  return {
    level: 'signal',
    icon: '❌',
    code: 'STOCK_OUT',
    title: `${ruptures[0].cnt} produit(s) en rupture`,
    count: Number(ruptures[0].cnt),
    action: 'Désactiver ou réapprovisionner',
    target_view: 'inventory',
    target_filter: {},
  };
}

module.exports = {
  checkCancelRate,
  checkOpenIncidents,
  checkLowStock,
  checkStockOut,
};
