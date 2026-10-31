'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {inspect}=require('./whole-repo-parcel-quantity-reproduction');
function input(afterQty){
 const base={item_id:'i',order_id:'o',qty_allocated:1,
  actual_allocated_active:1,membership_count_active:1,
  qty_packed:0,qty_shipped:0,qty_received:0,qty_collected:0};
 return {contract:'komerce-real-parcel-resync-observation/v1',
  scenario:'ASSIGN_SYNC_CANCEL_LAST_ACTIVE_PARCEL_RESYNC',
  realOwnersExecuted:true,canonicalPg:true,networkBlocked:true,
  allocatedParcelFixturePreparedBySQL:true,parcelAllocationHttpPathExecuted:false,
  allReadsFromPostgres:true,realCancellationAccepted:true,
  before:base,intermediate:{...base,actual_allocated_active:0},
  after:{...base,qty_allocated:afterQty,actual_allocated_active:0,
   membership_count_active:0}};
}
test('independent oracle flags stale persisted allocation when last active parcel cancelled',()=>{
 const a=inspect(input(1));
 assert.equal(a.violation,true);
 assert.deepEqual(a.signals,['PARCEL_CANCELLED_ACTIVE_ALLOCATION_STALE']);
 const b=inspect(input(0));
 assert.equal(b.violation,false);assert.deepEqual(b.signals,[]);
});
test('incomplete physical evidence is tool error, never a business bug',()=>{
 const forged=input(1);forged.before.qty_allocated=0;
 assert.throws(()=>inspect(forged),/PROOF_ERROR/);
 const missing=input(1);missing.networkBlocked=false;
 assert.throws(()=>inspect(missing),/PROOF_ERROR/);
 const identity=input(1);identity.after.order_id='foreign';
 assert.throws(()=>inspect(identity),/PROOF_ERROR/);
});
