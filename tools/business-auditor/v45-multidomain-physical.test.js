'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {CASES,OWNERS,mutate,select,judge}=require('./v45-three-domain-mutations');
const {parse}=require('./v45-multidomain-physical');
test('V45 source mutants use precise anchors and retain valid JavaScript',()=>{
 assert.equal(Object.keys(OWNERS).length,3);
 assert.equal(CASES.length,9);
 assert.equal(CASES.filter(c=>c.truth==='FAULT').length,6);
 assert.equal(CASES.filter(c=>c.truth==='EQUIVALENT_ON_FIXTURE').length,3);
 for(const c of CASES){
  const before=fs.readFileSync(path.resolve(__dirname,'../..',c.source),'utf8');
  const after=mutate(before,c.id,c.source);
  assert.notEqual(before,after);
  assert.doesNotThrow(()=>new Function('module','require',after),c.id);
 }
 assert.throws(()=>mutate('x','FX_INCORRECT_PIVOT',OWNERS.FX),/NON_UNIQUE_SOURCE_ANCHOR/);
 assert.throws(()=>mutate('x','ANY',OWNERS.FX),/UNSUPPORTED_MUTATION/);
 assert.throws(()=>mutate('x','FX_INCORRECT_PIVOT','services/foreign.js'),/UNSUPPORTED_MUTATION/);
});
test('V45 strictly limits executable impact selection to reviewed owners',()=>{
 assert.deepEqual(select([OWNERS.FX,OWNERS.ORDER]),['FX','ORDER']);
 assert.deepEqual(select(Object.values(OWNERS)),['FX','MARKET','ORDER']);
 for(const bad of [['services/finance-refund.js'],['../services/fx-authority.js'],[]])
  assert.throws(()=>select(bad),/V45_/);
 assert.deepEqual(parse(['--files',OWNERS.FX, '--out','/tmp/report']).files,[OWNERS.FX]);
 assert.throws(()=>parse(['--untrusted','yes']),/V45_PHYSICAL_TOOL_ERROR/);
});
const sample=(faults=true)=>CASES.map(c=>({
 id:c.id,domain:c.domain,mode:c.mode,truth:c.truth,
 signals:c.truth==='FAULT'&&faults?['EXPECTED_INDEPENDENT_ORACLE_VIOLATION']:[],
 realOwnerExecuted:true,canonicalPg:true,cloneDropped:true,mutationApplied:true
}));
test('V45 judge detects missing mutations, false positives, duplicate proof and provenance spoof',()=>{
 const modes=['FX','MARKET','ORDER'],all=sample();
 const ok=judge(all,modes);
 assert.deepEqual([ok.summary.faults,ok.summary.detected,ok.summary.falsePositives],
  [6,6,0]);
 assert.equal(ok.summary.status,'PASS_REVIEWED_THREE_DOMAIN_ADVERSARIAL');
 const missed=sample();missed[0].signals=[];
 assert.equal(judge(missed,modes).summary.missed,1);
 const fp=sample();fp[2].signals=['BAD'];
 assert.equal(judge(fp,modes).summary.falsePositives,1);
 const damaged=sample();damaged[0].cloneDropped=false;
 assert.throws(()=>judge(damaged,modes),/MISSING_PROVENANCE/);
 assert.throws(()=>judge([...all.slice(0,8),all[0]],modes),/DUPLICATE_EXPERIMENT|INCOMPLETE/);
 assert.throws(()=>judge(all.slice(1),modes),/INCOMPLETE/);
});
