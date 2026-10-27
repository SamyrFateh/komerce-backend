'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parseArgs,assertLocalTestTarget,runIndependent}=require('./cli');
const good={NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',
 DATABASE_URL:'postgresql://audit:password@127.0.0.1:5432/komerce_test'};
test('default scan is code-only, DB off by default',()=>{
 assert.deepEqual(parseArgs([]),{mode:'code',sampleLimit:25,base:null,out:null});
});
test('invalid modes and sample bounds rejected before any database access',()=>{
 assert.throws(()=>parseArgs(['--mode','write']),/Unsupported/);
 assert.throws(()=>parseArgs(['--mode','all','--sample-limit','0']),/sample-limit/);
 assert.throws(()=>parseArgs(['--invalid','1']),/Usage/);
});
test('explicit localhost test target is necessary; credentials never inferred',()=>{
 assert.equal(assertLocalTestTarget(good),true);
 for(const bad of [
  {...good,DATABASE_URL:'postgresql://railway:xxx@railway.internal:5432/komerce_test'},
  {...good,DATABASE_URL:'postgresql://localhost:5432/production'},
  {...good,NODE_ENV:'production'},
  {...good,KOMERCE_DISABLE_CRONS:'false'},
  {...good,DATABASE_URL:'file:///tmp/komerce_test'},
 ])assert.throws(()=>assertLocalTestTarget(bad));
});
test('independent scan code-only calls no PG factory, emits JSON and MD',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kba-unit-'));
 try{
  const r=await runIndependent(['--mode','code','--out',dir],{},{
   sha:'testsha',
   staticRunner:async()=>({contract:'komerce-audit-logic-v1',
    scannedFiles:14,trackedFiles:14,base:'HEAD',newFindings:0,
    findings:[{rule:'LD-TEST',priority:'P2',category:'WF',file:'a.js',line:20}]}),
   poolFactory:()=>{throw Error('Code-only accessed DB!');}
  });
  assert.equal(r.summary.staticFilesReviewed,14);
  assert.equal(r.summary.staticSuspicions,1);
  assert.equal(r.summary.dataRulesExecuted,null);
  assert.equal(r.permissions.dataTarget,'NO_DATABASE_CONNECTION');
  assert.equal(r.code.newFindings,null); // No explicit comparison base
  assert.ok(fs.existsSync(path.join(dir,'business-audit.json')));
  assert.ok(fs.existsSync(path.join(dir,'business-audit.md')));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('real engine data branch uses LOCAL readonly connection and produces bounded classified results',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kba-unit-'));const calls=[];let released=0,ended=0;
 const db={query:async(sql,values)=>{
  calls.push(sql);
  if(sql.includes("current_setting('transaction_read_only')"))return {rows:[{value:'on'}]};
  if(sql.startsWith('SELECT '))return {rows:[]};
  return {rows:[]};
 },release:()=>released++};
 try{
  const r=await runIndependent(['--mode','data','--out',dir,'--sample-limit','2'],good,{
   sha:'testsha',poolFactory:()=>({connect:async()=>db,end:async()=>{ended++}}),
   staticRunner:()=>{throw Error('DB-only scanned code!')}
  });
  assert.equal(r.summary.dataRulesExecuted,7);
  assert.equal(r.summary.rulesWithEvidence,0);
  assert.equal(r.summary.staticFilesReviewed,null);
  assert.equal(r.data.status,'EXECUTED_REPEATABLE_READ_READ_ONLY_ROLLBACK');
  assert.ok(calls.some(x=>x.startsWith('BEGIN TRANSACTION')));
  assert.equal(calls.at(-1),'ROLLBACK');
  assert.equal(released,1);assert.equal(ended,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('reject forbidden DB before any pool creation or artifact generation',async()=>{
 const dir=path.join(os.tmpdir(),'kba-reject-should-not-create-'+process.pid);
 let poolCalled=false;
 await assert.rejects(runIndependent(['--mode','data','--out',dir],
  {...good,DATABASE_URL:'postgresql://secret:xxx@railway.internal/komerce_test'},
  {poolFactory:()=>{poolCalled=true;throw Error('SHOULD NEVER RUN')}}),/Only local/);
 assert.equal(poolCalled,false);assert.equal(fs.existsSync(dir),false);
});
