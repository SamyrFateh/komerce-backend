#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-canonical-shipment-handover-chromium
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Open and hand over the exact packed M01 KOM-BOX via guarded Chromium, simulated staging only.
 * @impact-areas hub, logistics, staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {login}=require('./g6-hub-commitment-chromium');
const env=process.env;
const OUT=path.resolve('test-results/g6-hub-shipment');
const ORDER=env.G6_CANONICAL_ORDER_ID,PO=env.G6_CANONICAL_PO_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const BAG=env.G6_CANONICAL_BAG_ID,BAGREF=env.G6_CANONICAL_BAG_REF,PARCEL=env.G6_CANONICAL_PARCEL_ID;
const ALLOCATION=env.G6_CANONICAL_ALLOCATION_ID;
const BOXREF='KOM-BOX-SIM-STAGING-KL1WGP6';
const BOX=env.G6_CANONICAL_BOX_ID;
const SHIPMENT='SIM-STAGING-EXP-KL1WGP6';
const HANDOVER_PROOF='[SIMULATED / STAGING ONLY] G6-M01-REMISE-TRANSITAIRE-KL1WGP6';
const FORWARDER='SIMULATED-STAGING-TRANSITAIRE-KL1WGP6';
const PROOF='[SIMULATED / STAGING ONLY] G6-M01-KOM-BOX-KL1WGP6';
const API='/api/admin/workspaces/operations/market/KM';
const report={schema:'komerce-g6-hub-shipment/1',reference:REF,order_id:ORDER,po_id:PO,bag_id:BAG,bag_ref:BAGREF,
 parcel_id:PARCEL,allocation_id:ALLOCATION,box_ref:BOXREF,box_id:BOX,shipment_ref:SHIPMENT,scenario_id:'M01',market:'KM',
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',events:[],external_supplier_calls:0,external_payment_executed:false};
function save(){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');}
function check(ok,code){if(!ok)throw Error(code);}
async function runtime(){
 const r=await fetch(env.STAGING_BASE_URL+'/health/version',{redirect:'error'});
 check(r.status===200,'G6_BOX_HEALTH_HTTP_'+r.status);
 const sha=(await r.json()).commit;
 check(sha===env.E2E_EXPECTED_DEPLOY_SHA&&/^[a-f0-9]{40}$/.test(sha),'G6_BOX_RUNTIME_SHA_DRIFT');
 return sha;
}
async function readback(){
 const order=(await db.query(
  "SELECT o.id,o.reference,o.simulation_scope,o.payment_status::text payment_status,po.status::text po_status,"
  +"po.sent_note,(SELECT COUNT(*)::int FROM purchase_order_authorizations x WHERE x.purchase_order_id=po.id AND x.authorization_type='supplier_payment') payment_authorizations "
  +"FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN purchase_lines pl ON pl.order_item_id=oi.id "
  +"JOIN purchase_orders po ON po.id=pl.purchase_order_id WHERE o.id=$1 AND po.id=$2 AND pl.cancelled_at IS NULL",[ORDER,PO])).rows;
 const bag=(await db.query("SELECT id,reference,order_id,state::text state,unit_type::text unit_type,bag_plan FROM hub_physical_units WHERE order_id=$1 AND unit_type='HANDLING_UNIT'",[ORDER])).rows;
 const placement=(await db.query(
  "SELECT p.id placement_id,p.allocation_id,p.physical_unit_id,p.quantity,p.operation_type,p.evidence_method,p.evidence_ref,p.created_by "
  +"FROM hub_physical_unit_placements p JOIN hub_purchase_allocations a ON a.id=p.allocation_id "
  +"WHERE a.order_id=$1 AND p.removed_at IS NULL",[ORDER])).rows;
 const parcels=(await db.query(
  "SELECT DISTINCT p.id,p.reference,p.status::text status FROM parcels p JOIN parcel_items pi ON pi.parcel_id=p.id JOIN order_items oi ON oi.id=pi.order_item_id "
  +"WHERE p.order_id=$1 AND oi.order_id=$1 AND oi.fulfillment_source='IMPORT' AND p.status<>'cancelled' ORDER BY p.id",[ORDER])).rows;
 const box=(await db.query('SELECT id,reference,state::text state,unit_type::text unit_type,market_id,order_id FROM hub_physical_units WHERE reference=$1',[BOXREF])).rows;
 const links=(await db.query(
  'SELECT l.bag_unit_id,l.box_unit_id,l.parcel_id,l.linked_by,l.evidence_method,l.evidence_ref,l.bag_reference_scan,l.box_reference_scan '
  +'FROM hub_box_bags l JOIN hub_physical_units u ON u.id=l.bag_unit_id JOIN hub_physical_units b ON b.id=l.box_unit_id '
  +'WHERE u.order_id=$1 OR b.reference=$2',[ORDER,BOXREF])).rows;
 const effective=(await db.query(
  'SELECT p.placement_id,p.box_unit_id,p.bag_unit_id,p.allocation_id,p.quantity FROM hub_box_effective_placements p '
  +'JOIN hub_physical_units b ON b.id=p.box_unit_id WHERE b.reference=$1',[BOXREF])).rows;
 const custody=(await db.query(
  'SELECT e.event_type,e.from_state,e.to_state,e.actor_id,e.details FROM hub_custody_events e '
  +'JOIN hub_physical_units b ON b.id=e.physical_unit_id WHERE b.reference=$1 ORDER BY e.created_at,e.id',[BOXREF])).rows;
 const shipments=(await db.query(
  'SELECT s.id,s.reference,s.stage,s.hub_draft,s.forwarder_name,s.transport_mode,s.market_id FROM international_shipments s WHERE s.reference=$1 OR EXISTS (SELECT 1 FROM international_shipment_hub_units h WHERE h.shipment_id=s.id AND h.physical_unit_id=$2)',[SHIPMENT,BOX])).rows;
 const shipmentLinks=(await db.query(
  'SELECT h.shipment_id,h.physical_unit_id,u.reference FROM international_shipment_hub_units h JOIN hub_physical_units u ON u.id=h.physical_unit_id JOIN international_shipments s ON s.id=h.shipment_id WHERE s.reference=$1 OR h.physical_unit_id=$2',[SHIPMENT,BOX])).rows;
 const shipmentEvents=(await db.query(
  'SELECT e.event_type,e.from_stage,e.to_stage,e.proof_ref,e.actor_id,e.payload FROM international_shipment_events e JOIN international_shipments s ON s.id=e.shipment_id WHERE s.reference=$1 ORDER BY e.occurred_at,e.id',[SHIPMENT])).rows;
 const parcelItems=(await db.query('SELECT id,order_item_id,quantity,qty_shipped FROM parcel_items WHERE parcel_id=$1 ORDER BY id',[PARCEL])).rows;
 const parcelEvents=(await db.query("SELECT event_type,actor_id,metadata FROM parcel_events WHERE parcel_id=$1 AND event_type='shipped' ORDER BY id",[PARCEL])).rows;
 return {order,bag,placement,parcels,box,links,effective,custody,shipments,shipmentLinks,shipmentEvents,parcelItems,parcelEvents};
}
function checkBase(s){
 check(s.order.length===1&&s.order[0].id===ORDER&&s.order[0].reference===REF&&
  s.order[0].simulation_scope==='G6-BUYER'&&s.order[0].payment_status==='paid'&&
  s.order[0].po_status==='hub_received'&&s.order[0].sent_note?.startsWith('[SIMULATED / STAGING ONLY]')&&
  Number(s.order[0].payment_authorizations)===0,'G6_BOX_ORDER_SCOPE_INVALID');
 check(s.bag.length===1&&s.bag[0].id===BAG&&s.bag[0].reference===BAGREF&&s.bag[0].state==='PACKED'&&
  s.placement.length===1&&s.placement[0].physical_unit_id===BAG&&s.placement[0].allocation_id===ALLOCATION&&
  Number(s.placement[0].quantity)===1&&s.placement[0].operation_type==='REPACK'&&
  s.placement[0].evidence_method==='MANUAL'&&
  s.placement[0].evidence_ref==='[SIMULATED / STAGING ONLY] G6-M01-DEPOT-SAC-KL1WGP6',
  'G6_BOX_BAG_PHYSICAL_CONTENT_CHANGED');
 check(s.parcels.length===1&&s.parcels[0].id===PARCEL&&s.parcels[0].reference==='KOM-P-2026-000226',
  'G6_BOX_CLIENT_PARCEL_NOT_UNIQUE');
}
function checkLink(s,boxId,placementId){
 checkBase(s);
 check(s.box.length===1&&s.box[0].id===boxId&&s.box[0].unit_type==='MARKET_PARCEL'&&
  s.links.length===1&&s.links[0].box_unit_id===boxId&&s.links[0].bag_unit_id===BAG&&s.links[0].parcel_id===PARCEL&&
  s.links[0].linked_by&&s.links[0].evidence_method==='MANUAL'&&s.links[0].evidence_ref===PROOF&&
  s.links[0].bag_reference_scan===BAGREF&&s.links[0].box_reference_scan===BOXREF&&
  s.effective.length===1&&s.effective[0].placement_id===placementId&&s.effective[0].bag_unit_id===BAG&&
  s.effective[0].allocation_id===ALLOCATION&&Number(s.effective[0].quantity)===1&&
  s.placement[0].placement_id===placementId,'G6_BOX_LINK_OR_SINGLE_PLACEMENT_INVALID');
}
async function openDetails(page){
 await page.goto('/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});
 const tab=page.getByRole('tab',{name:'Dossiers'});
 await tab.waitFor({state:'visible',timeout:25000});await tab.click();
 const details=page.locator('[data-hub-physical-details]');
 await details.waitFor({state:'attached',timeout:25000});
 if(!await details.evaluate(x=>x.open))await details.locator('summary').first().click();
 const section=page.locator('[data-supply-boxes]');
 await section.waitFor({state:'visible',timeout:25000});
 return section;
}
function boxRow(section,page){return section.locator('tr').filter({has:page.getByText(BOXREF,{exact:true})});}
async function gesture(actor,key,endpoint,button,validatePayload){
 let count=0;
 const url=env.STAGING_BASE_URL+endpoint;
 const handler=async route=>{
  const req=route.request();
  if(req.method()!=='POST')return route.fallback();
  let b;try{b=req.postDataJSON();}catch(_){b=null;}
  if(count===0&&validatePayload(b,req)){
   count++;return route.continue();
  }
  actor.blocked.push({method:req.method(),path:new URL(req.url()).pathname});
  return route.abort('blockedbyclient');
 };
 await runtime();
 await actor.page.route(url,handler);
 try{
  await button.waitFor({state:'visible',timeout:20000});
  check(await button.isEnabled(),'G6_BOX_UI_DISABLED_'+key);
  const pending=actor.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:30000});
  await button.click({timeout:15000});
  const response=await pending;
  const b=await response.json().catch(()=>({}));
  report.events.push({key,http:response.status(),code:b.code||null,unit_id:b.physical_unit?.id||b.unit?.id||null});
  save();await actor.page.screenshot({path:path.join(OUT,key+'.png')});
  check(count===1&&response.status()>=200&&response.status()<300,'G6_BOX_HTTP_'+key+'_'+response.status()+'_'+(b.code||''));
  check(actor.blocked.length===0,'G6_BOX_UNEXPECTED_UI_WRITE');
  return b;
 }finally{await actor.page.unroute(url,handler);}
}
function checkShipment(s,shipmentId,stage){
 checkLink(s,BOX,s.placement[0].placement_id);
 check(s.shipments.length===1&&s.shipments[0].id===shipmentId&&s.shipments[0].reference===SHIPMENT&&
  s.shipments[0].stage===stage&&s.shipments[0].market_id===s.box[0].market_id&&
  s.shipmentLinks.length===1&&s.shipmentLinks[0].shipment_id===shipmentId&&
  s.shipmentLinks[0].physical_unit_id===BOX,'G6_SHIPMENT_LINEAGE_INVALID');
}
async function openTransport(page){
 await page.goto('/admin/workspaces/shipping-customs?market=KM',{waitUntil:'domcontentloaded'});
 await page.locator('[data-international-journey]').first().waitFor({state:'visible',timeout:25000});
 const tab=page.locator('.kmc-journey-tab').filter({hasText:'Transport & fret'});
 await tab.click();
 const row=page.locator('tr').filter({has:page.getByText(SHIPMENT,{exact:true})});
 await row.waitFor({state:'visible',timeout:25000});
 const open=row.getByRole('button',{name:'Consulter',exact:true});
 if(await open.count())await open.click();
 const task=page.locator('details.kmc-journey-task').filter({has:page.locator('summary',{hasText:'Confirmer : Remis au transitaire'})});
 await task.waitFor({state:'visible',timeout:25000});
 // The primary handover action is visible by default in the product.
 // Do not toggle the disclosure closed or force a hidden control.
 await task.locator('button[type="submit"]').waitFor({state:'visible',timeout:25000});
 return task;
}
async function main(){
 let browser;
 try{
  save();
  check(env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&
   env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.NODE_ENV==='test'&&
   env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&
   env.STAGING_BASE_URL==='https://komerce-backend-production.up.railway.app'&&
   env.G6_CANONICAL_PHASE==='HUB_SHIPMENT'&&env.G6_CANONICAL_SCENARIO==='M01'&&env.G6_TARGET_MARKET==='KM'&&
   REF==='KL1WGP6'&&ORDER==='56adad65-d1fa-4e80-8d69-c25e0fe92a76'&&PO==='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3'&&
   BAG==='bcf810c9-33b2-438a-b4c3-857b024e2247'&&BAGREF==='KOM-ITEM-178D0AEA488AA4B5B9'&&
   PARCEL==='95045ede-d5b8-405b-b65f-d9dbdddb4756'&&ALLOCATION==='3b430dcf-8662-44b4-a29f-27e38df19253'&&
   BOX==='6ca614e5-869c-40ab-80d7-3684974092fe'&&!!env.DATABASE_URL,'G6_SHIPMENT_OWNER_STAGING_GUARD');
  const target=await confirmTarget({db,env});
  check(target.confirmed&&target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_SHIPMENT_DB_MISMATCH');
  report.db_fingerprint=target.fingerprint;report.sha=await runtime();
  const before=await readback();checkLink(before,BOX,before.placement[0]?.placement_id);
  report.before=before;save();
  const partialId=env.G6_CANONICAL_PARTIAL_SHIPMENT_ID;
  const partialPath=env.G6_CANONICAL_PARTIAL_SHIPMENT_REPORT;
  let shipmentId;
  if(partialId||partialPath){
   check(partialId==='ff8591fc-78bb-49a4-b154-247508368d16'&&env.G6_CANONICAL_RESUME_RUN_ID==='44203777890'&&
    partialPath===path.resolve('test-results/g6-canonical-resume/g6-hub-shipment/report.json'),'G6_SHIPMENT_PARTIAL_BINDING_INVALID');
   const prior=JSON.parse(fs.readFileSync(partialPath,'utf8'));
   check(require('node:util').isDeepStrictEqual(before,prior.failure_readback)&&
    require('node:util').isDeepStrictEqual(before,prior.after_dispatch),'G6_SHIPMENT_PARTIAL_LIVE_DRIFT');
   checkShipment(before,partialId,'hub_ready');
   check(before.box[0].state==='DISPATCHED'&&before.shipments[0].hub_draft===true&&
    before.shipments[0].forwarder_name===null&&before.shipments[0].transport_mode===null&&
    before.parcels[0].status==='preparation'&&before.parcelItems.length===1&&
    Number(before.parcelItems[0].qty_shipped)===0&&Number(before.parcelItems[0].quantity)===1&&
    before.parcelEvents.length===0&&before.shipmentEvents.length===1&&before.shipmentEvents[0].event_type==='opened'&&
    prior.events?.length===2&&prior.events[0].key==='open-shipment'&&prior.events[0].http===201&&
    prior.events[1].key==='dispatch-box'&&prior.events[1].http===200,'G6_SHIPMENT_PARTIAL_NOT_READY');
   shipmentId=partialId;report.shipment_id=shipmentId;report.resumed_from_run_id='44203777890';
   report.events=prior.events.map(e=>({...e,source_run_id:'44203777890'}));
   report.after_open=prior.after_open;report.after_dispatch=prior.after_dispatch;save();
  }else check(before.box[0].state==='PACKED'&&before.shipments.length===0&&before.shipmentLinks.length===0&&
    before.parcels[0].status==='preparation'&&before.parcelItems.length===1&&
    Number(before.parcelItems[0].quantity)===1&&Number(before.parcelItems[0].qty_shipped)===0&&
    before.parcelEvents.length===0,'G6_SHIPMENT_ALREADY_STARTED_OR_INVALID');
  const placementId=before.placement[0].placement_id;
  browser=await chromium.launch({headless:true});
  const actor=await login(browser,'E2E_AGENT_HUB_',{readOnly:true});
  try{
   if(!partialId){
   let section=await openDetails(actor.page);
   let row=boxRow(section,actor.page);
   await row.waitFor({state:'visible',timeout:25000});
   await section.getByRole('textbox',{name:'Référence de la nouvelle expédition'}).fill(SHIPMENT);
   await row.getByRole('checkbox',{name:'Inclure '+BOXREF}).check();
   await gesture(actor,'open-shipment',API+'/boxes/shipment',section.locator('[data-workspace-action="create-shipment-from-boxes"]'),
    b=>b?.reference===SHIPMENT&&b.hub_unit_ids?.length===1&&b.hub_unit_ids[0]===BOX&&Object.keys(b).length===2);
   const opened=await readback();report.after_open=opened;save();
   check(opened.shipments.length===1,'G6_SHIPMENT_NOT_CREATED');
   shipmentId=opened.shipments[0].id;
   report.shipment_id=shipmentId;save();
   checkShipment(opened,shipmentId,'hub_ready');
   check(opened.box[0].state==='PACKED'&&opened.shipments[0].hub_draft===true&&
    opened.parcels[0].status==='preparation'&&Number(opened.parcelItems[0].qty_shipped)===0&&
    opened.shipmentEvents.length===1&&opened.shipmentEvents[0].event_type==='opened'&&
    opened.shipmentEvents[0].proof_ref===null&&opened.shipmentEvents[0].actor_id,'G6_SHIPMENT_OPEN_PG_INVALID');
   section=await openDetails(actor.page);row=boxRow(section,actor.page);
   await row.waitFor({state:'visible',timeout:25000});
   await gesture(actor,'dispatch-box',API+'/boxes/'+BOX+'/advance',row.locator('[data-workspace-action="advance-box"]'),
    b=>b?.to_state==='DISPATCHED'&&Object.keys(b).length===1);
   const dispatched=await readback();report.after_dispatch=dispatched;save();
   checkShipment(dispatched,shipmentId,'hub_ready');
   check(dispatched.box[0].state==='DISPATCHED'&&dispatched.parcels[0].status==='preparation'&&
    dispatched.placement[0].placement_id===placementId&&dispatched.custody.some(e=>e.event_type==='STATE_TRANSITION'&&
      e.from_state==='PACKED'&&e.to_state==='DISPATCHED'&&e.actor_id),'G6_SHIPMENT_DISPATCH_PG_INVALID');
   }
   const task=await openTransport(actor.page);
   await task.locator('[name="forwarder_name"]').fill(FORWARDER);
   await task.locator('[name="transport_mode"]').selectOption('sea');
   await task.locator('[name="proof_ref"]').fill(HANDOVER_PROOF);
   await gesture(actor,'handover-forwarder','/api/admin/workspaces/shipping-customs/market/KM/international/'+SHIPMENT+'/transition',
    task.locator('button[type="submit"]'),b=>b?.to_stage==='handed_over'&&b.forwarder_name===FORWARDER&&
      b.transport_mode==='sea'&&b.proof_ref===HANDOVER_PROOF&&Object.keys(b).length===4);
   const after=await readback();report.after=after;save();checkShipment(after,shipmentId,'handed_over');
   check(after.box[0].state==='DISPATCHED'&&after.placement[0].placement_id===placementId&&
    after.shipments[0].forwarder_name===FORWARDER&&after.shipments[0].transport_mode==='sea'&&
    after.parcels[0].status==='shipped'&&after.parcelItems.length===1&&Number(after.parcelItems[0].qty_shipped)===1&&
    after.shipmentEvents.length===2&&after.shipmentEvents.some(e=>e.event_type==='stage_changed'&&
    e.from_stage==='hub_ready'&&e.to_stage==='handed_over'&&e.proof_ref===HANDOVER_PROOF&&e.actor_id)&&
    after.parcelEvents.length===1&&after.parcelEvents[0].actor_id&&
    after.parcelEvents[0].metadata?.shipment_id===shipmentId&&after.parcelEvents[0].metadata?.proof_ref===HANDOVER_PROOF,
    'G6_SHIPMENT_HANDOVER_PG_INVALID');
   await runtime();report.next_stage='FORWARDER_RECEIPT';report.verdict='G6_HUB_SHIPMENT_SIMULATED_CHROMIUM_PG_PASS_HANDED_OVER';save();
  }finally{await actor.ctx.close();}
 }catch(e){report.error=String(e.message||e).slice(0,1500);report.verdict='BLOCKED';
  try{if(report.db_fingerprint)report.failure_readback=await readback();}catch(_){}
  save();process.exitCode=2;
 }finally{if(browser)await browser.close().catch(()=>{});await db.pool.end().catch(()=>{});console.log(JSON.stringify(report));}
}
if(require.main===module)main();
