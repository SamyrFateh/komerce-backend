/**
 * @komerce-arch
 * @role          hub-combox-destination-guard
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        caller_locked_transaction_executor, target_unit_id, immutable_allocation
 * @outputs       destination_mismatch_or_null
 * @depends       none
 * @used-by       services/hub-physical-identity.js
 * @db-read       hub_physical_unit_placements, hub_purchase_allocations
 * @db-write      none
 * @db-txn        caller_owned_transaction_required
 * @doctrine      HUB-001 mono-relais COMBOX, same-market destination isolation
 * @impact-areas  logistics, market
 * @version       2026-11
 */
'use strict';

// Caller holds the target unit lock: two concurrent moves cannot establish
// different destinations in an empty box. Read immutable allocation snapshots.
async function checkBoxDestination(db, toUnitId, allocation) {
  const { rows: targetDestinations } = await db.query(
    `SELECT DISTINCT a.market_id, a.destination_ref FROM hub_physical_unit_placements p
       JOIN hub_purchase_allocations a ON a.id=p.allocation_id
      WHERE p.physical_unit_id=$1 AND p.removed_at IS NULL`, [toUnitId]
  );
  if (targetDestinations.some(row => String(row.market_id) !== String(allocation.market_id))) {
    return {code:'HUB_BOX_MARKET_MISMATCH'};
  }
  if (!allocation.destination_ref || targetDestinations.some(row =>
    !row.destination_ref || row.destination_ref !== allocation.destination_ref)) {
    return {code:'HUB_BOX_RELAY_MISMATCH', message:'Article destiné à un autre relais : choisissez une COMBOX de sa destination'};
  }
  return null;
}

module.exports = { checkBoxDestination };
