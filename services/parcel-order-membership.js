/**
 * @komerce-arch
 * @role          logistics-parcel-order-membership
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        db_or_transaction_executor, order_id | parcel_id
 * @outputs       parcels représentant une commande / commandes représentées par un colis
 * @depends       none (executor fourni par l'appelant)
 * @used-by       utils/parcelSync.js, services/scan-engine.js, routes/hub-dashboard.js
 * @db-read       order_items, parcel_items, parcels
 * @db-txn        caller_transaction_preserved
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics, dashboard
 * @version       2026-10
 */

'use strict';

/**
 * Appartenance colis ↔ commande (HUB-A) — projection pure, aucune autorité.
 *
 * Un colis P représente la commande O si :
 *   - P porte au moins une ligne dont l'order_item appartient à O ; ou
 *   - P.order_id = O et P ne porte aucune ligne rattachée à un order_item
 *     (colis legacy / vide : sémantique historique inchangée).
 * `parcels.order_id` reste la commande porteuse (référence, destination) et
 * n'est jamais réécrit : aucun effacement d'affectation.
 */
function memberParcelPredicate(parcelAlias, orderParam) {
  const p = parcelAlias;
  return `(
    EXISTS (
      SELECT 1 FROM parcel_items mpi
      JOIN order_items moi ON moi.id = mpi.order_item_id
      WHERE mpi.parcel_id = ${p}.id AND moi.order_id = ${orderParam}
    )
    OR (
      ${p}.order_id = ${orderParam}
      AND NOT EXISTS (
        SELECT 1 FROM parcel_items mpi2
        JOIN order_items moi2 ON moi2.id = mpi2.order_item_id
        WHERE mpi2.parcel_id = ${p}.id
      )
    )
  )`;
}

/** Colis (colonnes demandées) qui représentent la commande. */
async function listParcelsRepresentingOrder(executor, orderId, { columns = 'p.id, p.status, p.type, p.reference', excludeCancelled = false } = {}) {
  const { rows } = await executor.query(
    `SELECT ${columns} FROM parcels p
     WHERE ${memberParcelPredicate('p', '$1')}
     ${excludeCancelled ? "AND p.status <> 'cancelled'" : ''}`,
    [orderId]
  );
  return rows;
}

/** Commandes représentées par un ou plusieurs colis (inclut la commande porteuse d'un colis sans ligne). */
async function listOrdersRepresentedByParcels(executor, parcelIds) {
  const ids = Array.isArray(parcelIds) ? parcelIds : [parcelIds];
  const { rows } = await executor.query(
    `SELECT DISTINCT order_id FROM (
       SELECT p.order_id AS order_id FROM parcels p
       WHERE p.id = ANY($1::uuid[])
         AND NOT EXISTS (SELECT 1 FROM parcel_items x JOIN order_items xo ON xo.id = x.order_item_id WHERE x.parcel_id = p.id)
       UNION
       SELECT oi.order_id FROM parcel_items pi JOIN order_items oi ON oi.id = pi.order_item_id
       WHERE pi.parcel_id = ANY($1::uuid[])
     ) t WHERE order_id IS NOT NULL ORDER BY order_id`,
    [ids]
  );
  return rows.map(r => r.order_id);
}

const listOrdersRepresentedByParcel = (executor, parcelId) => listOrdersRepresentedByParcels(executor, [parcelId]);

module.exports = { memberParcelPredicate, listParcelsRepresentingOrder, listOrdersRepresentedByParcel, listOrdersRepresentedByParcels };
