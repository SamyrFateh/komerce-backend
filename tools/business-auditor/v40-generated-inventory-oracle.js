'use strict';
/**
 * G3 independently observes canonical order_items/inventory_items and
 * completion after a real service call. No imports of the service under test.
 * Both healthy and intentionally mutated owners use this exact oracle.
 */
const eq=(a,b)=>String(a)===String(b);
const num=x=>x==null?0:Number(x);
function assess(x){
 if(x?.contract!=='komerce-inventory-canonical-physical/v30'||
   x.generatedSpec?.contract!=='komerce-generated-inventory-case/v40'||
   !x.realOwnerCalled||!x.realCanonicalSchema||
   !x.noExternalNetwork||!x.before||!x.after||!x.owner||
   !Array.isArray(x.before.rows)||!Array.isArray(x.after.rows))
  throw Error('G3_ORACLE_TOOL_ERROR: real canonical snapshots and owner required');
 const {relation,extraLines}=x.generatedSpec;
 if(!['IMPLICIT','OWN','FOREIGN'].includes(relation)||
   !Number.isInteger(extraLines)||extraLines<0||extraLines>3||
   !x.ids||!x.before.orderA||!x.before.orderB||
   !x.after.orderA||!x.after.orderB||
   x.before.orderAItemsCount!==1+extraLines||
   x.after.orderAItemsCount!==1+extraLines)
  throw Error('G3_ORACLE_TOOL_ERROR: fixture cardinality/provenance mismatch');
 const before=x.before,after=x.after,ids=x.ids,signals=[];
 if(before.rows.length!==0||eq(ids.orderA,ids.orderB)||
   !eq(before.orderA.id,ids.orderA)||!eq(after.orderA.id,ids.orderA)||
   !eq(before.orderB.id,ids.orderB)||!eq(after.orderB.id,ids.orderB))
  throw Error('G3_ORACLE_TOOL_ERROR: clean independent orders missing');
 const a=after.rows.filter(r=>eq(r.order_item_id,ids.itemA));
 const b=after.rows.filter(r=>eq(r.order_item_id,ids.itemB));
 if(after.rows.some(r=>!eq(r.inventory_order,r.authoritative_order)))
  signals.push('INV_GEN_CANONICAL_IDENTITY_VIOLATION');
 if(b.length!==0)signals.push('INV_GEN_UNREQUESTED_FOREIGN_RECEIPT');
 for(const k of ['items_received','items_total','completion_ratio']){
  if(num(after.orderB[k])!==num(before.orderB[k]))
   signals.push('INV_GEN_FOREIGN_ORDER_PROJECTION_CHANGED_'+k.toUpperCase());
 }
 if(relation==='FOREIGN'){
  if(x.owner.success||x.owner.errorCode!=='INVENTORY_ORDER_MISMATCH'||
     x.owner.errorStatus!==409)
   signals.push('INV_GEN_UNAUTHORIZED_FOREIGN_ORDER_ACCEPTED');
  if(a.length!==0||b.length!==0||
    ['items_received','items_total','completion_ratio'].some(
      k=>num(after.orderA[k])!==num(before.orderA[k])))
   signals.push('INV_GEN_REJECTED_RECEIPT_WROTE_DATA');
 }else{
  if(!x.owner.success||x.owner.errorCode||
    !eq(x.owner.response?.orderId,ids.orderA)||
    !eq(x.owner.response?.orderItemId,ids.itemA)||
    a.length!==1||!eq(a[0].inventory_order,ids.orderA))
   signals.push('INV_GEN_CANONICAL_RECEIPT_FAILED');
  // The canonical owner immediately proposes an assignment. With no matching
  // parcel the persisted item is BUFFERED, not RECEIVED; the INSERT RETURNING
  // item may still report 'received'. Compare proposal with persisted state.
  const proposal=x.owner.response?.proposalStatus;
  if(a.length===1){
   const row=a[0];
   if(proposal==='buffered'){
    if(row.status!=='buffered'||row.buffer_reason!=='no_compatible_parcel'||
       !row.buffer_until||row.proposed_parcel_id!=null)
     signals.push('INV_GEN_BUFFER_STATE_INCONSISTENT');
   }else if(proposal==='proposed'){
    if(row.status!=='proposed'||!row.proposed_parcel_id||!row.proposed_at)
     signals.push('INV_GEN_PROPOSAL_STATE_INCONSISTENT');
   }else signals.push('INV_GEN_MISSING_ASSIGNMENT_DECISION');
  }
  if(num(after.orderA.items_received)!==1||
     num(after.orderA.items_total)!==1+extraLines||
     Math.abs(num(after.orderA.completion_ratio)-1/(1+extraLines))>1e-9)
   signals.push('INV_GEN_COMPLETION_MISMATCH');
 }
 return {contract:'komerce-independent-generated-inventory-oracle/v40',
  signals,violation:signals.length>0,
  checkedAuthority:'order_items.order_id JOIN inventory_items + orders completion',
  expectedRelation:relation,authoritativeLineCount:after.orderAItemsCount,
  realOwnerExecuted:x.realOwnerCalled===true,
  mutationApplied:x.mutationApplied===true};
}
module.exports={assess};
