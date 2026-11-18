/** @komerce-arch-lite
 * @role g6-real-buyer-cash-bound-adapters
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose Execute only BUYER and RELAY_CASH on a fresh staging order via existing Chromium scripts.
 * @impact-areas staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {confirmTarget}=require('../target-guard');
const ROOT=path.resolve(__dirname,'../../..');
const BASE='https://komerce-backend-production.up.railway.app';
const REPORT_PATH=Object.freeze({
 BUYER:'test-results/g6-p2-buyer-order/report.json',
 RELAY_CASH:'test-results/g6-a-relay-cash/report.json',
 HUB_PO:'test-results/g6-p3-kuyiyuk/evidence.json'
});
const SCRIPTS=Object.freeze({
 BUYER:'scripts/recette/g6-p2-buyer-order-real-chromium.js',
 RELAY_CASH:'scripts/recette/g6-a-relay-cash-real-chromium.js',
 HUB_PO:'tests/staging-clicks/g6-p3-kuyiyuk.spec.js'
});
const SHA=/^[a-f0-9]{40}$/;
const REF=/^[A-Z0-9][A-Z0-9-]{5,63}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const same=(c,p)=>p?.order_id===c.order_id&&p?.order_reference===c.order_reference&&
 p?.staging_sha===c.staging_sha&&p?.db_fingerprint===c.db_fingerprint&&
 p?.market==='KM'&&p?.scenario_id==='M01'&&p?.production_permitted===false;
function guard(env){
 if(env.GITHUB_EVENT_NAME!=='issues'||env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER||
    env.GITHUB_REPOSITORY!=='SamyrFateh/komerce-backend'||
    env.NODE_ENV!=='test'||env.KOMERCE_ENV!=='staging'||env.KOMERCE_TARGET_ENV!=='staging'||
    env.EXPECTED_RAILWAY_ENVIRONMENT!=='staging'||env.STAGING_BASE_URL!==BASE||
    env.G6_CANONICAL_SCENARIO!=='M01'||env.G6_TARGET_MARKET!=='KM'||
    !SHA.test(String(env.E2E_EXPECTED_DEPLOY_SHA||''))||
    !/^\d{8,}$/.test(String(env.GITHUB_RUN_ID||''))||
    !env.DATABASE_URL||!env.E2E_ADMIN_EMAIL||!env.E2E_ADMIN_PASSWORD)
  throw Error('G6_REAL_BUYER_CASH_OWNER_STAGING_GUARD');
}
function report(stage){
 const rel=REPORT_PATH[stage];
 if(!rel)throw Error('G6_REAL_BUYER_CASH_STAGE_NOT_IMPLEMENTED_'+stage);
 const full=path.join(ROOT,rel);
 const bytes=fs.readFileSync(full);
 return {data:JSON.parse(bytes.toString('utf8')),digest:crypto.createHash('sha256').update(bytes).digest('hex'),rel};
}
async function orderPg(db,context){
 const {rows}=await db.query(`
 SELECT o.id,o.reference,o.status::text AS status,o.payment_status::text AS payment_status,
  o.payment_mode::text AS payment_mode,o.simulation_scope,m.code AS market,
  (SELECT count(*)::int FROM cash_collections c WHERE c.order_id=o.id) AS cash_count,
  (SELECT count(*)::int FROM cash_confirmation_controls c WHERE c.order_id=o.id AND c.state='CONFIRMED') AS control_count
 FROM orders o JOIN markets m ON m.id=o.market_id WHERE o.id=$1 AND o.reference=$2
 `,[context.order_id,context.order_reference]);
 if(rows.length!==1||rows[0].market!=='KM'||rows[0].simulation_scope!=='G6-BUYER'||
   rows[0].payment_mode!=='cash_relais')throw Error('G6_DYNAMIC_ORDER_PG_IDENTITY_INVALID');
 return rows[0];
}
function execute(script,env){
 const r=spawnSync(process.execPath,[path.join(ROOT,script)],{
  cwd:ROOT,env,stdio:'inherit',timeout:12*60*1000
 });
 if(r.error||r.status!==0)throw Error('G6_DYNAMIC_CHROMIUM_STAGE_FAILED_'+script);
}
function createRealBuyerCashAdapters({db,env=process.env,fetchImpl=fetch}={}){
 if(!db||typeof db.query!=='function')throw Error('G6_DYNAMIC_DATABASE_REQUIRED');
 guard(env);
 let issuedBuyer=null;
 let runtimePin=null;
 const stageProofs=new Map();
 async function health(){
  const v=await fetchImpl(BASE+'/health/version');
  if(!v.ok)throw Error('G6_DYNAMIC_DEPLOY_HEALTH_FAILURE');
  const version=await v.json();
  if(version.commit!==env.E2E_EXPECTED_DEPLOY_SHA)
   throw Error('G6_DYNAMIC_DEPLOY_SHA_DRIFT');
 }
 async function target(){
  await health();
  const confirmed=await confirmTarget({db,fetchImpl,env});
  if(!confirmed.confirmed||!confirmed.fingerprint)
   throw Error('G6_DYNAMIC_PG_TARGET_UNVERIFIED');
  return confirmed.fingerprint;
 }
 async function attestedRuntime(context){
  const fingerprint=await target();
  if(context&&(context.db_fingerprint!==fingerprint||
    context.staging_sha!==env.E2E_EXPECTED_DEPLOY_SHA))
   throw Error('G6_DYNAMIC_RUNTIME_CONTEXT_DRIFT');
  return {scenario_id:'M01',market:'KM',environment:'staging',
   staging_sha:env.E2E_EXPECTED_DEPLOY_SHA,db_fingerprint:fingerprint,
   production_permitted:false,attestation_origin:'INDEPENDENT_CHROMIUM_POSTGRESQL',
   ...(context?{order_id:context.order_id,order_reference:context.order_reference}:{})};
 }
 async function verifyStage(stageId,context){
  await attestedRuntime(context);
  const {data,digest}=report(stageId);
  if(stageId==='BUYER'){
   if(data.verdict!=='G6_P2_REAL_OTP_CHROMIUM_ORDER_CREATED_NO_EXTERNAL_EFFECTS'||
    data.runtime_sha!==context.staging_sha||data.db_fingerprint!==context.db_fingerprint||
    data.order?.id!==context.order_id||data.order?.reference!==context.order_reference||
    data.payment_real!==false||data.supplier_order_real!==false||
    data.blocked_requests?.length)throw Error('G6_DYNAMIC_BUYER_UI_PROOF_INVALID');
   const pg=await orderPg(db,context);
   // BUYER's original proof remains valid after legitimate cash payment.
   // A checkpoint authenticated on a later stage must not require cash
   // to still be pending, but must reject duplicate or unconfirmed cash.
   if(!['pending','confirmed','ordered'].includes(pg.status)||
      !['pending','paid'].includes(pg.payment_status)||
      ((pg.payment_status==='pending')&&(pg.cash_count!==0||pg.control_count!==0))||
      ((pg.payment_status==='paid')&&(pg.cash_count!==1||pg.control_count!==1)))
    throw Error('G6_DYNAMIC_BUYER_PG_READBACK_INVALID');
  }else if(stageId==='RELAY_CASH'){
   const matches=(data.steps||[]).filter(s=>s.name==='CASH_UI_PAID'&&s.market==='KM');
   const pre=(data.steps||[]).find(s=>s.name==='PRECHECK_TARGET_CASH_ORDERS');
   if(data.verdict!=='G6_A_RELAY_UI_ASSIGNMENT_AND_CASH_CHROMIUM_PG_PASS_NOT_PICKUP_GO'||
      data.sha!==context.staging_sha||data.db_fingerprint!==context.db_fingerprint||
      data.real_external_payment!==false||matches.length!==1||
      pre?.references?.KM!==context.order_reference||
      matches[0].reference!==context.order_reference||matches[0].http!==200||
      matches[0].payment_status!=='paid'||matches[0].cash_collection_count!==1||
      matches[0].cash_control_confirmed_count!==1)
    throw Error('G6_DYNAMIC_CASH_UI_PROOF_INVALID');
   const pg=await orderPg(db,context);
   if(pg.payment_status!=='paid'||pg.cash_count!==1||pg.control_count!==1)
    throw Error('G6_DYNAMIC_CASH_PG_READBACK_INVALID');
  }else if(stageId==='HUB_PO'){
   const cash=stageProofs.get('RELAY_CASH');
   if(!cash||cash.order_id!==context.order_id||cash.order_reference!==context.order_reference)
    throw Error('G6_DYNAMIC_HUB_CASH_CHECKPOINT_INVALID');
   if(data.verdict!=='G6_P3_MANUAL_LINE_AND_DRAFT_PO_CHROMIUM_PASS'||
      data.reference!==context.order_reference||
      data.db_fingerprint!==context.db_fingerprint||
      data.external_supplier_calls!==0||data.external_payment_executed!==false||
      data.final?.order_id!==context.order_id||
      data.final?.payment_status!=='paid'||
      Number(data.final?.line_count)!==1||Number(data.final?.po_count)!==1||
      Number(data.final?.cash_collection_count)!==1||
      Number(data.final?.cash_control_confirmed_count)!==1)
    throw Error('G6_DYNAMIC_HUB_UI_PROOF_INVALID');
   const poIds=(data.gestures||[]).filter(x=>x.key==='prepare-draft-po'&&x.verdict==='PASS')
     .map(x=>x.purchase_order_id);
   if(poIds.length!==1||!UUID.test(String(poIds[0]||'')))
    throw Error('G6_DYNAMIC_HUB_PO_NOT_UNIQUE');
   const pg=await orderPg(db,context);
   if(pg.payment_status!=='paid'||pg.cash_count!==1||pg.control_count!==1)
    throw Error('G6_DYNAMIC_HUB_PG_CASH_INVALID');
   const {rows}=await db.query(`
    SELECT COUNT(DISTINCT pl.id)::int AS line_count,
      COUNT(DISTINCT pl.purchase_order_id)::int AS po_count,
      MIN(pl.purchase_order_id::text) AS po_id
    FROM purchase_lines pl
    JOIN order_items oi ON oi.id=pl.order_item_id
    WHERE oi.order_id=$1 AND pl.cancelled_at IS NULL
   `,[context.order_id]);
   if(rows.length!==1||rows[0].line_count!==1||rows[0].po_count!==1||
      rows[0].po_id!==poIds[0])
    throw Error('G6_DYNAMIC_HUB_PG_PO_MISMATCH');
  }else throw Error('G6_REAL_BUYER_CASH_STAGE_NOT_IMPLEMENTED_'+stageId);
  return {...context,stage_id:stageId,
   attestation_origin:'INDEPENDENT_CHROMIUM_POSTGRESQL',
   evidence_sha256:digest,external_supplier_calls:0,external_payment_executed:false};
 }
 async function persistEvidence({stageId,attestation,context}){
  const {rel,digest}=report(stageId);
  if(!same(context,attestation)||attestation.stage_id!==stageId||
     digest!==attestation.evidence_sha256)
   throw Error('G6_DYNAMIC_EVIDENCE_CHANGED_BEFORE_PERSIST');
  const dest=path.join(ROOT,'test-results/g6-dynamic-checkpoints',stageId+'.json');
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  const record={...context,stage_id:stageId,source_run_id:String(env.GITHUB_RUN_ID),
   evidence_path:rel,verdict:'PASS',evidence_sha256:digest,
   attestation_origin:'INDEPENDENT_CHROMIUM_POSTGRESQL'};
  const temp=dest+'.'+process.pid+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
  fs.renameSync(temp,dest);
  const stored=JSON.parse(fs.readFileSync(dest,'utf8'));
  if(stored.evidence_sha256!==digest)throw Error('G6_DYNAMIC_EVIDENCE_PERSISTENCE_FAILED');
  stageProofs.set(stageId,stored);
  return {...stored,persisted:true};
 }
 return {
  attestRuntimeBeforeBuyer:async()=>{runtimePin=await attestedRuntime();return runtimePin;},
  executeBuyerChromium:async()=>{
   if(!runtimePin)throw Error('G6_DYNAMIC_RUNTIME_ATTESTATION_REQUIRED');
   fs.rmSync(path.join(ROOT,REPORT_PATH.BUYER),{force:true});
   execute(SCRIPTS.BUYER,env);
   issuedBuyer=report('BUYER').data;
   return issuedBuyer;
  },
  verifyBuyerIndependently:async({buyer,context})=>{
   if(buyer!==issuedBuyer)throw Error('G6_DYNAMIC_BUYER_NOT_FROM_CHROMIUM');
   return verifyStage(checkpoint.stage_id,context);
  },
  attestRuntime:async({context})=>attestedRuntime(context),
  authenticateCheckpoint:async({checkpoint,context})=>{
   if(!['BUYER','RELAY_CASH'].includes(checkpoint.stage_id)||
     checkpoint.source_run_id!==String(env.GITHUB_RUN_ID)||
     checkpoint.evidence_path!==REPORT_PATH[checkpoint.stage_id])
    throw Error('G6_DYNAMIC_CROSS_RUN_REQUIRES_AUTHENTICATED_GITHUB_ARTIFACT');
   const saved=stageProofs.get(checkpoint.stage_id);
   if(!saved||!same(context,saved)||saved.evidence_sha256!==checkpoint.evidence_sha256)
    throw Error('G6_DYNAMIC_CHECKPOINT_NOT_PERSISTED_LOCALLY');
   return verifyStage('BUYER',context);
  },
  executeStage:async({stageId,context})=>{
   if(!['RELAY_CASH','HUB_PO'].includes(stageId))
    throw Error('G6_DYNAMIC_DOWNSTREAM_STAGE_NOT_MIGRATED_'+stageId);
   if(!stageProofs.has('BUYER'))throw Error('G6_DYNAMIC_BUYER_CHECKPOINT_MISSING');
   await attestedRuntime(context);
   if(stageId==='RELAY_CASH'){
    await verifyStage('BUYER',context);
    fs.rmSync(path.join(ROOT,REPORT_PATH.RELAY_CASH),{force:true});
    execute(SCRIPTS.RELAY_CASH,{
     ...env,G6_CANONICAL_MARKET:'KM',
     G6_CANONICAL_ORDER_REFERENCE:context.order_reference
    });
    return report('RELAY_CASH').data;
   }
   if(!stageProofs.has('RELAY_CASH'))
    throw Error('G6_DYNAMIC_CASH_CHECKPOINT_MISSING');
   await verifyStage('RELAY_CASH',context);
   const buyer=report('BUYER').data;
   if(!UUID.test(String(buyer.buyer_id||''))||
      buyer.order?.id!==context.order_id||
      !env.E2E_AGENT_HUB_EMAIL||!env.E2E_AGENT_HUB_PASSWORD||
      !env.E2E_AGENT_RELAIS_EMAIL||!env.E2E_AGENT_RELAIS_PASSWORD)
    throw Error('G6_DYNAMIC_HUB_IDENTITY_NOT_BOUND');
   fs.rmSync(path.join(ROOT,REPORT_PATH.HUB_PO),{force:true});
   const runner=spawnSync(process.platform==='win32'?'npx.cmd':'npx',[
    'playwright','test','--config=playwright.hub-v1-clicks.config.js',
    SCRIPTS.HUB_PO
   ],{cwd:ROOT,env:{...env,PGOPTIONS:'-c default_transaction_read_only=on',
    E2E_CLICKS_BASE_URL:BASE,G6_CANONICAL_HUB_STAGE:'1',
    G6_CANONICAL_ORDER_REFERENCE:context.order_reference,
    G6_CANONICAL_ORDER_ID:context.order_id,
    G6_CANONICAL_BUYER_ID:buyer.buyer_id
   },stdio:'inherit',timeout:16*60*1000});
   if(runner.error||runner.status!==0)
    throw Error('G6_DYNAMIC_HUB_CHROMIUM_FAILED');
   return report('HUB_PO').data;
  },
  verifyStageProof:async({stageId,proof,context})=>{
   if(!['RELAY_CASH','HUB_PO'].includes(stageId)||
      JSON.stringify(proof)!==JSON.stringify(report(stageId).data))
    throw Error('G6_DYNAMIC_STAGE_PROOF_MISMATCH');
   return verifyStage(stageId,context);
  },
  persistEvidence
 };
}
module.exports={createRealBuyerCashAdapters};
