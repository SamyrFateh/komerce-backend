/**
 * @komerce-arch
 * @role          logistics-scan-write-service
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        db_or_transaction_executor, scan mutation payload
 * @outputs       query result / created scan row
 * @depends       none (executor fourni par l'appelant)
 * @used-by       routes/hub-dashboard.js, routes/admin/users.js, services/qr-collection-core.js, services/inventory-service.js
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

/**
 * Enregistre un scan de préparation produit par le Hub.
 * L'appelant conserve la propriété de sa transaction éventuelle.
 */
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

/**
 * HUB-001 — preuve append-only qu'une allocation physique prouvée a été
 * scannée dans un Market Parcel compatible. scan_events reste lifecycle-owned
 * par Logistics ; Inventory ne fait donc aucun INSERT direct dans cette table.
 */
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
  assertExecutor(executor);

  const metadata = {
    inventory_item_id: inventoryItemId,
    order_item_id: orderItemId,
    purchase_order_id: purchaseOrderId,
    market_id: marketId,
    relais_id: relaisId,
    quantity,
    matched_proposal: matchedProposal,
    hub_contract: 'HUB-001',
  };

  const { rows: [event] } = await executor.query(`
    INSERT INTO scan_events (
      parcel_id, order_id, event_type, scan_code,
      scanned_by, actor_role, notes, metadata, status
    ) VALUES (
      $1, $2, 'item_scanned', $3,
      $4, 'hub_agent', 'Physical allocation assigned to compatible Market Parcel', $5::jsonb, 'applied'
    )
    RETURNING id, parcel_id, order_id, event_type, created_at
  `, [
    parcelId,
    orderId,
    String(inventoryItemId),
    scannedBy,
    JSON.stringify(metadata),
  ]);

  return event;
}

/**
 * Enregistre la preuve de scan créée lors d'une collecte QR validée.
 * Le RETURNING id est conservé car parcelSync consomme cet identifiant.
 */
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

/**
 * Détache un utilisateur supprimé des scans historiques sans supprimer
 * l'historique logistique lui-même.
 */
async function detachUserFromScans(executor, userId) {
  assertExecutor(executor);

  return executor.query(
    'UPDATE scans SET scanned_by = NULL WHERE scanned_by = $1::uuid',
    [userId]
  );
}

module.exports = {
  recordHubPreparationScan,
  recordHubAllocationScanEvent,
  recordQrCollectionScan,
  detachUserFromScans,
};
