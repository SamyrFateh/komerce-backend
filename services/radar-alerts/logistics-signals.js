/**
 * @komerce-arch
 * @role          radar-logistics-signals
 * @domain        decision-signals
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context
 * @outputs       response_or_domain_result
 * @depends       db.js
 * @used-by       services/radar-queries.js
 * @db-read       parcels, orders
 * @db-write      none
 * @db-txn        none
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  decision-signals
 * @version       2026-08
 */

'use strict';

/**
 * services/radar-alerts/logistics-signals.js
 *
 * Alertes Radar liées à l'acheminement des colis.
 * Extrait de services/radar-queries.js::getAlerts() (checks C, F).
 */

async function checkBlockedParcels(db, slaBlockedDays) {
  const { rows: blockedParcels } = await db.query(`
    SELECT COUNT(DISTINCT p.id) AS cnt
    FROM parcels p
    WHERE p.status NOT IN ('collected', 'cancelled')
      AND p.created_at < NOW() - ($1 * INTERVAL '1 day')
  `, [slaBlockedDays]);

  if (Number(blockedParcels[0].cnt) <= 0) return null;

  return {
    level: 'critical',
    icon: '🔴',
    code: 'PARCELS_BLOCKED',
    title: `${blockedParcels[0].cnt} colis bloqué(s) > ${slaBlockedDays}j`,
    count: Number(blockedParcels[0].cnt),
    action: 'Intervention urgente',
    target_view: 'orders',
    target_filter: { parcel_status: 'blocked' },
  };
}

/**
 * Commandes partiellement livrées depuis > 7j : jusqu'à 3 alertes distinctes
 * (partial_collected / partial_available / awaiting_stock), retournées dans
 * un tableau (0 à 3 éléments) — jamais null pour rester composable avec
 * alerts.push(...résultat) côté orchestrateur.
 *
 * getDetail est injecté (plutôt qu'importé) pour éviter un cycle de
 * dépendance avec services/radar-queries.js, qui l'expose déjà comme
 * fonction pure publique.
 */
async function checkStaleDeliveries(db, { getDetail, backorderMaxD }) {
  const { rows: partialOrders } = await db.query(`
    SELECT o.id, o.reference, o.created_at, o.total_kmf,
           COALESCE(json_agg(p.status), '[]'::json) AS parcel_statuses,
           COALESCE(json_agg(p.id), '[]'::json) AS parcel_ids
    FROM orders o
    JOIN parcels p ON p.order_id = o.id
    WHERE o.status NOT IN ('cancelled', 'refunded')
      AND o.created_at < NOW() - INTERVAL '7 days'
    GROUP BY o.id
  `);

  let partialCollectedCount = 0;
  let partialAvailableCount = 0;
  let awaitingStockCount = 0;
  for (const order of partialOrders) {
    const fakeParcels = order.parcel_statuses.map(s => ({ status: s }));
    const detail = getDetail(fakeParcels);
    if (detail === 'partial_collected') partialCollectedCount++;
    if (detail === 'partial_available') partialAvailableCount++;
    if (detail === 'awaiting_stock' &&
        (new Date() - new Date(order.created_at)) / 86400000 > backorderMaxD) {
      awaitingStockCount++;
    }
  }

  const alerts = [];

  if (partialCollectedCount > 0) {
    alerts.push({
      level: 'critical',
      icon: '⚠️',
      code: 'PARTIAL_COLLECTED_STALE',
      title: `${partialCollectedCount} commande(s) partiellement récupérée(s) > 7j`,
      count: partialCollectedCount,
      action: 'Client a laissé du stock au relais',
      target_view: 'orders',
      target_filter: { status_detail: 'partial_collected' },
    });
  }
  if (partialAvailableCount > 0) {
    alerts.push({
      level: 'signal',
      icon: '🟠',
      code: 'PARTIAL_AVAILABLE_STALE',
      title: `${partialAvailableCount} commande(s) partiellement disponible(s) > 7j`,
      count: partialAvailableCount,
      action: 'Compléter la livraison',
      target_view: 'orders',
      target_filter: { status_detail: 'partial_available' },
    });
  }
  if (awaitingStockCount > 0) {
    alerts.push({
      level: 'critical',
      icon: '📦',
      code: 'AWAITING_STOCK_EXPIRED',
      title: `${awaitingStockCount} commande(s) en attente stock > ${backorderMaxD}j`,
      count: awaitingStockCount,
      action: 'Échec sourcing — décider',
      target_view: 'orders',
      target_filter: { status_detail: 'awaiting_stock' },
    });
  }

  return alerts;
}

module.exports = {
  checkBlockedParcels,
  checkStaleDeliveries,
};
