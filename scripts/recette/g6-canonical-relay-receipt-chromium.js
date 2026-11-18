#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-canonical-relay-receipt-chromium
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Certify the EXACT M01 single-parcel relay attestation via real Chromium and independent PG readback.
 * @impact-areas logistics, staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {isDeepStrictEqual}=require('node:util');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {readback,runtime}=require('./g6-hub-shipment-chromium');
const {login}=require('./g6-canonical-forwarder-chromium');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const ID='ff8591fc-78bb-49a4-b154-247508368d16',REF='SIM-STAGING-EXP-KL1WGP6';
const ORDER='56adad65-d1fa-4e80-8d69-c25e0fe92a76', PARCEL='95045ede-d5b8-405b-b65f-d9dbdddb4756';
const ITEM='8c999eec-7322-4676-8db6-585c4d4545f9', PROOF='[SIMULATED / STAGING ONLY] G6-M01-RECEPTION-RELAIS-KL1WGP6';
const OUT=path.resolve('test-results/g6-canonical-relay-receipt');
const URL='/api/admin/workspaces/operations/market/KM/relay-shipments/'+REF+'/receive';
const report={schema:'komerce-g6-relay-receipt/1',reference:'KL1WGP6',shipment_id:ID,shipment_ref:REF,
 order_id:ORDER,parcel_id:PARCEL,market:'KM',scenario_id:'M01',provenance:'SIMULATED / STAGING ONLY',
 verdict:'BLOCKED',events:[],external_supplier_calls:0,external_payment_executed:false};
const check=(ok,code)=>{if(!ok)throw Error(code)};
function save(){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')}
async function state(){
 const base=await readback();
 const {rows:orders}=await db.query('SELECT id,reference,status::text AS status,payment_status::text AS payment_status,relais_id,pickup_secret_hash,pickup_secret_last4 FROM orders WHERE id=$1',[ORDER]);
 const {rows:items}=await db.query('SELECT pi.order_item_id,pi.quantity,pi.qty_shipped,pi.qty_received,pi.qty_collected FROM parcel_items pi WHERE pi.parcel_id=$1',[PARCEL]);
 const {rows:receipts}=await db.query('SELECT shipment_id,order_item_id,relais_id,expected_qty,received_qty,received_by,proof_ref,incident_id FROM international_shipment_relay_receipts WHERE shipment_id=$1',[ID]);
 const {rows:events}=await db.query("SELECT event_type,from_stage,to_stage,proof_ref,actor_id FROM international_shipment_events WHERE shipment_id=$1 AND event_type='stage_changed' ORDER BY occurred_at,id",[ID]);
 check(orders.length===1&&items.length===1&&items[0].order_item_id===ITEM&&base.shipments.length===1&&base.shipments[0].id===ID&&
 base.box.length===1&&base.box[0].state==='DISPATCHED'&&base.links.length===1&&base.effective.length===1&&
 Number(base.effective[0].quantity)===1,'G6_RELAY_SCOPE_DRIFT');
 return {base,orders,items,receipts,events};
}
async function main(){
 let browser,actor;
 try{
  save();
  check(env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&
   env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&
   env.STAGING_BASE_URL===BASE&&env.G6_CANONICAL_PHASE==='RELAY_RECEIPT'&&env.G6_CANONICAL_RESUME_RUN_ID==='44260374187'&&
   env.G6_CANONICAL_ORDER_ID===ORDER&&env.G6_CANONICAL_SCENARIO==='M01'&&env.G6_TARGET_MARKET==='KM',
   'G6_RELAY_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_RELAY_DB_FINGERPRINT_INVALID');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  const prior=JSON.parse(fs.readFileSync('test-results/g6-canonical-resume/g6-canonical-customs/report.json','utf8'));
  const before=await state();report.before=before;save();
  check(before.base.order.length===1&&before.base.order[0].id===ORDER&&before.base.parcelItems.length===1&&
    before.base.parcelEvents.length===1&&before.base.parcelEvents[0].event_type==='shipped'&&
    isDeepStrictEqual(before.base,prior.after.base)&&before.base.shipments[0].stage==='local_delivery'&&
    before.base.parcels[0].id===PARCEL&&before.base.parcels[0].status==='shipped'&&
    before.orders[0].id===ORDER&&before.orders[0].reference==='KL1WGP6'&&before.orders[0].payment_status==='paid'&&
    before.receipts.length===0&&Number(before.items[0].qty_received)===0&&Number(before.items[0].qty_collected)===0&&
    Number(before.items[0].qty_shipped)===1,'G6_RELAY_PRECONDITION_INVALID');
  browser=await chromium.launch({headless:true});
  actor=await login(browser,'E2E_AGENT_RELAIS_','agent_relais');
  const me=await actor.page.request.get('/api/auth/me');
  check(me.ok(),'G6_RELAY_SESSION_MISSING');
  const profile=await me.json();
  // /api/auth/me intentionally exposes a public profile without staff relais_id.\n  // Verify staff assignment independently via read-only PostgreSQL, never by editing it.\n  const {rows:staff}=await db.query('SELECT id, role, relais_id FROM users WHERE id=$1',[profile.id]);\n  check(staff.length===1&&staff[0].role==='agent_relais'&&\n    staff[0].relais_id===before.orders[0].relais_id&&!!staff[0].relais_id,\n    'G6_RELAY_ACTOR_NOT_ORDER_RELAY');
  await actor.page.goto('/admin/relais-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});
  const card=actor.page.locator('[data-relay-shipment="'+REF+'"]');
  await card.waitFor({state:'visible',timeout:25000});
  check(await card.getAttribute('data-relay-receivable')==='true','G6_RELAY_UI_NOT_RECEIVABLE');
  if(!await card.evaluate(el=>el.open))await card.locator('summary').first().click();
  const field=card.locator('input[data-relay-received]');
  check(await field.count()===1&&await field.getAttribute('data-relay-received')===ITEM,'G6_RELAY_UI_ITEM_NOT_UNIQUE');
  await field.fill('1');
  await card.locator('input[data-relay-proof]').fill(PROOF);
  const expected={proof_ref:PROOF,lines:[{order_item_id:ITEM,received_qty:1}]};
  let count=0;const url=BASE+URL;
  const handler=async route=>{
   const req=route.request();if(req.method()!=='POST')return route.fallback();
   let payload;try{payload=req.postDataJSON()}catch(_){}
   if(count===0&&isDeepStrictEqual(payload,expected)){count++;return route.continue()}
   actor.blocked.push({method:req.method(),path:new URL(req.url()).pathname});return route.abort('blockedbyclient');
  };
  await runtime();await actor.page.route(url,handler);
  try{
   const button=card.locator('[data-workspace-action="relay-shipment-receive"]');
   await button.waitFor({state:'visible',timeout:20000});
   check(await button.isEnabled(),'G6_RELAY_BUTTON_DISABLED');
   const pending=actor.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:30000});
   await button.click();const response=await pending;
   report.events.push({key:'relay-receipt',http:response.status(),role:'agent_relais'});save();
   check(count===1&&response.status()===201&&actor.blocked.length===0,'G6_RELAY_RECEIPT_HTTP_'+response.status());
   await actor.page.screenshot({path:path.join(OUT,'reception-relais.png')});
  }finally{await actor.page.unroute(url,handler)}
  const after=await state();report.after=after;save();
  check(after.base.shipments[0].stage==='relay_received'&&after.base.parcels[0].status==='available'&&
   after.orders[0].status==='available'&&after.receipts.length===1&&after.receipts[0].shipment_id===ID&&
   after.receipts[0].order_item_id===ITEM&&after.receipts[0].relais_id===before.orders[0].relais_id&&
   Number(after.receipts[0].expected_qty)===1&&Number(after.receipts[0].received_qty)===1&&
   after.receipts[0].proof_ref===PROOF&&!!after.receipts[0].received_by&&!after.receipts[0].incident_id&&
   Number(after.items[0].qty_received)===1&&Number(after.items[0].qty_shipped)===1&&
   Number(after.items[0].qty_collected)===0&&after.events.length===before.events.length+1&&
   after.events.at(-1).from_stage==='local_delivery'&&after.events.at(-1).to_stage==='relay_received'&&
   after.events.at(-1).proof_ref===PROOF,'G6_RELAY_RECEIPT_PG_INVALID');
  await runtime();report.verdict='G6_RELAY_RECEIPT_SIMULATED_CHROMIUM_PG_PASS_AVAILABLE';
  report.next_stage='CLIENT_PICKUP';save();
 }catch(e){report.error=String(e.message||e).slice(0,700);try{if(report.db_fingerprint)report.failure_readback=await state()}catch(_){};save();process.exitCode=2}
 finally{if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
