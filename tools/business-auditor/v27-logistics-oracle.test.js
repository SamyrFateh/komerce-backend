'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {checkMembership}=require('./v27-logistics-oracle');
function fixture({mode='NOMINAL',ownerInserted=1,reported=1,active=1,already=false}={}){
 return {mode,fixture:{itemCount:1},realOwnerCalled:true,realCanonicalSchema:true,
  sessionCount:2,ownerInserted,ownerInsertCalls:1,
  physicalRows:[ownerInserted],
  before:{activeCount:0,openCount:0},
  after:{activeCount:active,openCount:active},
  response:{success:true,items_assigned:reported,...(already?{already_assigned:true}:{})}};
}
test('nominal one insert and active membership is clean',()=>{
 assert.deepEqual(checkMembership(fixture()).signals,[]);
});
test('real ON CONFLICT DO NOTHING rowCount=0 cannot count as assigned',()=>{
 const x=checkMembership(fixture({mode:'LATE_COLLISION',ownerInserted:0,reported:1}));
 assert.ok(x.signals.includes('L1_REPORTED_ASSIGNMENTS_DO_NOT_MATCH_OWNER_INSERTS'));
});
test('count-only mutant still lies about success classification',()=>{
 const x=checkMembership(fixture({mode:'REPORT_ONLY',ownerInserted:0,reported:0}));
 assert.ok(x.signals.includes('L2_SUCCESS_WITHOUT_WRITE_OR_IDEMPOTENT_CLASSIFICATION'));
 assert.equal(x.signals.includes('L1_REPORTED_ASSIGNMENTS_DO_NOT_MATCH_OWNER_INSERTS'),false);
});
test('bounded idempotent result satisfies independent oracle only when active item exists',()=>{
 assert.deepEqual(checkMembership(fixture({mode:'RECONCILE_RESULT',
  ownerInserted:0,reported:0,already:true})).signals,[]);
});
test('false already-assigned flag must not suppress unassigned-item anomaly',()=>{
 const x=checkMembership(fixture({ownerInserted:0,reported:0,active:0,already:true}));
 assert.ok(x.signals.includes('L3_ORDER_NOT_IN_EXACTLY_ONE_ACTIVE_PARCEL'));
 assert.ok(x.signals.includes('L4_IDEMPOTENT_RESULT_WITHOUT_ACTIVE_MEMBERSHIP'));
});
test('broken physical rowCount claim is a tool error, not a business violation',()=>{
 const x=fixture();x.ownerInserted=0;
 assert.throws(()=>checkMembership(x),/V27_ORACLE_TOOL_ERROR/);
});
