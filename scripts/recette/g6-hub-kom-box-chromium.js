#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-canonical-kom-box-chromium
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Compose and prepare a dedicated KOM-BOX from the exact sealed M01 bag, without repacking its content.
 * @impact-areas hub, logistics, staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {login}=require('./g6-hub-commitment-chromium');
const env=process.env;
const OUT=path.resolve('test-results/g6-hub-kom-box');
const ORDER=env.G6_CANONICAL_ORDER_ID,PO=env.G6_CANONICAL_PO_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const BAG=env.G6_CANONICAL_BAG_ID,BAGREF=env.G6_CANONICAL_BAG_REF,PARCEL=env.G6_CANONICAL_PARCEL_ID;
const ALLOCATION=env.G6_CANONICAL_ALLOCATION_ID;
const BOXREF='KOM-BOX-SIM-STAGING-KL1WGP6';
const PROOF='[SIMULATED / STAGING ONLY] G6-M01-KOM-BOX-KL1WGP6';
const API='/api/admin/workspaces/operations/market/KM';
const report={schema:'komerce-g6-kom-box/1',reference:REF,order_id:ORDER,po_id:PO,bag_id:BAG,bag_ref:BAGREF,
 parcel_id:PARCEL,allocation_id:ALLOCATION,box_ref:BOXREF,scenario_id:'M01',market:'KM',
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
 return {order,bag,placement,parcels,box,links,effective,custody};
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
async function main(){
 let browser;
 try{
  save();
  check(env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&
   env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.NODE_ENV==='test'&&
   env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&
   env.STAGING_BASE_URL==='https://komerce-backend-production.up.railway.app'&&
   env.G6_CANONICAL_PHASE==='HUB_KOM_BOX'&&env.G6_CANONICAL_SCENARIO==='M01'&&env.G6_TARGET_MARKET==='KM'&&
   REF==='KL1WGP6'&&ORDER==='56adad65-d1fa-4e80-8d69-c25e0fe92a76'&&PO==='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3'&&
   BAG==='bcf810c9-33b2-438a-b4c3-857b024e2247'&&BAGREF==='KOM-ITEM-178D0AEA488AA4B5B9'&&
   PARCEL==='95045ede-d5b8-405b-b65f-d9dbdddb4756'&&ALLOCATION==='3b430dcf-8662-44b4-a29f-27e38df19253'&&
   !!env.DATABASE_URL,'G6_BOX_OWNER_STAGING_GUARD');
  const target=await confirmTarget({db,env});
  check(target.confirmed&&target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_BOX_DB_MISMATCH');
  report.db_fingerprint=target.fingerprint;report.sha=await runtime();
  const before=await readback();checkBase(before);report.before=before;save();
  check(before.box.length===0&&before.links.length===0&&before.effective.length===0,'G6_BOX_ALREADY_STARTED_STOP');
  const placementId=before.placement[0].placement_id;
  browser=await chromium.launch({headless:true});
  const actor=await login(browser,'E2E_AGENT_HUB_',{readOnly:true});
  try{
   let section=await openDetails(actor.page);
   await section.getByRole('textbox',{name:'Référence de la nouvelle KOM-BOX'}).fill(BOXREF);
   await gesture(actor,'create-box',API+'/boxes',section.locator('[data-workspace-action="create-box"]'),
    (b,req)=>b?.reference===BOXREF&&Object.keys(b).length===1&&!!req.headers()['idempotency-key']);
   const created=await readback();checkBase(created);report.after_create=created;save();
   check(created.box.length===1&&created.box[0].unit_type==='MARKET_PARCEL'&&created.box[0].state==='RECEIVED'&&
      created.links.length===0&&created.effective.length===0&&created.placement[0].placement_id===placementId,
      'G6_BOX_CREATED_PG_INVALID');
   const boxId=created.box[0].id;report.box_id=boxId;save();
   section=await openDetails(actor.page);
   let row=boxRow(section,actor.page);await row.waitFor({state:'visible',timeout:25000});
   await row.locator('[data-hub-box-scan]').fill(BOXREF);
   await row.locator('[data-hub-bag-scan]').fill(BAGREF);
   await row.locator('[data-hub-bag-scan]').press('Enter');
   const parcelChoice=row.getByRole('combobox',{name:'Colis client si plusieurs colis pour ce sac'});
   check(!(await parcelChoice.isVisible()),'G6_BOX_UNEXPECTED_PARCEL_AMBIGUITY');
   await row.locator('[data-hub-box-evidence-method]').selectOption('MANUAL');
   await row.locator('[data-hub-box-manual-proof]').fill(PROOF);
   await gesture(actor,'attach-bag',API+'/boxes/'+boxId+'/bags',row.locator('[data-workspace-action="put-bag-in-box"]'),
     b=>b?.bag_unit_id===BAG&&(!b.parcel_id||b.parcel_id===PARCEL)&&b.bag_reference_scan===BAGREF&&
        b.box_reference_scan===BOXREF&&b.evidence_method==='MANUAL'&&b.evidence_ref===PROOF);
   let linked=await readback();report.after_link=linked;save();checkLink(linked,boxId,placementId);
   // Follow the exact UI states in order; verify each state and custody before the next gesture.
   let prior='RECEIVED';
   for(const state of ['IDENTIFIED','QUALITY_CHECKED','LOCATED','ALLOCATED','PICKED','PACKED']){
    section=await openDetails(actor.page);row=boxRow(section,actor.page);
    await row.waitFor({state:'visible',timeout:25000});
    const next=row.locator('[data-workspace-action="advance-box"]');
    check((await next.textContent()).includes(state),'G6_BOX_UNEXPECTED_NEXT_STATE_'+state);
    await gesture(actor,'advance-'+state.toLowerCase(),API+'/boxes/'+boxId+'/advance',next,
      b=>b?.to_state===state&&Object.keys(b).length===1);
    linked=await readback();report.after=linked;save();checkLink(linked,boxId,placementId);
    check(linked.box[0].state===state&&linked.custody.some(e=>e.event_type==='STATE_TRANSITION'&&
      e.from_state===prior&&e.to_state===state&&e.actor_id),'G6_BOX_ADVANCE_PG_INVALID_'+state);
    prior=state;
   }
   await runtime();
   report.next_stage='HUB_SHIPMENT';report.verdict='G6_KOM_BOX_SIMULATED_CHROMIUM_PG_PASS_PACKED';save();
  }finally{await actor.ctx.close();}
 }catch(e){
  report.error=String(e.message||e).slice(0,1500);report.verdict='BLOCKED';
  try{if(report.db_fingerprint)report.failure_readback=await readback();}catch(_){}
  save();process.exitCode=2;
 }finally{if(browser)await browser.close().catch(()=>{});await db.pool.end().catch(()=>{});console.log(JSON.stringify(report));}
}
if(require.main===module)main();
