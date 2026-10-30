'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DOMAINS,ADAPTERS,validate,assertProof,physicalDescriptors}=require('./v34-experiment-registry');
const {run,assemble,digest}=require('./v34-delivery-engine');
const sha='a'.repeat(40),hash='b'.repeat(64);
function baseline(dir){
 return {contract:'komerce-unified-business-logic-auditor/v29',sha,
  mode:'full',static:{scannedFiles:1616,trackedFiles:1616,suspicions:31},
  data:{status:'EXECUTED',rules:Array(7).fill({id:'x'})},
  sourceDiscovery:{summary:{totalWriterPairs:965,equivalenceClasses:27}},
  physical:{cases:[
   {id:'FIN-REFUND-BA',domain:'finance',result:'PASS_WITH_EVIDENCE',cloneDropped:true},
   {id:'LOG-PARCEL-NOMINAL',domain:'logistics',result:'PASS_WITH_EVIDENCE',cloneDropped:true},
   {id:'FIN-REFUND-AB',domain:'finance',result:'BUSINESS_VIOLATION',cloneDropped:true},
   {id:'LOG-PARCEL-CANCELLED',domain:'logistics',result:'BUSINESS_VIOLATION',cloneDropped:true}
  ]},
  coverage:DOMAINS.map(domain=>({domain,physicalCaseIds:[],
   status:['finance','logistics'].includes(domain)?'CALIBRATED_PARTIAL':'NOT_PHYSICALLY_COVERED',
   fullBusinessDomainCertification:false})),
  summary:{},reportDirectory:dir};
}
function gateProof(a){
 return {contract:'fixture',sha,allClonesDropped:true,
  source:{[a.sourceHashKey]:hash},
  cases:a.modes.map((mode,i)=>{
   const negative=a.requiredNegative[i];
   return {mode,verdict:a.verdicts[i],cloneDropped:true,
    authenticatedHttpRouteTested:false,
    oracle:{violation:a.verdicts[i]==='BUSINESS_VIOLATION',
     signals:a.knownViolation&&i===1?[a.knownViolation]:[]},
    negativeControl:a.knownViolation&&i===1?
     {correctedContractWouldPass:true,forgedSignals:[negative]}:
     {signals:negative?[negative]:[]}};
  })};
}
function temp(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v34-delivery-'));return dir}
test('four reviewed gates cover six domains without duplicate physical identities',()=>{
 assert.equal(validate(),true);
 assert.equal(ADAPTERS.length,4);
 assert.equal(new Set(ADAPTERS.flatMap(a=>a.caseIds)).size,8);
});
test('independent proof admission refuses source drift, missing clones, missing negative',()=>{
 for(const a of ADAPTERS){
  const p=gateProof(a);
  assert.equal(assertProof(a,p,{[a.sourceHashKey]:hash}),true);
  assert.throws(()=>assertProof(a,p,{[a.sourceHashKey]:'c'.repeat(64)}),/V34_REGISTRY_TOOL_ERROR/);
  p.allClonesDropped=false;
  assert.throws(()=>assertProof(a,p,{[a.sourceHashKey]:hash}),/V34_REGISTRY_TOOL_ERROR/);
  p.allClonesDropped=true;
  const i=a.requiredNegative.findIndex(Boolean);
  p.cases[i].negativeControl={signals:[],forgedSignals:[]};
  assert.throws(()=>assertProof(a,p,{[a.sourceHashKey]:hash}),/V34_REGISTRY_TOOL_ERROR/);
 }
});
test('full aggregation reports 12 cases and 8 PARTIAL domains, never full certification',()=>{
 const proofs=Object.fromEntries(ADAPTERS.map(a=>[a.reportKey,gateProof(a)]));
 const r=assemble(baseline('/tmp/mock'),proofs,true);
 assert.equal(r.summary.physicalCasesTotal,12);
 assert.equal(r.summary.partialPhysicalDomains,8);
 assert.deepEqual(r.summary.domainsNotPhysicallyCovered,[]);
 assert.equal(r.allBusinessDomainsCertified,false);
 assert.equal(r.summary.actualInvariantCoverageRatio,null);
 assert.ok(r.summary.knownBusinessViolations.includes('SOURCING-FULL-SNAPSHOT-ARCHIVE'));
 assert.equal(r.physicalCaseIndex.length,12);
 assert.match(digest(r),/Domaines entièrement certifiés : 0\/8/);
});
test('quick mode never preflights physical owner or executes clones',async()=>{
 const dir=temp();
 try{
  let baseCalls=0,gateCalls=0,anchorCalls=0;
  const runners=Object.fromEntries(ADAPTERS.map(a=>[a.id,{
   anchor(){anchorCalls++;return {[a.sourceHashKey]:hash}},
   async run(){gateCalls++;return gateProof(a)}
  }]));
  const b={...baseline(dir),mode:'quick',
   data:{status:'NOT_RUN',rules:[]},physical:null,
   coverage:baseline(dir).coverage.map(c=>({...c,physicalCaseIds:[],
    status:'NOT_PHYSICALLY_COVERED'}))};
  const r=await run(['--mode','quick'],{},{
   baseRun:async()=>{baseCalls++;return b},runners});
  assert.equal(baseCalls,1);assert.equal(gateCalls,0);assert.equal(anchorCalls,0);
  assert.equal(r.summary.physicalCasesTotal,0);
  assert.equal(r.summary.partialPhysicalDomains,0);
  assert.equal(r.orchestrator.recursivelyChainedV30toV33,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'unified-audit.json'))).summary.physicalCasesTotal,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('full mode uses one baseline and four flat gates exactly once',async()=>{
 const dir=temp();
 try{
  let baseCalls=0,gateCalls=0,anchorCalls=0;
  const runners=Object.fromEntries(ADAPTERS.map(a=>[a.id,{
   anchor(){anchorCalls++;return {[a.sourceHashKey]:hash}},
   async run(){gateCalls++;return gateProof(a)}
  }]));
  const r=await run(['--mode','full'],{
   NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',
   DATABASE_URL:'postgres://tester@localhost/komerce_test'},{
   baseRun:async()=>{baseCalls++;return baseline(dir)},runners});
  assert.equal(baseCalls,1);assert.equal(gateCalls,4);assert.equal(anchorCalls,4);
  assert.equal(r.summary.physicalCasesTotal,12);
  assert.equal(r.summary.partialPhysicalDomains,8);
  assert.equal(r.summary.actualInvariantCoverageRatio,null);
  assert.equal(r.orchestrator.recursivelyChainedV30toV33,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('full mode fails before source/SQL work with a remote DB',async()=>{
 let invoked=false;
 await assert.rejects(run(['--mode','full'],{
  NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',
  DATABASE_URL:'postgres://tester@railway-host/komerce_test'},{
  baseRun:async()=>{invoked=true}
 }),/Only local komerce_test allowed/);
 assert.equal(invoked,false);
});
