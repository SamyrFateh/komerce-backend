/**
 * @komerce-arch
 * @role          relay-parcel-item-reconciliation
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        locked_order_item_id, physical_shipment_links, immutable_relay_receipts
 * @outputs       quantity_proof_projection_on_customer_parcels
 * @depends       db
 * @used-by       services/relay-shipment-receipt.js
 * @db-read       order_items, international_shipment_hub_units, international_shipments, hub_physical_unit_placements, hub_purchase_allocations, international_shipment_relay_receipts, parcels, parcel_items
 * @db-write      parcel_items
 * @db-txn        caller_transaction_with_order_item_lock
 * @doctrine      single_physical_truth, no_fabricated_quantities, receipt_regression_forbidden
 * @impact-areas  logistics, relay, orders
 * @version       2026-11
 */
'use strict';

class RelayParcelProjectionError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new RelayParcelProjectionError(status, code, message); };

/**
 * Synchronise la projection du colis client depuis les deux faits physiques :
 *  - quantité expédiée : KOM-BOX effectivement remises au transitaire ;
 *  - quantité reçue : attestations immuables des agents relais.
 * Ne crée jamais de quantité fictive et n'abaisse pas une preuve déjà inscrite.
 * Le verrou de l'expédition puis les FOR UPDATE des parcel_items sérialisent la réconciliation.
 */
async function projectRelayReceiptToClientParcels(client, orderItemId) {
  // Verrou commun aux expéditions concurrentes touchant le même article client.
  await client.query('SELECT id FROM order_items WHERE id = $1 FOR UPDATE', [orderItemId]);
  const { rows: [totals] } = await client.query(`
    SELECT
      (SELECT COALESCE(SUM(placement.quantity), 0)::int
         FROM international_shipment_hub_units ship_box
         JOIN international_shipments ship ON ship.id = ship_box.shipment_id AND ship.stage <> 'hub_ready'
         JOIN hub_physical_unit_placements placement
           ON placement.physical_unit_id = ship_box.physical_unit_id AND placement.removed_at IS NULL
         JOIN hub_purchase_allocations alloc ON alloc.id = placement.allocation_id
        WHERE alloc.order_item_id = $1) AS physically_shipped,
      (SELECT COALESCE(SUM(receipt.received_qty), 0)::int
         FROM international_shipment_relay_receipts receipt
        WHERE receipt.order_item_id = $1) AS attested_received
  `, [orderItemId]);
  let shipped = Number(totals.physically_shipped || 0);
  let received = Math.min(shipped, Number(totals.attested_received || 0));
  const { rows: parcels } = await client.query(`
    SELECT pi.id, pi.quantity, pi.qty_packed, pi.qty_shipped, pi.qty_received
      FROM parcel_items pi JOIN parcels p ON p.id = pi.parcel_id
     WHERE pi.order_item_id = $1 AND p.cancelled_at IS NULL
     ORDER BY pi.created_at, pi.id
     FOR UPDATE OF pi
  `, [orderItemId]);
  let projected = 0;
  for (const pi of parcels) {
    const targetShipped = Math.min(Number(pi.quantity), shipped);
    const targetReceived = Math.min(targetShipped, received);
    if (targetShipped > Number(pi.qty_packed)) {
      fail(409, 'RELAY_PARCEL_PACKING_PROOF_MISSING',
        'Colis client non rapproché de sa preuve KOM-BOX : expédition non enregistrable comme réception client.');
    }
    if (targetShipped < Number(pi.qty_shipped) || targetReceived < Number(pi.qty_received)) {
      fail(409, 'RELAY_PARCEL_RECEIPT_REGRESSION',
        'La réception ne peut réduire une quantité précédemment attestée sur le colis client.');
    }
    if (targetShipped !== Number(pi.qty_shipped) || targetReceived !== Number(pi.qty_received)) {
      await client.query(
        'UPDATE parcel_items SET qty_shipped = $2, qty_received = $3 WHERE id = $1',
        [pi.id, targetShipped, targetReceived]
      );
    }
    projected += targetReceived;
    shipped -= targetShipped;
    received -= targetReceived;
  }
  if (shipped > 0) {
    fail(409, 'RELAY_CLIENT_PARCEL_COVERAGE_MISSING',
      'Une partie des articles expédiés ne figure dans aucun colis client actif.');
  }
  return { projected_received: projected, parcels_updated: parcels.length };
}


module.exports = { projectRelayReceiptToClientParcels, RelayParcelProjectionError };
