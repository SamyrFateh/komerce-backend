#!/usr/bin/env node
'use strict';
/**
 * Counterexpert review from high-risk whole-repo logistics/parcel candidates.
 * Actual owner services on disposable local canonical PostgreSQL; independent
 * expectation: order_item projected quantities represent active parcel sums.
 * This exercise is NOT a substitute for business-policy approval.
 */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {assertLocalTestTarget}=require('./cli');
const {withClone}=require('./v16-cloned-database');
const ROOT=path.resolve(__dirname,'../..');
const CHILD=path.join(__dirname,'whole-repo-parcel-quantity-child.js');
const fail=s=>{throw Error('WHOLE_REPO_PARCEL_PROOF_ERROR: '+s)};
function inspect(raw){
 if(raw?.contract!=='komerce-real-parcel-resync-observation/v1'||
  raw.scenario!=='ASSIGN_SYNC_CANCEL_LAST_ACTIVE_PARCEL_RESYNC'||
  raw.realOwnersExecuted!==true||raw.canonicalPg!==true||
  raw.networkBlocked!==true||raw.allReadsFromPostgres!==true||
  raw.realCancellationAccepted!==true||
  !raw.before||!raw.intermediate||!raw.after||
  raw.before.item_id!==raw.after.item_id||
  raw.before.order_id!==raw.after.order_id||
  raw.before.actual_allocated_active<1||
  raw.before.qty_allocated!==raw.before.actual_allocated_active||
  raw.after.actual_allocated_active!==0||
  raw.after.membership_count_active!==0)
  fail('real before-after canonical parcel state not demonstrated');
 const metric=['qty_allocated','qty_packed','qty_shipped','qty_received','qty_collected'];
 const signals=[];
 for(const k of metric){
  if(!Number.isSafeInteger(raw.after[k])||raw.after[k]<0)
   fail('post-service projection malformed: '+k);
 }
 if(raw.after.qty_allocated!==raw.after.actual_allocated_active)
  signals.push('PARCEL_CANCELLED_ACTIVE_ALLOCATION_STALE');
 return {contract:'komerce-independent-order-parcel-quantity-predicate/v1',
  signals,violation:signals.length>0,
  expectedActiveQty:raw.after.actual_allocated_active,
  observedStoredQty:raw.after.qty_allocated,
  declaredScope:'SINGLE_ORDER_ITEM_LAST_ACTIVE_PARCEL_CANCELLED_NOT_ALL_LOGISTICS'};
}
function spawn(url,env){
 const output=cp.execFileSync(process.execPath,[CHILD],{
  cwd:ROOT,encoding:'utf8',timeout:65000,maxBuffer:1024*1024,
  env:{...env,DATABASE_URL:url,NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true'},
  stdio:['ignore','pipe','pipe']});
 const prefix='WHOLE_REPO_PARCEL_PHYSICAL ';
 const line=output.split('\n').find(x=>x.startsWith(prefix));
 if(!line)fail('physical child did not emit validated observations');
 return JSON.parse(line.slice(prefix.length));
}
async function run({out}={},env=process.env,deps={}){
 assertLocalTestTarget(env);
 if(!out)fail('--out DIR mandatory');
 const wrapper=await (deps.withClone||withClone)(env,url=>
  (deps.spawn||spawn)(url,env));
 if(!wrapper.cloneCreated||!wrapper.cloneDroppedAfterExecution)
  fail('clone lifecycle missing');
 const oracle=inspect(wrapper.result);
 const result={contract:'komerce-whole-repo-owner-quantity-reproduction/v1',
  sha:env.GITHUB_SHA||cp.execFileSync('git',['rev-parse','HEAD'],{
   cwd:ROOT,encoding:'utf8'}).trim(),
  ownerServices:['services/auto-parcel.js','services/parcel-operations.js',
   'services/scan-engine.js'],
  raw:wrapper.result,oracle,cloneDropped:true,
  status:oracle.violation?'REPRODUCED_CANONICAL_PG_BUSINESS_CONTRADICTION':
   'NO_CONTRADICTION_ON_THIS_SCENARIO',
  productionReachabilityConfirmed:false,
  productionIncidentConfirmed:false,
  businessPolicyReviewRequired:true,
  noRuntimeSourceChanges:true};
 fs.mkdirSync(path.resolve(out),{recursive:true});
 fs.writeFileSync(path.join(path.resolve(out),'parcel-resync-probe.json'),
  JSON.stringify(result,null,2)+'\n');
 console.log('AUDITOR_WIDE_REAL_PARCEL_PROBE '+JSON.stringify({
  sha:result.sha,signals:oracle.signals,status:result.status,
  expectedActiveQty:oracle.expectedActiveQty,storedQty:oracle.observedStoredQty,
  cloneDropped:true}));
 return result;
}
function parse(a){
 if(a.length!==2||a[0]!=='--out'||!a[1])fail('usage --out DIRECTORY');
 return {out:a[1]};
}
if(require.main===module)run(parse(process.argv.slice(2))).catch(e=>{
 console.error(e.stack||e.message);process.exitCode=2});
module.exports={inspect,spawn,run,parse};
