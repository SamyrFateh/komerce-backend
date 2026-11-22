/** @komerce-arch-lite
 * @role g6-real-buyer-cash-bound-adapters
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose Execute only BUYER and RELAY_CASH on a fresh staging order via existing Chromium scripts.
 * @impact-areas staging-only
 */
'use strict';
const {marketProfile,PROFILES}=require('./market-profile');
const {SCENARIO_STAGE_IDS}=require('./stage-registry');
const {createM03ImportStages}=require('./m03-import-stages');
const multiPo=require('./multi-po');
const oracles=require('./local-stock-oracles');
const m03=require('./m03-oracles');
const {readSellable,selectMixedBasket}=require('./m03-prereq');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {confirmTarget}=require('../target-guard');
const {attestHealthVersion,fetchHealthReadOnly}=require('./health-read-only-retry');
const {redact}=require('./observability');
const ROOT=path.resolve(__dirname,'../../..');
const BASE='https://komerce-backend-production.up.railway.app';
const REPORT_PATH=Object.freeze({
 BUYER:'test-results/g6-p2-buyer-order/report.json',
 RELAY_CASH:'test-results/g6-a-relay-cash/report.json',
 HUB_PO:'test-results/g6-p3-kuyiyuk/evidence.json',
 HUB_COMMITMENT:'test-results/g6-hub-commitment/report.json',
 HUB_VENDOR_READINESS:'test-results/g6-hub-vendor-readiness/report.json',
 HUB_VENDOR_SIMULATION:'test-results/g6-hub-vendor-simulation/report.json',
 HUB_RECEIVING:'test-results/g6-hub-receiving/report.json',
 HUB_RECEIVING_READBACK:'test-results/g6-hub-receiving-readback/report.json',
 HUB_CUSTOMER_BAG:'test-results/g6-hub-customer-bag/report.json',
 HUB_KOM_BOX:'test-results/g6-hub-kom-box/report.json',
 HUB_SHIPMENT:'test-results/g6-hub-shipment/report.json',
 FORWARDER:'test-results/g6-canonical-forwarder/report.json',
 CUSTOMS:'test-results/g6-canonical-customs/report.json',
 RELAY_RECEIPT:'test-results/g6-canonical-relay-receipt/report.json',
 CLIENT_PICKUP:'test-results/g6-canonical-client-pickup/report.json',
 LOCAL_RELAY_AVAILABLE:'test-results/g6-local-relay-available/report.json',
 LOCAL_CLIENT_PICKUP:'test-results/g6-local-client-pickup/report.json',
 M03_NOT_COLLECTED:'test-results/g6-m03-not-collected/report.json',
 M03_COLLECTED_FINAL:'test-results/g6-m03-collected-final/report.json'
});
const SCRIPTS=Object.freeze({
 BUYER:'scripts/recette/g6-p2-buyer-order-real-chromium.js',
 RELAY_CASH:'scripts/recette/g6-a-relay-cash-real-chromium.js',
 HUB_PO:'tests/staging-clicks/g6-p3-kuyiyuk.spec.js',
 HUB_COMMITMENT:'scripts/recette/g6-hub-commitment-chromium.js',
 HUB_VENDOR_READINESS:'scripts/recette/g6-hub-vendor-readiness-chromium.js',
 HUB_VENDOR_SIMULATION:'scripts/recette/g6-hub-vendor-simulation-chromium.js',
 HUB_RECEIVING:'scripts/recette/g6-hub-receiving-chromium.js',
 HUB_RECEIVING_READBACK:'scripts/recette/g6-hub-receiving-readback.js',
 HUB_CUSTOMER_BAG:'scripts/recette/g6-hub-customer-bag-chromium.js',
 HUB_KOM_BOX:'scripts/recette/g6-hub-kom-box-chromium.js',
 HUB_SHIPMENT:'scripts/recette/g6-hub-shipment-chromium.js',
 FORWARDER:'scripts/recette/g6-canonical-forwarder-chromium.js',
 CUSTOMS:'scripts/recette/g6-canonical-customs-chromium.js',
 RELAY_RECEIPT:'scripts/recette/g6-canonical-relay-receipt-chromium.js',
 CLIENT_PICKUP:'scripts/recette/g6-canonical-client-pickup-chromium.js',
 LOCAL_RELAY_AVAILABLE:'scripts/recette/g6-local-relay-available-chromium.js',
 LOCAL_CLIENT_PICKUP:'scripts/recette/g6-local-client-pickup-chromium.js'
});
const DOWNSTREAM_M01=Object.freeze(['RELAY_CASH','HUB_PO','HUB_COMMITMENT','HUB_VENDOR_READINESS','HUB_VENDOR_SIMULATION','HUB_RECEIVING','HUB_RECEIVING_READBACK','HUB_CUSTOMER_BAG','HUB_KOM_BOX','HUB_SHIPMENT','FORWARDER','CUSTOMS','RELAY_RECEIPT','CLIENT_PICKUP']);
const M02_STAGES=Object.freeze(['LOCAL_RELAY_AVAILABLE','LOCAL_CLIENT_PICKUP']);
// G6-G4B : N23/N24 réutilisent le parcours M02 (achat, cash, mise à disposition) ; le geste négatif est joué ensuite par le runner.
const LOCAL_FLOW=Object.freeze(['M02','M03','N23','N24','N21','N22','N29','N28','N32','N30','N31','N25','N26b']);
const LOCAL_PG_FLOW=Object.freeze(['M02','N23','N24','N21','N22','N29','N28','N32','N30','N31','N25','N26b']);
const M03_ORACLE_STAGES=Object.freeze(['M03_NOT_COLLECTED','M03_COLLECTED_FINAL']);
// M03 : branche locale = étapes M02 ; oracles M03 en lecture seule ; branche import (HUB_PO..CLIENT_PICKUP) = boucle par PO (m03-import-stages).
const M03_IMPORT_STAGES=Object.freeze(DOWNSTREAM_M01.filter(x=>x!=='RELAY_CASH'));
const SHA=/^[a-f0-9]{40}$/;
const REF=/^[A-Z0-9][A-Z0-9-]{5,63}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const same=(c,p)=>p?.order_id===c.order_id&&p?.order_reference===c.order_reference&&
 p?.staging_sha===c.staging_sha&&p?.db_fingerprint===c.db_fingerprint&&
 p?.market===c.market&&p?.scenario_id===c.scenario_id&&p?.production_permitted===false;
function guard(env){
 if(env.GITHUB_EVENT_NAME!=='issues'||env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER||
    env.GITHUB_REPOSITORY!=='SamyrFateh/komerce-backend'||
    env.NODE_ENV!=='test'||env.KOMERCE_ENV!=='staging'||env.KOMERCE_TARGET_ENV!=='staging'||
    env.EXPECTED_RAILWAY_ENVIRONMENT!=='staging'||env.STAGING_BASE_URL!==BASE||
    !Object.hasOwn(SCENARIO_STAGE_IDS,String(env.G6_CANONICAL_SCENARIO))||!Object.hasOwn(PROFILES,env.G6_TARGET_MARKET)||
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
async function uniquePoId(db,orderId){
 const {rows}=await db.query(`
  SELECT COUNT(DISTINCT pl.id)::int AS line_count,
    COUNT(DISTINCT pl.purchase_order_id)::int AS po_count,
    MIN(pl.purchase_order_id::text) AS po_id
  FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id
  WHERE oi.order_id=$1 AND pl.cancelled_at IS NULL
 `,[orderId]);
 const item=rows[0];
 if(rows.length!==1||Number(item.line_count)!==1||
    Number(item.po_count)!==1||!UUID.test(String(item.po_id||'')))
  throw Error('G6_DYNAMIC_HUB_PO_ID_NOT_UNIQUE');
 return item.po_id;
}
async function poState(db,context,poId){
 const id=poId||await uniquePoId(db,context.order_id);
 const {rows}=await db.query(`
 SELECT po.status::text AS status, po.trigger_mode,
   (SELECT count(*)::int FROM purchase_order_authorizations a
    WHERE a.purchase_order_id=po.id AND a.authorization_type='purchase_commitment') AS commitments,
   (SELECT count(*)::int FROM purchase_order_authorizations a
    WHERE a.purchase_order_id=po.id AND a.authorization_type='supplier_payment') AS payments,
   (SELECT count(*)::int FROM manual_purchase_executions e
    WHERE e.purchase_order_id=po.id) AS executions
 FROM purchase_orders po WHERE po.id=$1
 `,[id]);
 if(rows.length!==1||rows[0].trigger_mode==='auto')
  throw Error('G6_DYNAMIC_HUB_PO_STATE_INVALID');
 return {id,...rows[0]};
}
async function finalMileIdentity(db,context,{beforeShipment=false,m03=false}={}){
 const packed=report('HUB_KOM_BOX').data,bag=report('HUB_CUSTOMER_BAG').data;
 const parcel=packed.parcel_id,box=packed.box_id;
 if(!UUID.test(String(parcel||''))||!UUID.test(String(box||''))||
    !UUID.test(String(packed.allocation_id||''))||
    packed.bag_id!==bag.bag_id)
  throw Error('G6_DYNAMIC_FINAL_MILE_BOX_DRIFT');
 // M03 : toutes les lignes IMPORT (une par PO) voyagent dans l'unique colis ; M01 : l'unique ligne de la commande.
 const items=await db.query('SELECT id FROM order_items WHERE order_id=$1'+(m03?" AND fulfillment_source='IMPORT' ORDER BY created_at,id":''),[context.order_id]);
 if(m03?items.rows.length<multiPo.MIN_IMPORT_POS||items.rows.some(r=>!UUID.test(String(r.id||''))):(items.rows.length!==1||!UUID.test(String(items.rows[0].id||''))))
  throw Error('G6_DYNAMIC_FINAL_MILE_ORDER_ITEM_NOT_UNIQUE');
 const shipment=await db.query(`
  SELECT s.id,s.reference FROM international_shipments s
  JOIN international_shipment_hub_units h ON h.shipment_id=s.id
  WHERE h.physical_unit_id=$1 ORDER BY s.id
 `,[box]);
 if(shipment.rows.length!==(beforeShipment?0:1)||
    (!beforeShipment&&(!UUID.test(String(shipment.rows[0].id||''))||
      !REF.test(String(shipment.rows[0].reference||'')))))
  throw Error('G6_DYNAMIC_FINAL_MILE_SHIPMENT_NOT_UNIQUE');
 return {shipment_id:shipment.rows[0]?.id||null,
  shipment_ref:shipment.rows[0]?.reference||null,
  order_item_id:items.rows[0].id,parcel_id:parcel,box_id:box,
  bag_id:bag.bag_id,bag_ref:bag.bag_ref,
  allocation_id:packed.allocation_id};
}
async function orderPg(db,context){
 const {rows}=await db.query(`
 SELECT o.id,o.reference,o.status::text AS status,o.payment_status::text AS payment_status,
  o.payment_mode::text AS payment_mode,o.simulation_scope,m.code AS market,
  (SELECT count(*)::int FROM cash_collections c WHERE c.order_id=o.id) AS cash_count,
  (SELECT count(*)::int FROM cash_confirmation_controls c WHERE c.order_id=o.id AND c.state='CONFIRMED') AS control_count
 FROM orders o JOIN markets m ON m.id=o.market_id WHERE o.id=$1 AND o.reference=$2
 `,[context.order_id,context.order_reference]);
 if(rows.length!==1||rows[0].market!==context.market||rows[0].simulation_scope!=='G6-BUYER'||
   rows[0].payment_mode!=='cash_relais')throw Error('G6_DYNAMIC_ORDER_PG_IDENTITY_INVALID');
 return rows[0];
}
function execute(script,env){
 const r=spawnSync(process.execPath,[path.join(ROOT,script)],{
  cwd:ROOT,env,stdio:'inherit',timeout:12*60*1000
 });
 if(r.error||r.status!==0){
  // Full, redacted child error (no truncation) plus where trace/screenshot/network journal live.
  const stage=Object.keys(SCRIPTS).find(k=>SCRIPTS[k]===script);
  let detail='';
  try{
   const rel=REPORT_PATH[stage];
   const child=JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'));
   detail=' | child_error='+redact(child.error||child.verdict||'')+' | artifacts='+path.dirname(rel);
  }catch(_){}
  throw Error('G6_DYNAMIC_CHROMIUM_STAGE_FAILED_'+script+' status='+r.status+
   ' signal='+r.signal+(r.error?' spawn_error='+redact(r.error.message):'')+detail);
 }
}
function createRealBuyerCashAdapters({db,env=process.env,fetchImpl=fetch}={}){
 if(!db||typeof db.query!=='function')throw Error('G6_DYNAMIC_DATABASE_REQUIRED');
 guard(env);
 const SCENARIO=env.G6_CANONICAL_SCENARIO;
 // N20, N11 à N16 : chaîne import identique à M01 ; les scripts enfants (Hub, transitaire, douane) tournent sous l'alias M01, jamais modifiés.
 if(['N20','N11','N12','N13','N14','N15','N16','N17','N18','N19','N35','N36','N37','N38','N39F1','N39F2','N39F3','N40','N26a','N27'].includes(SCENARIO))env={...env,G6_CANONICAL_SCENARIO:'M01'};
 let issuedBuyer=null;
 let runtimePin=null;
 const stageProofs=new Map();
 async function health(){
  // Railway/Actions can intermittently drop a connection at a checkpoint.
  // Only the GET health attestation is retried: no POST, checkpoint or
  // business transition is ever replayed by the network safeguard.
  await attestHealthVersion({
   fetchImpl,url:BASE+'/health/version',expectedSha:env.E2E_EXPECTED_DEPLOY_SHA
  });
 }
 async function target(){
  await health();
  // Target identity is also read via GET /health after /health/version.
  // Retry transport only; confirmTarget still compares the authoritative PG
  // fingerprint and expected Railway environment on EVERY checkpoint.
  const confirmed=await confirmTarget({
   db,env,fetchImpl:(url)=>fetchHealthReadOnly({fetchImpl,url})
  });
  if(!confirmed.confirmed||!confirmed.fingerprint)
   throw Error('G6_DYNAMIC_PG_TARGET_UNVERIFIED');
  return confirmed.fingerprint;
 }
 async function attestedRuntime(context){
  const fingerprint=await target();
  if(context&&(context.db_fingerprint!==fingerprint||
    context.staging_sha!==env.E2E_EXPECTED_DEPLOY_SHA))
   throw Error('G6_DYNAMIC_RUNTIME_CONTEXT_DRIFT');
  return {scenario_id:SCENARIO,market:marketProfile(env).code,environment:'staging',
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
   if(LOCAL_PG_FLOW.includes(SCENARIO))await oracles.assertNoHubOrTransport(db,context.order_id,'any');
   if(SCENARIO==='M03')await m03.assertMixedPhase(db,context.order_id,'structure');
  }else if(stageId==='RELAY_CASH'){
   const matches=(data.steps||[]).filter(s=>s.name==='CASH_UI_PAID'&&s.market===marketProfile(env).code);
   const pre=(data.steps||[]).find(s=>s.name==='PRECHECK_TARGET_CASH_ORDERS');
   if(data.verdict!=='G6_A_RELAY_UI_ASSIGNMENT_AND_CASH_CHROMIUM_PG_PASS_NOT_PICKUP_GO'||
      data.sha!==context.staging_sha||data.db_fingerprint!==context.db_fingerprint||
      data.real_external_payment!==false||matches.length!==1||
      pre?.references?.[marketProfile(env).code]!==context.order_reference||
      matches[0].reference!==context.order_reference||matches[0].http!==200||
      matches[0].payment_status!=='paid'||matches[0].cash_collection_count!==1||
      matches[0].cash_control_confirmed_count!==1)
    throw Error('G6_DYNAMIC_CASH_UI_PROOF_INVALID');
   const pg=await orderPg(db,context);
   if(pg.payment_status!=='paid'||pg.cash_count!==1||pg.control_count!==1)
    throw Error('G6_DYNAMIC_CASH_PG_READBACK_INVALID');
   if(LOCAL_PG_FLOW.includes(SCENARIO))await oracles.assertNoHubOrTransport(db,context.order_id,'any');
   if(SCENARIO==='M03')await m03.assertMixedPhase(db,context.order_id,'structure');
  }else if(M03_ORACLE_STAGES.includes(stageId)){
   if(SCENARIO!=='M03'||data.order_id!==context.order_id||data.oracle_verdict!=='PASS')
    throw Error('G6_M03_ORACLE_PROOF_INVALID_'+stageId);
  }else if(M02_STAGES.includes(stageId)){
   if(!LOCAL_FLOW.includes(SCENARIO))throw Error('G6_REAL_BUYER_CASH_STAGE_NOT_IMPLEMENTED_'+stageId);
   const expected={LOCAL_RELAY_AVAILABLE:'G6_LOCAL_RELAY_AVAILABLE_SIMULATED_CHROMIUM_PG_PASS',
    LOCAL_CLIENT_PICKUP:'G6_LOCAL_CLIENT_PICKUP_SIMULATED_CHROMIUM_PG_PASS_COLLECTED'}[stageId];
   if(data.verdict!==expected||data.db_fingerprint!==context.db_fingerprint||
      data.sha!==context.staging_sha||data.order_id!==context.order_id||
      data.reference!==context.order_reference||data.external_supplier_calls!==0||
      data.external_payment_executed!==false||data.plaintext_pickup_code_logged===true)
    throw Error('G6_M02_UI_PROOF_INVALID_'+stageId);
   const phase=stageId==='LOCAL_RELAY_AVAILABLE'?'available':'collected';
   const negative=SCENARIO==='M03'?await m03.assertMixedPhase(db,context.order_id,phase==='available'?'local_available':'local_collected')
    :await oracles.assertNoHubOrTransport(db,context.order_id,phase);
   if(stageId==='LOCAL_CLIENT_PICKUP'){
    const {rows:[scan]}=await db.query(
     "SELECT id FROM scans WHERE order_id=$1 AND step='collected' AND pickup_method='PICKUP_CODE'",[context.order_id]);
    if(!scan)throw Error('G6_M02_PICKUP_SCAN_MISSING');
    const proof=SCENARIO==='M03'?{negative,o_fin:await oracles.financeOracle(db,{orderId:context.order_id,reference:context.order_reference}),
     o_notif:await oracles.notificationOracle(db,{orderId:context.order_id,reference:context.order_reference})}
     :{negative,o_fin:await oracles.financeOracle(db,{orderId:context.order_id,reference:context.order_reference}),
     o_doc:await oracles.documentOracle(db,{orderId:context.order_id,scanId:scan.id}),
     o_notif:await oracles.notificationOracle(db,{orderId:context.order_id,reference:context.order_reference})};
    const out=path.join(ROOT,'test-results/g6-local-client-pickup/oracles.json');
    fs.mkdirSync(path.dirname(out),{recursive:true});
    fs.writeFileSync(out,JSON.stringify({scenario_id:SCENARIO,market:context.market,order_id:context.order_id,...proof},null,2)+'\n');
   }
  }else if(SCENARIO==='M03'&&M03_IMPORT_STAGES.includes(stageId)&&
    ['HUB_PO','HUB_COMMITMENT','HUB_VENDOR_READINESS','HUB_VENDOR_SIMULATION','HUB_RECEIVING','HUB_RECEIVING_READBACK','HUB_CUSTOMER_BAG','HUB_KOM_BOX'].includes(stageId)){
   // M03 : preuves par PO / sac consolidé (m03-import-stages) ; l'oracle PG reste indépendant du script.
   await m03import.verify(stageId,context,data,digest);
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
  }else if(['HUB_COMMITMENT','HUB_VENDOR_READINESS','HUB_VENDOR_SIMULATION'].includes(stageId)){
   const po=await poState(db,context);
   if(data.reference!==context.order_reference||data.po_id!==po.id||
      data.db_fingerprint!==context.db_fingerprint||
      data.external_supplier_calls!==0||data.external_payment_executed!==false||
      data.sha!==context.staging_sha)
    throw Error('G6_DYNAMIC_HUB_STAGE_PROVENANCE_INVALID_'+stageId);
   if(stageId==='HUB_COMMITMENT'){
    if(data.verdict!=='G6_HUB_COMMITMENT_AND_INTERNAL_SUBMIT_CHROMIUM_PASS_NOT_VENDOR_OR_RECEIPT_GO'||
     data.commitment?.http!==201||data.commitment?.pdf_generated!==true||
     data.after?.po_status!=='notified'||data.after?.commitment_count!==1||
     data.after?.payment_authorization_count!==0||
     po.status!=='notified'||po.commitments!==1||po.payments!==0||po.executions!==0)
     throw Error('G6_DYNAMIC_HUB_COMMITMENT_PG_INVALID');
   }else if(stageId==='HUB_VENDOR_READINESS'){
    if(data.verdict!=='G6_VENDOR_SEND_UI_READY_BUT_EXTERNAL_EVENT_NOT_PROVEN'||
     data.supplier_send_certified!==false||
     data.supplier_confirmation_certified!==false||
     data.physical_receipt_certified!==false||
     data.screen?.external_send_form_not_submitted!==true||
     po.status!=='notified'||po.commitments!==1||po.payments!==0||po.executions!==0)
     throw Error('G6_DYNAMIC_HUB_VENDOR_READINESS_INVALID');
   }else{
    if(data.verdict!=='G6_VENDOR_SIMULATED_SEND_AND_CONFIRM_CHROMIUM_PASS_NOT_RECEIPT_GO'||
     data.provenance!=='SIMULATED / STAGING ONLY'||
     data.after?.po_status!=='confirmed'||data.after?.simulation_marker!==true||
     data.after?.manual_executions!==1||data.after?.payment_authorizations!==0||
     po.status!=='confirmed'||po.commitments!==1||po.payments!==0||po.executions!==1)
     throw Error('G6_DYNAMIC_HUB_VENDOR_SIMULATION_INVALID');
   }
  }else if(['HUB_RECEIVING','HUB_RECEIVING_READBACK','HUB_CUSTOMER_BAG','HUB_KOM_BOX'].includes(stageId)){
   const po=await poState(db,context);
   const receipt=stageId==='HUB_RECEIVING' ? data : report('HUB_RECEIVING').data;
   const source=receipt?.receipt?.reference;
   if(data.reference!==context.order_reference||
      data.po_id!==po.id||data.db_fingerprint!==context.db_fingerprint||
      data.external_supplier_calls!==0||data.external_payment_executed!==false||
      (data.sha&&data.sha!==context.staging_sha)||
      !/^SUPPLIER_PACKAGE-[A-Z0-9-]{8,}$/i.test(String(source||''))||
      po.payments!==0||po.executions!==1)
    throw Error('G6_DYNAMIC_PHYSICAL_PROVENANCE_INVALID_'+stageId);
   const receiptState=await db.query(
    'SELECT COUNT(*)::int AS n FROM hub_physical_units WHERE reference=$1 AND unit_type=$2',
    [source,'SUPPLIER_PACKAGE']);
   if(receiptState.rows[0]?.n!==1||po.status!=='hub_received')
    throw Error('G6_DYNAMIC_PHYSICAL_RECEIPT_PG_INVALID');
   if(stageId==='HUB_RECEIVING'){
    if(data.verdict!=='G6_HUB_RECEIPT_SIMULATED_CHROMIUM_PASS_NOT_KOM_BOX_GO'||
       data.physical_receipt_certified!==true||
       data.receipt?.gesture!=='Chromium button click'||data.after?.remaining!==0||
       data.after?.physical_units!==1||data.after?.external_payment_authorizations!==0)
      throw Error('G6_DYNAMIC_RECEIVING_UI_PG_INVALID');
   }else if(stageId==='HUB_RECEIVING_READBACK'){
    if(data.verdict!=='G6_HUB_RECEIPT_SIMULATED_CHROMIUM_HISTORICAL_UI_PG_READBACK_PASS'||
       data.physical_ref!==source||data.read_only!==true||
       data.readback?.remaining!==0||data.readback?.placements?.length!==1||
       data.readback.placements[0].reference!==source||
       data.readback.placements[0].evidence_method!=='MANUAL')
      throw Error('G6_DYNAMIC_RECEIVING_READBACK_INVALID');
   }else if(stageId==='HUB_CUSTOMER_BAG'){
    const bag=data.bag_id;
    if(data.verdict!=='G6_CUSTOMER_BAG_SIMULATED_CHROMIUM_PG_PASS'||
       !UUID.test(String(bag||''))||data.source_ref!==source||
       data.after?.bags?.length!==1||data.after.bags[0].id!==bag||
       data.after.bags[0].state!=='PACKED'||data.after?.units?.filter(u=>u.active).length!==1||
       data.after.units.find(u=>u.active)?.id!==bag)
      throw Error('G6_DYNAMIC_CUSTOMER_BAG_INVALID');
   }else{
    const bag=report('HUB_CUSTOMER_BAG').data;
    if(data.verdict!=='G6_KOM_BOX_SIMULATED_CHROMIUM_PG_PASS_PACKED'||
       data.bag_id!==bag.bag_id||data.bag_ref!==bag.bag_ref||
       !UUID.test(String(data.box_id||''))||
       data.after?.box?.length!==1||data.after.box[0].id!==data.box_id||
       data.after.box[0].state!=='PACKED'||data.after?.links?.length!==1||
       data.after.links[0].bag_unit_id!==bag.bag_id||
       data.after.links[0].box_unit_id!==data.box_id)
      throw Error('G6_DYNAMIC_KOM_BOX_INVALID');
   }
  }else if(['HUB_SHIPMENT','FORWARDER','CUSTOMS','RELAY_RECEIPT','CLIENT_PICKUP'].includes(stageId)){
   const ids=await finalMileIdentity(db,context,{m03:SCENARIO==='M03'});
   if(data.db_fingerprint!==context.db_fingerprint||
      data.sha!==context.staging_sha||
      data.external_supplier_calls!==0||data.external_payment_executed!==false||
      data.order_id!==context.order_id)
    throw Error('G6_DYNAMIC_FINAL_MILE_PROVENANCE_INVALID_'+stageId);
   const expected={
    HUB_SHIPMENT:'G6_HUB_SHIPMENT_SIMULATED_CHROMIUM_PG_PASS_HANDED_OVER',
    FORWARDER:'G6_FORWARDER_SIMULATED_CHROMIUM_PG_PASS_ARRIVED',
    CUSTOMS:'G6_CUSTOMS_LOCAL_SIMULATED_CHROMIUM_PG_PASS',
    RELAY_RECEIPT:'G6_RELAY_RECEIPT_SIMULATED_CHROMIUM_PG_PASS_AVAILABLE',
    CLIENT_PICKUP:'G6_CLIENT_PICKUP_SIMULATED_CHROMIUM_PG_PASS_COLLECTED'
   };
   if(data.verdict!==expected[stageId]||
      (data.shipment_id&&data.shipment_id!==ids.shipment_id)||
      (data.parcel_id&&data.parcel_id!==ids.parcel_id))
    throw Error('G6_DYNAMIC_FINAL_MILE_UI_MISMATCH_'+stageId);
   const expectedStage={
    HUB_SHIPMENT:'handed_over',FORWARDER:'arrived',CUSTOMS:'local_delivery',
    RELAY_RECEIPT:'relay_received',CLIENT_PICKUP:'relay_received'
   }[stageId];
   const {rows}=await db.query(
    'SELECT stage::text stage FROM international_shipments WHERE id=$1',[ids.shipment_id]);
   if(rows.length!==1||rows[0].stage!==expectedStage)
    throw Error('G6_DYNAMIC_FINAL_MILE_PG_STAGE_INVALID_'+stageId);
   if(stageId==='CLIENT_PICKUP'){
    const pg=await orderPg(db,context);
    const checks=await db.query(
     "SELECT COUNT(*)::int AS n FROM scans WHERE order_id=$1 AND step='collected'",
     [context.order_id]);
    // M03 : la remise locale a déjà laissé 1 scan « collected » ; la remise import en ajoute exactement 1.
    if(pg.status!=='collected'||checks.rows[0]?.n!==(SCENARIO==='M03'?2:1)||
       data.plaintext_pickup_code_logged!==false)
     throw Error('G6_DYNAMIC_PICKUP_ANTI_DOUBLE_INVALID');
   }
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
 const m03import=createM03ImportStages({db,env,ROOT,REPORT_PATH,SCRIPTS,execute,report,stageProofs,verifyStage,orderPg,poState,marketProfile});
 return {
  attestRuntimeBeforeBuyer:async()=>{runtimePin=await attestedRuntime();return runtimePin;},
  resolveLocalStockProduct:async()=>{
   const {rows}=await db.query(`
    SELECT p.id,p.product_ref,d.amount
    FROM local_stock ls
    JOIN markets m ON m.id=ls.market_id AND m.code=$1
    JOIN products p ON p.id=ls.product_id
    JOIN product_market_price_drafts d ON d.product_id=p.id AND d.market_id=m.id AND d.status='LOCAL_ACTIVE'
    JOIN product_market_exposure e ON e.product_id=p.id AND e.market_id=m.id
    WHERE ls.location='KM_MAIN' AND ls.commercial_exposure='ENABLED'
      AND ls.qty_physical-COALESCE((SELECT SUM(a.quantity) FROM local_stock_allocations a
        WHERE a.local_stock_id=ls.id AND a.consumed_at IS NULL AND a.released_at IS NULL),0)>=1
      AND p.lifecycle_status='active' AND p.is_active=TRUE AND p.is_available=TRUE
      AND e.commercial_exposure='ENABLED'
      AND EXISTS (SELECT 1 FROM product_skus sku WHERE sku.product_id=p.id AND sku.is_active=TRUE)
      AND p.product_ref<>$2
    ORDER BY p.product_ref LIMIT 1`,[marketProfile(env).code,require('./scenario-profile').M01_PRODUCT_REF]);
   // Prérequis catalogue/stock (déclaré par l'écran W3), jamais créé ici : absent = bloqué.
   if(rows.length!==1)throw Error('G6_M02_LOCAL_STOCK_PRODUCT_MISSING_'+marketProfile(env).code);
   return {id:rows[0].id,product_ref:rows[0].product_ref,price:Number(rows[0].amount)};
  },
  // M03 : panier mixte choisi en lecture seule (1 local != KPR-000165 + imports de >=3 sources distinctes), jamais créé ici.
  resolveMixedBasket:async()=>{
   const market=marketProfile(env).code;
   let basket;
   try{basket=selectMixedBasket(await readSellable(db,market))}
   catch(e){throw Error(String(e.message).replace(/^G6_M03_/,'G6_M03_PRODUCT_GAP_'+market+'_'))}
   const line=p=>({product_ref:p.product_ref,price:p.price,source_key:p.source_key});
   return {basket:{local:line(basket.local),imports:basket.imports.map(line)}};
  },
  // N33 : produit à >= 2 SKU distincts, choisi en lecture seule, jamais créé ici.
  resolveMultiSkuProduct:async()=>require('./negative-scenarios').resolveMultiSku(db,marketProfile(env).code),
  executeBuyerChromium:async({product,basket,variants}={})=>{
   if(!runtimePin)throw Error('G6_DYNAMIC_RUNTIME_ATTESTATION_REQUIRED');
   fs.rmSync(path.join(ROOT,REPORT_PATH.BUYER),{force:true});
   execute(SCRIPTS.BUYER,basket?{...env,G6_M03_BASKET:JSON.stringify(basket)}:variants?{...env,G6_N33_VARIANTS:JSON.stringify({product_ref:variants.product_ref,price:variants.price,skus:variants.skus})}:product?{...env,G6_BUYER_PRODUCT_REF:product.product_ref,
    G6_BUYER_EXPECTED_PRICE:String(product.price)}:env);
   issuedBuyer=report('BUYER').data;
   return issuedBuyer;
  },
  verifyBuyerIndependently:async({buyer,context})=>{
   if(buyer!==issuedBuyer)throw Error('G6_DYNAMIC_BUYER_NOT_FROM_CHROMIUM');
   return verifyStage('BUYER',context);
  },
  attestRuntime:async({context})=>attestedRuntime(context),
  authenticateCheckpoint:async({checkpoint,context})=>{
   if(!['BUYER',...DOWNSTREAM_M01.slice(0,-1),...(LOCAL_FLOW.includes(SCENARIO)?M02_STAGES:[]),...(SCENARIO==='M03'?M03_ORACLE_STAGES:[])].includes(checkpoint.stage_id)||
     checkpoint.source_run_id!==String(env.GITHUB_RUN_ID)||
     checkpoint.evidence_path!==REPORT_PATH[checkpoint.stage_id])
    throw Error('G6_DYNAMIC_CROSS_RUN_REQUIRES_AUTHENTICATED_GITHUB_ARTIFACT');
   const saved=stageProofs.get(checkpoint.stage_id);
   if(!saved||!same(context,saved)||saved.evidence_sha256!==checkpoint.evidence_sha256)
    throw Error('G6_DYNAMIC_CHECKPOINT_NOT_PERSISTED_LOCALLY');
   return verifyStage(checkpoint.stage_id,context);
  },
  executeStage:async({stageId,context})=>{
   if(![...DOWNSTREAM_M01,...(LOCAL_FLOW.includes(SCENARIO)?M02_STAGES:[]),...(SCENARIO==='M03'?M03_ORACLE_STAGES:[])].includes(stageId))
    throw Error('G6_DYNAMIC_DOWNSTREAM_STAGE_NOT_MIGRATED_'+stageId);
   if(!stageProofs.has('BUYER'))throw Error('G6_DYNAMIC_BUYER_CHECKPOINT_MISSING');
   await attestedRuntime(context);
   if(SCENARIO==='M03'&&M03_IMPORT_STAGES.includes(stageId))
    return m03import.execute(stageId,context,finalMileIdentity);
   if(stageId==='RELAY_CASH'){
    await verifyStage('BUYER',context);
    fs.rmSync(path.join(ROOT,REPORT_PATH.RELAY_CASH),{force:true});
    execute(SCRIPTS.RELAY_CASH,{
     ...env,G6_CANONICAL_MARKET:marketProfile(env).code,G6_DYNAMIC_FRESH_BUYER:'1',
     G6_CANONICAL_ORDER_REFERENCE:context.order_reference
    });
    return report('RELAY_CASH').data;
   }
   if(M03_ORACLE_STAGES.includes(stageId)){
    // Oracle clé M03 (lecture seule PG) : jamais collected avant la remise des lignes import.
    const predecessor=stageId==='M03_NOT_COLLECTED'?'LOCAL_CLIENT_PICKUP':'CLIENT_PICKUP';
    if(!stageProofs.has(predecessor))throw Error('G6_M03_PREDECESSOR_MISSING_'+predecessor);
    await verifyStage(predecessor,context);
    const phase=stageId==='M03_NOT_COLLECTED'?'local_collected':'final';
    const oracle=await m03.assertMixedPhase(db,context.order_id,phase);
    const out=path.join(ROOT,REPORT_PATH[stageId]);
    fs.mkdirSync(path.dirname(out),{recursive:true});
    const rec={schema:'komerce-g6-m03-oracle/1',scenario_id:'M03',market:context.market,order_id:context.order_id,
     reference:context.order_reference,oracle_verdict:'PASS',oracle,db_fingerprint:context.db_fingerprint,sha:context.staging_sha,
     external_supplier_calls:0,external_payment_executed:false,production_permitted:false};
    if(stageId==='M03_COLLECTED_FINAL')rec.o_fin=await oracles.financeOracle(db,{orderId:context.order_id,reference:context.order_reference});
    fs.writeFileSync(out,JSON.stringify(rec,null,2)+'\n');
    return report(stageId).data;
   }
   if(M02_STAGES.includes(stageId)){
    const predecessor=stageId==='LOCAL_RELAY_AVAILABLE'?'RELAY_CASH':'LOCAL_RELAY_AVAILABLE';
    if(!LOCAL_FLOW.includes(SCENARIO)||!stageProofs.has(predecessor))
     throw Error('G6_M02_PREDECESSOR_MISSING_'+predecessor);
    await verifyStage(predecessor,context);
    fs.rmSync(path.join(ROOT,REPORT_PATH[stageId]),{force:true});
    execute(SCRIPTS[stageId],{
     ...env,G6_DYNAMIC_FRESH_ORDER:'1',G6_CANONICAL_PHASE:stageId,
     G6_CANONICAL_ORDER_ID:context.order_id,
     G6_CANONICAL_ORDER_REFERENCE:context.order_reference,
     G6_CANONICAL_DB_FINGERPRINT:context.db_fingerprint
    });
    return report(stageId).data;
   }
   if(stageId!=='HUB_PO'){
    const predecessor={
     HUB_COMMITMENT:'HUB_PO',
     HUB_VENDOR_READINESS:'HUB_COMMITMENT',
     HUB_VENDOR_SIMULATION:'HUB_VENDOR_READINESS',
     HUB_RECEIVING:'HUB_VENDOR_SIMULATION',
     HUB_RECEIVING_READBACK:'HUB_RECEIVING',
     HUB_CUSTOMER_BAG:'HUB_RECEIVING_READBACK',
     HUB_KOM_BOX:'HUB_CUSTOMER_BAG',
     HUB_SHIPMENT:'HUB_KOM_BOX',FORWARDER:'HUB_SHIPMENT',
     CUSTOMS:'FORWARDER',RELAY_RECEIPT:'CUSTOMS',CLIENT_PICKUP:'RELAY_RECEIPT'
    }[stageId];
    if(!stageProofs.has(predecessor))
     throw Error('G6_DYNAMIC_HUB_PREDECESSOR_MISSING_'+predecessor);
    await verifyStage(predecessor,context);
    const poId=await uniquePoId(db,context.order_id);
    const record=report('HUB_PO').data;
    const draftPo=(record.gestures||[]).find(x=>x.key==='prepare-draft-po'&&x.verdict==='PASS');
    if(draftPo?.purchase_order_id!==poId)
     throw Error('G6_DYNAMIC_HUB_PO_IDENTITY_DRIFT');
    // The physical supplier package does not exist during director commitment
    // or supplier readiness. Read it only after a successful HUB_RECEIVING.
    const needsReceipt=['HUB_RECEIVING_READBACK','HUB_CUSTOMER_BAG',
     'HUB_KOM_BOX','HUB_SHIPMENT','FORWARDER','CUSTOMS',
     'RELAY_RECEIPT','CLIENT_PICKUP'].includes(stageId);
    const receipt=needsReceipt?report('HUB_RECEIVING').data:null;
    const bag=stageId==='HUB_KOM_BOX'?report('HUB_CUSTOMER_BAG').data:null;
    const source=receipt?.receipt?.reference||'';
    if(stageId!=='HUB_RECEIVING'&&['HUB_RECEIVING_READBACK','HUB_CUSTOMER_BAG','HUB_KOM_BOX'].includes(stageId)&&
      !/^SUPPLIER_PACKAGE-[A-Z0-9-]{8,}$/i.test(source))
     throw Error('G6_DYNAMIC_PHYSICAL_RECEIPT_REFERENCE_MISSING');
    const finalStages=['HUB_SHIPMENT','FORWARDER','CUSTOMS','RELAY_RECEIPT','CLIENT_PICKUP'];
    const finalIds=finalStages.includes(stageId)?await finalMileIdentity(db,context,{beforeShipment:stageId==='HUB_SHIPMENT'}):null;
    const parcel=bag?.after?.parcels?.[0]?.id;
    const allocation=bag?.after?.order?.allocation_id;
    if(stageId==='HUB_KOM_BOX'&&
       (!UUID.test(String(bag?.bag_id||''))||!UUID.test(String(parcel||''))||
        !UUID.test(String(allocation||''))))
     throw Error('G6_DYNAMIC_KOM_BOX_PREDECESSOR_INCOMPLETE');
    fs.rmSync(path.join(ROOT,REPORT_PATH[stageId]),{force:true});
    execute(SCRIPTS[stageId],{
     ...env,G6_DYNAMIC_FRESH_ORDER:'1',G6_CANONICAL_PHASE:stageId,
     G6_CANONICAL_ORDER_ID:context.order_id,
     G6_CANONICAL_ORDER_REFERENCE:context.order_reference,
     G6_CANONICAL_PO_ID:poId,G6_CANONICAL_DB_FINGERPRINT:context.db_fingerprint,
     G6_CANONICAL_RECEIPT_REFERENCE:source,
     ...(bag?{G6_CANONICAL_BAG_ID:bag.bag_id,G6_CANONICAL_BAG_REF:bag.bag_ref,
      G6_CANONICAL_PARCEL_ID:parcel,G6_CANONICAL_ALLOCATION_ID:allocation}:{}),
     ...(finalIds?Object.fromEntries(Object.entries(finalIds).map(([k,v])=>['G6_CANONICAL_'+k.toUpperCase(),v])):{})
    });
    return report(stageId).data;
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
   if(![...DOWNSTREAM_M01,...(LOCAL_FLOW.includes(SCENARIO)?M02_STAGES:[]),...(SCENARIO==='M03'?M03_ORACLE_STAGES:[])].includes(stageId)||
      JSON.stringify(proof)!==JSON.stringify(report(stageId).data))
    throw Error('G6_DYNAMIC_STAGE_PROOF_MISMATCH');
   return verifyStage(stageId,context);
  },
  persistEvidence
 };
}
module.exports={createRealBuyerCashAdapters};
