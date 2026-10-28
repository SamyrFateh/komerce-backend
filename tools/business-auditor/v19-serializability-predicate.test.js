'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {inspect,resultFingerprint}=require('./v19-serializability-predicate');
function state(parcels,aa=1,bb=1){
 const rows=parcels.map(([status,members])=>({status,members}));
 return {parcels:rows,assignedByOrder:[
  {target:'A',members:aa},{target:'B',members:bb}],
 total:rows.reduce((n,x)=>n+x.members,0)};
}
const nearState=state([['preparation',29]],0,0);
const cancelled=state([['cancelled',29]],0,0);
function ok(target,created=false){return {target,status:'fulfilled',
 value:{success:true,items_assigned:1,parcel_created:created}}}
const reject=(target,code)=>({target,status:'rejected',code});
function proof({raceState=state([['preparation',31]]),fixture='NEAR_CAPACITY',
 raceOutcomes=[ok('A'),ok('B')],gate={arrived:2,serialized:false}}={}){
 const starting=fixture==='NEAR_CAPACITY'?nearState:cancelled;
 const normal=fixture==='NEAR_CAPACITY'?
  state([['preparation',30],['preparation',1]]):
  state([['cancelled',29],['preparation',2]]);
 const first=fixture==='NEAR_CAPACITY'?[ok('A'),ok('B',true)]:[ok('A',true),ok('B')];
 const reverse=fixture==='NEAR_CAPACITY'?[ok('B'),ok('A',true)]:[ok('B',true),ok('A')];
 const mk=(mode,after,outcomes,g={arrived:0,serialized:false})=>
  ({mode,fixture,cloneDropped:true,before:starting,after,outcomes,gate:g});
 return {contract:'komerce-opus-full-serializability-raw/v19',
  adapter:'AUTO_PARCEL_TWO_ORDERS',fixture,
  dbIsolation:'ONE_LOCAL_CANONICAL_TEMPLATE_CLONE_PER_EXECUTION',
  allClonesDropped:true,routeHttpExecuted:false,productionIncidentConfirmed:false,
  retryPolicy:null,cases:[
   mk('AB',normal,first),mk('AB_REPEAT',normal,first),
   mk('BA',normal,reverse),mk('PARALLEL',raceState,raceOutcomes,gate)]};
}
test('pure serialized race is a concurrency violation not a missing business-invariant oracle',()=>{
 const v=inspect(proof());
 assert.equal(v.verdict,'NON_SERIALIZABLE');
 assert.equal(v.deterministic,true);
});
test('duplicate parcel reference 23505 is NON_SERIALIZABLE_FAILURE, not inconclusive',()=>{
 const v=inspect(proof({fixture:'CANCELLED_EXISTING_PARCEL',
  raceState:state([['cancelled',29],['preparation',1]],1,0),
  raceOutcomes:[ok('A',true),reject('B','23505')]}));
 assert.equal(v.verdict,'NON_SERIALIZABLE_FAILURE');
 assert.equal(v.constrainedFailure,true);
});
test('stock-like guard error already present in sequential outcome is not new conflict',()=>{
 const x=proof({raceState:state([['preparation',30]],1,0),
  raceOutcomes:[ok('A'),reject('B','23514')]});
 const aligned=x.cases[0];
 aligned.after=x.cases[3].after;
 aligned.outcomes=x.cases[3].outcomes;
 x.cases[1].after=aligned.after;
 x.cases[1].outcomes=aligned.outcomes;
 assert.equal(inspect(x).verdict,'NO_CONFLICT');
});
test('physical state equals AB but returns reflect BA is NON_SERIALIZABLE',()=>{
 const p=proof({raceState:state([['preparation',30],['preparation',1]])});
 p.cases[3].outcomes=p.cases[2].outcomes;
 assert.equal(inspect(p).verdict,'NON_SERIALIZABLE');
});
test('different AB replay prevents false concurrency positives',()=>{
 const p=proof();
 p.cases[1].outcomes=[ok('A',true),ok('B')];
 assert.equal(inspect(p).verdict,'NONDETERMINISTIC_FIXTURE');
});
test('both physical state and outcomes match AB under lock => SERIALIZED_BY_LOCK',()=>{
 const p=proof({raceState:state([['preparation',30],['preparation',1]]),
  gate:{arrived:1,serialized:true}});
 p.cases[3].outcomes=p.cases[0].outcomes;
 assert.equal(inspect(p).verdict,'SERIALIZED_BY_LOCK');
});
test('serial retry errors become RETRYABLE only with an explicit declared policy',()=>{
 const p=proof({raceState:state([['preparation',30]],1,0),
  raceOutcomes:[ok('A'),reject('B','40001')]});
 assert.equal(inspect(p).verdict,'NON_SERIALIZABLE_FAILURE');
 p.retryPolicy={declared:true,codes:['40001'],source:'approved adapter retry contract'};
 assert.equal(inspect(p).verdict,'RETRYABLE');
});
test('physical snapshot corruption and missing clone are TOOL_ERROR',()=>{
 const p=proof();p.cases[0].after.total=0;
 assert.throws(()=>inspect(p),/TOOL_ERROR/);
 const x=proof();x.cases[3].cloneDropped=false;
 assert.throws(()=>inspect(x),/TOOL_ERROR/);
});
test('result fingerprint is invariant to outcome completion order and generated UUIDs',()=>{
 assert.equal(resultFingerprint([ok('B',true),ok('A')]),
   resultFingerprint([ok('A'),ok('B',true)]));
});
