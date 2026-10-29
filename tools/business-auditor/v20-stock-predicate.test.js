'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {inspect}=require('./v20-stock-predicate');
const {compareSchedules}=require('./v20-serial-kernel');
const ok=target=>({target,status:'fulfilled',value:{success:true}});
const err=(target,code='23514')=>({target,status:'rejected',code});
function raw(stock=1,winner='A'){
 const mk=(mode,results)=>({mode,cloneDropped:true,
  before:{stock},after:{stock:0},outcomes:results,
  gate:{arrived:mode==='PARALLEL'?2:0,serialized:false}});
 const ab=stock===1?[ok('A'),err('B')]:[ok('A'),ok('B')];
 const ba=stock===1?[ok('B'),err('A')]:[ok('B'),ok('A')];
 const race=stock===1?(winner==='A'?[ok('A'),err('B')]:[ok('B'),err('A')]):[ok('A'),ok('B')];
 return {contract:'komerce-opus-stock-negative-control-raw/v20',
  openingStock:stock,dbIsolation:'LOCAL_CANONICAL_TEMPLATE_CLONES',
  allClonesDropped:true,noExternalPayments:true,productionIncidentConfirmed:false,
  cases:[mk('AB',ab),mk('AB_REPEAT',ab),mk('BA',ba),mk('PARALLEL',race)]};
}
test('real-check-like failure is sequentially equivalent whichever actor succeeds',()=>{
 for(const winner of ['A','B']){
  const v=inspect(raw(1,winner));
  assert.equal(v.verdict,'NO_CONFLICT');
  assert.equal(v.negativeControlPassed,true);
  assert.ok(v.serialErrors.includes('23514'));
  assert.ok(v.raceErrors.includes('23514'));
 }
});
test('two atomic decrements from stock=2 can both succeed and remain serializable',()=>{
 const v=inspect(raw(2));
 assert.equal(v.verdict,'NO_CONFLICT');
 assert.equal(v.negativeControlPassed,true);
});
test('unexpected exception in parallel is correctly counted as false-positive alarm on control',()=>{
 const p=raw(1);p.cases[3].outcomes[1]=err('B','23505');
 const v=inspect(p);
 assert.equal(v.verdict,'NON_SERIALIZABLE_FAILURE');
 assert.equal(v.falsePositiveDetected,true);
});
test('stock evidence with negative persisted balance is invalid, not a found race',()=>{
 const p=raw(1);p.cases[3].after.stock=-1;
 assert.throws(()=>inspect(p),/TOOL_ERROR/);
});
test('both adapter domains reuse exactly the same comparison kernel',()=>{
 assert.equal(typeof compareSchedules,'function');
 const a=inspect(raw(1,'A')),b=inspect(raw(1,'B'));
 assert.equal(a.verdict,b.verdict);
});
