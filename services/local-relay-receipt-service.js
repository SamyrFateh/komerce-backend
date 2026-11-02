/** @komerce-arch @role orders-local-relay-receipt @domain orders @layer service
 * @criticality critical @inputs order_id, authenticated agent, physical_receipt
 * @outputs local parcel, proof and order available
 * @depends db.js, services/order-status-machine.js, services/order-item-availability-service.js, utils/reference.js
 * @used-by routes/orders/status.js @db-read orders, order_items, parcels, local_stock_allocations
 * @db-write parcels, parcel_items, parcel_events, scans
 * @db-write-via:order-status-machine orders, order_status_history
 * @db-write-via:order-item-availability-service order_items
 * @db-txn caller-owned-atomic @impact-areas orders, logistics, local-stock, pickup */
'use strict';
const crypto = require('crypto');
const db = require('../db');
const { generateParcelRef } = require('../utils/reference');
const { transitionOrderStatus } = require('./order-status-machine');
const { setOrderItemAvailabilityStatus } = require('./order-item-availability-service');
const fail = (status, code, error) => ({ok:false, status, body:{code,error}});

// A relay actor's signed physical receipt, never an inference from AVAILABLE_NOW.
// Fail closed for mixed orders: a separate parcel-scoped path is required.
async function recordLocalRelayReceipt({orderId, actor, physicalReceived, note = null}) {
  if (!actor?.id || !['admin','agent_relais'].includes(actor.role))
    return fail(403,'LOCAL_RECEIPT_ROLE_FORBIDDEN','Seul le relais ou un administrateur peut attester la réception');
  if (physicalReceived !== true)
    return fail(400,'LOCAL_RECEIPT_PROOF_REQUIRED','La réception physique au relais doit être attestée');
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const {rows:[order]} = await client.query(
      'SELECT id, reference, status, payment_status, relais_id FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
    if (!order) {
      await client.query('ROLLBACK');
      return fail(404,'ORDER_NOT_FOUND','Commande introuvable');
    }
    if (actor.role==='agent_relais' && (!actor.relais_id || String(actor.relais_id)!==String(order.relais_id))) {
      await client.query('ROLLBACK');
      return fail(403,'LOCAL_RECEIPT_RELAY_FORBIDDEN','Commande hors du relais de cet agent');
    }
    if (order.payment_status!=='paid' || !['confirmed','ordered','preparation'].includes(order.status)) {
      await client.query('ROLLBACK');
      return fail(409,'LOCAL_RECEIPT_ORDER_NOT_READY','Paiement non confirmé ou commande déjà avancée');
    }
    const {rows:items} = await client.query(
      'SELECT id,product_id,quantity,fulfillment_source FROM order_items WHERE order_id=$1 ORDER BY id FOR UPDATE', [orderId]);
    if (!items.length || items.some(item=>item.fulfillment_source!=='LOCAL_STOCK')) {
      await client.query('ROLLBACK');
      return fail(409,'LOCAL_RECEIPT_NOT_LOCAL_ONLY','Les commandes mixtes exigent une réception par colis');
    }
    const {rows:[stock]} = await client.query(
      "SELECT COALESCE(SUM(quantity) FILTER (WHERE consumed_at IS NOT NULL AND released_at IS NULL),0)::int AS consumed FROM local_stock_allocations WHERE order_id=$1", [orderId]);
    const expected = items.reduce((sum,item)=>sum+Number(item.quantity),0);
    if (Number(stock?.consumed)!==expected) {
      await client.query('ROLLBACK');
      return fail(409,'LOCAL_RECEIPT_ALLOCATION_MISMATCH','Allocation locale payée incohérente');
    }
    const {rows:existing} = await client.query(
      'SELECT p.id FROM parcels p WHERE p.order_id=$1 OR EXISTS (SELECT 1 FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id WHERE pi.parcel_id=p.id AND oi.order_id=$1) LIMIT 1 FOR UPDATE OF p',
      [orderId]);
    if (existing.length) {
      await client.query('ROLLBACK');
      return fail(409,'LOCAL_RECEIPT_PARCEL_ALREADY_EXISTS','Colis existant : utiliser le parcours colis');
    }
    const parcelId=crypto.randomUUID(), reference=await generateParcelRef(client);
    const proofNote='Réception physique locale attestée au relais'+
      (typeof note==='string' && note.trim() ? ': '+note.trim().slice(0,500) : '');
    await client.query(
      "INSERT INTO parcels (id,order_id,type,status,reference,label,relais_id,created_by,available_at,notes) VALUES ($1,$2,'standard','available',$3,'Retrait local',$4,$5,NOW(),$6)",
      [parcelId,orderId,reference,order.relais_id,actor.id,proofNote]);
    for (const item of items) {
      await client.query(
        'INSERT INTO parcel_items (parcel_id,order_item_id,product_id,quantity,qty_received,verified,verified_at,verified_by) VALUES ($1,$2,$3,$4,$4,TRUE,NOW(),$5)',
        [parcelId,item.id,item.product_id,item.quantity,actor.id]);
      await setOrderItemAvailabilityStatus(client,item.id,'available');
    }
    const {rows:[receipt]}=await client.query(
      "INSERT INTO scans (order_id,parcel_id,step,scan_code,scanned_by,notes) VALUES ($1,$2,'relais_received',$3,$4,$5) RETURNING id",
      [orderId,parcelId,order.reference,actor.id,proofNote]);
    await client.query(
      "INSERT INTO parcel_events (parcel_id,event_type,actor_id,notes,metadata) VALUES ($1,'available',$2,$3,$4::jsonb)",
      [parcelId,actor.id,proofNote,JSON.stringify({source:'local_relay_receipt',scan_id:receipt.id})]);
    const transition=await transitionOrderStatus({
      orderId,newStatus:'available',actor,source:'local_relay_receipt',
      scanId:receipt.id,note:proofNote,dbClient:client
    });
    if (!transition.success || transition.noop || transition.newStatus!=='available')
      throw Object.assign(new Error(transition.error||'Transition locale refusée'),
        {code:transition.code||'LOCAL_RECEIPT_TRANSITION_REFUSED'});
    await client.query('COMMIT');
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
