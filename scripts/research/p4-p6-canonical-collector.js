'use strict';
/**
 * Research-only cross-process P4 -> P6 observer.
 *
 * P4 parcel membership owner: parcel-order-membership.
 * P6 economic truth owner: real-margin-shadow (same transaction).
 * P4 freight/customs actual rows: order_item_real_cost_allocations, linked
 * at exact order_item_id AND order_id, parcel_id and optional shipment_id.
 *
 * No second calculation of maritime weights, duty, invoice, or FX.
 * A shared parcel's carrier p.order_id is not the customer's order.
 */
const {record}=require('./p1-p7-canonical-collector');
const TYPES=['freight','customs'];
const num=x=>x==null?null:Number.isFinite(Number(x))?Number(x):null;
function assessP4P6({item,memberParcels=[],itemParcels=[],costs=[],shipments=[],shadow=null,orderItemCount=null}={}){
 if(!item?.order_id||!item?.order_item_id)throw Error('P4-P6 order and item required');
 const contradictions=new Set(),gaps=new Set();
 const member=new Set(memberParcels.map(x=>String(x.id)));
 const lineMember=new Set(itemParcels.map(x=>String(x.parcel_id)));
 if(!member.size)gaps.add('NO_CANONICAL_PARCEL_MEMBERSHIP');
 if(!lineMember.size)gaps.add('ITEM_PARCEL_LINES_MISSING_OR_LEGACY');
 const owned=costs.filter(c=>TYPES.includes(c.cost_type));
 const actual=owned.filter(c=>c.is_actual===true);
 const actualTypes=new Map(TYPES.map(t=>[t,actual.filter(c=>c.cost_type===t)]));
 const totals=Object.fromEntries(TYPES.map(t=>[t,actualTypes.get(t).reduce((s,c)=>s+(num(c.amount_kmf)||0),0)]));
 const by=shadow?.costs?.by_type||null;
 if(!by)gaps.add('ECONOMIC_SHADOW_NOT_AVAILABLE');
 if(shadow?.order_id&&String(shadow.order_id)!==String(item.order_id))
  contradictions.add('ECONOMIC_SHADOW_FOREIGN_ORDER');
 for(const p of itemParcels){
  if(p.line_order_id&&String(p.line_order_id)!==String(item.order_id))
   contradictions.add('PARCEL_ITEM_FOREIGN_ORDER');
  if(!member.has(String(p.parcel_id)))contradictions.add('ITEM_PARCEL_NOT_CANONICAL_MEMBER');
 }
 const declaredShipments=new Set(shipments.map(x=>String(x.shipment_id)+':'+String(x.parcel_id)));
 for(const c of owned){
  if(String(c.order_id)!==String(item.order_id))contradictions.add('LOGISTICS_COST_FOREIGN_ORDER');
  if(String(c.order_item_id)!==String(item.order_item_id))contradictions.add('LOGISTICS_COST_FOREIGN_ITEM');
  if(num(c.amount_kmf)===null||num(c.amount_kmf)<0)contradictions.add('LOGISTICS_COST_INVALID_AMOUNT');
  if(!c.parcel_id){gaps.add('LOGISTICS_COST_WITHOUT_PARCEL_LINEAGE');continue;}
  if(!member.has(String(c.parcel_id)))contradictions.add('LOGISTICS_COST_FOREIGN_PARCEL');
  if(!lineMember.has(String(c.parcel_id)))contradictions.add('LOGISTICS_COST_PARCEL_NOT_CONTAINING_ITEM');
  // Match the specific declared shipment to the parcel via canonical
  // customs_shipment_parcels: shipment header belonging to another market/order
  // does not make the linked item foreign, but missing membership is suspect.
  if(c.shipment_id&&c.source==='customs_shipments'){
   const key=String(c.shipment_id)+':'+String(c.parcel_id);
   if(!declaredShipments.has(key))contradictions.add('LOGISTICS_COST_SHIPMENT_PARCEL_UNLINKED');
  }else if(c.source==='customs_shipments'){
   gaps.add('CUSTOMS_SHIPMENT_SOURCE_WITHOUT_SHIPMENT_ID');
  }
 }
 let compared=0;
 // Shadow is an order aggregate, not per-item. Only compare if the order has
 // exactly one item and the economics are actual; otherwise no false mismatch.
 for(const type of TYPES){
  const state=by?.[type]?.state,ownerAmount=num(by?.[type]?.real_kmf);
  if(state==='real'&&orderItemCount===1&&ownerAmount!==null) {
   compared++;
   if(Math.abs(totals[type]-ownerAmount)>1.01)
    contradictions.add('SHADOW_'+type.toUpperCase()+'_DIFFERS_FROM_ACTUAL_ALLOCATION');
  }else{
   gaps.add(type.toUpperCase()+'_REAL_VALUE_NOT_COMPARABLE');
  }
  if(owned.some(c=>c.cost_type===type&&c.is_actual!==true))
   gaps.add(type.toUpperCase()+'_NON_ACTUAL_ALLOCATION_NOT_REAL');
 }
 if(orderItemCount!==1)gaps.add('MULTI_ITEM_SHADOW_AGGREGATE_NOT_ITEM_COMPARABLE');
 if(!actual.length)gaps.add('NO_ACTUAL_FREIGHT_OR_CUSTOMS_ALLOCATION');
 const sourceStatus=member.size&&lineMember.size?'PROVED':'UNKNOWN';
 // Missing customs actual, freight actual, or independent economic source must
 // never imply the entire logistics-cost seam has been positively certified.
 const targetStatus=compared===2&&actual.length>=2&&
  gaps.size===0?'PROVED':'UNKNOWN';
 const proof=record('P4_P6_LOGISTICS_COST',sourceStatus,targetStatus,
  {order_id:item.order_id},{order_id:shadow?.order_id||null},
  {order_item_id:item.order_item_id,
    member_parcel_count:member.size,item_parcel_count:lineMember.size,
    actual_cost_counts:Object.fromEntries(TYPES.map(t=>[t,actualTypes.get(t).length])),
    actual_allocated_kmf:totals,
    shadow_states:Object.fromEntries(TYPES.map(t=>[t,by?.[t]?.state||'NOT_READ'])),
    compared_owner_cost_types:compared,
    shared_carrier_parcels:itemParcels.filter(p=>p.carrier_order_id&&
      String(p.carrier_order_id)!==String(item.order_id)).length});
 proof.crossContradictions=[...contradictions];
 return {proofs:{P4_P6_LOGISTICS_COST:proof},
   diagnostics:{contradictions:[...contradictions],gaps:[...gaps],evidence_level:'RESEARCH_ONLY'},
   facts:{order_id:item.order_id,order_item_id:item.order_item_id,
    member_parcel_count:member.size,item_parcel_count:lineMember.size,
    actual_cost_count:actual.length,allocated_kmf:totals,
    compared_owner_cost_types:compared,
    shared_carrier_parcels:proof.context.shared_carrier_parcels,
    shadow_states:proof.context.shadow_states},
   owner_provenance:{
    physical:'services/parcel-order-membership.listParcelsRepresentingOrder',
    economic:'services/cost-allocation/real-margin-shadow.computeOrderRealMarginShadow',
    allocations:'order_item_real_cost_allocations order + item + parcel + shipment',
    shipment:'customs_shipment_parcels parcel membership',
    external_carrier_payment_certified:false,
   }};
}
async function collectP4P6Canonical(db,{item,readers={}}={}){
 if(!db||typeof db.query!=='function'||!item?.order_id||!item?.order_item_id)
  throw Error('P4-P6 exact order item and SQL executor required');
 const {listParcelsRepresentingOrder}=require('../../services/parcel-order-membership');
 const list=readers.listMembers||listParcelsRepresentingOrder;
 const memberParcels=await list(db,item.order_id,{
  columns:'p.id,p.order_id,p.status',excludeCancelled:true});
 const {rows:itemParcels}=await db.query(
  'SELECT pi.parcel_id,oi.order_id AS line_order_id,p.order_id AS carrier_order_id '+
  'FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id '+
  'JOIN parcels p ON p.id=pi.parcel_id '+
  'WHERE pi.order_item_id=$1 AND p.status <> $2 ORDER BY pi.parcel_id LIMIT 101',
  [item.order_item_id,'cancelled']);
 const {rows:costs}=await db.query(
  'SELECT id,order_id,order_item_id,parcel_id,shipment_id,cost_type,amount_kmf,'+
  'is_actual,source,allocation_method FROM order_item_real_cost_allocations '+
  'WHERE order_item_id=$1 AND cost_type = ANY($2::text[]) ORDER BY id LIMIT 101',
  [item.order_item_id,TYPES]);
 const shipmentIds=[...new Set(costs.filter(c=>c.shipment_id).map(c=>c.shipment_id))];
 const {rows:shipments}=shipmentIds.length?await db.query(
  'SELECT shipment_id,parcel_id FROM customs_shipment_parcels '+
  'WHERE shipment_id=ANY($1::uuid[])',
  [shipmentIds]):{rows:[]};
  const {rows:countRows}=await db.query('SELECT COUNT(*)::int AS n FROM order_items WHERE order_id=$1',
  [item.order_id]);
 const margin=readers.realMargin||
  require('../../services/cost-allocation/real-margin-shadow').computeOrderRealMarginShadow;
 const shadow=await margin(item.order_id,{client:db});
 const r=assessP4P6({item,memberParcels,itemParcels,costs,shipments,shadow,
  orderItemCount:countRows[0]?.n??null});
 if(itemParcels.length>100||costs.length>100)r.diagnostics.gaps.push('RESEARCH_PAGINATION_LIMIT_REACHED');
 return r;
}
module.exports={assessP4P6,collectP4P6Canonical};
