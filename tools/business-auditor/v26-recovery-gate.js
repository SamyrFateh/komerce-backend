#!/usr/bin/env node
'use strict';
/**
 * V2.6 physical reconciliation experiment, source owners + durable external
 * mock PSP evidence + untouched V2.2 economic invariants.
 *
 * This certifies an isolated R&D scenario, NEVER a production PayPal lookup.
 */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),
 cp=require('node:child_process'),crypto=require('node:crypto');
const {Client}=require('pg');
const {withClone}=require('./v16-cloned-database');
const {FAULTS}=require('./v25-reconciliation-oracle');
const {checkFinancialSchedule}=require('./v22-financial-invariants');
const root=path.resolve(__dirname,'../..');
const faultWorker=path.join(__dirname,'v25-fault-worker.js');
const recoveryWorker=path.join(__dirname,'v26-reconcile-worker.js');
const assert=(ok,m)=>{if(!ok)throw Error('V26_GATE_FAILED: '+m)};
function runWorker(file,mode,url,seed,provider,env){
 const run=cp.spawnSync(process.execPath,[file,mode],{
  cwd:root,encoding:'utf8',timeout:35000,maxBuffer:1024*1024,
  env:{...env,DATABASE_URL:url,NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',
   KBA_V24_MUTANT:'DURABLE_INTENT_COUNTERFACTUAL',KBA_V23_MUTANT:'',
   KBA_V25_FAULT:file===faultWorker?mode:'',
   KBA_V25_SEED_PATH:seed,KBA_V25_PROVIDER_LOG:provider,
   KBA_V26_CRASH_ALLOWED:file===recoveryWorker&&mode==='CRASH_BEFORE_COMMIT'?'true':''}});
 if(run.error)throw Error('V26_TOOL_ERROR: '+run.error.message);
 assert(Number.isInteger(run.status),'abnormal child exit '+mode);
 return {exit:run.status,stdout:run.stdout,stderr:(run.stderr||'').slice(-900)};
}
function resultLine(run){
 const match=run.stdout.split('\n').find(x=>x.startsWith('BUSINESS_AUDIT_V26_CHILD '));
 assert(match,'missing recovery verdict '+run.stdout.slice(-500)+run.stderr);
 return JSON.parse(match.slice('BUSINESS_AUDIT_V26_CHILD '.length));
}
function providerEvents(p){
 if(!fs.existsSync(p))return [];
 return fs.readFileSync(p,'utf8').split('\n').filter(Boolean).map(JSON.parse);
}
async function snapshot(url,ids){
 const c=new Client({connectionString:url,connectionTimeoutMillis:5000});
 await c.connect();
 try{
  const q=async(sql,params)=>(await c.query(sql,params)).rows;
  const [order]=await q('SELECT status,payment_status,payment_mode,total_eur::float,total_kmf::int,paypal_capture_id FROM orders WHERE id=$1',[ids.order]);
  const intents=await q('SELECT owner,state,amount_eur::float,amount_kmf::int,provider_request_key,provider_refund_id FROM kba_refund_intents WHERE order_id=$1',[ids.order]);
  const ledger=await q('SELECT refund_method,refund_type,status,amount_eur::float,amount_kmf::int,stripe_refund_id FROM refunds WHERE order_id=$1 ORDER BY id',[ids.order]);
  const [{wallet}]=await q('SELECT COALESCE(SUM(t.amount_kmf),0)::int AS wallet FROM wallet_transactions t JOIN wallets w ON w.id=t.wallet_id WHERE w.user_id=$1 AND t.amount_kmf>0',[ids.user]);
  return {order,intents,ledger,walletKmf:Number(wallet)};
 }finally{await c.end()}
}
const sig=x=>JSON.stringify(x);
async function run(out,rankingFile,env=process.env){
 assert(/^[0-9a-f]{40}$/.test(env.GITHUB_SHA||'')&&/^\d+$/.test(env.GITHUB_RUN_ID||'')&&
   out&&rankingFile,'CI provenance required');
 const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 assert(sha===env.GITHUB_SHA,'SHA mismatch');
 const prior=JSON.parse(fs.readFileSync(path.join(out,'v25-interrupted-refund.json'),'utf8'));
 const baseline=JSON.parse(fs.readFileSync(path.join(out,'v24-durable-intent-counterfactual.json'),'utf8'));
 const frozen=JSON.parse(fs.readFileSync(rankingFile,'utf8'));
 assert(prior.sha===sha&&prior.runId===env.GITHUB_RUN_ID&&
   baseline.sha===sha&&baseline.runId===env.GITHUB_RUN_ID&&
   frozen.sha===sha&&frozen.ranking.rankHash===prior.rankingHash&&
   prior.allClonesDropped&&prior.cases.length===4&&
   prior.verdicts.every(x=>x.recoveryCompleted===false),
   'same-SHA, same-run upstream negative evidence required');
 const cases=[];
 for(const fault of Object.keys(FAULTS)){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kba_v25_'));
  const seed=path.join(tmp,'seed.json'),provider=path.join(tmp,'provider.jsonl');
  try{
   const experiment=await withClone(env,async url=>{
    const initialRun=runWorker(faultWorker,fault,url,seed,provider,env);
    assert(initialRun.exit===FAULTS[fault].exit,'V2.5 fault not reproduced '+fault+' '+initialRun.stderr);
    const ids=JSON.parse(fs.readFileSync(seed,'utf8'));
    const initial=await snapshot(url,ids),events=providerEvents(provider);
    assert(initial.intents.length===1&&events.length===FAULTS[fault].events,
      'initial PSP and intent evidence mismatch');
    // Wrong amount and an unavailable provider MUST NOT mutate financial SQL.
    let invalid=null,unavailable=null,interrupted=null;
    if(events.length){
     invalid=resultLine(runWorker(recoveryWorker,'BAD_AMOUNT',url,seed,provider,env)).result;
     assert(invalid.decision==='MANUAL_PROVIDER_PROOF_MISMATCH','bad provider amount was accepted');
    }
    unavailable=resultLine(runWorker(recoveryWorker,'PROVIDER_UNAVAILABLE',url,seed,provider,env)).result;
    assert(unavailable.decision==='MANUAL_PROVIDER_UNAVAILABLE_OR_UNKNOWN',
      'unavailable evidence was treated as proof');
    assert(sig(await snapshot(url,ids))===sig(initial),'invalid provider lookup modified DB');
    if(fault==='POST_PSP_HARD_EXIT'){
     const crash=runWorker(recoveryWorker,'CRASH_BEFORE_COMMIT',url,seed,provider,env);
     assert(crash.exit===86,'reconciler did not crash at pre-COMMIT checkpoint '+crash.stderr);
     assert(sig(await snapshot(url,ids))===sig(initial),
       'uncommitted reconciliation leaked across process death');
     interrupted={exit:crash.exit,rollbackObserved:true};
    }
    const outcome=resultLine(runWorker(recoveryWorker,'NORMAL',url,seed,provider,env)).result;
    const after=await snapshot(url,ids);
    const again=resultLine(runWorker(recoveryWorker,'NORMAL',url,seed,provider,env)).result;
    const final=await snapshot(url,ids);
    assert(sig(final)===sig(after),'replay changed a completed financial state');
    assert(providerEvents(provider).length===events.length,'reconciliation caused a new PSP transfer');
    const observation={mode:'BA',capture:{eur:20,kmf:10000},
      outcomes:{paypal:{http:409}},state:{
       refunds:final.ledger,pspEvents:events,walletCreditKmf:final.walletKmf}};
    const finance=checkFinancialSchedule(observation);
    assert(!finance.violation&&finance.totalRefundValueCents<=finance.capturedCents,
      'independent economic oracle detected unexpected payout');
    if(events.length){
     assert(outcome.decision==='RECONCILED_WITH_PROVIDER_PROOF'&&outcome.repaired===true&&
       again.decision==='ALREADY_RECONCILED'&&again.repaired===false&&
       final.ledger.length===1&&
       final.ledger[0].status==='completed'&&
       final.ledger[0].refund_method==='paypal'&&
       final.ledger[0].stripe_refund_id===events[0].id&&
       final.order.status==='refunded'&&final.order.payment_status==='refunded'&&
       final.intents[0].state==='completed'&&
       final.intents[0].provider_refund_id===events[0].id,
       'confirmed refund recovery did not reconcile all canonical states '+fault+
        ' '+JSON.stringify({outcome,again,final}));
    }else{
     assert(outcome.decision==='MANUAL_NO_POSITIVE_PROVIDER_PROOF'&&
       again.decision===outcome.decision&&
       final.ledger.length===0&&
       final.order.payment_status==='paid'&&
       final.intents[0].state==='reserved',
       'missing PSP event incorrectly healed as success');
    }
    return {fault,initial,events,invalid,unavailable,interrupted,
      outcome,again,final,financialOracle:finance,
      noNewProviderSideEffect:true};
   });
   assert(experiment.cloneDroppedAfterExecution===true,'database clone not destroyed '+fault);
   cases.push({...experiment.result,cloneDropped:true});
  }finally{fs.rmSync(tmp,{recursive:true,force:true})}
 }
 const artifact={contract:'komerce-recovered-refund-counterfactual/v26',
  sha,runId:env.GITHUB_RUN_ID,rankingHash:frozen.ranking.rankHash,
  cases,allClonesDropped:cases.every(c=>c.cloneDropped),
  realProviderLookupProven:false,productionFixProven:false,
  sourceHashes:Object.fromEntries([
   'tools/business-auditor/v22-financial-invariants.js',
   'tools/business-auditor/v26-reconciler.js',
   'tools/business-auditor/v26-reconcile-worker.js',
   'services/refund-service.js','services/payment-service.js',
   'services/order-status-machine.js'].map(p=>[p,crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root,p))).digest('hex')])),
  disclaimer:'Research-only reconciliation with local simulated provider archive. No real PayPal refund-key search, no production release, partial refunds and all writers still unproven.'};
 fs.writeFileSync(path.join(out,'v26-recovery-counterfactual.json'),JSON.stringify(artifact,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V26_RECOVERY '+JSON.stringify({
   sha,results:cases.map(x=>({fault:x.fault,decision:x.outcome.decision,
    replay:x.again.decision,signals:x.financialOracle.signals,
    crashRollback:x.interrupted?.rollbackObserved||false})),
   allClonesDropped:artifact.allClonesDropped,productionFixProven:false}));
 return artifact;
}
if(require.main===module)run(process.argv[2],process.argv[3]).catch(e=>{
 console.error('BUSINESS_AUDIT_V26_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2;
});
module.exports={run};
