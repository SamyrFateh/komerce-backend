/**
 * @komerce-arch
 * @role          logistics-parcel-item-mutation-service
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        db_or_transaction_executor, parcel item mutation payload
 * @outputs       query result / parcel item row
 * @depends       none (executor fourni par l'appelant)
 * @used-by       routes/hub-dashboard.js, services/inventory-service.js, services/hub-packing-service.js
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

async function assignWholeOrderItemToParcel(executor, { parcelId, orderItemId, orderId }) {
  assertExecutor(executor);
  return executor.query(
    `INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
     SELECT $1, oi.id, oi.product_id, oi.quantity
     FROM order_items oi WHERE oi.id = $2 AND oi.order_id = $3
     ON CONFLICT DO NOTHING`,
    [parcelId, orderItemId, orderId]
  );
}

async function assignParcelItem(executor, { parcelId, orderItemId, productId, quantity }) {
  assertExecutor(executor);
  return executor.query(
    `INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [parcelId, orderItemId, productId, quantity]
  );
}

async function addParcelItem(executor, { parcelId, orderItemId, productId, quantity }) {
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

async function removeParcelItem(executor, { parcelId, orderItemId }) {
  assertExecutor(executor);
  const { rows: [row] } = await executor.query(
    'DELETE FROM parcel_items WHERE parcel_id = $1 AND order_item_id = $2 RETURNING *',
    [parcelId, orderItemId]
  );
  return row || null;
}

async function assignSingleOrderItemToParcel(executor, { parcelId, orderItemId }) {
  assertExecutor(executor);
  return executor.query(
    `INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
     SELECT $1, $2, oi.product_id, 1
     FROM order_items oi WHERE oi.id = $3
     ON CONFLICT DO NOTHING`,
    [parcelId, orderItemId, orderItemId]
  );
}

async function assignPhysicalAllocationToParcel(executor, { parcelId, orderItemId, quantity }) {
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
     ORDER BY pi.id
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
    const desiredQty = Math.min(maxTargetQty, targetQty + physicalQty);
    if (desiredQty > targetQty) {
      await executor.query(
        `UPDATE parcel_items SET quantity = quantity + $2 WHERE id = $1`,
        [primary.id, desiredQty - targetQty]
      );
    }
    return { parcel_item_id: primary.id, created: false, planned_quantity: desiredQty };
  }

  const insertQty = Math.min(physicalQty, maxTargetQty);
  const { rows: [created] } = await executor.query(`
    INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
    VALUES ($1, $2, $3, $4)
    RETURNING id, parcel_id, order_item_id, quantity
  `, [parcelId, orderItemId, orderItem.product_id, insertQty]);

  return { parcel_item_id: created.id, created: true, planned_quantity: Number(created.quantity) };
}

/**
 * HUB-001 — split EXPLICITE d'une quantité de packing d'un Market Parcel vers
 * un autre contenant compatible. Un split total serait un move/reassign : il
 * est donc interdit ici. La somme des quantités reste constante.
 */
async function splitParcelItemAllocation(executor, {
  fromParcelId,
  toParcelId,
  orderItemId,
  quantity,
}) {
  assertExecutor(executor);
  const splitQty = Number(quantity);
  if (!Number.isInteger(splitQty) || splitQty <= 0) {
    throw allocationError('HUB_INVALID_SPLIT_QUANTITY', 'Quantité de split invalide.', { quantity });
  }
  if (String(fromParcelId) === String(toParcelId)) {
    throw allocationError('HUB_SPLIT_SAME_PARCEL', 'Le split exige deux colis distincts.');
  }

  const { rows: [orderItem] } = await executor.query(
    'SELECT id, product_id FROM order_items WHERE id = $1 FOR SHARE',
    [orderItemId]
  );
  if (!orderItem) throw allocationError('HUB_ORDER_ITEM_NOT_FOUND', 'Article de commande introuvable.');

  const { rows } = await executor.query(`
    SELECT pi.id, pi.parcel_id, pi.quantity
      FROM parcel_items pi
     WHERE pi.order_item_id = $1
       AND pi.parcel_id = ANY($2::uuid[])
     ORDER BY pi.id
     FOR UPDATE
  `, [orderItemId, [fromParcelId, toParcelId]]);

  const source = rows.find((r) => String(r.parcel_id) === String(fromParcelId));
  const target = rows.find((r) => String(r.parcel_id) === String(toParcelId));
  if (!source) {
    throw allocationError('HUB_SPLIT_SOURCE_NOT_FOUND', 'Allocation source introuvable dans le colis source.');
  }
  const sourceQty = Number(source.quantity || 0);
  if (splitQty >= sourceQty) {
    throw allocationError(
      'HUB_SPLIT_MUST_LEAVE_SOURCE',
      'Un split doit laisser une quantité positive dans le colis source ; déplacer toute la quantité serait une réassignation.',
      { source_quantity: sourceQty, split_quantity: splitQty }
    );
  }

  await executor.query('UPDATE parcel_items SET quantity = quantity - $2 WHERE id = $1', [source.id, splitQty]);

  let targetId;
  if (target) {
    await executor.query('UPDATE parcel_items SET quantity = quantity + $2 WHERE id = $1', [target.id, splitQty]);
    targetId = target.id;
  } else {
    const { rows: [created] } = await executor.query(`
      INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [toParcelId, orderItemId, orderItem.product_id, splitQty]);
    targetId = created.id;
  }

  return {
    order_item_id: orderItemId,
    from_parcel_id: fromParcelId,
    to_parcel_id: toParcelId,
    split_quantity: splitQty,
    source_remaining_quantity: sourceQty - splitQty,
    target_parcel_item_id: targetId,
  };
}

module.exports = {
  assignWholeOrderItemToParcel,
  assignParcelItem,
  addParcelItem,
  removeParcelItem,
  assignSingleOrderItemToParcel,
  assignPhysicalAllocationToParcel,
  splitParcelItemAllocation,
};
