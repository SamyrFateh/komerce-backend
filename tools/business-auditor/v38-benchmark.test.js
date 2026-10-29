'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {TRUTH,build,matrix,digest}=require('./v38-benchmark');
const {generate,evaluate}=require('./v37-order-matrix-generator');
const SHA='a'.repeat(40);
function observed(plan,mutant=false){
 return plan.cases.map(c=>{
  const pass=c.expected==='TRANSITION'||(mutant&&c.role==='agent_relais'&&c.target==='ordered');
  return {id:c.id,sourceStatus:'confirmed',target:c.target,role:c.role,
   initialStatus:'confirmed',initialHistory:0,finalStatus:pass?'ordered':'confirmed',
   finalHistory:pass?1:0,finalHistoryStatus:pass?'ordered':null,
   orderedTimestampPresent:pass,ownerSuccess:pass};
 });
}
function pair(){
 const plan=generate('blind-benchmark');
 const base={contract:'komerce-unified-business-logic-auditor/v35',sha:SHA,
  invariantCoverage:{registryHash:'f'.repeat(64)},
  physicalCaseIndex:Object.entries(TRUTH).map(([id,label])=>({
   id,verdict:label==='BUG'?'BUSINESS_VIOLATION':'PASS_WITH_EVIDENCE',
   cloneDropped:true}))};
 const generated={contract:'komerce-generated-order-matrix-gate/v37',sha:SHA,
  plan:{scenarioCount:24,sourceMutantKnownToGenerator:false},
  allClonesDropped:true,cases:[
   {mode:'NOMINAL',oracle:evaluate(plan,observed(plan))},
   {mode:'BLIND_MUTANT',oracle:evaluate(plan,observed(plan,true))}
  ]};
 return {base,generated};
}
test('frozen truth score: 60 reviewed cases, 4 positives, zero FP or FN on limited set',()=>{
 const {base,generated}=pair(),b=build(base,generated);
 assert.equal(b.confusion.total,60);
 assert.equal(b.confusion.tp,4);
 assert.equal(b.confusion.fp,0);
 assert.equal(b.confusion.fn,0);
 assert.equal(b.confusion.tn,56);
 assert.equal(b.confusion.recall,1);
 assert.equal(b.confusion.precision,1);
 assert.equal(b.limits.hiddenMutationClassCount,1);
 assert.equal(b.limits.notAReleaseGO,true);
 assert.match(digest(b),/NE PROUVE PAS/);
});
test('perfect-pass oracle is scored with false negatives, not certified',()=>{
 const {base,generated}=pair();
 const r=generated.cases[1].oracle.results.find(x=>x.role==='agent_relais'&&x.target==='ordered');
 r.signals=[];
 const b=build(base,generated);
 assert.equal(b.confusion.fn,1);
 assert.ok(b.confusion.recall<1);
});
test('false alarm in nominal cohort is counted as FP',()=>{
 const {base,generated}=pair();
 generated.cases[0].oracle.results[0].signals=['FAKE_ALARM'];
 const b=build(base,generated);
 assert.equal(b.confusion.fp,1);
 assert.ok(b.confusion.precision<1);
});
test('mixed git SHAs and deleted clone evidence are TOOL_ERRORS',()=>{
 const {base,generated}=pair();
 generated.sha='b'.repeat(40);
 assert.throws(()=>build(base,generated),/V38_BENCHMARK_TOOL_ERROR/);
 generated.sha=SHA;
 base.physicalCaseIndex[0].cloneDropped=false;
 assert.throws(()=>build(base,generated),/V38_BENCHMARK_TOOL_ERROR/);
});
test('missing external truth label cannot silently drop a hard case',()=>{
 const {base,generated}=pair();
 base.physicalCaseIndex[0].id='unexpected-owner-event';
 assert.throws(()=>build(base,generated),/V38_BENCHMARK_TOOL_ERROR/);
});
test('nonmeasurable precision is returned null rather than fictional 100 percent',()=>{
 const r=matrix([{actual:'CLEAN',detected:false}]);
 assert.equal(r.precision,null);
 assert.equal(r.recall,null);
 assert.equal(r.tn,1);
});
