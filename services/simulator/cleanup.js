/**
 * @komerce-arch
 * @role          cleanup
 * @domain        unknown
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

/**
 * Simulator Cleanup — nettoyage des données de simulation
 */
'use strict';

const db = require('../../db');

async function cleanup() {
  const results = { deleted: {}, errors: [] };

  try {
    // 1. Delete parcel_items linked to simulator parcels
    const { rowCount: piCount } = await db.query(`
      DELETE FROM parcel_items WHERE parcel_id IN (
        SELECT id FROM parcels WHERE notes LIKE '%simulateur%'
      )
    `);
    results.deleted.parcel_items = piCount || 0;

    // 2. Delete parcels created by simulator
    const { rowCount: pCount } = await db.query(`
      DELETE FROM parcels WHERE notes LIKE '%simulateur%'
    `);
    results.deleted.parcels = pCount || 0;

    // 3. Delete scans from simulator
    const { rowCount: sCount } = await db.query(`
      DELETE FROM scans WHERE notes LIKE '%simulateur%' OR notes LIKE '%Simulateur%'
    `);
    results.deleted.scans = sCount || 0;

    // 4. Reset orders that were advanced by simulator back to pending
    // (Only if they were pending originally — safer to just delete test orders)
    // For now, just clean up simulator artifacts without touching orders

  } catch(e) {
    results.errors.push(e.message);
  }

  return results;
}

module.exports = { cleanup };
