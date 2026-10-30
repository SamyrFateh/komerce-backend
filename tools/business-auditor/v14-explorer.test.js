'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {generatePlans,OPERATORS}=require('./v14-sequence-planner');
const {inspect}=require('./v14-sequence-predicates');
test('generated plans cover both owners, idempotence and cancellations without any issue-specific sequence',()=>{
 const plans=generatePlans(4);
 assert.ok(plans.length>=20);
 assert.equal(new Set(plans.map(x=>x.actions.join('|'))).size,plans.length);
 assert.deepEqual(OPERATORS.map(x=>x.id),['ASSIGN_A','ASSIGN_B','CANCEL_OPEN']);
 assert.ok(plans.some(x=>x.actions.join('|')==='ASSIGN_A|CANCEL_OPEN|ASSIGN_A'));
 assert.ok(plans.some(x=>x.actions.join('|')==='ASSIGN_A|ASSIGN_B|CANCEL_OPEN|ASSIGN_B'));
 assert.ok(plans.some(x=>x.actions.join('|')==='ASSIGN_A|ASSIGN_A'));
 assert.ok(plans.every(p=>p.actions.length<=4&&p.actions[0]!=='CANCEL_OPEN'));
 assert.throws(()=>generatePlans(5),/depth/);
});
const initial=()=>({orders:[{order:'A',status:'ordered'},{order:'B',status:'ordered'}],
 parcels:[],members:[]});
function record({falseReport=false,wrongOwner=false}={}){
 const plans=generatePlans(1);
 const cases=plans.map(p=>{
  const owner=p.actions[0]==='ASSIGN_A'?'A':'B';
  const target=wrongOwner?'A':owner;
  const item=target==='A'?'IA':'IB',parcel=target==='A'?'PA':'PB';
  return {id:p.id,actions:p.actions,ids:{A:'A',B:'B',relay:'R',itemA:'IA',itemB:'IB'},
   initial:initial(),steps:[{action:p.actions[0],target:owner,
    result:{success:true,items_assigned:falseReport?0:1},
    state:{orders:initial().orders,parcels:[{id:parcel,status:'preparation',members:1,carrier:target}],
     members:[{parcel,item,order:target,quantity:1,parcelStatus:'preparation'}]}}]};
 });
 return {contract:'komerce-business-sequence-exploration-raw/v14',
  scope:'CANONICAL_PG_REAL_OWNERS_SINGLE_CONNECTION',depth:1,
  generatedCases:cases.length,actionAlphabet:['ASSIGN_A','ASSIGN_B','CANCEL_OPEN'],
  cases,dbLocalOnly:true,rollbackVerified:true,allCasesSavepointRolledBack:true,
  concurrentTransactionsExecuted:false,routeHttpExecuted:false,productionIncidentConfirmed:false};
}
test('report-vs-state predicate passes physical nominal without requiring a known-bug verdict',()=>{
 const r=inspect(record());
 assert.equal(r.totalSignals,0);assert.equal(r.plannedCases,2);assert.equal(r.evaluatedSteps,2);
});
test('false business success becomes finding and cannot be hidden in a test-owned boolean',()=>{
 const raw=record({falseReport:true});raw.observationCorrect=true;
 const r=inspect(raw);
 assert.equal(r.signalCounts.ASSIGNMENT_COUNT_DISAGREES_WITH_DB,2);
 assert.equal(r.knownFamilySignals,2);
 assert.equal(r.productionIncidentConfirmed,false);
});
test('assignment attributed to wrong owner is independently detected',()=>{
 const r=inspect(record({wrongOwner:true}));
 assert.ok(r.totalSignals>=1);
});
test('inconsistent physical counts are a tool error rather than a business finding',()=>{
 const r=record();r.cases[0].steps[0].state.parcels[0].members=2;
 assert.throws(()=>inspect(r),/TOOL_ERROR/);
});
