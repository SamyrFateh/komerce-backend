'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {build,parseCard,reportMarkdown}=require('./v35-invariant-coverage');
const {run}=require('./v35-delivery-engine');
const vmSource=(inv)=>"'use strict';module.exports={name:'synthetic',domain:'sourcing',owner:'test',invariants:"+JSON.stringify(inv)+",files:{services:['services/sourcing-candidate-actions.js']}}";
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v35-coverage-'));
 fs.mkdirSync(path.join(root,'tests','unit'),{recursive:true});
 fs.writeFileSync(path.join(root,'tests/unit/example.test.js'),'// fixture\n');
 const runners={unit:[/^tests\/unit\/.*\.test\.js$/],playwright:new Set()};
 const source=vmSource([
  'Only one active state',
  {statement:'Mutation creates a real audit',test:'tests/unit/example.test.js'},
  {statement:'Another test declared but absent',test:'tests/unit/missing.test.js'},
  {statement:'Unknown runner cannot be claimed',test:'docs/not-a-test.txt'}
 ]);
 return {root,runners,cardEntries:[{file:'features/synthetic.feature.js',source}]};
}
test('exact invariant denominator partitions TEXT, registered and missing test files',()=>{
 const f=fixture();
 try{
  const c=build(f);
  assert.equal(c.metrics.cards,1);
  assert.equal(c.metrics.declared,4);
  assert.equal(c.metrics.textOnly,1);
  assert.equal(c.metrics.declaredWithTest,3);
  assert.equal(c.metrics.testAddressRegistered,1);
  assert.equal(c.metrics.testFileMissing,2);
  assert.equal(c.metrics.actuallyExecutedInvariantTests,0);
  assert.equal(c.metrics.independentlyCertifiedInvariants,0);
  assert.equal(c.invariants.filter(x=>x.fullyCertified).length,0);
  assert.deepEqual(c.invariants.map(x=>x.ordinal),[1,2,3,4]);
  assert.ok(reportMarkdown(c).includes('0/4'));
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
test('deterministic fingerprint and invariant IDs, and edits break registry hash',()=>{
 const f=fixture();
 try{
  const one=build(f),two=build(f);
  assert.equal(one.registryHash,two.registryHash);
  assert.deepEqual(one.invariants.map(x=>x.id),two.invariants.map(x=>x.id));
  f.cardEntries[0].source=f.cardEntries[0].source.replace('Only one','Only two');
  const changed=build(f);
  assert.notEqual(changed.registryHash,one.registryHash);
  assert.notEqual(changed.invariants[0].id,one.invariants[0].id);
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
test('malicious feature card cannot import fs or process in sandbox',()=>{
 const f=fixture();
 try{
  f.cardEntries[0].source="require('fs').writeFileSync('/tmp/unwanted','yes')";
  assert.throws(()=>build(f),/V35_INVARIANT_REGISTRY_TOOL_ERROR/);
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
test('no automatic claiming of individually proven invariants from a domain witness',()=>{
 const f=fixture();
 try{
  const c=build(f);
  assert.equal(c.domains.find(x=>x.domain==='sourcing').total,4);
  assert.equal(c.domains.find(x=>x.domain==='sourcing').independentOraclesLinked,0);
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
test('G2 quick full report enriches source provenance without running DB',async()=>{
 const f=fixture();
 const r=fs.mkdtempSync(path.join(os.tmpdir(),'v35-audit-'));
 try{
  const catalog=build(f);
  const base={contract:'komerce-unified-business-logic-auditor/v34',
   sha:'a'.repeat(40),mode:'quick',
   coverage:['sourcing','pricing','catalogue','orders','finance','inventory','logistics','authorization'].map(domain=>({domain,physicalCaseIds:[]})),
   static:{scannedFiles:100,trackedFiles:100},
   sourceDiscovery:{summary:{totalWriterPairs:10}},
   summary:{physicalCasesTotal:0,partialPhysicalDomains:0},
   physicalCaseIndex:[],physical:null,reportDirectory:r};
  let called=0;
  const result=await run(['--mode','quick'],{},{
   catalog:async()=>catalog,
   previous:async()=>{called++;return base}});
  assert.equal(called,1);
  assert.equal(result.summary.declaredFeatureInvariants,4);
  assert.equal(result.summary.individuallyCertifiedFeatureInvariants,0);
  assert.equal(result.invariantCoverage.metrics.testAddressRegistered,1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(r,'invariant-coverage.json'))).invariants.length,4);
  assert.equal(JSON.parse(fs.readFileSync(path.join(r,'unified-audit.json'))).summary.actualInvariantCoverageRatio,0);
 }finally{fs.rmSync(r,{recursive:true,force:true});fs.rmSync(f.root,{recursive:true,force:true})}
});
test('invalid declared coverage is a TOOL ERROR and never silently emitted',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v35-reject-'));
 try{
  let called=false;
  await assert.rejects(run([],{},{
   catalog:async()=>({contract:'komerce-invariant-provenance-registry/v35',registryHash:'broken',metrics:{declared:0}}),
   previous:async()=>{called=true}
  }),/V35_COVERAGE_TOOL_ERROR/);
  assert.equal(called,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
