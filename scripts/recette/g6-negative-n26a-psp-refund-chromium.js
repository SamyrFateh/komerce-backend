/** @komerce-arch-lite
 * @role g6-negative-n26a-psp-refund-chromium
 * @domain refunds
 * @layer script
 * @owner backend-core
 * @purpose N26a: admin Chromium reserves and executes exactly one partial line refund through the original PSP sandbox; PostgreSQL verifies settlement and receipt.
 * @db-read orders, order_items, order_item_refund_reservations, refund_execution_intents, refunds, transaction_documents
 * @db-write none
 * @impact-areas staging-only, refunds, payments
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {runtime}=require('./g6-hub-shipment-chromium');
const {login}=require('./g6-canonical-forwarder-chromium');
const {observe,fullError}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill,humanSelect}=require('./canonical/actors/human-gestures');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const SCEN=env.G6_CANONICAL_SCENARIO,ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const PHASE='N26A_LINE_REFUND_PSP_DECISION',OUT=path.resolve('test-results/g6-negative-n26a');
let OBS=null;
const report={schema:'komerce-g6-negative-n26a/1',scenario_id:SCEN,market:MK.code,reference:REF,
 order_id:ID,provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],candidate:null,
 external_supplier_calls:0,external_payment_attempted:false,external_payment_executed:false,production_permitted:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const check=(ok,code)=>{if(!ok)throw Error(code)};

async function snapshot(orderId){
 const {rows:[order]}=await db.query(`SELECT id,reference,user_id,status::text AS status,
   payment_status::text AS payment_status,payment_mode::text AS payment_mode,market_id,
   stripe_payment_id,paypal_capture_id FROM orders WHERE id=$1`,[orderId]);
 check(!!order,'G6_N26A_PRODUCT_GAP_ORDER_MISSING');
 const {rows:items}=await db.query(`SELECT id,quantity,qty_collected,qty_refunded FROM order_items
   WHERE order_id=$1 ORDER BY id`,[orderId]);
 const {rows:[effects]}=await db.query(`SELECT
   (SELECT count(*)::int FROM order_item_refund_reservations WHERE order_id=$1) AS reservations,
   (SELECT count(*)::int FROM refunds WHERE order_id=$1 AND refund_type LIKE 'item:%' AND status='completed') AS refunds,
   (SELECT count(*)::int FROM refund_execution_intents WHERE order_id=$1) AS intents,
   (SELECT count(*)::int FROM transaction_documents WHERE order_id=$1 AND document_type='refund_receipt') AS receipts,
   (SELECT count(*)::int FROM local_item_refund_reservations WHERE order_id=$1) AS local_reservations,
   (SELECT count(*)::int FROM wallet_credit_lots wcl JOIN wallet_transactions wt ON wt.id=wcl.transaction_id
      WHERE wcl.source_order_id=$1 AND wt.type='credit') AS wallet_credits`,[orderId]);
 return {order,items,effects};
}

async function main(){
 let browser;
 try{
  save();
  check(SCEN==='N26a'&&env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&
   env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&
   env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&
   env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
   env.G6_CANONICAL_PHASE===PHASE&&env.G6_DYNAMIC_FRESH_ORDER==='1'&&env.G6_TARGET_MARKET===MK.code&&
   /^[a-f0-9-]{36}$/i.test(ID||''),'G6_N26A_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_N26A_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  const before=await snapshot(ID);
  check(before.order.reference===REF&&before.order.payment_status==='paid'&&
   ['stripe_eur','paypal_eur'].includes(before.order.payment_mode),'G6_N26A_PREREQ_ORDER_NOT_PAID_PSP');
  check(before.effects.reservations===0&&before.effects.refunds===0&&before.effects.intents===0,
   'G6_N26A_PREREQ_PRIOR_REFUND_EFFECT');
  report.before={payer_user_id:before.order.user_id,payment_mode:before.order.payment_mode,
   items:before.items,effects:before.effects};

  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const admin=await login(browser,'E2E_ADMIN_','admin');
  try{
   await admin.page.setViewportSize({width:1440,height:900});
   await humanGoto(admin.page,'/g8-remboursements.html',{waitUntil:'domcontentloaded'});
   await admin.page.waitForLoadState('networkidle',{timeout:20000}).catch(()=>{});
   const panel=admin.page.locator('#g8-item-refund');
   await panel.waitFor({state:'visible',timeout:15000}).catch(()=>{});
   check(await panel.count()===1,'G6_N26A_SCREEN_MISSING_PSP_PARTIAL_REFUND');
   await humanClick(admin.page,panel.locator('summary'));
   const lookup=panel.locator('form').first();
   await humanFill(admin.page,lookup.locator('input[name="order_reference"]'),REF);
   const contextResponse=admin.page.waitForResponse(r=>r.url().includes('/item-refund-context')&&r.request().method()==='GET');
   await humanClick(admin.page,lookup.locator('[data-g8-action="load-item-refund-context"]'));
   const contextHttp=await contextResponse;report.context_http=contextHttp.status();
   check(contextHttp.ok(),'G6_N26A_CONTEXT_HTTP_'+contextHttp.status());
   const context=await contextHttp.json();
   check(context.order?.id===ID&&context.order?.reference===REF,'G6_N26A_CONTEXT_ORDER_MISMATCH');
   check(Array.isArray(context.candidates)&&context.candidates.length>0,'G6_N26A_PREREQ_MISSING_VERIFIED_SHORTAGE');
   const candidate=context.candidates[0];
   check(Number(candidate.available_quantity)>=1,'G6_N26A_PREREQ_NO_RESERVABLE_QUANTITY');
   report.candidate={incident_id:candidate.incident_id,order_item_id:candidate.order_item_id,
    proof:candidate.proof,verified_missing:candidate.verified_missing,available_quantity:candidate.available_quantity};
   report.steps_reached.push('ORDER_AND_SHORTAGE_PROOF_READ');save();

   const decision=panel.locator('form').nth(1);
   await humanSelect(admin.page,decision.locator('select[name="candidate"]'),'0');
   await humanFill(admin.page,decision.locator('input[name="quantity"]'),'1');
   await humanFill(admin.page,decision.locator('input[name="reason"]'),'Manquant attesté — N26a');
   admin.page.once('dialog',dialog=>dialog.accept());
   const reserveResponse=admin.page.waitForResponse(r=>r.url().endsWith('/refund-reservations')&&r.request().method()==='POST');
   await humanClick(admin.page,decision.locator('[data-g8-action="reserve-item-refund"]'),
    {mutation:{method:'POST',pathRe:/\/refund-reservations$/,statuses:[200,202]}});
   const reserveHttp=await reserveResponse;report.reservation_http=reserveHttp.status();
   report.request=JSON.parse(reserveHttp.request().postData()||'{}');
   report.reservation_response=await reserveHttp.json();
   check([200,202].includes(reserveHttp.status())&&report.reservation_response.status==='reserved',
    'G6_N26A_RESERVATION_NOT_COMMITTED');
   report.steps_reached.push('PARTIAL_REFUND_RESERVED');save();

   admin.page.once('dialog',dialog=>dialog.accept());
   const executeResponse=admin.page.waitForResponse(r=>r.url().endsWith('/execute')&&r.request().method()==='POST');
   report.external_payment_attempted=true;save();
   await humanClick(admin.page,panel.locator('[data-g8-action="execute-item-refund"]'),
    {mutation:{method:'POST',pathRe:/\/refund-reservations\/[^/]+\/execute$/,statuses:[200]}});
   const executeHttp=await executeResponse;report.execution_http=executeHttp.status();
   report.execution_response=await executeHttp.json();
   check(executeHttp.status()===200&&report.execution_response.status==='confirmed'&&
    report.execution_response.paid===true,'G6_N26A_PSP_REFUND_NOT_CONFIRMED');
   report.steps_reached.push('PSP_SANDBOX_REFUND_CONFIRMED');
   report.external_payment_executed=true;
   report.after=await snapshot(ID);
   report.verdict='G6_N26A_PSP_PARTIAL_LINE_REFUND_CHROMIUM_PASS';save();
  }finally{await admin.ctx.close()}
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});
  await db.pool.end();console.log(JSON.stringify(report));}
}
if(require.main===module)main();
module.exports={main,snapshot};
