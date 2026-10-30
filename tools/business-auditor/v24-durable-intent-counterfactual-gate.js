#!/usr/bin/env node
'use strict';
/**
 * V2.4 positive counterfactual with the SAME unedited V2.2 oracle.
 * Execute actual cancellation and PayPal refund service on independent local
 * PostgreSQL clones. A test-only BOTH-OWNER reservation wrapper is the mutant.
 * Fail if any financial signal remains, missing ledger or unkeyed PSP occurs.
 */
const fs=require('node:fs'),path=require('node:path'),
 cp=require('node:child_process'),crypto=require('node:crypto');
const {withClone}=require('./v16-cloned-database');
const {checkFinancialSchedule}=require('./v22-financial-invariants');
const root=path.resolve(__dirname,'../..'),child=path.join(__dirname,'v22-refund-probe-child.js');
const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function assert(ok,message){if(!ok)throw Error('V24_INTENT_COUNTERFACTUAL_FAILED: '+message)}
const codes=['I1_ECONOMIC_REFUNDS_EXCEED_CAPTURE',
 'I2_PSP_REFUND_MISSING_FROM_LEDGER',
 'I3_OWNER_SUCCESS_WITH_UNRECORDED_PSP_REFUND'];
async function run(out,rankingFile,env=process.env){
 assert(out&&rankingFile&&/^[0-9a-f]{40}$/.test(env.GITHUB_SHA||'')&&
  /^\d+$/.test(env.GITHUB_RUN_ID||''),'CI provenance missing');
 const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 assert(sha===env.GITHUB_SHA,'SHA mismatch');
 const frozen=json(rankingFile),baseline=json(path.join(out,'v22-refund-probe.json'));
 assert(frozen.sha===sha&&
   frozen.ranking.rankHash===baseline.parentRankingHash&&
   baseline.sha===sha&&baseline.runId===env.GITHUB_RUN_ID&&
   baseline.contract==='komerce-real-refund-financial-proof/v22'&&
   baseline.selectedPairRank<=5,
   'same-SHA source selection and original negative control required');
 const originalAB=baseline.verdict.schedules.find(x=>x.mode==='AB');
 const originalPAR=baseline.verdict.schedules.find(x=>x.mode==='PAR');
 assert(originalAB?.signals.length===3&&originalPAR?.signals.length===3,
   'source regression must remain detectable by unchanged V2.2 oracle');
 const samples=[],reports=[];
 for(const mode of ['AB','AB_REPEAT','BA','PAR']){
  const x=await withClone(env,url=>{
   const stdout=cp.execFileSync(process.execPath,[child,mode],{
    cwd:root,env:{...env,DATABASE_URL:url,NODE_ENV:'test',
     KOMERCE_DISABLE_CRONS:'true',KBA_V24_MUTANT:'DURABLE_INTENT_COUNTERFACTUAL',
     KBA_V23_MUTANT:''},
    timeout:40000,maxBuffer:1024*1024,encoding:'utf8',
    stdio:['ignore','pipe','pipe']});
   const line=stdout.split('\n').find(z=>z.startsWith('BUSINESS_AUDIT_V22_FINANCIAL_PROBE '));
   assert(Boolean(line),'child missing evidence '+mode);
   return JSON.parse(line.slice('BUSINESS_AUDIT_V22_FINANCIAL_PROBE '.length));
  });
  const record=x.result,report=checkFinancialSchedule(record);
  assert(x.cloneDroppedAfterExecution===true&&record.localCloneVerified===true&&
   record.authMiddlewareExecuted===false&&
   record.simulation==='PAYPAL_FETCH_STRICT_NO_EXTERNAL_NETWORK'&&
   record.researchMutation==='DURABLE_INTENT_COUNTERFACTUAL',
   'isolation/provenance '+mode);
  assert(!report.violation&&report.signals.length===0&&
   report.totalRefundValueCents===report.capturedCents&&
   report.capturedCents===2000,'unchanged financial oracle still sees breach '+mode);
  assert(Array.isArray(record.state.intents)&&record.state.intents.length===1,
    'exactly one durable intent required '+mode);
  const intent=record.state.intents[0];
  assert(intent.state==='completed'&&
   intent.amount_eur===20&&intent.amount_kmf===10000,
   'reservation must be completed and match captured snapshot '+mode);
  if(['AB','AB_REPEAT'].includes(mode)){
   assert(record.outcomes.cancel.http===200&&record.outcomes.paypal.http===409&&
    intent.owner==='wallet_credit'&&intent.provider_request_key===null&&
    record.state.pspEvents.length===0&&
    report.walletEquivalentCents===2000,
    'wallet wins; PayPal must never be called '+mode);
   if(mode==='AB_REPEAT')assert(record.outcomes.replay?.http===409,
     'second attempt must not issue PSP transfer');
  }else{
   assert(record.outcomes.paypal.http===200&&
    record.state.pspEvents.length===1&&
    intent.owner==='paypal'&&
    typeof intent.provider_request_key==='string'&&
    /^kmr-ref-[a-f0-9-]{36}$/.test(intent.provider_request_key)&&
    intent.provider_request_key===record.state.pspEvents[0].key&&
    intent.provider_refund_id===record.state.pspEvents[0].id&&
    report.pspReconciliation.every(z=>z.registered)&&
    report.walletEquivalentCents===0,
    'PSP must be keyed, registered and exclusive '+mode);
   if(mode==='BA')assert(record.outcomes.cancel.http===422&&
    record.outcomes.replay?.http===409,'BA replay and cancellation guards '+JSON.stringify(record.outcomes));
   if(mode==='PAR')assert(record.outcomes.cancel.http===409,
    'while PayPal PSP is paused, cancellation must be rejected');
  }
  samples.push({...record,cloneDropped:true});
  reports.push(report);
 }
 // Mutate OBSERVED external events, NOT the independent oracle.
 // A forged second provider refund must immediately break I1 and I2.
 const forged=JSON.parse(JSON.stringify(samples[3]));
 forged.state.pspEvents.push({id:'PP-FORGED',amountEur:20,key:'FORGED'});
 const oracleMutant=checkFinancialSchedule(forged);
 assert(codes.slice(0,2).every(x=>oracleMutant.signals.includes(x)),
   'oracle accepted deliberately forged second PSP payment');
 const hashes=Object.fromEntries([
  'tools/business-auditor/v22-financial-invariants.js',
  'tools/business-auditor/v24-durable-intent-counterfactual.js',
  'tools/business-auditor/v22-refund-probe-child.js',
  'routes/orders/cancel.js','services/payment-paypal.js','services/refund-service.js'
 ].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]));
 const proof={contract:'komerce-durable-intent-counterfactual/v24',sha,
  runId:env.GITHUB_RUN_ID,rankingHash:frozen.ranking.rankHash,
  sameUnmodifiedEconomicOracle:true,originalABSignals:originalAB.signals,
  originalPARSignals:originalPAR.signals,samples,reports,
  forgedSecondPspSignals:oracleMutant.signals,
  hashes,clonesDropped:samples.every(x=>x.cloneDropped),
  productionFixProven:false,httpAuthProven:false,
  disclaimer:'Research-only two-owner full-refund coordination. Existing alternate writers, partial refunds, crashes and recovery not certified.'};
 fs.writeFileSync(path.join(out,'v24-durable-intent-counterfactual.json'),JSON.stringify(proof,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V24_DURABLE_INTENT '+JSON.stringify({
  sha,original:originalAB.signals,counterfactual:reports.map(x=>({mode:x.mode,signals:x.signals})),
  forged:oracleMutant.signals,clonesDropped:proof.clonesDropped,
  productionFixProven:false}));
 return proof;
}
if(require.main===module)run(process.argv[2],process.argv[3]).catch(e=>{
 console.error('BUSINESS_AUDIT_V24_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2;
});
module.exports={run};
