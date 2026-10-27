'use strict';
/**
 * Read-only cross-owner P4 -> P2 handoff observer.
 *
 * Truth of parcel membership: logistics/parcel-order-membership service,
 * never parcels.order_id when parcel_items exist for another order.
 * Truth of handoff: logistics/customer-handoff-reconciliation service.
 * Queries inspect raw lineage and scan association as INDEPENDENT cross-checks
 * only; no second business decision engine and no mutation.
 */
const {record}=require('./p1-p7-canonical-collector');

function assessP4P2({item,memberParcels=[],itemParcels=[],scans=[],handoff=null}={}) {
 if(!item?.order_id||!item?.order_item_id)throw Error('Exact persisted order and order item required');
 const orderId=String(item.order_id);
 const memberIds=new Set(memberParcels.map(p=>String(p.id)));
 const itemIds=new Set(itemParcels.map(p=>String(p.id)));
 const gaps=[],contradictions=[];
 if(!memberIds.size)gaps.push('NO_PARCEL_MEMBERSHIP');
 if(!itemIds.size)gaps.push('EXACT_ITEM_PARCEL_MEMBERSHIP_MISSING_OR_LEGACY');
 // A carrier parcel header from a different order is valid for a shared
 // parcel. Only membership from parcel_items/order_items is decisive.
 for(const p of itemParcels){
   if(!memberIds.has(String(p.id)))contradictions.push('PARCEL_LINE_NOT_IN_CANONICAL_ORDER_MEMBERSHIP');
   if(p.line_owner_order_id && String(p.line_owner_order_id)!==orderId)
     contradictions.push('PARCEL_ITEM_FOREIGN_ORDER');
   if(String(p.order_item_id)!==String(item.order_item_id))
     contradictions.push('PARCEL_ITEM_FOREIGN_ITEM');
 }
 if(handoff?.order_id&&String(handoff.order_id)!==orderId)
   contradictions.push('HANDOFF_FOREIGN_ORDER');
 // The owner only loads scans WHERE scans.order_id = current order.
 // Check separately that every collection scan with parcel_id addresses a
 // MEMBER parcel; otherwise a scan on an unrelated parcel must not be used
 // as evidence for this order.
 for(const s of scans){
   if(String(s.order_id)!==orderId)contradictions.push('COLLECTION_SCAN_FOREIGN_ORDER');
   if(s.parcel_id && !memberIds.has(String(s.parcel_id)))
     contradictions.push('COLLECTION_SCAN_FOREIGN_PARCEL');
   if(s.parcel_id && s.pickup_relais_id && item.relais_id &&
     String(s.pickup_relais_id)!==String(item.relais_id))
     contradictions.push('COLLECTION_SCAN_FOREIGN_RELAY');
 }
 if(handoff?.verdict==='HANDOFF_MATCHED'){
   if(!memberIds.size)gaps.push('LEGACY_NO_PARCEL_HANDOFF_NOT_LINE_PROVEN');
   const provedIds=new Set((handoff.proofs||[]).map(p=>String(p.parcel_id)).filter(x=>x!=='null'));
   for(const id of memberIds)
     if(!provedIds.has(id))contradictions.push('MATCHED_HANDOFF_MISSING_MEMBER_PARCEL_PROOF');
 }else if(!handoff)gaps.push('HANDOFF_OWNER_NOT_EXECUTED');
 else if(handoff.verdict==='HANDOFF_PENDING')gaps.push('CUSTOMER_HANDOFF_PENDING');
 const p4status=memberIds.size&&itemIds.size?'PROVED':'UNKNOWN';
 const p2status=handoff?.verdict==='HANDOFF_MATCHED'?'PROVED':
   handoff?.verdict==='HANDOFF_MISMATCH'?'BLOCKED':'UNKNOWN';
 const edge=record('P4_P2_RELAY_HANDOFF',p4status,p2status,
  {order_id:orderId},{order_id:handoff?.order_id||null},{
  order_item_id:item.order_item_id,
  member_parcel_count:memberParcels.length,
  item_parcel_count:itemParcels.length,
  collected_parcel_count:handoff?.collected_parcel_count??null,
  handoff_verdict:handoff?.verdict||'NOT_RUN',
  handoff_reason:handoff?.reason||null,
  // A shared parcel may be physically carried by another order.
  shared_carrier_parcels:itemParcels.filter(p=>p.order_id&&String(p.order_id)!==orderId).length});
 edge.crossContradictions=[...new Set(contradictions)];
 return {proofs:{P4_P2_RELAY_HANDOFF:edge},
  diagnostics:{contradictions:[...new Set(contradictions)],gaps:[...new Set(gaps)]},
  facts:{order_id:orderId,order_item_id:String(item.order_item_id),
   parcel_count:memberParcels.length,item_parcel_count:itemParcels.length,
   scan_count:scans.length,handoff_verdict:handoff?.verdict||null,
   shared_carrier_parcels:edge.context.shared_carrier_parcels}};
}
async function collectP4P2Canonical(db,{item,readers={}}={}) {
 if(!db||typeof db.query!=='function'||!item?.order_id||!item?.order_item_id)
   throw Error('Exact order item and SQL executor required');
 const {listParcelsRepresentingOrder}=require('../../services/parcel-order-membership');
 const {reconcileCustomerHandoff}=require('../../services/customer-handoff-reconciliation');
 const list=readers.listMembers||listParcelsRepresentingOrder;
 const reconcile=readers.reconcileHandoff||reconcileCustomerHandoff;
 const memberParcels=await list(db,item.order_id,{
  columns:'p.id,p.order_id,p.status,p.relais_id,p.reference',
  excludeCancelled:true});
 const {rows:itemParcels}=await db.query(
  'SELECT p.id,p.order_id,pi.order_item_id,oi.order_id AS line_owner_order_id,'+
  'p.status FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id '+
  'JOIN order_items oi ON oi.id=pi.order_item_id '+
  'WHERE pi.order_item_id=$1 AND p.status <> $2 ORDER BY p.id LIMIT 100',
  [item.order_item_id,'cancelled']);
 const {rows:scans}=await db.query(
  "SELECT id,order_id,parcel_id,pickup_relais_id FROM scans "+
  "WHERE order_id=$1 AND step='collected' ORDER BY created_at,id LIMIT 100",
  [item.order_id]);
 const handoff=await reconcile(db,{orderId:item.order_id});
 return {...assessP4P2({item,memberParcels,itemParcels,scans,handoff}),
  owner_provenance:{
   parcel_membership:'services/parcel-order-membership.listParcelsRepresentingOrder',
   handoff:'services/customer-handoff-reconciliation.reconcileCustomerHandoff',
   detail:'parcel_items/order_items and scans by exact order id (cross-check)',
   liveRelayProof:false,
  }};
}
module.exports={assessP4P2,collectP4P2Canonical};
