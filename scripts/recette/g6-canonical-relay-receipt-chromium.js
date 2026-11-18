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
const {openRelayLive}=require('./canonical/relay-live-navigation');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_DYNAMIC_FRESH_ORDER==='1'?env.G6_CANONICAL_SHIPMENT_ID:'ff8591fc-78bb-49a4-b154-247508368d16',REF=env.G6_DYNAMIC_FRESH_ORDER==='1'?env.G6_CANONICAL_SHIPMENT_REF:'SIM-STAGING-EXP-KL1WGP6';
const ORDER=env.G6_DYNAMIC_FRESH_ORDER==='1'?env.G6_CANONICAL_ORDER_ID:'56adad65-d1fa-4e80-8d69-c25e0fe92a76', PARCEL=env.G6_DYNAMIC_FRESH_ORDER==='1'?env.G6_CANONICAL_PARCEL_ID:'95045ede-d5b8-405b-b65f-d9dbdddb4756';
const ITEM=env.G6_DYNAMIC_FRESH_ORDER==='1'?env.G6_CANONICAL_ORDER_ITEM_ID:'8c999eec-7322-4676-8db6-585c4d4545f9', PROOF='[SIMULATED / STAGING ONLY] G6-M01-RECEPTION-RELAIS-'+(env.G6_CANONICAL_ORDER_REFERENCE||'KL1WGP6');
const OUT=path.resolve('test-results/g6-canonical-relay-receipt');
const {observe,fullError}=require("./canonical/observability");let OBS=null;
const {humanGoto,humanClick,humanFill,humanSelect,humanCheck,humanPress}=require('./canonical/actors/human-gestures');
const RECEIPT_PATH='/api/admin/workspaces/operations/market/KM/relay-shipments/'+REF+'/receive';
const report={schema:'komerce-g6-relay-receipt/1',reference:env.G6_CANONICAL_ORDER_REFERENCE||'KL1WGP6',shipment_id:ID,shipment_ref:REF,
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

async function attachDedicatedRelayByUI(browser,agentId,orderRelay){
 const email=String(env.E2E_AGENT_RELAIS_EMAIL||'').toLowerCase();
 check(/^[^@\s]*(e2e|rct1|recette)[^@\s]*@(komerce\.test|recette\.komerce\.invalid)$/.test(email),
  'G6_RELAY_ASSIGNMENT_NOT_DEDICATED_E2E');
 const {rows:staff}=await db.query('SELECT id,role,relais_id FROM users WHERE id=$1',[agentId]);
 const {rows:relay}=await db.query(
  "SELECT id,name,is_active,market_id FROM relais WHERE id=$1 AND market_id=(SELECT id FROM markets WHERE code='KM')",
  [orderRelay]);
 check(staff.length===1&&staff[0].role==='agent_relais'&&relay.length===1&&relay[0].is_active===true,
  'G6_RELAY_ASSIGNMENT_SCOPE_INVALID');
 const {rows:membership}=await db.query(
  `SELECT 1 FROM assignment_memberships am
     JOIN market_operating_assignments moa ON moa.id=am.assignment_id
     JOIN membership_capabilities mc ON mc.membership_id=am.id
    WHERE am.user_id=$1 AND am.status='ACTIVE' AND moa.market_id=$2
      AND moa.status='ACTIVE' AND mc.revoked_at IS NULL
      AND mc.capability=ANY($3::text[]) LIMIT 1`,
  [agentId,relay[0].market_id,['execution.parcel.receive','execution.parcel.collect']]);
 check(membership.length===1,'G6_RELAY_ASSIGNMENT_MARKET_MEMBERSHIP_MISSING');
 const admin=await login(browser,'E2E_ADMIN_','admin');
 const endpoint='/api/market-delegation/markets/KM/network/relais/'+orderRelay+'/agents';
 const url=BASE+endpoint;
 let count=0;
 const handler=async route=>{
  const req=route.request();
  let body;try{body=req.postDataJSON()}catch(_){}
  if(req.method()==='POST'&&count===0&&isDeepStrictEqual(body,{user_id:agentId})){
   count++;return route.continue();
  }
  admin.blocked.push({method:req.method(),path:new URL(req.url()).pathname});
  return route.abort('blockedbyclient');
 };
 try{
  await runtime();
  await humanGoto(admin.page,'/dashboards/canonical/market-autonomy.html?market=KM',{waitUntil:'domcontentloaded'});
  const panel=admin.page.locator('[data-market-network]');
  try{await panel.waitFor({state:'visible',timeout:15000})}catch(error){
   const ui=await admin.page.locator('#market-autonomy-root').evaluate(e=>({
    class_name:e.className,heading:e.querySelector('h1')?.textContent?.slice(0,90)||null,
    body:e.textContent?.trim().slice(0,180)||null
   })).catch(()=>({class_name:'ROOT_MISSING'}));
   const requests={};
   for(const [label,url] of [
    ['context','/api/admin/dashboard/context'],
    ['pricing','/api/admin/workspaces/pricing/market/KM'],
    ['network','/api/market-delegation/markets/KM/network/relais']
   ]){
    const response=await admin.page.request.get(url).catch(()=>null);
    requests[label]=response?.status()||0;
   }
   report.network_ui_diagnostic={path:new URL(admin.page.url()).pathname,ui,requests};
   save();
   throw Error('G6_RELAY_NETWORK_SCREEN_UNAVAILABLE_'+
    [ui.class_name,requests.context,requests.pricing,requests.network].join('_'));
  }
  const card=admin.page.locator('.kmc-team-member').filter({has:admin.page.locator('strong',{hasText:relay[0].name})});
  check(await card.count()===1,'G6_RELAY_ASSIGNMENT_CARD_NOT_UNIQUE');
  const select=card.locator('select[data-agent-select]');
  await select.waitFor({state:'visible',timeout:20000});
  check(await select.locator('option').evaluateAll((xs,id)=>xs.some(x=>x.value===id),agentId),
   'G6_RELAY_ASSIGNMENT_ACTOR_NOT_ELIGIBLE');
  await humanSelect(null,select,agentId);
  await admin.page.route(url,handler);
  try{
   const pending=admin.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:30000});
   await humanClick(null,card.getByRole('button',{name:'Rattacher',exact:true}));
   const response=await pending;
   check(response.status()===200&&count===1&&admin.blocked.length===0,
    'G6_RELAY_ASSIGNMENT_UI_HTTP_'+response.status());
  }finally{await admin.page.unroute(url,handler)}
  const {rows:after}=await db.query('SELECT relais_id FROM users WHERE id=$1',[agentId]);
  check(after.length===1&&after[0].relais_id===orderRelay,'G6_RELAY_ASSIGNMENT_PG_INVALID');
  await runtime();
  report.assignment={via:'Chromium_UI',role:'admin',changed:true,
   old_relais_id:staff[0].relais_id,new_relais_id:orderRelay,http:200};
  save();
 }finally{await admin.ctx.close()}
}

async function main(){
 let browser,actor;
 try{
  save();
  check(env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&
   env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&
   env.STAGING_BASE_URL===BASE&&env.G6_CANONICAL_PHASE==='RELAY_RECEIPT'&&(env.G6_CANONICAL_RESUME_RUN_ID==='44260374187'||env.G6_DYNAMIC_FRESH_ORDER==='1')&&
   env.G6_CANONICAL_ORDER_ID===ORDER&&env.G6_CANONICAL_SCENARIO==='M01'&&env.G6_TARGET_MARKET==='KM',
   'G6_RELAY_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_RELAY_DB_FINGERPRINT_INVALID');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  const prior=JSON.parse(fs.readFileSync((env.G6_DYNAMIC_FRESH_ORDER==='1'?'test-results/g6-canonical-customs/report.json':'test-results/g6-canonical-resume/g6-canonical-customs/report.json'),'utf8'));
  const before=await state();report.before=before;save();
  check(before.base.order.length===1&&before.base.order[0].id===ORDER&&before.base.parcelItems.length===1&&
    before.base.parcelEvents.length===1&&before.base.parcelEvents[0].event_type==='shipped'&&
    isDeepStrictEqual(before.base,prior.after.base)&&before.base.shipments[0].stage==='local_delivery'&&
    before.base.parcels[0].id===PARCEL&&before.base.parcels[0].status==='shipped'&&
    before.orders[0].id===ORDER&&before.orders[0].reference===(env.G6_CANONICAL_ORDER_REFERENCE||'KL1WGP6')&&before.orders[0].payment_status==='paid'&&
    before.receipts.length===0&&Number(before.items[0].qty_received)===0&&Number(before.items[0].qty_collected)===0&&
    Number(before.items[0].qty_shipped)===1,'G6_RELAY_PRECONDITION_INVALID');
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  actor=await login(browser,'E2E_AGENT_RELAIS_','agent_relais');
  const me=await actor.page.request.get('/api/auth/me');
  check(me.ok(),'G6_RELAY_SESSION_MISSING');
  const profile=await me.json();
  // /api/auth/me intentionally exposes a public profile without staff relais_id.
  // Verify staff assignment independently via read-only PostgreSQL, never by editing it.
  const {rows:staff}=await db.query('SELECT id, role, relais_id FROM users WHERE id=$1',[profile.id]);
  check(staff.length===1&&staff[0].role==='agent_relais','G6_RELAY_ACTOR_ROLE_INVALID');
  if(staff[0].relais_id!==before.orders[0].relais_id)
   await attachDedicatedRelayByUI(browser,profile.id,before.orders[0].relais_id);
  const {rows:bound}=await db.query('SELECT relais_id FROM users WHERE id=$1',[profile.id]);
  check(bound.length===1&&bound[0].relais_id===before.orders[0].relais_id,
    'G6_RELAY_ACTOR_NOT_ORDER_RELAY');
  // The role-based login may redirect to this canonical page concurrently.
  // Require the actual shipment card after navigation; do not bypass UI.
  const card=await openRelayLive(actor.page,{
   selector:'[data-relay-shipment="'+REF+'"]',timeout:25000
  });
  check(await card.getAttribute('data-relay-receivable')==='true','G6_RELAY_UI_NOT_RECEIVABLE');
  if(!await card.evaluate(el=>el.open))await humanClick(null,card.locator('summary').first());
  const field=card.locator('input[data-relay-received]');
  check(await field.count()===1&&await field.getAttribute('data-relay-received')===ITEM,'G6_RELAY_UI_ITEM_NOT_UNIQUE');
  await humanFill(null,field,'1');
  await humanFill(null,card.locator('input[data-relay-proof]'),PROOF);
  const expected={proof_ref:PROOF,lines:[{order_item_id:ITEM,received_qty:1}]};
  let count=0;const url=BASE+RECEIPT_PATH;
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
   await humanClick(null,button);const response=await pending;
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
 }catch(e){report.error=fullError(e);try{if(report.db_fingerprint)report.failure_readback=await state()}catch(_){};save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
