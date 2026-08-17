/**
 * @komerce-arch
 * @role          logistics-parcel-mutation-boundary
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        caller_owned_queryable, parcel_mutation_payload
 * @outputs       parcel_mutation_result
 * @depends       none
 * @used-by       routes/hub-dashboard.js, services/customs-shipment-service.js, services/cash-reminder-service.js
 * @db-read       none
 * @db-write      parcels
 * @db-txn        caller_owned_queryable
 * @doctrine      lifecycle_owner_boundary, preserve_caller_transaction
 * @impact-areas  logistics, dashboard, customs, payments
 * @version       2026-08
 */

'use strict';

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('[parcel-mutation-service] requires an executor with query()');
  }
  return executor;
}

async function createHubParcel(executor, {
  reference,
  externalCode,
  sealCode,
  orderId,
  type,
  notes,
}) {
  const db = requireExecutor(executor);

  if (externalCode) {
    const { rows: [parcel] } = await db.query(
      `INSERT INTO parcels (reference, external_code, seal_code, order_id, type, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft') RETURNING *`,
      [reference, externalCode, sealCode, orderId, type, notes || null]
    );
    return parcel;
  }

  const { rows: [parcel] } = await db.query(
    `INSERT INTO parcels (reference, order_id, type, notes, status)
     VALUES ($1, $2, $3, $4, 'draft') RETURNING *`,
    [reference, orderId, type, notes || null]
  );
  return parcel;
}

async function createAutoPreparedParcel(executor, {
  reference,
  externalCode,
  sealCode,
  orderId,
  notes,
}) {
  const db = requireExecutor(executor);

  if (externalCode) {
    const { rows: [parcel] } = await db.query(
      `INSERT INTO parcels (reference, external_code, seal_code, order_id, type, status, notes)
       VALUES ($1, $2, $3, $4, 'standard', 'draft', $5) RETURNING *`,
      [reference, externalCode, sealCode, orderId, notes]
    );
    return parcel;
  }

  const { rows: [parcel] } = await db.query(
    `INSERT INTO parcels (reference, order_id, type, status, notes)
     VALUES ($1, $2, 'standard', 'draft', $3) RETURNING *`,
    [reference, orderId, notes]
  );
  return parcel;
}

async function setParcelWeight(executor, { parcelId, weightKg }) {
  const db = requireExecutor(executor);
  return db.query(
    'UPDATE parcels SET weight_kg = $1 WHERE id = $2',
    [weightKg, parcelId]
  );
}

async function appendParcelShipmentInfo(executor, { parcelId, note }) {
  const db = requireExecutor(executor);
  return db.query(
    `UPDATE parcels SET
       shipped_at = NOW(),
       notes = COALESCE(notes, '') || $1,
       updated_at = NOW()
     WHERE id = $2`,
    [note, parcelId]
  );
}

async function markCustomsCleared(executor, { parcelIds, notes }) {
  const db = requireExecutor(executor);
  return db.query(
    `UPDATE parcels
        SET customs_cleared_at = NOW(),
            customs_notes      = $2
      WHERE id = ANY($1::uuid[])
        AND customs_cleared_at IS NULL`,
    [parcelIds, notes || null]
  );
}

async function markBackorderReminderSent(executor, parcelId) {
  const db = requireExecutor(executor);
  return db.query(
    `UPDATE parcels SET backorder_reminder_sent = TRUE, updated_at = NOW()
     WHERE id = $1`,
    [parcelId]
  );
}

module.exports = {
  createHubParcel,
  createAutoPreparedParcel,
  setParcelWeight,
  appendParcelShipmentInfo,
  markCustomsCleared,
  markBackorderReminderSent,
};
