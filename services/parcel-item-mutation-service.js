/**
 * @komerce-arch
 * @role          logistics-parcel-item-mutation-service
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        db_or_transaction_executor, parcel item mutation payload
 * @outputs       query result / parcel item row
 * @depends       none (executor fourni par l'appelant)
 * @used-by       routes/hub-dashboard.js, services/inventory-service.js
 * @db-read       order_items
 * @db-write      parcel_items
 * @db-txn        caller_transaction_preserved
 * @doctrine      writer_not_owner_boundary
 * @impact-areas  logistics, dashboard, inventory
 * @version       2026-08
 */

'use strict';

function assertExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('parcel-item-mutation-service requires an executor exposing query(sql, params)');
  }
}

/**
 * Assigne l'intégralité d'un order_item à un colis après validation de son
 * appartenance à la commande. Sémantique historique de hub-dashboard/create-parcel.
 */
async function assignWholeOrderItemToParcel(executor, {
  parcelId,
  orderItemId,
  orderId,
}) {
  assertExecutor(executor);

  return executor.query(
    `INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
     SELECT $1, oi.id, oi.product_id, oi.quantity
     FROM order_items oi WHERE oi.id = $2 AND oi.order_id = $3
     ON CONFLICT DO NOTHING`,
    [parcelId, orderItemId, orderId]
  );
}

/**
 * Assigne un article déjà résolu (product_id + quantity connus) à un colis.
 * Sémantique historique de hub-dashboard/auto-prepare.
 */
async function assignParcelItem(executor, {
  parcelId,
  orderItemId,
  productId,
  quantity,
}) {
  assertExecutor(executor);

  return executor.query(
    `INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [parcelId, orderItemId, productId, quantity]
  );
}

/**
 * Ajoute un article résolu et retourne la ligne créée si elle existe.
 * Sémantique historique de POST /hub-dash/parcels/:id/add-item.
 */
async function addParcelItem(executor, {
  parcelId,
  orderItemId,
  productId,
  quantity,
}) {
  assertExecutor(executor);

  const { rows: [row] } = await executor.query(
    `INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [parcelId, orderItemId, productId, quantity]
  );

  return row || null;
}

/**
 * Retire un article d'un colis et retourne la ligne supprimée si elle existe.
 */
async function removeParcelItem(executor, {
  parcelId,
  orderItemId,
}) {
  assertExecutor(executor);

  const { rows: [row] } = await executor.query(
    'DELETE FROM parcel_items WHERE parcel_id = $1 AND order_item_id = $2 RETURNING *',
    [parcelId, orderItemId]
  );

  return row || null;
}

/**
 * Assigne une unité d'un order_item à un colis lors du scan inventory.
 * La quantité reste volontairement fixée à 1, comme avant extraction.
 */
async function assignSingleOrderItemToParcel(executor, {
  parcelId,
  orderItemId,
}) {
  assertExecutor(executor);

  return executor.query(
    `INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
     SELECT $1, $2, oi.product_id, 1
     FROM order_items oi WHERE oi.id = $3
     ON CONFLICT DO NOTHING`,
    [parcelId, orderItemId, orderItemId]
  );
}

module.exports = {
  assignWholeOrderItemToParcel,
  assignParcelItem,
  addParcelItem,
  removeParcelItem,
  assignSingleOrderItemToParcel,
};
