'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {POLICY,generate,evaluate}=require('./v37-order-matrix-generator');
const {run}=require('./v37-generated-order-gate');
const crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function observed(plan,{mutant=false}={}){
 return plan.cases.map(x=>{
  const permitted=x.expected==='TRANSITION';
  const bypass=mutant&&x.role==='agent_relais'&&x.target==='ordered';
  const accepted=permitted||bypass;
  return {id:x.id,sourceStatus:'confirmed',target:x.target,role:x.role,
   initialStatus:'confirmed',initialHistory:0,
   finalStatus:accepted?'ordered':'confirmed',
   finalHistory:accepted?1:0,
   finalHistoryStatus:accepted?'ordered':null,
   orderedTimestampPresent:accepted,ownerSuccess:accepted};
 });
}
test('generator is deterministic and spans the full role × target Cartesian product',()=>{
 const a=generate('seed-a'),b=generate('seed-a'),c=generate('seed-b');
 assert.equal(a.cases.length,POLICY.roles.length*POLICY.targets.length);
 assert.equal(a.cases.length,24);
 assert.equal(new Set(a.cases.map(x=>x.id)).size,24);
 assert.equal(a.selectionHash,b.selectionHash);
 assert.notEqual(a.selectionHash,c.selectionHash);
 assert.equal(a.sourceMutantKnownToGenerator,false);
});
test('nominal generated 24-case owner response and independent SQL shape pass',()=>{
 const p=generate('seed-a'),r=evaluate(p,observed(p));
 assert.equal(r.violation,false);
 assert.equal(r.scenarios,24);
 assert.equal(r.accepted,2);
 assert.equal(r.rejected,22);
});
test('blind unseen role-bypass regression is found without modifying case generator',()=>{
 const p=generate('seed-a');
 const o=evaluate(p,observed(p,{mutant:true}));
 assert.equal(o.violation,true);
 assert.ok(o.violations.some(v=>v.role==='agent_relais'&&v.target==='ordered'&&
  v.codes.includes('ORDG1_UNAUTHORIZED_OR_MISSING_STATUS_TRANSITION')));
});
test('fake success without SQL change is detected by owner-answer oracle',()=>{
 const p=generate('seed-a'),x=observed(p);
 x.find(v=>v.role==='agent_relais'&&v.target==='ordered').ownerSuccess=true;
 assert.ok(evaluate(p,x).violations.some(v=>v.codes.includes('ORDG4_OWNER_RESPONSE_DIFFERS_FROM_POLICY')));
});
test('missing or duplicate scenario cannot claim pass',()=>{
 const p=generate('seed-a'),x=observed(p);
 x.pop();assert.throws(()=>evaluate(p,x),/V37_GENERATOR_TOOL_ERROR/);
 x.push(x[0]);assert.throws(()=>evaluate(p,x),/V37_GENERATOR_TOOL_ERROR/);
});
test('gate preserves owner source and sees exactly one hidden mutant with clone teardown',async()=>{
 const seed='test-seed',p=generate(seed);
 const env={NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',
  DATABASE_URL:'postgres://u@localhost/komerce_test',GITHUB_SHA:'b'.repeat(40)};
 const evidence=(mode)=>({result:{
  contract:'komerce-generated-order-physical/v37',mode,seed,
  planHash:p.selectionHash,policyHash:p.policyHash,
  ownerExecuted:true,canonicalPg:true,noExternalNetwork:true,
  noProductionTouch:true,sourceFileChanged:false,
  observations:observed(p,{mutant:mode==='BLIND_MUTANT'})
 },cloneDroppedAfterExecution:true});
 const result=await run(env,{seed},{
  sourceAnchor:()=>({owner:'services/order-status-machine.js',
   sourceHash:'a'.repeat(64),policyHash:hash(POLICY),
   mutantAllowedOnlyInMemory:true}),
  withClone:async(_env,fn)=>{const mode=fn('postgres://x@localhost/kba_123456789abcdef012');
   return mode},
  observe:mode=>evidence(mode)});
 assert.equal(result.cases[0].oracle.violation,false);
 assert.equal(result.cases[1].oracle.violation,true);
 assert.equal(result.allClonesDropped,true);
});
test('gate rejects remote/non-test DB before fixture generation',async()=>{
 await assert.rejects(run({DATABASE_URL:'postgres://u@railway-host/komerce_test'},
  {seed:'seed-a'}),/NODE_ENV=test/);
});
