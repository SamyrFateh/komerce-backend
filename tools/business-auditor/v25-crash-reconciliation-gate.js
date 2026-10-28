#!/usr/bin/env node
'use strict';
/**
 * V2.5 isolated crash/recovery probe: four full clones, no PSP network.
 * Child process exits 86 at explicit crash points, while the provider
 * side-effects survive in an independent fsynced file.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),
 crypto=require('node:crypto'),cp=require('node:child_process');
const {Client}=require('pg');
const {withClone}=require('./v16-cloned-database');
const {FAULTS,verifyCrashEvidence}=require('./v25-reconciliation-oracle');
const root=path.resolve(__dirname,'../..'),worker=path.join(__dirname,'v25-fault-worker.js');
function assert(ok,msg){if(!ok)throw Error('V25_GATE_FAILED: '+msg)}
function shaFile(p){return crypto.createHash('sha256')
 .update(fs.readFileSync(path.join(root,p))).digest('hex')}
function parseOutput(out) {
 const line=out.split('\n').find(x=>x.startsWith('BUSINESS_AUDIT_V25_CHILD '));
 assert(line,'worker returned no proof');
 return JSON.parse(line.slice('BUSINESS_AUDIT_V25_CHILD '.length));
}
function providerEvents(file) {
 if(!fs.existsSync(file))return [];
 return fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x));
}
async function snapshot(url,orderId,userId){
 const db=new Client({connectionString:url,connectionTimeoutMillis:5000});
 await db.connect();
 try{
  const query=async(sql,params)=>(await db.query(sql,params)).rows;
  const intents=await query('SELECT owner,state,amount_eur::float,amount_kmf::int,provider_request_key,provider_refund_id FROM kba_refund_intents WHERE order_id=$1',[orderId]);
  const ledger=await query('SELECT refund_method,status,amount_eur::float,stripe_refund_id FROM refunds WHERE order_id=$1',[orderId]);
  const [order]=await query('SELECT status,payment_status,total_eur::float,total_kmf::int,paypal_capture_id FROM orders WHERE id=$1',[orderId]);
  const [{kmf}]=await query('SELECT COALESCE(SUM(t.amount_kmf),0)::int AS kmf FROM wallet_transactions t JOIN wallets w ON w.id=t.wallet_id WHERE w.user_id=$1 AND t.amount_kmf>0',[userId]);
  return {intents,ledger,order,walletKmf:Number(kmf)};
 }finally{await db.end()}
}
function runWorker(mode,fault,url,seed,provider,env) {
 const run=cp.spawnSync(process.execPath,[worker,mode],{
  cwd:root,env:{...env,DATABASE_URL:url,NODE_ENV:'test',
   KOMERCE_DISABLE_CRONS:'true',KBA_V24_MUTANT:'DURABLE_INTENT_COUNTERFACTUAL',
   KBA_V23_MUTANT:'',KBA_V25_FAULT:fault,KBA_V25_SEED_PATH:seed,
   KBA_V25_PROVIDER_LOG:provider},timeout:35000,encoding:'utf8',maxBuffer:1024*1024});
 if(run.error)throw Error('V25_TOOL_ERROR: '+run.error.message);
 assert(typeof run.status==='number','worker abnormal or timed out');
 return {exit:run.status,stdout:run.stdout,stderr:(run.stderr||'').slice(-300)};
}
async function run(out,rankingFile,env=process.env){
 assert(out&&rankingFile&&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
  /^\d+$/.test(env.GITHUB_RUN_ID||''),'CI SHA/run required');
 const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 assert(sha===env.GITHUB_SHA,'checkout mismatch');
 const ranked=JSON.parse(fs.readFileSync(rankingFile,'utf8'));
 const baseline=JSON.parse(fs.readFileSync(path.join(out,'v24-durable-intent-counterfactual.json'),'utf8'));
 assert(ranked.sha===sha&&ranked.ranking.rankHash===baseline.rankingHash&&
  baseline.sha===sha&&baseline.runId===env.GITHUB_RUN_ID&&
  baseline.reports.every(x=>!x.violation),'V2.4 same-SHA positive baseline required');
 const cases=[],verdicts=[];
 for(const fault of Object.keys(FAULTS)){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kba_v25_'));
  const seed=path.join(tmp,'seed.json'),provider=path.join(tmp,'provider.jsonl');
  try{
   const execution=await withClone(env,async url=>{
    const first=runWorker('FAULT',fault,url,seed,provider,env);
    assert(first.exit===FAULTS[fault].exit,'unexpected fault worker exit '+fault+' '+first.stderr);
    assert(fs.existsSync(seed),'seed not durably recorded before interruption');
    const ids=JSON.parse(fs.readFileSync(seed,'utf8'));
    const initial=await snapshot(url,ids.order,ids.user);
    const originalEvents=providerEvents(provider);
    // A new process recovers the SAME DB+same order without reseeding.
    const retry=runWorker('RETRY','RETRY',url,seed,provider,env);
    assert(retry.exit===0,'retry worker failed '+fault+' '+retry.stderr);
    const result=parseOutput(retry.stdout);
    const after=await snapshot(url,ids.order,ids.user);
    return {fault,firstExit:first.exit,
     capture:{eur:20,kmf:10000,captureId:'CAP-OFFLINE'},
     snapshot:initial,providerEvents:originalEvents,
     retry:{exit:retry.exit,response:{status:result.result.status,
      providerCalls:result.result.providerCalls},
      providerEventsAfter:providerEvents(provider).length,
      intentStateAfter:after.intents[0]?.state,
      ledgerCountAfter:after.ledger.length},
     testOnlyProviderLog:true,noLivePspCalls:true};
   });
   assert(execution.cloneDroppedAfterExecution===true,'clone not dropped');
   const data={...execution.result,cloneDropped:true};
   const verdict=verifyCrashEvidence(data);
   cases.push(data);verdicts.push(verdict);
  }finally{fs.rmSync(tmp,{recursive:true,force:true})}
 }
 // Negative control: tamper an external provider id, never the independent oracle.
 const mutated=JSON.parse(JSON.stringify(cases[1]));
 mutated.providerEvents[0].providerRequestKey='UNRELATED_PROVIDER_KEY';
 let rejected=false;
 try{verifyCrashEvidence(mutated)}catch(e){rejected=/V25_PROOF_DRIFT/.test(e.message)}
 assert(rejected,'oracle accepted counterfeit PSP key');
 const files=[
  'tools/business-auditor/v22-financial-invariants.js',
  'tools/business-auditor/v24-durable-intent-counterfactual.js',
  'tools/business-auditor/v25-reconciliation-oracle.js',
  'tools/business-auditor/v25-fault-worker.js',
  'services/payment-paypal.js','routes/orders/cancel.js'
 ];
 const result={contract:'komerce-interrupted-refund-reconciliation/v25',
  sha,runId:env.GITHUB_RUN_ID,rankingHash:ranked.ranking.rankHash,
  cases,verdicts,sourceHashes:Object.fromEntries(files.map(p=>[p,shaFile(p)])),
  noProductionImpact:true,allClonesDropped:cases.every(x=>x.cloneDropped),
  noProviderNetwork:true,
  caveat:'Simulated process death and fsynced provider record, not real PayPal availability or complete automated reconciliation. No production fix.'};
 fs.writeFileSync(path.join(out,'v25-interrupted-refund.json'),JSON.stringify(result,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V25_RECONCILIATION '+JSON.stringify({
  sha,results:verdicts.map(v=>({fault:v.fault,signals:v.signals,
   replayRefused:v.retryRefused,noDuplicatePSP:v.noDuplicatePSPEffect})),
  clonesDropped:result.allClonesDropped,autoRecoveryProven:false}));
 return result;
}
if(require.main===module)run(process.argv[2],process.argv[3]).catch(e=>{
 console.error('BUSINESS_AUDIT_V25_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2;
});
module.exports={run};
