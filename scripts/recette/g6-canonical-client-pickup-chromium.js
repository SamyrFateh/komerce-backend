#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-canonical-client-pickup-chromium
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Same M01 order: real buyer OTP/one-time pickup code in Chromium, then assigned relay handoff, independent PG.
 * @impact-areas staging-only, pickup, checkout, logistics
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {chromium}=require('playwright');
const {normalizeCode}=require('../../services/pickup-code-helpers');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {preseedG6BuyerOtp,verifyMarkedG6Buyer}=require('../../services/g6-staging-buyer-identity-guard');
const {readback,runtime}=require('./g6-hub-shipment-chromium');
const {login}=require('./g6-canonical-forwarder-chromium');
const {openRelayLive}=require('./canonical/relay-live-navigation');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_DYNAMIC_FRESH_ORDER==='1'?env.G6_CANONICAL_ORDER_ID:'56adad65-d1fa-4e80-8d69-c25e0fe92a76';
const PARCEL=env.G6_DYNAMIC_FRESH_ORDER==='1'?env.G6_CANONICAL_PARCEL_ID:'95045ede-d5b8-405b-b65f-d9dbdddb4756';
const SHIPMENT=env.G6_DYNAMIC_FRESH_ORDER==='1'?env.G6_CANONICAL_SHIPMENT_ID:'ff8591fc-78bb-49a4-b154-247508368d16';
const ITEM=env.G6_DYNAMIC_FRESH_ORDER==='1'?env.G6_CANONICAL_ORDER_ITEM_ID:'8c999eec-7322-4676-8db6-585c4d4545f9';
const OUT=path.resolve('test-results/g6-canonical-client-pickup');
const {observe,fullError}=require("./canonical/observability");let OBS=null;
const {startTraceAfterAuth}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill,humanSelect,humanCheck,humanPress}=require('./canonical/actors/human-gestures');
const report={schema:'komerce-g6-client-pickup/1',scenario_id:'M01',market:MK.code,reference:env.G6_CANONICAL_ORDER_REFERENCE||'KL1WGP6',
 order_id:ID,parcel_id:PARCEL,shipment_id:SHIPMENT,provenance:'SIMULATED / STAGING ONLY',
 verdict:'BLOCKED',events:[],external_supplier_calls:0,external_payment_executed:false,
 plaintext_pickup_code_logged:false,production_permitted:false};
function check(v,error){if(!v)throw Error(error)}
function save(){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')}
async function state(){
 const base=await readback();
 const {rows:orders}=await db.query(
  `SELECT o.id,o.reference,o.status::text AS status,o.payment_status::text AS payment_status,
      o.user_id,o.pickup_code_recipient_user_id,o.relais_id,o.pickup_secret_hash,
      o.pickup_secret_revealed_at,o.pickup_secret_last4,u.phone,u.email,u.role::text AS role
    FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=$1`,[ID]);
 const {rows:lines}=await db.query('SELECT order_item_id,quantity,qty_received,qty_collected FROM parcel_items WHERE parcel_id=$1',[PARCEL]);
 const {rows:receipts}=await db.query('SELECT shipment_id,order_item_id,relais_id,received_qty,incident_id FROM international_shipment_relay_receipts WHERE shipment_id=$1',[SHIPMENT]);
 const {rows:scans}=await db.query("SELECT id,scanned_by,pickup_method,pickup_relais_id FROM scans WHERE order_id=$1 AND step='collected' ORDER BY id",[ID]);
 check(base.shipments.length===1&&base.shipments[0].id===SHIPMENT&&base.parcels.length===1&&base.parcels[0].id===PARCEL&&
  orders.length===1&&orders[0].reference===(env.G6_CANONICAL_ORDER_REFERENCE||'KL1WGP6')&&lines.length===1&&lines[0].order_item_id===ITEM&&receipts.length===1&&
  receipts[0].shipment_id===SHIPMENT&&receipts[0].order_item_id===ITEM&&Number(receipts[0].received_qty)===1&&
  receipts[0].incident_id===null,'G6_PICKUP_SCOPE_DRIFT');
 return {base,orders,lines,receipts,scans};
}
async function customer(browser,owner){
 // G6 test account was created in original M01 Chromium buyer run. Seed only an OTP
 // through the exact guarded staging fixture writer; NO new order or buyer account.
 const otp=String(crypto.randomInt(100000,1000000));
 const c=await db.getClient();
 try{await c.query('BEGIN');await preseedG6BuyerOtp(c,{buyer:owner,phone:owner.phone,code:otp});await c.query('COMMIT')}
 catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}
 report.otp_fixture={writer:'preseedG6BuyerOtp',marked_existing_client:true,plaintext_persisted_in_report:false};
 save();
 const ctx=await browser.newContext({baseURL:BASE,viewport:{width:1440,height:900},locale:'fr-FR'});
 const page=await ctx.newPage(),blocked=[];
 let requestCount=0,verifyCount=0,rotateCount=0,plaintext=null;
 const revealPath='/api/pickup/customer-regenerate/'+ID;
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),m=req.method();
  if(['GET','HEAD','OPTIONS'].includes(m))return route.continue();
  if(url.origin===BASE&&m==='POST'&&url.pathname==='/api/auth/otp/request'&&requestCount++===0)return route.continue();
  if(url.origin===BASE&&m==='POST'&&url.pathname==='/api/auth/otp/verify'&&verifyCount++===0)return route.continue();
  if(url.origin===BASE&&m==='POST'&&url.pathname===revealPath&&rotateCount++===0){
   const result=await route.fetch();
   const body=await result.json().catch(()=>({}));
   if(result.status()===200&&typeof body.code==='string')plaintext=body.code;
   return route.fulfill({response:result});
  }
  blocked.push({method:m,path:url.pathname});return route.abort('blockedbyclient');
 });
 try{
  await humanGoto(page,'/boutique/?market='+MK.code+'',{waitUntil:'domcontentloaded'});
  await humanClick(null,page.locator('.k-header-nav-btn[data-tab="komerce"]').first());
  await humanClick(null,page.locator('#k-kmc-identify'));
  await page.locator('#k-id-step-phone').waitFor({state:'visible',timeout:20000});
  await humanFill(null,page.locator('#k-id-name'),'G6');
  await humanFill(null,page.locator('#k-id-lastname'),'E2E');
  await humanSelect(null,page.locator('#k-id-phone-country'),MK.dial);
  await humanFill(null,page.locator('#k-id-phone'),owner.phone.slice(MK.dial.length));
  const req=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/otp/request'&&r.request().method()==='POST',{timeout:20000});
  await humanClick(null,page.locator('#k-id-phone-cta'));
  check((await req).status()===200,'G6_PICKUP_OTP_REQUEST_REJECTED');
  await page.locator('#k-id-step-otp').waitFor({state:'visible',timeout:15000});
  const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/otp/verify'&&r.request().method()==='POST',{timeout:20000});
  for(let i=0;i<6;i++)await humanFill(null,page.locator('.k-id-otp-box').nth(i),otp[i]);
  const res=await pending,session=await res.json().catch(()=>null);
  check(res.status()===200&&session?.user?.id===owner.id,'G6_PICKUP_OTP_SESSION_OWNER_INVALID');
  check((await ctx.cookies()).some(x=>x.name.endsWith('kmrc_jwt')&&x.httpOnly),'G6_PICKUP_SESSION_NOT_HTTPONLY');
  await startTraceAfterAuth(ctx);
  await runtime();
  report.events.push({key:'client-otp',http:200,role:'client'});save();
  await humanGoto(page,'/boutique/?market='+MK.code+'&tab=track',{waitUntil:'domcontentloaded'});
  const card=page.locator('.k-myorder-card[data-ref="'+(env.G6_CANONICAL_ORDER_REFERENCE||'KL1WGP6')+'"]');
  await card.waitFor({state:'visible',timeout:30000});await humanClick(null,card);
  const action=page.locator('.k-order-pickup-code');
  await action.waitFor({state:'visible',timeout:15000});
  check(await action.getByText('Code de retrait',{exact:true}).isVisible(),'G6_PICKUP_CODE_CLIENT_UI_MISSING');
  // Code from PAYMENT long predates the 30-minute reveal window. Use the actual
  // client-only rotation UI once; never obtain/hash/guess code from PG.
  page.on('dialog',d=>d.type()==='confirm'?d.accept():d.dismiss());
  const button=action.getByRole('button',{name:'Générer un nouveau code',exact:true});
  const rotating=page.waitForResponse(r=>new URL(r.url()).pathname===revealPath&&r.request().method()==='POST',{timeout:25000});
  await humanClick(null,button);const response=await rotating;
  report.rotation_gate={http:response.status(),rotation_requests:rotateCount,
    blocked_paths:blocked.map(x=>x.path).filter(x=>!x.startsWith('/api/auth/otp/'))};
  save();
  check(response.status()===200&&rotateCount===1&&
    !blocked.some(x=>x.path===revealPath),
    'G6_PICKUP_CLIENT_ROTATION_FAILED');
  const normalized=normalizeCode(plaintext);
  check(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(normalized),'G6_PICKUP_SECRET_FORMAT_INVALID');
  const shown=await action.locator('.k-pickup-code-output').textContent();
  check(shown.includes(plaintext)&&shown.startsWith('Votre code : '),'G6_PICKUP_CLIENT_SECRET_NOT_DISPLAYED');
  check(await action.locator('.k-order-pickup-code-reveal').isHidden(),'G6_PICKUP_REVEAL_NOT_HIDDEN');
  report.events.push({key:'client-code-rotation',http:response.status(),role:'client',ui:true,code_masked:'********'});
  save();await runtime();
  return {ctx,page,code:normalized};
 }catch(e){await ctx.close();throw e}
}
async function relay(browser,code,expectedRelay){
 const actor=await login(browser,'E2E_AGENT_RELAIS_','agent_relais');
 try{
  const me=await actor.page.request.get('/api/auth/me'),user=await me.json();
  const {rows:staff}=await db.query('SELECT id,role::text AS role,relais_id FROM users WHERE id=$1',[user.id]);
  check(me.ok()&&staff.length===1&&staff[0].role==='agent_relais'&&staff[0].relais_id===expectedRelay,
   'G6_PICKUP_RELAY_ACTOR_MISMATCH');
  const path='/api/scans/collect',url=BASE+path;
  let calls=0;
  await actor.page.route(url,route=>{
   const req=route.request();let body;
   try{body=req.postDataJSON()}catch(_){}
   if(req.method()==='POST'&&calls++===0&&isDeepStrictEqual(body,{pickup_code:code}))return route.continue();
   actor.blocked.push({method:req.method(),path});return route.abort('blockedbyclient');
  });
  actor.page.on('dialog',d=>d.type()==='confirm'?d.accept():d.dismiss());
  // Reuse the role landing page; the real pickup form must still be visible.
  const box=await openRelayLive(actor.page,{
   selector:'[data-manual-pickup-code]',timeout:30000,entry:'remises'
  });
  const input=box.locator('[data-pickup-code-input]');
  check(await input.getAttribute('type')==='password','G6_PICKUP_RELAY_FIELD_MUST_BE_MASKED');
  await humanFill(null,input,code);
  const pending=actor.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:30000});
  const button=box.locator('[data-pickup-code-confirm]');
  check(await button.isEnabled(),'G6_PICKUP_RELAY_ACTION_DISABLED');
  await humanClick(null,button);const res=await pending;
  check(res.status()===200&&calls===1&&actor.blocked.length===0,'G6_PICKUP_RELAY_COLLECT_REJECTED_'+res.status());
  report.events.push({key:'relay-code-collect',http:200,role:'agent_relais',ui:true,code_masked:'********'});
  save();await runtime();
  // `[data-manual-pickup-code]` est le comptoir GÉNÉRIQUE de l'onglet Remises (operations-workspace.js
  // renderPickupCodeSection) : affiché dès qu'un colis du relais attend un retrait, sans lien avec cette
  // commande (le POST ne porte que {pickup_code}). Il reste donc visible pour le client suivant (1 en KM/CM).
  // Oracle = PG lecture seule : retrait unique, code consommé, aucun second retrait.
  await actor.page.reload({waitUntil:'domcontentloaded'});
  await actor.page.locator('[data-relay-execution-jump="collect"]').waitFor({state:'visible',timeout:20000}).catch(()=>{});
  const available=await actor.page.locator('[data-manual-pickup-code]').count();
  const {rows:[once]}=await db.query(`SELECT o.status::text AS status,o.pickup_secret_hash IS NULL AS code_consumed,
     (SELECT COUNT(*)::int FROM scans s WHERE s.order_id=o.id AND s.step='collected') AS collect_scans,
     (SELECT COUNT(*)::int FROM scans s WHERE s.order_id=o.id AND s.step='collected' AND s.pickup_method='PICKUP_CODE') AS code_scans
    FROM orders o WHERE o.id=$1`,[ID]);
  check(once&&once.status==='collected'&&once.code_consumed===true&&once.collect_scans===1&&once.code_scans===1&&calls===1&&
    actor.blocked.length===0,'G6_PICKUP_SECOND_HANDOFF_OR_CODE_NOT_CONSUMED');
  report.second_handoff_ui={generic_counter_forms_visible:available,generic_counter_note:'comptoir générique Remises, non lié à la commande',
    pg_collect_scans:once.collect_scans,pg_code_consumed:once.code_consumed,second_post_attempted:false};
  return user.id;
 }finally{await actor.ctx.close()}
}
async function main(){
 let browser,clientContext;
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&
   env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&
   env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
   env.G6_CANONICAL_PHASE==='CLIENT_PICKUP'&&(env.G6_CANONICAL_RESUME_RUN_ID==='44272362064'||env.G6_DYNAMIC_FRESH_ORDER==='1')&&
   env.G6_CANONICAL_SCENARIO==='M01'&&env.G6_TARGET_MARKET===MK.code&&env.G6_CANONICAL_ORDER_ID===ID,
   'G6_PICKUP_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_PICKUP_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  const prior=JSON.parse(fs.readFileSync((env.G6_DYNAMIC_FRESH_ORDER==='1'?'test-results/g6-canonical-relay-receipt/report.json':'test-results/g6-canonical-resume/g6-canonical-relay-receipt/report.json'),'utf8'));
  const before=await state();report.before={base:before.base,orders:before.orders.map(o=>({id:o.id,reference:o.reference,status:o.status,payment_status:o.payment_status,relais_id:o.relais_id,owner_id:o.user_id,secret_exists:!!o.pickup_secret_hash})),lines:before.lines,receipts:before.receipts,scans:before.scans};save();
  const owner=before.orders[0];
  check(isDeepStrictEqual(before.base,prior.after.base)&&before.base.shipments[0].stage==='relay_received'&&
    before.base.parcels[0].status==='available'&&owner.status==='available'&&owner.payment_status==='paid'&&
    (!owner.pickup_code_recipient_user_id||owner.user_id===owner.pickup_code_recipient_user_id),'G6_PICKUP_PRECONDITION_OWNER_INVALID');
  check(owner.role==='client'&&!!owner.phone&&!!owner.pickup_secret_hash&&before.scans.length===0&&
    Number(before.lines[0].qty_received)===1&&Number(before.lines[0].qty_collected)===0,
    'G6_PICKUP_PRECONDITION_PHYSICAL_INVALID');
  const buyer={id:owner.user_id,email:owner.email,phone:owner.phone,role:owner.role};
  check(await verifyMarkedG6Buyer(db,buyer,env),'G6_PICKUP_EXISTING_MARKED_BUYER_REQUIRED');
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const c=await customer(browser,buyer);clientContext=c.ctx;
  const agent=await relay(browser,c.code,owner.relais_id);
  // Never include the code in any log, screenshot or report. Wipe local reference.
  c.code=null;
  const after=await state();
  report.after={base:after.base,orders:after.orders.map(o=>({id:o.id,status:o.status,payment_status:o.payment_status,secret_exists:!!o.pickup_secret_hash})),
    lines:after.lines,receipts:after.receipts,scans:after.scans};
  save();
  check(after.orders[0].status==='collected'&&after.base.parcels[0].status==='collected'&&
    after.base.shipments[0].stage==='relay_received'&&
    Number(after.lines[0].qty_collected)===1&&after.scans.length===1&&
    after.scans[0].scanned_by===agent&&after.scans[0].pickup_relais_id===owner.relais_id&&
    after.scans[0].pickup_method==='PICKUP_CODE'&&after.receipts.length===1&&
    isDeepStrictEqual(after.receipts,before.receipts),
    'G6_PICKUP_FINAL_PG_INVALID');
  await runtime();
  report.verdict='G6_CLIENT_PICKUP_SIMULATED_CHROMIUM_PG_PASS_COLLECTED';
  report.next_stage='COMPLETED_M01';save();
 }catch(e){report.error=fullError(e);try{const s=await state();report.failure_readback={order:s.orders[0]?.status,parcel:s.base.parcels[0]?.status,shipment:s.base.shipments[0]?.stage,scans:s.scans.length}}catch(_){};
  save();process.exitCode=2}
 finally{if(clientContext)await clientContext.close().catch(()=>{});if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
// M02 (LOCAL_STOCK) réutilise les gestes client (code) et relais (saisie clavier) sans les dupliquer.
module.exports={customer,relay};
