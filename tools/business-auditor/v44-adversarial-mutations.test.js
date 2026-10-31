'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {cases,mutate,judge}=require('./v44-adversarial-mutations');
const owner=fs.readFileSync(path.resolve(__dirname,'../../services/inventory-service.js'),'utf8');
test('V44 mutations preserve syntax and have unique live owner anchors',()=>{
 assert.equal(cases.length,7);
 assert.equal(cases.filter(c=>c.truth==='VIOLATION').length,5);
 for(const c of cases){
  const changed=mutate(owner,c.id);
  assert.notEqual(changed,owner);
  assert.doesNotThrow(()=>new Function('module','require',changed));
 }
 assert.throws(()=>mutate(owner,'ARBITRARY'),/V44_MUTANT_UNKNOWN/);
 assert.throws(()=>mutate('irrelevant','SKIP_ASSIGNMENT'),/ANCHOR_NON_UNIQUE/);
});
function make(){
 return cases.map(c=>({id:c.id,executions:[0,1].map(()=>({
  verdict:c.truth==='VIOLATION'?'BUSINESS_VIOLATION':'PASS_WITH_EVIDENCE',
  cloneDropped:true,realOwnerCalled:true,canonicalPostgres:true,
  oracle:{signals:[]}
 }))}));
}
test('V44 independent calibration distinguishes real missed defects from equivalents',()=>{
 const good=judge(make());
 assert.equal(good.summary.status,'PASS_ADVERSARIAL_INVENTORY');
 assert.deepEqual([good.summary.truePositive,good.summary.falsePositive],[5,0]);
 const a=make();a[0].executions[0].verdict='PASS_WITH_EVIDENCE';
 assert.equal(judge(a).summary.falseNegative,1);
 const b=make();b[5].executions[0].verdict='BUSINESS_VIOLATION';
 assert.equal(judge(b).summary.falsePositive,1);
 const c=make();c[0].executions[0].cloneDropped=false;
 assert.throws(()=>judge(c),/PROVENANCE_MISSING/);
});
