'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {evaluate,interpret}=require('./v16-healing-predicate');
function c(mode,distribution=[30,1]){
 const after={parcels:distribution.map((n,i)=>({id:i?'P1':'P0',status:'preparation',members:n})),
  total:distribution.reduce((a,b)=>a+b,0),
  assignedByOrder:[{order:'A',members:1},{order:'B',members:1}]};
 return {mode,dbCloned:true,cloneDropped:true,
  orderA:'A',orderB:'B',originalParcel:'P0',
  before:{parcels:[{id:'P0',status:'preparation',members:29}],total:29},
  after,gate:mode==='SERIALIZED_MUTANT'?{arrived:1,serialized:true}:
   {arrived:mode==='UNLOCKED_RACE'?2:0,serialized:false},
  outcomes:[{order:'A',status:'fulfilled',value:{success:true,items_assigned:1}},
   {order:'B',status:'fulfilled',value:{success:true,items_assigned:1}}]};
}
function proof(){
 return {contract:'komerce-opus-healing-experiment-raw/v16',
  dbIsolation:'CREATE_DATABASE_TEMPLATE_KOMERCE_TEST_DROP_PER_CASE',
  allClonesDropped:true,realCanonicalSchema:true,realOwnerInvoked:true,
  productionOwnerModified:false,routeHttpExecuted:false,productionIncidentConfirmed:false,
  cases:[c('SEQUENTIAL'),c('UNLOCKED_RACE',[31]),c('SERIALIZED_MUTANT')]};
}
test('real original owner breaches 31, lock mutation is recognized as satisfied',()=>{
 const r=interpret(proof());
 assert.equal(r.verdict,'HEALING_ORACLE_CALIBRATED');
 assert.deepEqual(r.observed.map(x=>x.verdict),[
  'CAPACITY_SATISFIED','CAPACITY_BREACH','CAPACITY_SATISFIED']);
 assert.equal(r.lockedMutantRecognizedAsFixed,true);
});
test('fix in the REAL owner is recognized with lock wait, not TOOL_ERROR',()=>{
 const p=proof();p.cases[1].after.parcels=c('SEQUENTIAL').after.parcels;
 p.cases[1].gate={arrived:1,serialized:true};
 const r=interpret(p);
 assert.equal(r.verdict,'ACTUAL_OWNER_HEALED');
 assert.equal(r.actualOwnerFixedRecognized,true);
 assert.equal(r.actualServiceRaceDemonstrated,false);
});
test('owner failure is a business observation, not a tool crash',()=>{
 const x=c('SERIALIZED_MUTANT',[30]);
 x.after.total=30;x.after.assignedByOrder[1].members=0;
 x.outcomes[1]={order:'B',status:'rejected',code:'LOCK_FAILURE'};
 assert.equal(evaluate(x).verdict,'OWNER_ERROR_AFTER_SYNCHRONIZATION');
});
test('malformed or uncleaned fixture remains TOOL_ERROR',()=>{
 const p=proof();p.cases[2].after.total=32;
 assert.throws(()=>interpret(p),/TOOL_ERROR/);
 const q=proof();q.allClonesDropped=false;
 assert.throws(()=>interpret(q),/TOOL_ERROR/);
});

test('rendezvous freezes overlap count after a lock wait and accepts later read',async()=>{
 const {rendezvous}=require('./v16-healing-runner');
 const monitor={query:async()=>({rows:[{pid:1,wait_event_type:'Lock'}]})};
 const gate=rendezvous(monitor,[1,2],{timeoutMs:800,watchLocks:true});
 await gate.wait();
 assert.deepEqual(gate.meta(),{arrived:1,serialized:true});
 await gate.wait();
 assert.deepEqual(gate.meta(),{arrived:1,serialized:true});
});
test('rendezvous without lock observes two genuinely overlapping reads',async()=>{
 const {rendezvous}=require('./v16-healing-runner');
 const monitor={query:async()=>({rows:[]})};
 const gate=rendezvous(monitor,[1,2],{timeoutMs:800,watchLocks:true});
 await Promise.all([gate.wait(),gate.wait()]);
 assert.deepEqual(gate.meta(),{arrived:2,serialized:false});
});
