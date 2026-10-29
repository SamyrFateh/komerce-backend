#!/usr/bin/env node
'use strict';
/**
 * Runs the adapted Opus probe on 4 separate TEMPLATE clones.
 * The child enforces an isolated kba_* local database and no live PSP.
 * Clone destruction happens in V1.6 withClone finally even if child fails.
 * Never import/run untrusted user-supplied probe directly in the CI process.
 */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),
 crypto=require('node:crypto');
const {withClone}=require('./v16-cloned-database');
const {evaluateSchedules}=require('./v22-financial-invariants');
const root=path.resolve(__dirname,'../..');
const child=path.join(__dirname,'v22-refund-probe-child.js');
const readJson=(file)=>JSON.parse(fs.readFileSync(file,'utf8'));
async function run(out,rankingFile,env=process.env){
 if(!out||!rankingFile||!/^[0-9a-f]{40}$/.test(env.GITHUB_SHA||'')||
  !/^\d+$/.test(env.GITHUB_RUN_ID||''))
  throw Error('TOOL_ERROR: CI ref, source ranking and output required');
 const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 if(sha!==env.GITHUB_SHA)throw Error('TOOL_ERROR: checkout SHA mismatch');
 const frozen=readJson(rankingFile);
 if(frozen.contract!=='komerce-reduction-before-physical-PG/v22'||
  frozen.sha!==sha||frozen.ranking?.rank?.length>frozen.parent?.total)
  throw Error('TOOL_ERROR: ranking not frozen from this source SHA');
 const chosen=frozen.ranking.rank.find(x=>x.table==='refunds'&&
  x.actors.some(y=>y.source==='routes/orders/cancel.js')&&
  x.actors.some(y=>y.source==='services/payment-paypal.js'));
 const rank=frozen.ranking.rank.indexOf(chosen)+1;
 if(!chosen||rank<1||rank>5)
  throw Error('TOOL_ERROR: PayPal cancellation pair not selected within PR budget');
 const cases=[];
 for(const mode of ['AB','AB_REPEAT','BA','PAR']){
  const x=await withClone(env,(url)=>{
   const stdout=cp.execFileSync(process.execPath,[child,mode],{
    cwd:root,env:{...env,DATABASE_URL:url,NODE_ENV:'test',
     KOMERCE_DISABLE_CRONS:'true'},timeout:40000,maxBuffer:1024*1024,
    encoding:'utf8',stdio:['ignore','pipe','pipe']
   });
   const line=stdout.split('\n').find(t=>t.startsWith('BUSINESS_AUDIT_V22_FINANCIAL_PROBE '));
   if(!line)throw Error('TOOL_ERROR: child produced no trace for '+mode);
   return JSON.parse(line.slice('BUSINESS_AUDIT_V22_FINANCIAL_PROBE '.length));
  });
  if(!x.cloneDroppedAfterExecution||!x.result.localCloneVerified||
     x.result.simulation!=='PAYPAL_FETCH_STRICT_NO_EXTERNAL_NETWORK')
   throw Error('TOOL_ERROR: payment sandbox or PG teardown not verified');
  cases.push({...x.result,cloneDropped:x.cloneDroppedAfterExecution});
 }
 const verdict=evaluateSchedules(cases);
 const knownSignals=['I1_ECONOMIC_REFUNDS_EXCEED_CAPTURE','I2_PSP_REFUND_MISSING_FROM_LEDGER'];
 if(!verdict.deterministic||
  !['AB','AB_REPEAT','PAR'].every(m=>verdict.violatedSchedules.includes(m))||
  verdict.violatedSchedules.includes('BA')||
  knownSignals.some(signal=>!verdict.schedules[0].signals.includes(signal)))
  throw Error('V2.2_REVIEW_REQUIRED: actual economic probe or baseline drifted');
 const files=['services/payment-paypal.js','services/refund-service.js',
  'routes/orders/cancel.js','tools/business-auditor/v22-financial-invariants.js',
  'tools/business-auditor/v22-refund-probe-child.js',
  'tools/business-auditor/v22-prioritize-pairs.js'];
 const hashes=Object.fromEntries(files.map(p=>[p,crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(root,p))).digest('hex')]));
 const data={contract:'komerce-real-refund-financial-proof/v22',
  sha,runId:env.GITHUB_RUN_ID,parentRankingHash:frozen.ranking.rankHash,
  selectedPairId:chosen.id,selectedPairRank:rank,hashes,
  cases,verdict,
  authMiddlewareExecuted:false,providerLiveNetworkCalls:0,
  productionIncidentConfirmed:false};
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'v22-refund-probe.json'),JSON.stringify(data,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V22_PHYSICAL_FINANCE '+JSON.stringify({
  sha,pairRank:rank,selectionHash:frozen.ranking.rankHash,
  results:verdict.schedules.map(x=>({mode:x.mode,signals:x.signals,
   valueCents:x.totalRefundValueCents,capturedCents:x.capturedCents})),
  clonesDropped:cases.every(c=>c.cloneDropped),livePayments:0
 }));
 return data;
}
if(require.main===module)run(process.argv[2],process.argv[3]).catch(e=>{
 console.error('BUSINESS_AUDIT_V22_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2;
});
module.exports={run};
