/**
 * @komerce-arch
 * @role          international-handover-customer-parcel-status
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        shipment_id, verified_handover, locked_transaction_client, authenticated_actor
 * @outputs       transitioned_customer_parcels, immutable_parcel_events
 * @depends       services/parcel-operations.js
 * @used-by       services/international-shipment-journey.js
 * @db-read       international_shipment_hub_units, hub_box_effective_placements, hub_purchase_allocations, parcels, parcel_items
 * @db-write      parcel_events
 * @db-write-via:parcel-operations parcels
 * @db-txn        caller_owned_handover_transaction
 * @doctrine      customer_parcel_shipped_only_when_all_parcel_items_physically_handed_over, no_duplicate_status_writer
 */
'use strict';

const { transitionParcelStatus } = require('./parcel-operations');

class HandoverParcelError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.status = 409;
  }
}

/**
 * Exécuter APRÈS le trigger 370 qui dérive parcel_items.qty_shipped.
 * Les colis mixtes ou partiels ne changent de statut que si TOUT le colis
 * client est physiquement parti. Une commande partielle ne devient pas
 * automatiquement shipped/closed par cette projection.
 */
async function markFullyHandedOverParcelsShipped(client, shipmentId, actor, proofRef) {
  if (!client?.query || !actor?.id || !shipmentId || !proofRef) {
    throw new HandoverParcelError('HANDOVER_PARCEL_PROOF_REQUIRED', 'Transaction, expédition, acteur et preuve requis');
  }
  const { rows: parcels } = await client.query(`
    SELECT p.id, p.reference, p.status, p.order_id,
           qty.expected_qty, qty.shipped_qty
      FROM parcels p
      JOIN (
        SELECT pi.parcel_id,
               SUM(pi.quantity)::int AS expected_qty,
               SUM(pi.qty_shipped)::int AS shipped_qty
          FROM parcel_items pi
         GROUP BY pi.parcel_id
        HAVING SUM(pi.qty_shipped)>0 AND SUM(pi.qty_shipped)=SUM(pi.quantity)
      ) qty ON qty.parcel_id=p.id
     WHERE p.cancelled_at IS NULL
       AND p.status IN ('preparation','shipped','in_transit','arrived','available','collected')
       AND EXISTS (
         SELECT 1 FROM parcel_items rel_pi
         JOIN hub_purchase_allocations a ON a.order_item_id=rel_pi.order_item_id
         JOIN hub_box_effective_placements placements ON placements.allocation_id=a.id
         JOIN international_shipment_hub_units boxes ON boxes.physical_unit_id=placements.box_unit_id
          WHERE rel_pi.parcel_id=p.id AND boxes.shipment_id=$1
       )
     ORDER BY p.id FOR UPDATE OF p`, [shipmentId]);
  const transitioned = [];
  for (const parcel of parcels) {
    if (parcel.status !== 'preparation') continue;
    const change = await transitionParcelStatus(client, parcel.id, 'shipped');
    if (!change?.ok) throw new HandoverParcelError('HANDOVER_PARCEL_TRANSITION_REFUSED',
      `Colis ${parcel.reference} non expédiable : ${change?.body?.error || change?.status || 'inconnu'}`);
    await client.query(
      "INSERT INTO parcel_events(parcel_id,event_type,actor_id,notes,metadata) VALUES($1,'shipped',$2,$3,$4::jsonb)",
      [parcel.id, actor.id, `Remise physique transitaire ${proofRef}`,
        JSON.stringify({ source:'international_shipment_handover', shipment_id:shipmentId,
          proof_ref:proofRef, expected_qty:parcel.expected_qty, shipped_qty:parcel.shipped_qty })]);
    transitioned.push(parcel.reference);
  }
  return { parcels_marked_shipped: transitioned };
}

module.exports = { markFullyHandedOverParcelsShipped, HandoverParcelError };
