'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {interpret}=require('./v13-canonical-parcel-predicate');
const parcel=(id,status,n)=>({id,status,memberships:n});
const member=(id,status,item)=>({parcelId:id,status,orderItemId:item,quantity:1});
const state=(parcels,memberships,eligible=true)=>({orderStatus:'ordered',parcels,memberships,eligibleForDistributeAll:eligible});
function fixture(corrected=false){
 const normal=state([parcel('N1','preparation',1)],[member('N1','preparation','NI')],false);
 const before=state([parcel('A1','preparation',1)],[member('A1','preparation','AI')],false);
 const cancelled=state([parcel('A1','cancelled',1)],[member('A1','cancelled','AI')],true);
 const subsequent=corrected?
  state([parcel('A1','cancelled',0),parcel('A2','preparation',1)],[member('A2','preparation','AI')],false):
  state([parcel('A1','cancelled',1),parcel('A2','preparation',0)],[member('A1','cancelled','AI')],true);
 return {contract:'komerce-canonical-parcel-sequence-raw/v13',
  scope:'REAL_SERVICES_CANONICAL_POSTGRESQL_16_SINGLE_TRANSACTION',
  canonicalSchema:true,liveDatabase:false,rollbackVerified:true,usedSkipValidation:false,
  routeHttpExecuted:false,twoConnectionRaceExecuted:false,productionIncidentConfirmed:false,
  fixtures:{nominalOrder:'ORDER_N',affectedOrder:'ORDER_A',affectedOrderItem:'AI',originalParcel:'A1'},
  steps:[
   {scenario:'NOMINAL',action:'distribute',result:{success:true,items_assigned:1},state:normal},
   {scenario:'NOMINAL',action:'retry_without_cancel',result:{success:true,already_assigned:true},state:normal},
   {scenario:'CANCEL_RETRY',action:'distribute',result:{success:true,items_assigned:1},state:before},
   {scenario:'CANCEL_RETRY',action:'cancel_via_ssot',result:{ok:true},state:cancelled},
   {scenario:'CANCEL_RETRY',action:'redistribute',result:{success:true,items_assigned:corrected?1:1},state:subsequent},
   {scenario:'CANCEL_RETRY',action:'repeat_redistribute',result:{success:true,already_assigned:corrected},state:subsequent}
  ]};
}
test('canonical sequence exposes reported success, stranded item and ghost parcel',()=>{
 const v=interpret(fixture());
 assert.equal(v.verdict,'REPRODUCED_CANONICAL_PG_SEQUENCE_ANOMALY');
 assert.deepEqual(v.issues.map(x=>x.id),[
  'FALSE_SUCCESS_COUNT','GHOST_OPEN_PARCEL','ACTIVE_ORDER_STRANDED_AFTER_CANCEL']);
 assert.equal(v.productionIncidentConfirmed,false);
});
test('same independent oracle becomes satisfied after a fully repaired membership transition',()=>{
 const v=interpret(fixture(true));
 assert.equal(v.verdict,'CONTROLLED_CANONICAL_PG_SEQUENCE_SATISFIED');
 assert.equal(v.issues.length,0);
});
test('self-written status flags and claims cannot override actual membership rows',()=>{
 const r=fixture();r.reportedBug=false;r.steps[4].state.isCorrect=true;
 assert.equal(interpret(r).issues.length,3);
});
test('fake or inconsistent SQL snapshots rejected as tool error',()=>{
 const x=fixture();x.steps[4].state.parcels[1].memberships=1;
 assert.throws(()=>interpret(x),/TOOL_ERROR/);
 const y=fixture();y.steps[3].state.memberships[0].status='preparation';
 assert.throws(()=>interpret(y),/TOOL_ERROR/);
 const z=fixture();z.rollbackVerified=false;
 assert.throws(()=>interpret(z),/TOOL_ERROR/);
});
