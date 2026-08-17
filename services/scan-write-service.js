/**
 * @komerce-arch
 * @role          logistics-scan-write-service
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        db_or_transaction_executor, scan mutation payload
 * @outputs       query result / created scan row
 * @depends       none (executor fourni par l'appelant)
 * @used-by       routes/hub-dashboard.js, routes/admin/users.js, services/qr-collection-core.js
 * @db-read       none
 * @db-write      scans
 * @db-txn        caller_transaction_preserved
 * @doctrine      writer_not_owner_boundary
 * @impact-areas  logistics, orders, dashboard
 * @version       2026-08
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
  recordQrCollectionScan,
  detachUserFromScans,
};
