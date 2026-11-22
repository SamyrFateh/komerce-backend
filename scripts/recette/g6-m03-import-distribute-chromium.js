#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-m03-import-parcel-distribution-chromium
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Perform the real per-order "Répartir" Hub Live gesture after physical receipt; attest one IMPORT parcel with exact order membership before KOM-BOX.
 * @impact-areas staging-only, logistics
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {login}=require('./g6-hub-commitment-chromium');
const {humanGoto,humanClick}=require('./canonical/actors/human-gestures');
const MK=require('./canonical/market-profile').marketProfile(process.env);
const env=process.env;
const ORDER=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const BAG=env.G6_CANONICAL_BAG_ID;
const EXPECTED=Number(env.G6_M03_IMPORT_ITEMS);
const OUT=path.resolve('test-results/g6-m03-parcel-distribution');
const API='/api/admin/workspaces/operations/market/'+MK.code+'/orders/'+encodeURIComponent(REF||'')+'/distribute';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{40}$/;
const report={schema:'komerce-g6-m03-import-distribution/1',scenario_id:'M03',market:MK.code,
 reference:REF,order_id:ORDER,bag_id:BAG,verdict:'BLOCKED',staging_only:true,
 external_supplier_calls:0,external_payment_executed:false,production_permitted:false};
const check=(ok,code)=>{if(!ok)throw Error(code)};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
async function runtime(){
 const r=await fetch(env.STAGING_BASE_URL+'/health/version',{redirect:'error'});
 check(r.status===200,'G6_M03_DISTRIBUTION_HEALTH_HTTP_'+r.status);
 const v=await r.json();
 check(v.commit===env.E2E_EXPECTED_DEPLOY_SHA,'G6_M03_DISTRIBUTION_SHA_DRIFT');
 return v.commit;
}
async function snapshot(){
 const {rows:[order]}=await db.query(
  "SELECT id,reference,status::text AS status,payment_status::text AS payment_status,simulation_scope FROM orders WHERE id=$1",[ORDER]);
 const {rows:items}=await db.query(
  "SELECT oi.id,oi.fulfillment_source::text AS lane,oi.quantity::int AS quantity,"
  +"COALESCE((SELECT SUM(v.received_quantity)::int FROM v_purchase_line_progress v WHERE v.order_item_id=oi.id AND NOT v.cancelled),0) AS physically_received "
  +"FROM order_items oi WHERE oi.order_id=$1 ORDER BY oi.id",[ORDER]);
 const {rows:memberships}=await db.query(
  "SELECT p.id AS parcel_id,p.reference AS parcel_ref,p.order_id AS parcel_order_id,p.status::text AS status,"
  +"pi.order_item_id,pi.quantity::int AS quantity,oi.fulfillment_source::text AS lane "
  +"FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id JOIN order_items oi ON oi.id=pi.order_item_id "
  +"WHERE oi.order_id=$1 AND p.status<>'cancelled' AND p.cancelled_at IS NULL ORDER BY p.id,oi.id",[ORDER]);
 const {rows:[bag]}=await db.query(
  "SELECT id,order_id,state::text AS state,unit_type::text AS unit_type FROM hub_physical_units WHERE id=$1",[BAG]);
 return {order,items,memberships,bag};
}
function attest(s,{after=false}={}){
 check(s.order?.id===ORDER&&s.order?.reference===REF&&s.order?.simulation_scope==='G6-BUYER'&&
  s.order?.payment_status==='paid'&&['ordered','preparation','available'].includes(s.order?.status),
  'G6_M03_DISTRIBUTION_ORDER_SCOPE_INVALID');
 check(s.bag?.id===BAG&&s.bag?.order_id===ORDER&&s.bag?.state==='PACKED'&&s.bag?.unit_type==='HANDLING_UNIT',
  'G6_M03_DISTRIBUTION_BAG_NOT_PHYSICALLY_PACKED');
 const imports=s.items.filter(x=>x.lane==='IMPORT');
 const locals=s.items.filter(x=>x.lane==='LOCAL_STOCK');
 check(imports.length===EXPECTED&&locals.length===1&&s.items.length===EXPECTED+1&&
  imports.every(x=>x.quantity===1&&Number(x.physically_received)===1),
  'G6_M03_DISTRIBUTION_IMPORT_NOT_ALL_PHYSICALLY_RECEIVED');
 const importIds=new Set(imports.map(x=>x.id));
 const members=s.memberships.filter(x=>x.lane==='IMPORT');
 if(!after){
  check(members.length===0,'G6_M03_DISTRIBUTION_IMPORT_ALREADY_PARCELIZED_NO_REPLAY');
  return null;
 }
 check(members.length===EXPECTED&&members.every(x=>importIds.has(x.order_item_id)&&x.quantity===1)&&
  new Set(members.map(x=>x.order_item_id)).size===EXPECTED&&
  new Set(members.map(x=>x.parcel_id)).size===1&&
  members.every(x=>x.parcel_order_id===ORDER&&x.status==='preparation'),
  'G6_M03_DISTRIBUTION_PG_IMPORT_MEMBERSHIP_INVALID');
 const parcelId=members[0].parcel_id;
 check(s.memberships.filter(x=>x.parcel_id===parcelId).every(x=>x.lane==='IMPORT')&&
  UUID.test(String(parcelId))&&/^[A-Z0-9][A-Z0-9-]{5,63}$/.test(String(members[0].parcel_ref||'')),
  'G6_M03_DISTRIBUTION_PG_LOCAL_IMPORT_MIX_OR_REFERENCE_INVALID');
 return {parcel_id:parcelId,parcel_ref:members[0].parcel_ref,import_order_item_ids:[...importIds].sort()};
}
async function main(){
 let browser,actor;
 try{
  save();
  check(env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&
   env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.NODE_ENV==='test'&&
   env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&
   env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.G6_CANONICAL_SCENARIO==='M03'&&
   env.G6_CANONICAL_PHASE==='HUB_KOM_BOX'&&env.G6_DYNAMIC_FRESH_ORDER==='1'&&
   env.STAGING_BASE_URL==='https://komerce-backend-production.up.railway.app'&&
   env.G6_TARGET_MARKET===MK.code&&UUID.test(String(ORDER))&&UUID.test(String(BAG))&&
   SHA.test(String(env.E2E_EXPECTED_DEPLOY_SHA))&&
   /^[A-Z0-9-]{6,64}$/.test(String(REF))&&EXPECTED===3&&!!env.DATABASE_URL,
   'G6_M03_DISTRIBUTION_OWNER_STAGING_GUARD');
  const target=await confirmTarget({db,env});
  check(target.confirmed&&target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,
    'G6_M03_DISTRIBUTION_DATABASE_DRIFT');
  report.db_fingerprint=target.fingerprint;
  report.sha=await runtime();
  const before=await snapshot();
  attest(before);
  report.before={order_status:before.order.status,bag_state:before.bag.state,
    imported_items:before.items.filter(x=>x.lane==='IMPORT').length,
    imported_parcels:0};
  save();
  browser=await chromium.launch({headless:true});
  actor=await login(browser,'E2E_AGENT_HUB_',{readOnly:true});
  await humanGoto(actor.page,'/admin/hub-live?view=execute&market='+MK.code,{waitUntil:'domcontentloaded'});
  const tab=actor.page.locator('[data-workspace-view="hub"]');
  await tab.waitFor({state:'visible',timeout:25000});
  await humanClick(null,tab);
  const row=actor.page.locator('tbody tr').filter({has:actor.page.getByText(REF,{exact:true})});
  const button=row.locator('[data-workspace-action="distribute-order"]');
  await button.waitFor({state:'visible',timeout:25000});
  check(await button.isEnabled(),'G6_M03_DISTRIBUTION_BUTTON_DISABLED');
  const endpoint=env.STAGING_BASE_URL+API;
  let forwarded=0;
  const handler=async route=>{
   if(route.request().method()!=='POST')return route.fallback();
   if(forwarded++===0)return route.continue();
   actor.blocked.push({method:'POST',path:API});
   return route.abort('blockedbyclient');
  };
  await runtime();
  await actor.page.route(endpoint,handler);
  let status,payload;
  try{
   const pending=actor.page.waitForResponse(r=>r.url()===endpoint&&r.request().method()==='POST',{timeout:45000});
   await humanClick(null,button);
   const response=await pending;
   status=response.status();payload=await response.json().catch(()=>null);
  }finally{await actor.page.unroute(endpoint,handler);}
  report.gesture={action:'Répartir',route:API,http:status,result:payload?.result||null};
  save();
  check(forwarded===1&&status===200&&payload?.ok===true&&
    payload?.action==='distribute_order'&&payload?.result?.success===true&&
    payload?.result?.already_assigned===false&&payload?.result?.queued===false&&
    payload?.result?.nothing_eligible===false&&
    !!payload?.result?.parcel_ref&&actor.blocked.length===0,
    'G6_M03_DISTRIBUTION_UI_RESULT_INVALID');
  const after=await snapshot();
  const proof=attest(after,{after:true});
  check(proof.parcel_ref===payload.result.parcel_ref,'G6_M03_DISTRIBUTION_UI_PG_PARCEL_MISMATCH');
  check(await runtime()===report.sha,'G6_M03_DISTRIBUTION_POST_COMMIT_SHA_DRIFT');
  report.parcel_id=proof.parcel_id;report.parcel_ref=proof.parcel_ref;
  report.import_order_item_ids=proof.import_order_item_ids;
  report.verdict='G6_M03_IMPORT_PARCEL_DISTRIBUTION_CHROMIUM_PG_PASS';
  save();
 }catch(e){
  report.verdict='BLOCKED';report.error=String(e?.stack||e);
  try{if(actor)await actor.page.screenshot({path:path.join(OUT,'blocked.png'),fullPage:true});}catch(_){}
  save();process.exitCode=2;
 }finally{
  if(actor)await actor.ctx.close().catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  await db.pool.end().catch(()=>{});
  console.log(JSON.stringify({verdict:report.verdict,error:report.error||null,parcel_id:report.parcel_id||null}));
 }
}
if(require.main===module)main();
module.exports={attest};
