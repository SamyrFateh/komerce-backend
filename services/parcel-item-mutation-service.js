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
 * @db-read       order_items, parcel_items, parcels
 * @db-write      parcel_items
 * @db-txn        caller_transaction_preserved
 * @doctrine      writer_not_owner_boundary, HUB-001_PHYSICAL_IDENTITY_ALLOCATION_CUSTODY
 * @impact-areas  logistics, dashboard, inventory
 * @version       2026-09
 */

'use strict';

function assertExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('parcel-item-mutation-service requires an executor exposing query(sql, params)');
  }
}

function allocationError(code, message, details = {}) {
  const err = new Error(message || code);
  err.code = code;
  err.details = details;
  return err;
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
 * Legacy helper : une unité. Conservé pour les anciens call-sites.
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

/**
 * HUB-001 — matérialise une allocation physique dans le contenant cible sans
 * réinventer l'allocation commerciale.
 *
 * Règles :
 * - si une allocation parcel_items existe déjà dans le colis cible (ex.
 *   auto-parcel), elle sert de plan et n'est jamais dupliquée inutilement ;
 * - si le même order_item est déjà planifié dans un AUTRE colis actif et que
 *   le colis cible n'en porte aucune part, on refuse : un split/repack doit
 *   être explicite, jamais une réassignation silencieuse ;
 * - si la ligne du colis cible est née du scan physique, sa quantité monte au
 *   plus jusqu'au reliquat commercial encore disponible pour ce colis.
 */
async function assignPhysicalAllocationToParcel(executor, {
  parcelId,
  orderItemId,
  quantity,
}) {
  assertExecutor(executor);
  const physicalQty = Number(quantity);
  if (!Number.isInteger(physicalQty) || physicalQty <= 0) {
    throw allocationError('HUB_INVALID_PHYSICAL_QUANTITY', 'Quantité physique invalide.', { quantity });
  }

  const { rows: [orderItem] } = await executor.query(
    `SELECT id, order_id, product_id, quantity
       FROM order_items
      WHERE id = $1
      FOR SHARE`,
    [orderItemId]
  );
  if (!orderItem) {
    throw allocationError('HUB_ORDER_ITEM_NOT_FOUND', 'Article de commande introuvable.', { order_item_id: orderItemId });
  }

  const { rows: existing } = await executor.query(`
    SELECT pi.id, pi.parcel_id, pi.quantity, p.status
      FROM parcel_items pi
      JOIN parcels p ON p.id = pi.parcel_id
     WHERE pi.order_item_id = $1
       AND p.status <> 'cancelled'
     ORDER BY pi.created_at NULLS FIRST, pi.id
     FOR UPDATE OF pi
  `, [orderItemId]);

  const targetRows = existing.filter((row) => String(row.parcel_id) === String(parcelId));
  const otherRows = existing.filter((row) => String(row.parcel_id) !== String(parcelId));

  if (targetRows.length === 0 && otherRows.length > 0) {
    throw allocationError(
      'HUB_EXPLICIT_SPLIT_REQUIRED',
      'Cette ligne est déjà allouée à un autre colis : split/repack explicite requis, aucune réassignation silencieuse.',
      { order_item_id: orderItemId, target_parcel_id: parcelId, existing_parcel_ids: [...new Set(otherRows.map((r) => r.parcel_id))] }
    );
  }

  const orderedQty = Number(orderItem.quantity || 0);
  const otherQty = otherRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const maxTargetQty = orderedQty - otherQty;
  if (maxTargetQty <= 0) {
    throw allocationError('HUB_ORDER_ITEM_ALREADY_FULLY_ALLOCATED', 'Aucun reliquat commercial ne peut être alloué à ce colis.', {
      order_item_id: orderItemId,
      ordered_quantity: orderedQty,
      other_parcel_quantity: otherQty,
    });
  }

  if (targetRows.length > 0) {
    const primary = targetRows[0];
    const targetQty = targetRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const desiredQty = Math.min(maxTargetQty, Math.max(targetQty, targetQty + physicalQty));

    // Si la ligne existante est déjà un plan complet (auto-parcel), on ne
    // double-compte pas le scan physique. Sinon, on augmente la première ligne.
    if (desiredQty > targetQty) {
      await executor.query(
        `UPDATE parcel_items
            SET quantity = quantity + $2
          WHERE id = $1`,
        [primary.id, desiredQty - targetQty]
      );
    }

    return { parcel_item_id: primary.id, created: false, planned_quantity: Math.max(targetQty, desiredQty) };
  }

  const insertQty = Math.min(physicalQty, maxTargetQty);
  const { rows: [created] } = await executor.query(`
    INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
    VALUES ($1, $2, $3, $4)
    RETURNING id, parcel_id, order_item_id, quantity
  `, [parcelId, orderItemId, orderItem.product_id, insertQty]);

  return { parcel_item_id: created.id, created: true, planned_quantity: Number(created.quantity) };
}

module.exports = {
  assignWholeOrderItemToParcel,
  assignParcelItem,
  addParcelItem,
  removeParcelItem,
  assignSingleOrderItemToParcel,
  assignPhysicalAllocationToParcel,
};
