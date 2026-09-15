/**
 * @komerce-arch
 * @role          logistics-hub-seal-service
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        parcel_id, hub actor, notes
 * @outputs       parcel-scoped shipped transition
 * @depends       db, services/hub-allocation-service.js, services/parcel-operations.js, services/order-status-machine.js, utils/parcels.js
 * @used-by       routes/hub.js
 * @db-read       inventory_items, incidents, order_items, orders, parcel_items, parcels, relais
 * @db-write      parcel_events
 * @db-write-via:parcel-operations parcels
 * @db-write-via:order-status-machine orders, order_status_history
 * @db-txn        seal_atomic
 * @doctrine      HUB-001_PHYSICAL_IDENTITY_ALLOCATION_CUSTODY, F2_INCIDENT_GOVERNANCE_CONTRACT
 * @impact-areas  logistics, inventory, orders
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const { assertParcelPhysicalReadiness } = require('./hub-allocation-service');
const { transitionParcelStatus } = require('./parcel-operations');
const { transitionOrderStatus } = require('./order-status-machine');
const { computeOrderStatus } = require('../utils/parcels');

async function recomputeAffectedOrders(client, parcelId, actor, notes) {
  const { rows: affected } = await client.query(`
    SELECT DISTINCT oi.order_id
      FROM parcel_items pi
      JOIN order_items oi ON oi.id = pi.order_item_id
     WHERE pi.parcel_id = $1
    UNION
    SELECT p.order_id
      FROM parcels p
     WHERE p.id = $1 AND p.order_id IS NOT NULL
  `, [parcelId]);

  const results = [];
  for (const row of affected) {
    const orderId = row.order_id;
    const { rows: parcelStates } = await client.query(`
      SELECT DISTINCT p.id, p.status, p.type
        FROM parcels p
       WHERE p.status <> 'cancelled'
         AND (
           p.order_id = $1
           OR EXISTS (
             SELECT 1
               FROM parcel_items pi
               JOIN order_items oi ON oi.id = pi.order_item_id
              WHERE pi.parcel_id = p.id
                AND oi.order_id = $1
           )
         )
    `, [orderId]);

    if (!parcelStates.length) continue;
    const nextStatus = computeOrderStatus(parcelStates);
    const transition = await transitionOrderStatus({
      orderId,
      newStatus: nextStatus,
      actor,
      source: 'scan',
      note: notes || `[hub-seal] parcel=${parcelId}`,
      dbClient: client,
    });
    results.push({ order_id: orderId, status: transition.newStatus || nextStatus });
  }
  return results;
}

/**
 * HUB-001 : scelle EXACTEMENT le colis demandé.
 *
 * L'ancien chemin appelait safeSyncScanToParcels(order_id, shipped), ce qui
 * pouvait faire passer tous les colis actifs de la commande à shipped et
 * absorbait les erreurs. Ici :
 *   1. preuve de composition physique ;
 *   2. F2 incident guard via transitionParcelStatus ;
 *   3. transition du seul parcel_id ;
 *   4. recompute des commandes réellement membres du colis.
 */
async function sealHubParcel(parcelId, userId, notes = null) {
  return db.withTransaction(async (client) => {
    const { rows: [parcel] } = await client.query(`
      SELECT id, order_id, status, reference
        FROM parcels
       WHERE id = $1
         AND status <> 'cancelled'
       FOR UPDATE
    `, [parcelId]);

    if (!parcel) {
      return { status: 404, body: { error: 'Colis introuvable' } };
    }
    if (parcel.status !== 'preparation') {
      return {
        status: 400,
        body: { error: `Colis ${parcel.reference} doit être en préparation pour être scellé (statut: ${parcel.status})` },
      };
    }

    const readiness = await assertParcelPhysicalReadiness(client, parcel.id);

    const transition = await transitionParcelStatus(client, parcel.id, 'shipped');
    if (!transition.ok) {
      const err = new Error(transition.body && transition.body.error || 'Transition colis refusée');
      err.code = 'HUB_PARCEL_TRANSITION_REJECTED';
      throw err;
    }

    await client.query(`
      INSERT INTO parcel_events (parcel_id, event_type, actor_id, notes, metadata)
      VALUES ($1, 'shipped', $2, $3, $4::jsonb)
    `, [
      parcel.id,
      userId || null,
      notes || `Hub seal: ${parcel.reference}`,
      JSON.stringify({ source: 'hub_seal', hub_contract: 'HUB-001', market_id: readiness.market_id, relais_id: readiness.relais_id }),
    ]);

    const orders = await recomputeAffectedOrders(
      client,
      parcel.id,
      { id: userId || null, role: 'agent_hub' },
      notes
    );

    const { rows: [updated] } = await client.query('SELECT * FROM parcels WHERE id = $1', [parcel.id]);

    return {
      status: 200,
      body: {
        message: `Colis ${parcel.reference} scellé — prêt à expédier`,
        parcel: updated,
        affected_orders: orders,
        physical_readiness: readiness,
      },
    };
  });
}

module.exports = { sealHubParcel, recomputeAffectedOrders };
