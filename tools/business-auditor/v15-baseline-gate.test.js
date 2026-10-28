'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {compare}=require('./v15-baseline-gate');
const baseline=require('./v15-concurrency-baseline.json');
const report=()=>({contract:'komerce-physical-concurrency-proof/v15',
 verdict:{contract:'komerce-canonical-pg-concurrency-predicate/v15',
  verdict:baseline.expectedVerdict,sequential:{maximum:30},concurrent:{maximum:31},capacity:30},
 raw:{allFixturesDeleted:true}});
test('same physical race is stable on explicit issue baseline but not accepted business behavior',()=>{
 const r=compare(baseline,report());
 assert.equal(r.outcome,'BASELINE_MATCH');assert.equal(r.issue,3095);
 assert.equal(r.productionIncidentConfirmed,false);
});
test('business fix requires reviewing this intentionally failing research baseline',()=>{
 const r=report();r.verdict.concurrent.maximum=30;
 r.verdict.verdict='CONTROLLED_CONCURRENT_PG_CAPACITY_SATISFIED';
 const x=compare(baseline,r);
 assert.equal(x.outcome,'REVIEW_REQUIRED');
 assert.ok(x.changes.some(y=>y.field==='verdict'));
});
test('new capacity regression or unsafe cleanup also requires review',()=>{
 const r=report();r.verdict.sequential.maximum=31;r.raw.allFixturesDeleted=false;
 assert.equal(compare(baseline,r).changes.length,2);
});
test('invalid proof is tool error',()=>{
 assert.throws(()=>compare(baseline,{}),/TOOL_ERROR/);
});
