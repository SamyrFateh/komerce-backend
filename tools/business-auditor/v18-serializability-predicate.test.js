'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fingerprint,inspect}=require('./v18-serializability-predicate');
function state(parcelCounts,counts=[1,1]){
 return {parcels:parcelCounts.map(n=>({status:'preparation',members:n})),
  assignedByOrder:[{target:'A',members:counts[0]},{target:'B',members:counts[1]}],
  total:parcelCounts.reduce((a,b)=>a+b,0)};
}
function raw(raceCounts=[31],gate={arrived:2,serialized:false}){
 const mk=(mode,after,g)=>({mode,before:state([29],[0,0]),after,
  cloneDropped:true,outcomes:[
   {target:'A',status:'fulfilled',value:{success:true}},
   {target:'B',status:'fulfilled',value:{success:true}}],
  gate:g||{arrived:0,serialized:false}});
 return {contract:'komerce-adapter-serializability-raw/v18',
  method:'PHYSICAL_PG_CANONICAL_THREE_CLONES',allClonesDropped:true,
  productionIncidentConfirmed:false,routeHttpExecuted:false,
  cases:[mk('AB',state([30,1])),mk('BA',state([1,30])),
    mk('PARALLEL',state(raceCounts),gate)]};
}
test('physical 31 membership race cannot equal either serial schedule',()=>{
 const v=inspect(raw());assert.equal(v.verdict,'NON_SERIALIZABLE');
 assert.equal(v.matchAB,false);assert.equal(v.matchBA,false);
});
test('locking actual owner gives serial fingerprint and lock-specific verdict',()=>{
 const v=inspect(raw([30,1],{arrived:1,serialized:true}));
 assert.equal(v.verdict,'SERIALIZED_BY_LOCK');
 assert.equal(v.lockWaitObserved,true);
});
test('serial outcomes with no lock are NO_CONFLICT',()=>{
 assert.equal(inspect(raw([1,30])).verdict,'NO_CONFLICT');
});
test('same physical counts with different random UUIDs produce same fingerprint',()=>{
 const a=state([30,1]),b=state([1,30]);
 assert.equal(fingerprint(a),fingerprint(b));
});
test('owner exception is classified inconclusive and not an invented bug',()=>{
 const p=raw();p.cases[2].outcomes[1]={target:'B',status:'rejected',code:'23505'};
 assert.equal(inspect(p).verdict,'INCONCLUSIVE_OWNER_EXCEPTION');
});
test('inconsistent SQL observations or uncleaned clones never count as business signals',()=>{
 const p=raw();p.cases[2].after.total=99;
 assert.throws(()=>inspect(p),/TOOL_ERROR/);
 const x=raw();x.allClonesDropped=false;
 assert.throws(()=>inspect(x),/TOOL_ERROR/);
});
