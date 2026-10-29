'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {choose}=require('./v36-targeted-selector');
const {parse,run}=require('./v36-targeted-audit');
const hash='a'.repeat(64);
const card={contract:'komerce-invariant-provenance-registry/v35',
 registryHash:hash,cards:[{file:'features/orders.feature.js'}],
 invariants:[
  {id:'KINV-ORDER-1',feature:'orders',auditorDomain:'orders',
   featureFile:'features/orders.feature.js',
   ownedSources:['services/order-status-machine.js'],
   test:'tests/unit/order-status-machine.test.js',testStatus:'TEST_DECLARED_RUNNER_REGISTERED'},
  {id:'KINV-SOURCE-1',feature:'sourcing',auditorDomain:'sourcing',
   featureFile:'features/sourcing.feature.js',
   ownedSources:['services/sourcing-candidate-import-service.js'],
   test:null,testStatus:'NO_EXECUTABLE_TEST_DECLARED'}]};
test('selection is deterministic, source grounded and counts implicated declared invariants',()=>{
 const a=choose({files:['services/order-status-machine.js'],catalog:card,
  maxClones:2,exists:()=>true});
 const b=choose({files:['services/order-status-machine.js'],catalog:card,
  maxClones:2,exists:()=>true});
 assert.equal(a.selectionHash,b.selectionHash);
 assert.equal(a.selectedAdapters.length,1);
 assert.equal(a.selectedAdapters[0].id,'orders-sourcing');
 assert.equal(a.plannedClones,2);
 assert.deepEqual(a.impactedInvariants.map(x=>x.id),['KINV-ORDER-1']);
 assert.equal(a.selectionDoesNotProveBug,true);
});
test('changed file with no reviewed owner is NOT COVERED, never executed automatically',()=>{
 const a=choose({files:['services/unknown-service.js'],catalog:card,
  maxClones:2,exists:()=>true});
 assert.equal(a.selectedAdapters.length,0);
 assert.deepEqual(a.unmatchedChanges,['services/unknown-service.js']);
 assert.equal(a.unknownPairExecutability,'NOT_COVERED');
});
test('two eligible groups with budget 2 select exactly one, defer the other',()=>{
 const a=choose({files:['services/order-status-machine.js',
  'services/fx-authority.js'],catalog:card,maxClones:2,exists:()=>true});
 assert.equal(a.candidateAdapters.length,2);
 assert.equal(a.selectedAdapters.length,1);
 assert.equal(a.deferredAdapters.length,1);
 assert.equal(a.plannedClones,2);
});
test('zero clone budget remains safe with meaningful unexecuted candidates',()=>{
 const a=choose({files:['services/order-status-machine.js'],catalog:card,
  maxClones:0,exists:()=>true});
 assert.equal(a.selectedAdapters.length,0);
 assert.equal(a.deferredAdapters.length,1);
});
test('paths are deduplicated and traversal is refused before selection',()=>{
 assert.throws(()=>choose({files:['../staging.env'],catalog:card}),/V36_TARGETED_SELECTOR_TOOL_ERROR/);
 const a=choose({files:['services/order-status-machine.js',
  'services/order-status-machine.js'],catalog:card,maxClones:2,exists:()=>true});
 assert.equal(a.files.length,1);
});
test('CLI recognizes dry-run budget and changed list',()=>{
 assert.deepEqual(parse(['--changed','services/order-status-machine.js',
  '--dry-run','--budget','0']).files,['services/order-status-machine.js']);
 assert.throws(()=>parse([]),/V36_TARGETED_TOOL_ERROR/);
});
test('targeted dry-run writes plan without opening any database or gates',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v36-targeted-'));
 try{
  fs.writeFileSync(path.join(dir,'invariant-coverage.json'),JSON.stringify(card));
  const mock={contract:'komerce-unified-business-logic-auditor/v35',
   physical:null,reportDirectory:dir,sha:'b'.repeat(40)};
  let calls=0;
  const result=await run(['--changed','services/order-status-machine.js','--dry-run'],{},{
   sourceRun:async()=>mock,
   exists:()=>true,
   runners:{'orders-sourcing':{anchor:()=>{throw Error('should not preflight')},
    run:()=>{throw Error('should not execute')}}}});
  assert.equal(result.physicalCases.length,0);
  assert.equal(result.selection.selectedAdapters.length,1);
  assert.equal(result.summary.newBugAutonomousDiscoveryProven,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'targeted-plan.json'))).plannedClones,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('physical mode refuses any remote DB BEFORE a selected owner can run',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v36-targeted-'));
 try{
  fs.writeFileSync(path.join(dir,'invariant-coverage.json'),JSON.stringify(card));
  const mock={contract:'komerce-unified-business-logic-auditor/v35',
   physical:null,reportDirectory:dir,sha:'b'.repeat(40)};
  await assert.rejects(run(['--changed','services/order-status-machine.js'],{
   NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',
   DATABASE_URL:'postgres://u@railway.host/komerce_test'},{
   sourceRun:async()=>mock,exists:()=>true
  }),/Only local komerce_test allowed/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
