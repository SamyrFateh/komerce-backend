'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {interpret}=require('./v12-physical-parcel-predicate');
function record(nominalReported=1,adverseReported=1){
 return {contract:'komerce-raw-pg-membership-witness/v12',
  method:'REAL_SERVICE_PG_TEMP_WRITES_WITH_STUBBED_LOOKUPS',
  database:'DISPOSABLE_LOCAL_POSTGRES_ONLY',
  fullCanonicalSchemaStateProven:false,multiSessionConcurrentProof:false,
  productionIncidentConfirmed:false,cases:[
   {caseId:'NOMINAL_NEW_MEMBERSHIP',preseed:false,before:0,after:1,created:1,inTarget:1,
    reported:nominalReported,serviceSuccess:true,affectedRows:[1],
    sqlKinds:['INSERT_MEMBERSHIP_CONFLICT_TOLERANT'],transactionRolledBack:true},
   {caseId:'CONFLICT_EXISTING_CANCELLED_MEMBERSHIP',preseed:true,before:1,after:1,created:0,inTarget:0,
    reported:adverseReported,serviceSuccess:true,affectedRows:[0],
    sqlKinds:['INSERT_MEMBERSHIP_CONFLICT_TOLERANT'],transactionRolledBack:true}
  ]};
}
test('physical row counts detect a controlled owner misreport independently of boolean claims',()=>{
 const f=interpret(record());
 assert.equal(f.verdict,'REPRODUCED_PHYSICAL_PG_TEMP_INVARIANT_VIOLATION');
 assert.deepEqual(f.mismatches.map(x=>x.scenario),['CONFLICT_EXISTING_CANCELLED_MEMBERSHIP']);
 assert.equal(f.productionIncidentConfirmed,false);
});
test('fixed owner makes same oracle satisfied without changing expectations',()=>{
 const f=interpret(record(1,0));
 assert.equal(f.verdict,'CONTROLLED_PHYSICAL_PG_TEMP_INVARIANT_SATISFIED');
 assert.equal(f.mismatches.length,0);
});
test('nominal regression yields finding, not tool error',()=>{
 const f=interpret(record(0,0));
 assert.equal(f.verdict,'REPRODUCED_PHYSICAL_PG_TEMP_INVARIANT_VIOLATION');
 assert.equal(f.mismatches[0].scenario,'NOMINAL_NEW_MEMBERSHIP');
});
test('forging a legacy result field cannot be used by the physical predicate',()=>{
 const raw=record();
 raw.conflictReportedAccurately=true;
 raw.adversarialReported=0;
 const f=interpret(raw);
 assert.equal(f.verdict,'REPRODUCED_PHYSICAL_PG_TEMP_INVARIANT_VIOLATION');
});
test('inconsistent SQL or silently overwritten raw values are tool errors',()=>{
 const raw=record();raw.cases[1].created=1;
 assert.throws(()=>interpret(raw),/TOOL_ERROR/);
 const raw2=record();raw2.cases[1].affectedRows=[1];
 assert.throws(()=>interpret(raw2),/TOOL_ERROR/);
 const raw3=record();raw3.cases[0].transactionRolledBack=false;
 assert.throws(()=>interpret(raw3),/TOOL_ERROR/);
});
