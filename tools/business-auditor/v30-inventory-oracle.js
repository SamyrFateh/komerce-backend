'use strict';
/**
 * Independent V3.0 inventory owner/provenance oracle, based on immutable
 * order_items.order_id, not on receiveItem's chosen order nor its response.
 * No import of application service. A 409 without physical rollback is FAIL.
 */
const fail=s=>{throw Error('V30_ORACLE_TOOL_ERROR: '+s)};
const numeric=x=>x==null?0:Number(x);
const eq=(a,b)=>String(a)===String(b);
function assess(x){
 if(x?.contract!=='komerce-inventory-canonical-physical/v30'||
  !['NOMINAL','FOREIGN_ORDER'].includes(x.mode)||
  !x.realOwnerCalled||!x.realCanonicalSchema||!x.noExternalNetwork||
  x.authMiddlewareExecuted!==false||!x.ids||
  !x.before||!x.after||!x.owner||
  !Array.isArray(x.before.rows)||!Array.isArray(x.after.rows)||
  !x.before.orderA||!x.before.orderB||!x.after.orderA||!x.after.orderB)
  fail('physical source, actor and canonical DB snapshots mandatory');
 const ids=x.ids,s=x.before,t=x.after,signals=[];
 if(!eq(s.orderA.id,ids.orderA)||!eq(s.orderB.id,ids.orderB)||
  !eq(t.orderA.id,ids.orderA)||!eq(t.orderB.id,ids.orderB)||
  eq(ids.orderA,ids.orderB)||eq(ids.itemA,ids.itemB)||
  s.rows.length!==0)
  fail('two independent clean orders required');
 const a=t.rows.filter(r=>eq(r.order_item_id,ids.itemA));
 const b=t.rows.filter(r=>eq(r.order_item_id,ids.itemB));
 if(t.rows.some(r=>!eq(r.inventory_order,r.authoritative_order)))
  signals.push('INV1_CANONICAL_ORDER_IDENTITY_BROKEN');
 if(b.length)signals.push('INV2_UNREQUESTED_ORDER_B_RECEIVED');
 const completion=(a,b)=>['items_received','items_total','completion_ratio']
  .every(k=>numeric(a[k])===numeric(b[k]));
 if(!completion(s.orderB,t.orderB))
  signals.push('INV3_FOREIGN_ORDER_COMPLETION_CHANGED');
 if(x.mode==='NOMINAL'){
  if(!x.owner.success||x.owner.errorCode||!x.owner.response||
   !eq(x.owner.response.orderId,ids.orderA)||
   !eq(x.owner.response.orderItemId,ids.itemA)||
   a.length!==1||b.length!==0||!eq(a[0].inventory_order,ids.orderA))
   signals.push('INV4_NOMINAL_RECEIPT_NOT_CANONICAL');
  if(numeric(t.orderA.items_received)!==1||
   numeric(t.orderA.items_total)!==1||
   numeric(t.orderA.completion_ratio)!==1)
   signals.push('INV5_RECEIPT_COMPLETION_NOT_RECONCILED');
 }else{
  if(x.owner.success||x.owner.errorCode!=='INVENTORY_ORDER_MISMATCH'||
   x.owner.errorStatus!==409)
   signals.push('INV6_FOREIGN_ORDER_NOT_REJECTED_WITH_409');
  if(a.length!==0||b.length!==0||
   !completion(s.orderA,t.orderA)||!completion(s.orderB,t.orderB))
   signals.push('INV7_REJECTED_REQUEST_LEFT_PHYSICAL_WRITES');
 }
 return {contract:'komerce-independent-inventory-ownership-oracle/v30',
  mode:x.mode,signals,violation:signals.length>0,
  canonicalA:ids.orderA,foreignB:ids.orderB,
  insertedRows:a.length,unrequestedRows:b.length,
  orderACompletionBefore:numeric(s.orderA.completion_ratio),
  orderACompletionAfter:numeric(t.orderA.completion_ratio),
  orderBCompletionBefore:numeric(s.orderB.completion_ratio),
  orderBCompletionAfter:numeric(t.orderB.completion_ratio),
  sourceProvenance:'JOIN_INVENTORY_ITEMS_TO_ORDER_ITEMS_FROM_INDEPENDENT_PG_SESSION',
  realHttpMiddlewareVerified:false,productionIncidentClaim:false};
}
function forgeAfterRejection(physical){
 if(physical?.mode!=='FOREIGN_ORDER')fail('counterfeit starts with genuine rejected request');
 const f=structuredClone(physical);
 f.after.rows.push({id:'forged-fixture',order_item_id:f.ids.itemA,
  inventory_order:f.ids.orderB,authoritative_order:f.ids.orderA,status:'received'});
 f.after.orderB.items_received=1;
 f.after.orderB.items_total=1;
 f.after.orderB.completion_ratio='1';
 // Preserve owner rejection; oracle must not accept a 409 as sufficient.
 return f;
}
module.exports={assess,forgeAfterRejection};
