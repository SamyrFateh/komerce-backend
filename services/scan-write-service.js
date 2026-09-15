/**
 * @komerce-arch
 * @role          logistics-scan-write-service
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        db_or_transaction_executor, scan mutation payload
 * @outputs       query result / created scan row
 * @depends       none (executor fourni par l'appelant)
 * @used-by       routes/hub-dashboard.js, routes/admin/users.js, services/qr-collection-core.js, services/inventory-service.js, services/hub-packing-service.js
 * @db-read       none
 * @db-write      scans, scan_events
 * @db-txn        caller_transaction_preserved
 * @doctrine      writer_not_owner_boundary, HUB-001_PHYSICAL_IDENTITY_ALLOCATION_CUSTODY
 * @impact-areas  logistics, orders, dashboard, inventory
 * @version       2026-09
 */

'use strict';

function assertExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('scan-write-service requires an executor exposing query(sql, params)');
  }
}

async function recordHubPreparationScan(executor, {
  orderId,
  scannedBy,
  notes,
  scanCode,
}) {
  assertExecutor(executor);
  return executor.query(
    `INSERT INTO scans (order_id, step, scanned_by, notes, scan_code)
     VALUES ($1, 'preparation', $2, $3, $4)`,
    [orderId, scannedBy, notes, scanCode]
  );
}

async function recordHubPhysicalEvent(executor, {
  parcelId,
  orderId,
  eventType,
  scanCode,
  scannedBy = null,
  notes,
  metadata = {},
}) {
  assertExecutor(executor);
  const { rows: [event] } = await executor.query(`
    INSERT INTO scan_events (
      parcel_id, order_id, event_type, scan_code,
      scanned_by, actor_role, notes, metadata, status
    ) VALUES ($1,$2,$3,$4,$5,'hub_agent',$6,$7::jsonb,'applied')
    RETURNING id, parcel_id, order_id, event_type, created_at
  `, [
    parcelId,
    orderId || null,
    eventType,
    scanCode || null,
    scannedBy,
    notes || null,
    JSON.stringify({ ...metadata, hub_contract: 'HUB-001' }),
  ]);
  return event;
}

async function recordHubAllocationScanEvent(executor, {
  parcelId,
  orderId,
  inventoryItemId,
  orderItemId,
  purchaseOrderId,
  marketId,
  relaisId,
  quantity,
  scannedBy = null,
  matchedProposal = null,
}) {
  return recordHubPhysicalEvent(executor, {
    parcelId,
    orderId,
    eventType: 'item_scanned',
    scanCode: String(inventoryItemId),
    scannedBy,
    notes: 'Physical allocation assigned to compatible Market Parcel',
    metadata: {
      action: 'assign',
      inventory_item_id: inventoryItemId,
      order_item_id: orderItemId,
      purchase_order_id: purchaseOrderId,
      market_id: marketId,
      relais_id: relaisId,
      quantity,
      matched_proposal: matchedProposal,
    },
  });
}

async function recordHubSplitEvent(executor, {
  parcelId,
  orderId,
  sourceInventoryItemId,
  childInventoryItemId,
  orderItemId,
  purchaseOrderId,
  fromParcelId,
  toParcelId,
  quantity,
  scannedBy = null,
}) {
  return recordHubPhysicalEvent(executor, {
    parcelId,
    orderId,
    eventType: 'correction',
    scanCode: String(childInventoryItemId),
    scannedBy,
    notes: 'Explicit physical allocation split',
    metadata: {
      action: 'split',
      source_inventory_item_id: sourceInventoryItemId,
      child_inventory_item_id: childInventoryItemId,
      order_item_id: orderItemId,
      purchase_order_id: purchaseOrderId,
      from_parcel_id: fromParcelId,
      to_parcel_id: toParcelId,
      quantity,
    },
  });
}

async function recordHubRepackEvent(executor, {
  parcelId,
  orderId,
  inventoryItemId,
  orderItemId,
  purchaseOrderId,
  fromParcelId,
  toParcelId,
  quantity,
  scannedBy = null,
}) {
  return recordHubPhysicalEvent(executor, {
    parcelId,
    orderId,
    eventType: 'correction',
    scanCode: String(inventoryItemId),
    scannedBy,
    notes: 'Explicit physical allocation repack',
    metadata: {
      action: 'repack',
      inventory_item_id: inventoryItemId,
      order_item_id: orderItemId,
      purchase_order_id: purchaseOrderId,
      from_parcel_id: fromParcelId,
      to_parcel_id: toParcelId,
      quantity,
    },
  });
}

async function recordQrCollectionScan(executor, {
  orderId,
  scannedBy,
  location,
  scanCode,
}) {
  assertExecutor(executor);
  const { rows: [scanRow] } = await executor.query(
    `INSERT INTO scans
       (order_id, step, scanned_by, location, scan_code, notes)
     VALUES ($1, 'collected', $2, $3, $4, 'Retrait client via QR Code — token validé')
     RETURNING id`,
    [orderId, scannedBy, location, scanCode]
  );
  return scanRow;
}

async function detachUserFromScans(executor, userId) {
  assertExecutor(executor);
  return executor.query(
    'UPDATE scans SET scanned_by = NULL WHERE scanned_by = $1::uuid',
    [userId]
  );
}

module.exports = {
  recordHubPreparationScan,
  recordHubPhysicalEvent,
  recordHubAllocationScanEvent,
  recordHubSplitEvent,
  recordHubRepackEvent,
  recordQrCollectionScan,
  detachUserFromScans,
};
