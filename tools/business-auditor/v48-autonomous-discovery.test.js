'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {select,changed,run,parse}=require('./v48-autonomous-discovery');
const sha='a'.repeat(40);
test('V48 change-driven owner selection works without mutant IDs or handpicked modes',()=>{
 const x=select({changedPaths:['services/order-status-machine.js',
  'services/market-operation-guard.js','services/market-operation-guard.js']});
 assert.deepEqual(x.selected,['MARKET','ORDER']);
 assert.deepEqual(x.unsupportedChangedPaths,[]);
 assert.equal(x.entirelyCovered,true);
 const y=select({changedPaths:['services/unknown-finance-owner.js',
  'routes/orders/another.js','tools/business-auditor/x.js']});
 assert.equal(y.selected.length,0);
 assert.equal(y.unsupportedChangedPaths.length,2);
 assert.equal(y.entirelyCovered,false);
 assert.deepEqual(select({allReviewed:true}).selected,
  ['INVENTORY','FX','MARKET','ORDER','SOURCING']);
 for(const bad of [['../outside'],['/etc/passwd'],['services/valid\\bad']])
  assert.throws(()=>select({changedPaths:bad}),/V48_DISCOVERY_ERROR/);
});
test('V48 git diff discovers unstaged owner edits, with optional ancestor filter',()=>{
 const calls=[];
 const git=(...args)=>{
  calls.push(args.join(' '));
  if(args[0]==='merge-base')return '';
  if(args[0]==='diff'&&args.includes('HEAD')&&args.includes('--name-only')&&args.length===4)
   return 'services/order-status-machine.js\nservices/market-operation-guard.js';
  return 'services/market-operation-guard.js\n';
 };
 assert.deepEqual(changed(sha,{git}),[
  'services/market-operation-guard.js','services/order-status-machine.js']);
 assert.ok(calls.some(x=>x.startsWith('merge-base --is-ancestor ')));
 assert.throws(()=>changed('not a sha',{git}),/V48_DISCOVERY_ERROR/);
});
test('V48 unregistered source mutation gets selected and real-owner oracle flags it',async()=>{
 let called=0;
 const env={NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',
  DATABASE_URL:'postgresql://test:pass@localhost:5432/komerce_test',GITHUB_SHA:sha};
 const x=await run({out:null},env,{
  git:(...a)=>a[0]==='rev-parse'?sha:'',
  changed:()=>['services/market-operation-guard.js'],
  one:async(mode,mutant)=>{
   called++;
   assert.equal(mode,'MARKET');
   assert.equal(mutant,null);
   return {mode,signals:['MK2_MARKET_OPERATION_POLICY_VIOLATION'],
    realOwnerExecuted:true,cloneDropped:true,canonicalPg:true,
    mutationApplied:false};
  }});
 assert.equal(called,1);
 assert.equal(x.summary.status,'BUSINESS_CONTRADICTION_FOUND');
 assert.equal(x.summary.observedViolationOwners,1);
 assert.equal(x.observations[0].sourceMutantIdProvided,false);
 assert.equal(x.certifiedAutonomousUnknownBugDiscovery,false);
});
test('V48 does not manufacture a PASS from unsupported code or tool errors',async()=>{
 const env={NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',
  DATABASE_URL:'postgresql://test:pass@localhost:5432/komerce_test',GITHUB_SHA:sha};
 const base={git:()=>sha,changed:()=>['services/unreviewed-payment.js']};
 const x=await run({},env,base);
 assert.equal(x.summary.status,'NO_ELIGIBLE_OWNER');
 assert.equal(x.selection.entirelyCovered,false);
 assert.equal(x.summary.unsupportedChangedPaths,1);
 await assert.rejects(()=>run({},env,{
  git:()=>sha,changed:()=>['services/market-operation-guard.js'],
  one:async()=>{throw Error('broken physical worker')}
 }),/V48_DISCOVERY_ERROR/);
 assert.throws(()=>parse(['--mutant','SKIP_CHECK']),/V48_DISCOVERY_ERROR/);
});
