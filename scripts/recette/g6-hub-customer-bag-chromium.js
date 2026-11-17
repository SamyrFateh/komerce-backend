#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-canonical-customer-bag-chromium
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Prepare and seal the exact previously received M01 order's bag via genuine Hub UI, one write at a time.
 * @impact-areas hub, staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {login}=require('./g6-hub-commitment-chromium');
const env=process.env,ROOT=path.resolve(__dirname,'../..');
const OUT=path.join(ROOT,'test-results/g6-hub-customer-bag');
const ORDER=env.G6_CANONICAL_ORDER_ID,PO=env.G6_CANONICAL_PO_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const SOURCE=env.G6_CANONICAL_RECEIPT_REFERENCE;
const API='/api/admin/workspaces/operations/market/KM';
const PROOF='[SIMULATED / STAGING ONLY] G6-M01-DEPOT-SAC-KL1WGP6';
const report={schema:'komerce-g6-hub-customer-bag/1',scenario_id:'M01',market:'KM',
  reference:REF,order_id:ORDER,po_id:PO,source_ref:SOURCE,verdict:'BLOCKED',
  provenance:'SIMULATED / STAGING ONLY',events:[],external_supplier_calls:0,external_payment_executed:false};
function save(){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');}
function check(ok,code){if(!ok)throw Error(code);}
async function runtime(){
 const r=await fetch(env.STAGING_BASE_URL+'/health/version',{redirect:'error'});
 check(r.status===200,'G6_BAG_HEALTH_HTTP_'+r.status);
 const sha=(await r.json()).commit;
 check(sha===env.E2E_EXPECTED_DEPLOY_SHA&&/^[a-f0-9]{40}$/.test(sha),'G6_BAG_RUNTIME_SHA_DRIFT');
 return sha;
}
async function snapshot(){
 const orders=(await db.query(
  'SELECT o.id,o.reference,o.simulation_scope,o.payment_status::text payment_status,po.status::text po_status,'
  +'po.sent_note,a.id allocation_id,a.order_item_id,a.purchase_line_id,a.quantity,'
  +"(SELECT COUNT(*)::int FROM purchase_order_authorizations x WHERE x.purchase_order_id=po.id AND x.authorization_type='supplier_payment') payment_authorizations "
  +'FROM hub_purchase_allocations a JOIN orders o ON o.id=a.order_id JOIN purchase_orders po ON po.id=a.purchase_order_id '
  +'WHERE a.order_id=$1 AND a.purchase_order_id=$2',[ORDER,PO])).rows;
 check(orders.length===1,'G6_BAG_ALLOCATION_NOT_UNIQUE');
 const order=orders[0];
 const units=(await db.query(
  'SELECT u.id,u.reference,u.unit_type::text unit_type,u.state::text state,p.quantity,p.operation_type::text operation_type,'
  +'p.evidence_method::text evidence_method,p.evidence_ref,p.removed_at IS NULL AS active '
  +'FROM hub_physical_unit_placements p JOIN hub_physical_units u ON u.id=p.physical_unit_id '
  +'WHERE p.allocation_id=$1 ORDER BY p.created_at',[order.allocation_id])).rows;
 const bags=(await db.query(
  "SELECT id,reference,state::text state,bag_plan FROM hub_physical_units WHERE order_id=$1 AND unit_type='HANDLING_UNIT' ORDER BY created_at",[ORDER])).rows;
 const links=(await db.query('SELECT l.bag_unit_id,l.box_unit_id,l.parcel_id FROM hub_box_bags l JOIN hub_physical_units u ON u.id=l.bag_unit_id WHERE u.order_id=$1',[ORDER])).rows;
 const parcels=(await db.query(
  "SELECT DISTINCT p.id,p.reference,p.status::text status FROM parcels p JOIN parcel_items pi ON pi.parcel_id=p.id JOIN order_items oi ON oi.id=pi.order_item_id "
  +"WHERE p.order_id=$1 AND oi.order_id=$1 AND oi.fulfillment_source='IMPORT' AND p.status<>'cancelled' ORDER BY p.id",[ORDER])).rows;
 return {order,units,bags,links,parcels};
}
function validateBase(s){
 const o=s.order;
 check(o.id===ORDER&&o.reference===REF&&o.simulation_scope==='G6-BUYER'&&o.payment_status==='paid'&&
   o.po_status==='hub_received'&&o.sent_note?.startsWith('[SIMULATED / STAGING ONLY]')&&
   Number(o.quantity)===1&&Number(o.payment_authorizations)===0,'G6_BAG_ORDER_SCOPE_DRIFT');
 const receipt=s.units.filter(u=>u.reference===SOURCE&&u.operation_type==='RECEIVE'&&
   u.unit_type==='SUPPLIER_PACKAGE'&&Number(u.quantity)===1&&u.evidence_method==='MANUAL'&&
   u.evidence_ref==='[SIMULATED / STAGING ONLY] G6-M01-RECEPTION-KL1WGP6');
 check(receipt.length===1&&s.units.filter(u=>u.active).reduce((n,u)=>n+Number(u.quantity),0)===1&&
   s.links.length===0,'G6_BAG_PHYSICAL_SCOPE_DRIFT');
 return receipt[0];
}
async function openDetails(page){
 await page.goto('/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});
 const tab=page.getByRole('tab',{name:'Dossiers'});
 await tab.waitFor({state:'visible',timeout:25000});
 await tab.click();
 const details=page.locator('[data-hub-physical-details]');
 await details.waitFor({state:'attached',timeout:25000});
 const summary=details.locator('summary').first();
 if(!await details.evaluate(x=>x.open))await summary.click();
 await page.locator('[data-hub-bag-preparation]').waitFor({state:'visible',timeout:25000});
 return page.locator('[data-hub-bag-preparation]');
}
// A write is enabled just for the particular visible button and exact payload.
// Never retry a POST after a timeout; persist observed evidence before checking PG.
async function gesture(actor,key,endpoint,button,validatePayload){
 let permitted=0;
 const url=env.STAGING_BASE_URL+endpoint;
 const handler=async route=>{
   const req=route.request();
   if(req.method()!=='POST')return route.fallback();
   let payload;
   try{payload=req.postDataJSON();}catch(_){payload=null;}
   if(permitted===0&&validatePayload(payload)){
     permitted++;return route.continue();
   }
   actor.blocked.push({method:req.method(),path:new URL(req.url()).pathname});
   return route.abort('blockedbyclient');
 };
 await runtime();
 await actor.page.route(url,handler);
 try{
   await button.waitFor({state:'visible',timeout:20000});
   check(await button.isEnabled(),'G6_BAG_UI_DISABLED_'+key);
   const responsePromise=actor.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:30000});
   // Pointer action only; no DOM click or request substitution.
   await button.click({timeout:15000});
   const response=await responsePromise;
   const body=await response.json().catch(()=>({}));
   report.events.push({key,http:response.status(),code:body.code||null,
     unit_id:body.physical_unit?.id||body.id||null,reference:body.physical_unit?.reference||null});
   save();
   await actor.page.screenshot({path:path.join(OUT,key+'.png')});
   check(permitted===1&&response.status()>=200&&response.status()<300,'G6_BAG_HTTP_'+key+'_'+response.status()+'_'+(body.code||''));
   check(actor.blocked.length===0,'G6_BAG_UNEXPECTED_BROWSER_WRITE');
   return body;
 }finally{await actor.page.unroute(url,handler);}
}
async function main(){
 let browser;
 try{
  save();
  check(env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&
   env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.NODE_ENV==='test'&&
   env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&
   env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL==='https://komerce-backend-production.up.railway.app'&&
   env.G6_CANONICAL_PHASE==='HUB_CUSTOMER_BAG'&&env.G6_CANONICAL_SCENARIO==='M01'&&env.G6_TARGET_MARKET==='KM'&&
   REF==='KL1WGP6'&&ORDER==='56adad65-d1fa-4e80-8d69-c25e0fe92a76'&&
   PO==='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3'&&SOURCE==='SUPPLIER_PACKAGE-17824209-30d1-41be-87ad-1ef55c8a2994'&&
   !!env.DATABASE_URL,'G6_BAG_OWNER_STAGING_GUARD');
  const target=await confirmTarget({db,env});
  check(target.confirmed&&target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_BAG_DB_MISMATCH');
  report.db_fingerprint=target.fingerprint;report.sha=await runtime();
  const before=await snapshot(),receipt=validateBase(before);
  report.before=before;save();
  check(before.bags.length===0&&receipt.active&&receipt.state==='RECEIVED','G6_BAG_ALREADY_STARTED_OR_SOURCE_INVALID');
  browser=await chromium.launch({headless:true});
  const actor=await login(browser,'E2E_AGENT_HUB_',{readOnly:true});
  try{
   let prep=await openDetails(actor.page);
   const select=prep.getByRole('combobox',{name:'Commande dont préparer le sac'});
   await select.waitFor({state:'visible',timeout:20000});
   const choices=await select.locator('option').evaluateAll(xs=>xs.map(x=>({value:x.value,text:x.textContent})));
   const exact=choices.filter(c=>c.text.startsWith(REF+' · 1 unité(s)'));
   check(exact.length===1,'G6_BAG_EXACT_ORDER_NOT_AVAILABLE');
   await select.selectOption(exact[0].value);
   await gesture(actor,'create-bag',API+'/bags',prep.locator('[data-workspace-action="create-customer-bag"]'),
     b=>b?.order_id===ORDER&&b.bag_plan?.length===1&&
       b.bag_plan[0].order_item_id===before.order.order_item_id&&Number(b.bag_plan[0].quantity)===1);
   const created=await snapshot();validateBase(created);
   report.after_create=created;save();
   check(created.bags.length===1&&created.bags[0].state!=='PACKED'&&created.bags[0].bag_plan?.length===1&&
      created.bags[0].bag_plan[0].order_item_id===before.order.order_item_id&&
      Number(created.bags[0].bag_plan[0].quantity)===1,'G6_BAG_CREATE_PG_INVALID');
   const bag=created.bags[0];
   prep=await openDetails(actor.page);
   let holder=prep.locator('.kmc-hub-bag-open').filter({hasText:bag.reference+' · '+REF});
   await holder.waitFor({state:'visible',timeout:25000});
   const sources=holder.getByRole('combobox',{name:'Référence disponible pour '+bag.reference});
   const opts=await sources.locator('option').evaluateAll(xs=>xs.map(x=>({value:x.value,text:x.textContent})));
   const source=opts.filter(x=>x.text.endsWith('('+SOURCE+')')&&x.text.includes('1 disponible(s)'));
   check(source.length===1,'G6_BAG_EXACT_SOURCE_NOT_AVAILABLE');
   await sources.selectOption(source[0].value);
   await holder.locator('[data-hub-bag-evidence-method]').selectOption('MANUAL');
   await holder.locator('[data-hub-bag-manual-proof]').fill(PROOF);
   await holder.locator('input[type="number"]').fill('1');
   await gesture(actor,'deposit-bag',API+'/bags/'+bag.id+'/deposit',
     holder.locator('[data-workspace-action="scan-bag-deposit"]'),
     b=>b?.from_unit_id===receipt.id&&b.allocation_id===before.order.allocation_id&&
       Number(b.quantity)===1&&b.evidence_method==='MANUAL'&&b.evidence_ref===PROOF);
   const deposited=await snapshot();validateBase(deposited);
   report.after_deposit=deposited;save();
   const active=deposited.units.filter(u=>u.active);
   check(active.length===1&&active[0].id===bag.id&&Number(active[0].quantity)===1&&
     active[0].evidence_method==='MANUAL'&&active[0].evidence_ref===PROOF,'G6_BAG_DEPOSIT_PG_INVALID');
   prep=await openDetails(actor.page);
   holder=prep.locator('.kmc-hub-bag-open').filter({hasText:bag.reference+' · '+REF});
   await holder.waitFor({state:'visible',timeout:25000});
   await gesture(actor,'close-bag',API+'/bags/'+bag.id+'/close',
     holder.locator('[data-workspace-action="close-customer-bag"]'),
     b=>b&&Object.keys(b).length===0);
   const final=await snapshot();validateBase(final);report.after=final;save();
   check(final.bags.length===1&&final.bags[0].id===bag.id&&final.bags[0].state==='PACKED'&&
     final.units.filter(u=>u.active).length===1&&final.units.find(u=>u.active).id===bag.id,
     'G6_BAG_SEAL_PG_INVALID');
   await runtime();
   report.bag_id=bag.id;report.bag_ref=bag.reference;report.parcel_count=final.parcels.length;
   report.next_stage='KOM_BOX';report.verdict='G6_CUSTOMER_BAG_SIMULATED_CHROMIUM_PG_PASS';
   save();
  }finally{await actor.ctx.close();}
 }catch(e){
  report.verdict='BLOCKED';report.error=String(e.message||e).slice(0,1500);
  if(browser){try{const pages=browser.contexts().flatMap(c=>c.pages());if(pages.length)await pages[0].screenshot({path:path.join(OUT,'blocked.png')});}catch(_){}}
  // A partial sequence may already have committed a move. Never restart automatically.
  try{if(report.db_fingerprint)report.failure_readback=await snapshot();}catch(_){}
  save();process.exitCode=2;
 }finally{if(browser)await browser.close().catch(()=>{});await db.pool.end().catch(()=>{});console.log(JSON.stringify(report));}
}
if(require.main===module)main();
