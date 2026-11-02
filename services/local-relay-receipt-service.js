/**
 * @komerce-arch
 * @role          orders-local-relay-receipt
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        order_id, authenticated_relay_actor, attested_physical_receipt
 * @outputs       parcel_local, scan_proof, local_line_availability, order_status
 * @depends       db.js, services/order-status-machine.js, services/parcel-item-mutation-service.js, services/order-item-availability-service.js, utils/reference.js
 * @used-by       routes/orders/status.js
 * @db-read       orders, order_items, relais, parcels, local_stock_allocations
 * @db-write      parcels, parcel_items, parcel_events, scans
 * @db-write-via:parcel-item-mutation-service parcel_items, parcel_events
 * @db-write-via:order-status-machine orders, order_status_history
 * @db-write-via:order-item-availability-service order_items
 * @db-txn        caller-owned-atomic
 * @impact-areas  orders, logistics, local-stock, pickup
 */
'use strict';
const crypto = require('crypto');
const db = require('../db');
const { generateParcelRef } = require('../utils/reference');
const { transitionOrderStatus } = require('./order-status-machine');
const clientNotifications = require('./client-notification-service');
const log = require('../utils/logger').child({ module: 'local-relay-receipt' });
const { setOrderItemAvailabilityStatus } = require('./order-item-availability-service');
const { addParcelItemTraced } = require('./parcel-item-mutation-service');
const fail = (status, code, error) => ({ok:false, status, body:{code,error}});

// A relay actor's signed physical receipt, never an inference from AVAILABLE_NOW.
// Mixed orders retain import lines untouched; local proof belongs to its own parcel.
async function recordLocalRelayReceipt({orderId, actor, physicalReceived, note = null}) {
  if (!actor?.id || !['admin','agent_relais'].includes(actor.role))
    return fail(403,'LOCAL_RECEIPT_ROLE_FORBIDDEN','Seul le relais ou un administrateur peut attester la réception');
  if (physicalReceived !== true)
    return fail(400,'LOCAL_RECEIPT_PROOF_REQUIRED','La réception physique au relais doit être attestée');
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const {rows:[order]} = await client.query(
      'SELECT o.id, o.reference, o.status, o.payment_status, o.relais_id, o.user_id, r.name AS relais_name FROM orders o JOIN relais r ON r.id=o.relais_id WHERE o.id=$1 FOR UPDATE OF o', [orderId]);
    if (!order) {
      await client.query('ROLLBACK');
      return fail(404,'ORDER_NOT_FOUND','Commande introuvable');
    }
    if (actor.role==='agent_relais' && (!actor.relais_id || String(actor.relais_id)!==String(order.relais_id))) {
      await client.query('ROLLBACK');
      return fail(403,'LOCAL_RECEIPT_RELAY_FORBIDDEN','Commande hors du relais de cet agent');
    }
    if (order.payment_status!=='paid' || !['confirmed','ordered','preparation','shipped','in_transit','available'].includes(order.status)) {
      await client.query('ROLLBACK');
      return fail(409,'LOCAL_RECEIPT_ORDER_NOT_READY','Paiement non confirmé ou commande déjà avancée');
    }
    const {rows:items} = await client.query(
      'SELECT id,product_id,quantity,fulfillment_source FROM order_items WHERE order_id=$1 ORDER BY id FOR UPDATE', [orderId]);
    if (!items.some(item=>item.fulfillment_source==='LOCAL_STOCK') ||
        items.some(item=>!['LOCAL_STOCK','IMPORT'].includes(item.fulfillment_source))) {
      await client.query('ROLLBACK');
      return fail(409,'LOCAL_RECEIPT_INVALID_PROVENANCE','Réception locale impossible : provenance absente ou aucune ligne locale');
    }
    const localItems=items.filter(item=>item.fulfillment_source==='LOCAL_STOCK');
    const {rows:[stock]} = await client.query(
      "SELECT COALESCE(SUM(quantity) FILTER (WHERE consumed_at IS NOT NULL AND released_at IS NULL),0)::int AS consumed FROM local_stock_allocations WHERE order_id=$1", [orderId]);
    const expected = localItems.reduce((sum,item)=>sum+Number(item.quantity),0);
    if (Number(stock?.consumed)!==expected) {
      await client.query('ROLLBACK');
      return fail(409,'LOCAL_RECEIPT_ALLOCATION_MISMATCH','Allocation locale payée incohérente');
    }
    const {rows:existing} = await client.query(
      "SELECT p.id FROM parcels p JOIN parcel_items pi ON pi.parcel_id=p.id JOIN order_items oi ON oi.id=pi.order_item_id WHERE oi.order_id=$1 AND oi.fulfillment_source='LOCAL_STOCK' LIMIT 1 FOR UPDATE OF p",
      [orderId]);
    if (existing.length) {
      await client.query('ROLLBACK');
      return fail(409,'LOCAL_RECEIPT_PARCEL_ALREADY_EXISTS','Colis existant : utiliser le parcours colis');
    }
    const parcelId=crypto.randomUUID(), reference=await generateParcelRef(client);
    const proofNote='Réception physique locale attestée au relais'+
      (typeof note==='string' && note.trim() ? ': '+note.trim().slice(0,500) : '');
    await client.query(
      "INSERT INTO parcels (id,order_id,type,status,reference,label,relais_id,created_by,notes) VALUES ($1,$2,'standard','draft',$3,'Retrait local',$4,$5,$6)",
      [parcelId,orderId,reference,order.relais_id,actor.id,proofNote]);
    // Insert the physical receipt proof before the parcel lines. Migration 362
    // checks the proof in the parcel quantity trigger in this same transaction.
    const {rows:[receipt]}=await client.query(
      "INSERT INTO scans (order_id,parcel_id,step,scan_code,scanned_by,notes) VALUES ($1,$2,'relais_received',$3,$4,$5) RETURNING id",
      [orderId,parcelId,order.reference,actor.id,proofNote]);
    for (const item of localItems) {
      // Canonical guarded assignment owns parcel_items composition. A local
      // receipt is NOT an international shipment, so qty_shipped remains 0.
      const assignment=await addParcelItemTraced(client,{
        parcelId,orderItemId:item.id,quantity:Number(item.quantity),actorId:actor.id
      });
      if (!assignment?.row || assignment.already_assigned)
        throw new Error('LOCAL_RECEIPT_ITEM_ASSIGNMENT_CONFLICT');
      await client.query(
        'UPDATE parcel_items SET qty_allocated=$3,qty_packed=$3,qty_shipped=0,qty_received=$3,verified=TRUE,verified_at=NOW(),verified_by=$4 WHERE parcel_id=$1 AND order_item_id=$2',
        [parcelId,item.id,item.quantity,actor.id]);
      await setOrderItemAvailabilityStatus(client,item.id,'available');
    }
    await client.query("UPDATE parcels SET status='available',available_at=NOW() WHERE id=$1",[parcelId]);
    await client.query(
      "INSERT INTO parcel_events (parcel_id,event_type,actor_id,notes,metadata) VALUES ($1,'available',$2,$3,$4::jsonb)",
      [parcelId,actor.id,proofNote,JSON.stringify({source:'local_relay_receipt',scan_id:receipt.id})]);
    const transition=await transitionOrderStatus({
      orderId,newStatus:'available',actor,source:'local_relay_receipt',
      scanId:receipt.id,note:proofNote,dbClient:client
    });
    if (!transition.success || transition.newStatus!=='available') {
      await client.query('ROLLBACK');
      return fail(409,transition.code||'LOCAL_RECEIPT_TRANSITION_REFUSED',transition.error||'Transition locale refusée');
    }
    await client.query('COMMIT');
    try {
      await clientNotifications.emitPickupReady({
        dbClient:db,userId:order.user_id,orderId,orderReference:order.reference,
        relaisName:order.relais_name
      });
    } catch (notifyErr) {
      log.warn({err:notifyErr,order_id:orderId},'Pickup notification projection failed; reconciliation will retry');
    }
    return {ok:true,status:200,body:{
      success:true,status:'available',parcel_id:parcelId,
      parcel_reference:reference,receipt_scan_id:receipt.id
    }};
  } catch(error) {
    try {await client.query('ROLLBACK');} catch (_) {}
    throw error;
  } finally {client.release();}
}
module.exports={recordLocalRelayReceipt};
