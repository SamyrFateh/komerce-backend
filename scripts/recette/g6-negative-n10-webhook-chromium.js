/** @komerce-arch-lite
 * @role g6-negative-n10-webhook-chromium
 * @domain payment
 * @layer script
 * @owner backend-core
 * @purpose N10 (webhook PSP simulé dupliqué ou non signé), staging only : Chromium NOT_APPLICABLE (aucun écran), sondes API signalées, preuve PG avant/après, aucune écriture SQL, aucun PSP réel.
 * @db-read orders, cash_collections, stripe_events_processed, mobile_money_transactions
 * @db-write none
 * @impact-areas staging-only, payment
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {runtime}=require('./g6-hub-shipment-chromium');
const N=require('./canonical/negative-scenarios');
const {fullError}=require('./canonical/observability');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const OUT=path.resolve('test-results/g6-negative-n10');
const PREFIX='evt_g6_n10_';
const report={schema:'komerce-g6-negative-n10/1',scenario_id:'N10',chromium:'NOT_APPLICABLE',reason:'webhook serveur à serveur, aucun écran',order_id:ID,reference:REF,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],probes:[],gaps:[],limits:[],external_payment_executed:false,production_permitted:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const reach=k=>{report.steps_reached.push(k);save()};
const check=(ok,code)=>{if(!ok)throw Error(code)};
// Sonde API signalée (aucun geste écran pour un webhook). Réponse jugée : seul un refus de signature est conforme.
async function probe(kind,url,headers,body,accepted){
 const res=await fetch(BASE+url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)}).catch(()=>null);
 const j=res?await res.json().catch(()=>({})):{};
 const row={kind,via:'API_PROBE_NO_SCREEN_GESTURE',http:res?res.status:null,code:String(j.code||'').slice(0,60)||null};
 report.probes.push(row);save();
 check(row.http!==null,'G6_N10_SCREEN_MISSING_NO_RESPONSE_'+kind);
 if(!accepted.includes(row.http))report.gaps.push(kind.toUpperCase()+'_HTTP_'+row.http);
 return row;
}
async function pickMobileMoneyTx(){
 const {rows}=await db.query(`SELECT id,provider,external_transaction_id FROM mobile_money_transactions
  WHERE external_transaction_id IS NOT NULL AND provider IN ('orange_money','mtn_momo','kartapay') ORDER BY created_at DESC LIMIT 1`);
 return rows[0]||null;
}
async function main(){
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
   env.G6_CANONICAL_PHASE==='N10_WEBHOOK_UNSIGNED_DUPLICATE'&&env.G6_DYNAMIC_FRESH_ORDER==='1'&&
   /^[a-f0-9-]{36}$/i.test(ID||'')&&!!REF,'G6_N10_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_N10_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  const tx=await pickMobileMoneyTx();
  report.mobile_money_fixture=tx?{provider:tx.provider}:'NO_TX_FIXTURE';
  const before=await N.snapN10(db,{orderId:ID,prefix:PREFIX,txId:tx?.id||null});
  report.before=before;reach('PG_BEFORE');
  const event={id:PREFIX+REF,object:'event',type:'payment_intent.succeeded',
   data:{object:{id:'pi_g6_n10_'+REF,object:'payment_intent',status:'succeeded',amount:100,currency:'eur',metadata:{order_reference:REF}}}};
  // L09 : même événement x3 puis sans en-tête ; la signature est obligatoire (400), jamais d'effet.
  for(let i=0;i<3;i++)await probe('stripe_unsigned_dup_'+(i+1),'/api/payments/stripe/webhook',{'stripe-signature':'t='+Math.floor(Date.now()/1000)+',v1='+'0'.repeat(64)},event,[400]);
  await probe('stripe_no_signature','/api/payments/stripe/webhook',{},event,[400]);
  reach('STRIPE_UNSIGNED_REFUSED');
  if(tx){
   const body={data:{id:tx.external_transaction_id,clientId:'g6-n10-forged',status:'SUCCESS',submittedAt:new Date().toISOString(),total:{value:'100',currency:'XAF'}}};
   for(let i=0;i<2;i++)await probe('mobile_money_forged_'+(i+1),'/api/payments/mobile-money/webhook/'+tx.provider,{'KartaPay-Signature':'0'.repeat(64)},body,[401]);
   reach('MOBILE_MONEY_FORGED_REFUSED');
  }else report.limits.push('MOBILE_MONEY_SIGNATURE_NOT_PROBED_NO_TX_FIXTURE');
  // Un doublon valablement signé exige le secret du PSP, jamais fourni à la recette : non prouvable, signalé.
  report.limits.push('SIGNED_DUPLICATE_NOT_PROVABLE_NO_PSP_SECRET');
  const after=await N.snapN10(db,{orderId:ID,prefix:PREFIX,txId:tx?.id||null});
  report.after=after;reach('PG_AFTER');
  if(report.gaps.length)throw Error('G6_N10_PRODUCT_GAP_'+report.gaps.join('_'));
  report.oracle=N.oracleN10(before,after);
  await runtime();
  report.verdict='G6_N10_WEBHOOK_UNSIGNED_DUPLICATE_REFUSED_NO_SETTLEMENT_API_PG_PASS_CHROMIUM_NOT_APPLICABLE';save();
 }catch(e){report.error=fullError(e);if(report.gaps.length||/PRODUCT_GAP/.test(report.error))report.verdict='PRODUCT_GAP';save();process.exitCode=2}
 finally{await db.pool.end().catch(()=>{});console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
