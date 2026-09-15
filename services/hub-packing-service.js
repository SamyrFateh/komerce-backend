/**
 * @komerce-arch
 * @role          inventory-hub-packing-service
 * @domain        inventory
 * @layer         service
 * @criticality   critical
 * @inputs        inventory_item_id, target parcel, quantity, actor
 * @outputs       auditable split/repack result
 * @depends       db, services/hub-allocation-service.js, services/parcel-item-mutation-service.js, services/scan-write-service.js
 * @used-by       routes/inventory-api.js
 * @db-read       inventory_items, orders, purchase_orders, parcels, parcel_items
 * @db-write      inventory_items
 * @db-write-via:parcel-item-mutation-service parcel_items
 * @db-write-via:scan-write-service scan_events
 * @db-txn        packing_operation_atomic
 * @doctrine      HUB-001_PHYSICAL_IDENTITY_ALLOCATION_CUSTODY
 * @impact-areas  inventory, logistics, purchasing, orders
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const { assertParcelCompatible, hubAllocationError } = require('./hub-allocation-service');
const { splitParcelItemAllocation } = require('./parcel-item-mutation-service');
const { recordHubSplitEvent, recordHubRepackEvent } = require('./scan-write-service');

async function loadAssignedAllocation(client, inventoryItemId) {
  const { rows: [item] } = await client.query(`
    SELECT ii.*,
           o.market_id,
           o.relais_id,
           po.order_id AS purchase_order_order_id,
           po.order_item_id AS purchase_order_item_id,
           po.status AS purchase_status
      FROM inventory_items ii
      JOIN orders o ON o.id = ii.order_id
      LEFT JOIN purchase_orders po ON po.id = ii.purchase_order_id
     WHERE ii.id = $1
     FOR UPDATE OF ii
  `, [inventoryItemId]);

  if (!item || item.status !== 'assigned' || !item.parcel_id) {
    throw hubAllocationError('HUB_PHYSICAL_ALLOCATION_NOT_ASSIGNED', 'Allocation physique introuvable ou non assignée.', { inventory_item_id: inventoryItemId });
  }
  if (!item.purchase_order_id || !item.identity_verified_at) {
    throw hubAllocationError('HUB_PURCHASE_ALLOCATION_UNPROVEN', 'Allocation physique non prouvée : split/repack interdit.', { inventory_item_id: inventoryItemId });
  }
  if (
    item.purchase_status === 'cancelled' ||
    String(item.purchase_order_order_id || '') !== String(item.order_id) ||
    String(item.purchase_order_item_id || '') !== String(item.order_item_id)
  ) {
    throw hubAllocationError('HUB_PURCHASE_ALLOCATION_CONFLICT', 'La vérité Purchasing ne correspond plus à l’allocation physique.', {
      inventory_item_id: inventoryItemId,
      purchase_order_id: item.purchase_order_id,
    });
  }
  return item;
}

/**
 * Divise une allocation physique. Le parent reste dans son colis et garde une
 * quantité positive. L'enfant hérite de la même identité commerciale/achat,
 * avec `split_from_inventory_item_id` comme lineage explicite.
 */
async function splitPhysicalAllocation({ inventory_item_id, to_parcel_id, quantity, actor_id = null } = {}) {
  const splitQty = Number(quantity);
  if (!Number.isInteger(splitQty) || splitQty <= 0) {
    throw hubAllocationError('HUB_INVALID_SPLIT_QUANTITY', 'Quantité de split invalide.', { quantity });
  }

  return db.withTransaction(async (client) => {
    const source = await loadAssignedAllocation(client, inventory_item_id);
    const sourceQty = Number(source.quantity || 0);
    if (splitQty >= sourceQty) {
      throw hubAllocationError('HUB_SPLIT_MUST_LEAVE_SOURCE', 'Le split doit laisser une quantité positive dans le colis source.', {
        source_quantity: sourceQty,
        split_quantity: splitQty,
      });
    }

    const target = await assertParcelCompatible(client, { parcelId: to_parcel_id, allocation: source });
    if (String(target.id) === String(source.parcel_id)) {
      throw hubAllocationError('HUB_SPLIT_SAME_PARCEL', 'Le split exige un colis cible différent.');
    }

    const packing = await splitParcelItemAllocation(client, {
      fromParcelId: source.parcel_id,
      toParcelId: target.id,
      orderItemId: source.order_item_id,
      quantity: splitQty,
    });

    await client.query(
      `UPDATE inventory_items SET quantity = quantity - $2, updated_at = NOW() WHERE id = $1`,
      [source.id, splitQty]
    );

    const { rows: [child] } = await client.query(`
      INSERT INTO inventory_items (
        id, order_item_id, order_id, product_id, quantity,
        purchase_order_id, identity_verified_at, split_from_inventory_item_id,
        status, parcel_id, received_at, assigned_at, received_by, notes
      ) VALUES (
        gen_random_uuid(), $1,$2,$3,$4,
        $5,$6,$7,
        'assigned',$8,$9,NOW(),$10,$11
      )
      RETURNING *
    `, [
      source.order_item_id,
      source.order_id,
      source.product_id,
      splitQty,
      source.purchase_order_id,
      source.identity_verified_at,
      source.id,
      target.id,
      source.received_at,
      source.received_by || null,
      `HUB-001 split from inventory_item ${source.id}`,
    ]);

    const evidence = await recordHubSplitEvent(client, {
      parcelId: target.id,
      orderId: source.order_id,
      sourceInventoryItemId: source.id,
      childInventoryItemId: child.id,
      orderItemId: source.order_item_id,
      purchaseOrderId: source.purchase_order_id,
      fromParcelId: source.parcel_id,
      toParcelId: target.id,
      quantity: splitQty,
      scannedBy: actor_id,
    });

    return {
      split: true,
      source_inventory_item_id: source.id,
      child_inventory_item: child,
      from_parcel_id: source.parcel_id,
      to_parcel_id: target.id,
      quantity: splitQty,
      source_remaining_quantity: sourceQty - splitQty,
      target_parcel_item_id: packing.target_parcel_item_id,
      evidence_scan_event_id: evidence && evidence.id,
    };
  });
}

/**
 * Repack explicite d'une allocation physique complète vers un autre contenant
 * COMPATIBLE. Contrairement à une réassignation commerciale, order/order_item/
 * PO/Market/Relais restent inchangés. L'opération est atomique et auditée.
 */
async function repackPhysicalAllocation({ inventory_item_id, to_parcel_id, actor_id = null } = {}) {
  return db.withTransaction(async (client) => {
    const item = await loadAssignedAllocation(client, inventory_item_id);
    const target = await assertParcelCompatible(client, { parcelId: to_parcel_id, allocation: item });
    if (String(target.id) === String(item.parcel_id)) {
      throw hubAllocationError('HUB_REPACK_SAME_PARCEL', 'Le repack exige un autre colis physique.');
    }

    const qty = Number(item.quantity || 0);
    const { rows: packingRows } = await client.query(`
      SELECT pi.id, pi.parcel_id, pi.quantity
        FROM parcel_items pi
       WHERE pi.order_item_id = $1
         AND pi.parcel_id = ANY($2::uuid[])
       ORDER BY pi.id
       FOR UPDATE
    `, [item.order_item_id, [item.parcel_id, target.id]]);

    const sourcePacking = packingRows.find((r) => String(r.parcel_id) === String(item.parcel_id));
    const targetPacking = packingRows.find((r) => String(r.parcel_id) === String(target.id));
    if (!sourcePacking || Number(sourcePacking.quantity || 0) < qty) {
      throw hubAllocationError('HUB_REPACK_SOURCE_QUANTITY_CONFLICT', 'Le packing source ne couvre pas l’allocation physique à repacker.', {
        inventory_item_id: item.id,
        physical_quantity: qty,
        packing_quantity: sourcePacking ? Number(sourcePacking.quantity || 0) : 0,
      });
    }

    const sourceRemaining = Number(sourcePacking.quantity) - qty;
    if (sourceRemaining === 0) {
      await client.query('DELETE FROM parcel_items WHERE id = $1', [sourcePacking.id]);
    } else {
      await client.query('UPDATE parcel_items SET quantity = $2 WHERE id = $1', [sourcePacking.id, sourceRemaining]);
    }

    if (targetPacking) {
      await client.query('UPDATE parcel_items SET quantity = quantity + $2 WHERE id = $1', [targetPacking.id, qty]);
    } else {
      await client.query(`
        INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
        VALUES ($1,$2,$3,$4)
      `, [target.id, item.order_item_id, item.product_id, qty]);
    }

    const { rows: [moved] } = await client.query(`
      UPDATE inventory_items
         SET parcel_id = $2, assigned_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *
    `, [item.id, target.id]);

    const evidence = await recordHubRepackEvent(client, {
      parcelId: target.id,
      orderId: item.order_id,
      inventoryItemId: item.id,
      orderItemId: item.order_item_id,
      purchaseOrderId: item.purchase_order_id,
      fromParcelId: item.parcel_id,
      toParcelId: target.id,
      quantity: qty,
      scannedBy: actor_id,
    });

    return {
      repacked: true,
      inventory_item: moved,
      from_parcel_id: item.parcel_id,
      to_parcel_id: target.id,
      quantity: qty,
      evidence_scan_event_id: evidence && evidence.id,
    };
  });
}

module.exports = { splitPhysicalAllocation, repackPhysicalAllocation, loadAssignedAllocation };
