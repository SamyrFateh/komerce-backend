'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {compareBaseline}=require('./v12-baseline-gate');
const b=require('./v12-verdict-baseline.json');
const report=()=>({contract:'komerce-business-bug-hunter/v1',
 findings:Object.keys(b.expected).map(id=>({id,verdict:b.expected[id]}))});
test('reviewed known violation baseline matches but is not business acceptance',()=>{
 const x=compareBaseline(b,report());
 assert.equal(x.outcome,'BASELINE_MATCH');assert.equal(x.incidentsConfirmed,0);
});
test('fix to known defect triggers explicit human baseline review',()=>{
 const r=report();r.findings[0].verdict='CONTROLLED_TEST_INVARIANT_SATISFIED';
 const x=compareBaseline(b,r);
 assert.equal(x.outcome,'BASELINE_DRIFT');
 assert.equal(x.changes[0].type,'VERDICT_CHANGED');
});
test('new violation/oracle triggers baseline drift',()=>{
 const r=report();r.findings.push({id:'INVENTORY-NEW',verdict:'REPRODUCED_CONTROLLED_TEST_INVARIANT_VIOLATION'});
 const x=compareBaseline(b,r);
 assert.deepEqual(x.changes.map(z=>z.id),['INVENTORY-NEW']);
});
test('tool error, stale/missing or duplicated claims do not count as business regressions',()=>{
 assert.throws(()=>compareBaseline(b,{}),/TOOL_ERROR/);
 const r=report();r.findings.push(r.findings[0]);
 assert.throws(()=>compareBaseline(b,r),/TOOL_ERROR/);
});
