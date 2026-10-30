#!/usr/bin/env node
'use strict';
/**
 * V2.7 first independent non-financial domain proof:
 * physical canonical PostgreSQL, real owner + second committed writer.
 * Freeze source SHA and require prior same-run financial baselines.
 */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {withClone}=require('./v16-cloned-database');
const {checkMembership}=require('./v27-logistics-oracle');
const root=path.resolve(__dirname,'../..'),child=path.join(__dirname,'v27-logistics-physical-child.js');
const assert=(v,s)=>{if(!v)throw Error('V27_GATE_FAILED: '+s)};
const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
async function run(out,env=process.env){
 assert(out&&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
  /^\d+$/.test(env.GITHUB_RUN_ID||''),'CI provenance missing');
 const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 assert(sha===env.GITHUB_SHA,'checkout SHA mismatch');
 const prior=json(path.join(out,'v26-recovery-counterfactual.json'));
 assert(prior.sha===sha&&prior.runId===env.GITHUB_RUN_ID&&
  prior.contract==='komerce-recovered-refund-counterfactual/v26'&&
  prior.allClonesDropped&&prior.cases.length===4,
  'same-run independently verified previous domain proof is required');
 const cases=[],verdicts=[];
 for(const mode of ['NOMINAL','LATE_COLLISION','REPORT_ONLY','RECONCILE_RESULT','CANCELLED_MEMBERSHIP']){
  const p=await withClone(env,url=>{
   const output=cp.execFileSync(process.execPath,[child,mode],{
    cwd:root,encoding:'utf8',maxBuffer:1024*1024,timeout:35000,
    env:{...env,DATABASE_URL:url,NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true'},
    stdio:['ignore','pipe','pipe']});
   const line=output.split('\n').find(x=>x.startsWith('BUSINESS_AUDIT_V27_PHYSICAL '));
   assert(Boolean(line),'missing child physical witness '+mode);
   return JSON.parse(line.slice('BUSINESS_AUDIT_V27_PHYSICAL '.length));
  });
  const raw=p.result,verdict=checkMembership(raw);
  assert(p.cloneDroppedAfterExecution===true&&raw.mode===mode&&
   raw.realOwnerCalled&&raw.realCanonicalSchema&&raw.noProductionTouch&&
   raw.authMiddlewareExecuted===false&&raw.sessionCount===2,
   'physical isolation or owner provenance invalid '+mode);
  assert(raw.fixture.itemCount===1&&raw.before.activeCount===0&&
   raw.ownerInsertCalls===1,
   'canonical fixture not repeatable '+mode);
  assert(raw.actualIndexes.some(x=>x.name==='unique_order_item_per_parcel'&&
   x.definition.includes('(order_item_id)')),
   'canonical one-item ownership constraint missing');
  if(mode!=='CANCELLED_MEMBERSHIP')assert(
   raw.after.activeCount===1&&raw.after.openCount===1,
   'active membership coverage for '+mode);
  if(mode==='NOMINAL')assert(!verdict.violation&&
    raw.ownerInserted===1&&raw.response.items_assigned===1&&
    !raw.injectedBeforeOwnerInsert,
    'nominal insert must produce exactly one membership');
  if(mode==='LATE_COLLISION')assert(
   verdict.signals.join('|')==='L1_REPORTED_ASSIGNMENTS_DO_NOT_MATCH_OWNER_INSERTS|L2_SUCCESS_WITHOUT_WRITE_OR_IDEMPOTENT_CLASSIFICATION'&&
   raw.injectedBeforeOwnerInsert&&raw.ownerInserted===0&&
   raw.sourceResponse.items_assigned===1,
   'real competing write must reveal count mismatch '+JSON.stringify({verdict,raw}));
  if(mode==='REPORT_ONLY')assert(
   verdict.signals.join('|')==='L2_SUCCESS_WITHOUT_WRITE_OR_IDEMPOTENT_CLASSIFICATION'&&
   raw.ownerInserted===0&&raw.response.items_assigned===0&&
   raw.response.success===true&&!raw.response.already_assigned,
   'count-only fake fix must remain red');
  if(mode==='RECONCILE_RESULT')assert(
   !verdict.violation&&raw.ownerInserted===0&&
   raw.response.items_assigned===0&&raw.response.already_assigned===true,
   'bounded result reconciliation must be truthful');
  if(mode==='CANCELLED_MEMBERSHIP')assert(
   verdict.signals.join('|')===
    'L1_REPORTED_ASSIGNMENTS_DO_NOT_MATCH_OWNER_INSERTS|L2_SUCCESS_WITHOUT_WRITE_OR_IDEMPOTENT_CLASSIFICATION|L3_ORDER_NOT_IN_EXACTLY_ONE_ACTIVE_PARCEL|L5_REPORTED_TARGET_MEMBERSHIP_MISSING'&&
   raw.ownerInserted===0&&raw.sourceResponse.items_assigned===1&&
   raw.after.activeCount===0&&raw.after.openCount===0&&
   raw.after.membership.length===1&&raw.after.membership[0].status==='cancelled',
   'cancelled membership hides absent active parcel yet owner claims success');
  cases.push({...raw,cloneDropped:true});
  verdicts.push(verdict);
 }
 // Negative control: a fake "already assigned" label without membership is NOT accepted.
 const forged=JSON.parse(JSON.stringify(cases[3]));
 forged.after.activeCount=0;forged.after.openCount=0;forged.after.membership=[];
 const forgedSignals=checkMembership(forged).signals;
 assert(['L3_ORDER_NOT_IN_EXACTLY_ONE_ACTIVE_PARCEL',
   'L4_IDEMPOTENT_RESULT_WITHOUT_ACTIVE_MEMBERSHIP'].every(s=>forgedSignals.includes(s)),
   'oracle accepted forged idempotent success with no physical membership');
 const files=['services/auto-parcel.js',
  'tools/business-auditor/v27-logistics-physical-child.js',
  'tools/business-auditor/v27-logistics-oracle.js',
  'tools/business-auditor/v22-financial-invariants.js'];
 const hashes=Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(root,f))).digest('hex')]));
 const proof={contract:'komerce-canonical-logistics-second-domain/v27',
  sha,runId:env.GITHUB_RUN_ID,sourceHashes:hashes,cases,verdicts,
  forgedSignals,clonesDropped:cases.every(x=>x.cloneDropped),
  realCanonicalPg:true,twoSeparateDbConnections:true,
  businessBugDemonstratedOnClone:true,routeHttpProven:false,
  realParallelSchedulingProven:false,productionIncidentConfirmed:false,
  productionFixProven:false,
  limits:'Single-item interleaving with second writer committed before real owner INSERT, not a comprehensive concurrent scheduler or deployable patch. Report-only and reconciled-result are test-only response mutations.'};
 fs.writeFileSync(path.join(out,'v27-logistics-proof.json'),JSON.stringify(proof,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V27_LOGISTICS '+JSON.stringify({sha,
  cases:verdicts.map(x=>({mode:x.mode,signals:x.signals,
   ownedInserts:x.ownerInserted,reported:x.reported,active:x.activeAfter})),
  forgedSignals,clonesDropped:proof.clonesDropped,productionFixProven:false}));
 return proof;
}
if(require.main===module)run(process.argv[2]).catch(e=>{
 console.error('BUSINESS_AUDIT_V27_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2;
});
module.exports={run};
