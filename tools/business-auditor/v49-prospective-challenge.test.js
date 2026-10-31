'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),
 fs=require('node:fs'),path=require('node:path');
const {PROBES,shuffled,mutate,assess,metrics,parse}=require('./v49-prospective-challenge');
const {CASES:KNOWN}=require('./v45-three-domain-mutations');
const ROOT=path.resolve(__dirname,'../..');
test('V49 has 2 prospective faults and 1 healthy equivalent for each of 3 owner families',()=>{
 assert.equal(PROBES.length,9);
 assert.deepEqual([...new Set(PROBES.map(x=>x.owner))].sort(),['FX','MARKET','ORDER']);
 for(const owner of ['FX','MARKET','ORDER']){
  assert.equal(PROBES.filter(x=>x.owner===owner&&x.truth==='FAULT').length,2);
  assert.equal(PROBES.filter(x=>x.owner===owner&&x.truth==='EQUIVALENT').length,1);
 }
 const known=new Set(KNOWN.map(c=>c.id));
 for(const c of PROBES){
  assert.ok(!known.has(c.id),'V45 registered mutant cannot count as V49 novel');
  const source=fs.readFileSync(path.join(ROOT,c.path),'utf8');
  const modified=mutate(source,c);
  assert.notEqual(modified,source);
  assert.ok(modified.includes(c.to));
 }
 assert.throws(()=>mutate('bad',PROBES[0]),/V49_CHALLENGE_ERROR/);
 assert.throws(()=>parse(['--id','FX_NUMERATOR_DOUBLE']),/V49_CHALLENGE_ERROR/);
});
test('V49 uses evaluator randomization, not input fixed order',()=>{
 const reversed=shuffled(PROBES,()=>0);
 assert.equal(reversed.length,PROBES.length);
 assert.deepEqual(new Set(reversed),new Set(PROBES));
 assert.notDeepEqual(reversed,PROBES);
});
const result=(spec,signals)=>({id:spec.id,owner:spec.owner,truth:spec.truth,
 signals,toolError:null});
test('V49 calculates recall and specificity and fails closed on false positives and missed defects',()=>{
 const perfect=PROBES.map(x=>result(x,x.truth==='FAULT'?['ORACLE']:[]));
 assert.deepEqual(
  (({TP,TN,FP,FN,toolErrors})=>({TP,TN,FP,FN,toolErrors}))(metrics(perfect)),
  {TP:6,TN:3,FP:0,FN:0,toolErrors:0});
 assert.equal(metrics(perfect).verdict,'PASS_PROSPECTIVE_NON_SEALED');
 const missed=structuredClone(perfect);
 missed.find(x=>x.truth==='FAULT').signals=[];
 assert.equal(metrics(missed).FN,1);
 assert.equal(metrics(missed).verdict,'FAIL_PROSPECTIVE_NON_SEALED');
 const fp=structuredClone(perfect);
 fp.find(x=>x.truth==='EQUIVALENT').signals=['WRONG'];
 assert.equal(metrics(fp).FP,1);
 const error=structuredClone(perfect);
 error[0].toolError='PG unavailable';error[0].signals=null;
 assert.equal(metrics(error).toolErrors,1);
 assert.throws(()=>metrics(perfect.slice(1)),/V49_CHALLENGE_ERROR/);
});
test('V49 accepts only scanner-selected owner, clean clone and matching source fingerprint',()=>{
 const p=PROBES[0],s='d'.repeat(64);
 const raw={
  contract:'komerce-autonomous-code-diff-discovery/v48',
  selection:{mode:'GIT_CHANGE_DRIVEN',changedPaths:[p.path],selected:[p.owner]},
  ownerSourceFingerprints:{[p.path]:s},
  summary:{ownerErrors:0,reviewedOwnersExecuted:1},
  certifiedAutonomousUnknownBugDiscovery:false,
  observations:[{mode:p.owner,cloneDropped:true,ownerCodeExecuted:true,
   sourceMutantIdProvided:false,signals:['FX1_PIVOT_RESULT_OR_ROUNDING_MISMATCH']}]
 };
 assert.deepEqual(assess(raw,p.owner,p.path,s),raw.observations[0].signals);
 const forged=structuredClone(raw);forged.observations[0].cloneDropped=false;
 assert.throws(()=>assess(forged,p.owner,p.path,s),/V49_CHALLENGE_ERROR/);
 const swap=structuredClone(raw);swap.selection.selected=['ORDER'];
 assert.throws(()=>assess(swap,p.owner,p.path,s),/V49_CHALLENGE_ERROR/);
 const hash=structuredClone(raw);hash.ownerSourceFingerprints[p.path]='e'.repeat(64);
 assert.throws(()=>assess(hash,p.owner,p.path,s),/V49_CHALLENGE_ERROR/);
});
