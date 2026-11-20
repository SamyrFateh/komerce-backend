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
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {login}=require('./g6-hub-commitment-chromium');
const env=process.env,ROOT=path.resolve(__dirname,'../..');
const OUT=path.join(ROOT,'test-results/g6-hub-customer-bag');
const {observe,fullError}=require("./canonical/observability");let OBS=null;
const {humanGoto,humanClick,humanFill,humanSelect,humanCheck,humanPress}=require('./canonical/actors/human-gestures');
const ORDER=env.G6_CANONICAL_ORDER_ID,PO=env.G6_CANONICAL_PO_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const SOURCE=env.G6_CANONICAL_RECEIPT_REFERENCE;
// Multi-PO (M03) : un seul sac client consolidé pour toutes les lignes ; défauts = chemin historique (1 PO, 1 ligne, 1 unité).
const SC=require('./canonical/multi-po').importScope(env,{po:PO,receipt:SOURCE});
const API='/api/admin/workspaces/operations/market/'+MK.code;
const PROOF='[SIMULATED / STAGING ONLY] G6-M01-DEPOT-SAC-'+REF;
const report={schema:'komerce-g6-hub-customer-bag/1',scenario_id:'M01',market:MK.code,
  reference:REF,order_id:ORDER,po_id:PO,source_ref:SOURCE,po_ids:SC.pos,source_refs:SC.receipts,verdict:'BLOCKED',
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
  +'po.sent_note,a.purchase_order_id,a.id allocation_id,a.order_item_id,a.purchase_line_id,a.quantity,'
  +"(SELECT COUNT(*)::int FROM purchase_order_authorizations x WHERE x.purchase_order_id=po.id AND x.authorization_type='supplier_payment') payment_authorizations "
  +'FROM hub_purchase_allocations a JOIN orders o ON o.id=a.order_id JOIN purchase_orders po ON po.id=a.purchase_order_id '
  +'WHERE a.order_id=$1 AND a.purchase_order_id=ANY($2::uuid[])',[ORDER,SC.pos])).rows;
 check(orders.length===SC.pos.length&&new Set(orders.map(x=>x.id)).size===1,'G6_BAG_ALLOCATION_NOT_UNIQUE');
 // Alignement strict PO <-> allocation <-> réception : l'ordre de SC.pos fait foi.
 orders.sort((x,y)=>SC.pos.indexOf(x.purchase_order_id)-SC.pos.indexOf(y.purchase_order_id));
 check(orders.every((x,i)=>x.purchase_order_id===SC.pos[i]),'G6_BAG_ALLOCATION_NOT_UNIQUE');
 const order=orders[0],allocationIds=orders.map(x=>x.allocation_id);
 const units=(await db.query(
  'SELECT u.id,u.reference,u.unit_type::text unit_type,u.state::text state,p.quantity,p.operation_type::text operation_type,'
  +'p.evidence_method::text evidence_method,p.evidence_ref,p.removed_at IS NULL AS active '
  +'FROM hub_physical_unit_placements p JOIN hub_physical_units u ON u.id=p.physical_unit_id '
  +'WHERE p.allocation_id=ANY($1::uuid[]) ORDER BY p.placed_at,p.id',[allocationIds])).rows;
 const bags=(await db.query(
  "SELECT id,reference,state::text state,bag_plan FROM hub_physical_units WHERE order_id=$1 AND unit_type='HANDLING_UNIT' ORDER BY created_at",[ORDER])).rows;
 const custody=(await db.query(
  "SELECT e.physical_unit_id,e.event_type,e.operation_id,e.operation_type,e.quantity,e.actor_id,e.to_state,e.details "
  +"FROM hub_custody_events e WHERE e.allocation_id=ANY($1::uuid[]) OR e.physical_unit_id IN (SELECT id FROM hub_physical_units WHERE order_id=$2 AND unit_type='HANDLING_UNIT') "
  +"ORDER BY e.created_at,e.id",[allocationIds,ORDER])).rows;
 const links=(await db.query('SELECT l.bag_unit_id,l.box_unit_id,l.parcel_id FROM hub_box_bags l JOIN hub_physical_units u ON u.id=l.bag_unit_id WHERE u.order_id=$1',[ORDER])).rows;
 const parcels=(await db.query(
  "SELECT DISTINCT p.id,p.reference,p.status::text status FROM parcels p JOIN parcel_items pi ON pi.parcel_id=p.id JOIN order_items oi ON oi.id=pi.order_item_id "
  +"WHERE p.order_id=$1 AND oi.order_id=$1 AND oi.fulfillment_source='IMPORT' AND p.status<>'cancelled' ORDER BY p.id",[ORDER])).rows;
 return {order,orders,units,bags,custody,links,parcels};
}
function validateBase(s){
 for(const o of s.orders)
  check(o.id===ORDER&&o.reference===REF&&o.simulation_scope==='G6-BUYER'&&o.payment_status==='paid'&&
   o.po_status==='hub_received'&&o.sent_note?.startsWith('[SIMULATED / STAGING ONLY]')&&
   Number(o.quantity)===1&&Number(o.payment_authorizations)===0,'G6_BAG_ORDER_SCOPE_DRIFT');
 const receipts=SC.receipts.map(ref=>s.units.filter(u=>u.reference===ref&&u.operation_type==='RECEIVE'&&
   u.unit_type==='SUPPLIER_PACKAGE'&&Number(u.quantity)===1&&u.evidence_method==='MANUAL'&&
   u.evidence_ref==='[SIMULATED / STAGING ONLY] G6-M01-RECEPTION-'+REF));
 check(receipts.every(r=>r.length===1)&&s.units.filter(u=>u.active).reduce((n,u)=>n+Number(u.quantity),0)===SC.units&&
   s.links.length===0,'G6_BAG_PHYSICAL_SCOPE_DRIFT');
 return receipts.map(r=>r[0]);
}
// Le plan du sac couvre exactement les lignes IMPORT reçues, une unité chacune (sac unique de la commande).
function planMatches(plan,s){
 const ids=new Set(s.orders.map(o=>o.order_item_id));
 return Array.isArray(plan)&&plan.length===SC.items&&ids.size===SC.items&&
  plan.every(x=>ids.has(x.order_item_id)&&Number(x.quantity)===1)&&new Set(plan.map(x=>x.order_item_id)).size===SC.items;
}
async function openDetails(page){
 await humanGoto(page,'/admin/hub-live?view=execute&market='+MK.code+'',{waitUntil:'domcontentloaded'});
 const tab=page.getByRole('tab',{name:'Dossiers'});
 await tab.waitFor({state:'visible',timeout:25000});
 await humanClick(null,tab);
 const details=page.locator('[data-hub-physical-details]');
 await details.waitFor({state:'attached',timeout:25000});
 const summary=details.locator('summary').first();
 if(!await details.evaluate(x=>x.open))await humanClick(null,summary);
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
   await humanClick(null,button,{timeout:15000});
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
   env.G6_CANONICAL_PHASE==='HUB_CUSTOMER_BAG'&&['M01','M03'].includes(env.G6_CANONICAL_SCENARIO)&&env.G6_TARGET_MARKET===MK.code&&
   ((REF==='KL1WGP6'&&ORDER==='56adad65-d1fa-4e80-8d69-c25e0fe92a76'&&
     PO==='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3'&&SOURCE==='SUPPLIER_PACKAGE-17824209-30d1-41be-87ad-1ef55c8a2994')||
    (env.G6_DYNAMIC_FRESH_ORDER==='1'&&/^[A-Z0-9][A-Z0-9-]{5,63}$/.test(REF||'')&&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(ORDER||'')&&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(PO||'')&&
      /^SUPPLIER_PACKAGE-[A-Z0-9-]{8,}$/i.test(SOURCE||'')&&SC.pos[0]===PO&&SC.receipts[0]===SOURCE&&
      SC.pos.length===SC.receipts.length&&SC.pos.length===SC.items&&SC.units===SC.items&&
      SC.pos.every(x=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x))&&
      SC.receipts.every(x=>/^SUPPLIER_PACKAGE-[A-Z0-9-]{8,}$/i.test(x))))&&
   !!env.DATABASE_URL,'G6_BAG_OWNER_STAGING_GUARD');
  const target=await confirmTarget({db,env});
  check(target.confirmed&&target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_BAG_DB_MISMATCH');
  report.db_fingerprint=target.fingerprint;report.sha=await runtime();
  const before=await snapshot(),receipts=validateBase(before);
  report.before=before;save();
  check(before.bags.length===0&&receipts.every(r=>r.active&&r.state==='RECEIVED'),'G6_BAG_ALREADY_STARTED_OR_SOURCE_INVALID');
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const actor=await login(browser,'E2E_AGENT_HUB_',{readOnly:true});
  try{
   let prep=await openDetails(actor.page);
   const select=prep.getByRole('combobox',{name:'Commande dont préparer le sac'});
   await select.waitFor({state:'visible',timeout:20000});
   const choices=await select.locator('option').evaluateAll(xs=>xs.map(x=>({value:x.value,text:x.textContent})));
   const exact=choices.filter(c=>c.text.startsWith(REF+' · '+SC.units+' unité(s)'));
   check(exact.length===1,'G6_BAG_EXACT_ORDER_NOT_AVAILABLE');
   await humanSelect(null,select,exact[0].value);
   await gesture(actor,'create-bag',API+'/bags',prep.locator('[data-workspace-action="create-customer-bag"]'),
     b=>b?.order_id===ORDER&&planMatches(b.bag_plan,before));
   const created=await snapshot();validateBase(created);
   report.after_create=created;save();
   check(created.bags.length===1&&created.bags[0].state!=='PACKED'&&planMatches(created.bags[0].bag_plan,before),'G6_BAG_CREATE_PG_INVALID');
   const bag=created.bags[0];
   // Un dépôt = un geste = une mutation, par source (un colis fournisseur par PO), dans l'ordre des PO.
   for(let i=0;i<receipts.length;i++){
    const receipt=receipts[i],SRC=SC.receipts[i],alloc=before.orders[i].allocation_id;
    prep=await openDetails(actor.page);
    const holder=prep.locator('.kmc-hub-bag-open').filter({hasText:bag.reference+' · '+REF});
    await holder.waitFor({state:'visible',timeout:25000});
    const sources=holder.getByRole('combobox',{name:'Référence disponible pour '+bag.reference});
    const opts=await sources.locator('option').evaluateAll(xs=>xs.map(x=>({value:x.value,text:x.textContent})));
    const source=opts.filter(x=>x.text.endsWith('('+SRC+')')&&x.text.includes('1 disponible(s)'));
    check(source.length===1,'G6_BAG_EXACT_SOURCE_NOT_AVAILABLE');
    await humanSelect(null,sources,source[0].value);
    await humanSelect(null,holder.locator('[data-hub-bag-evidence-method]'),'MANUAL');
    await humanFill(null,holder.locator('[data-hub-bag-manual-proof]'),PROOF);
    await humanFill(null,holder.locator('input[type="number"]'),'1');
    await gesture(actor,SC.multi?'deposit-bag-'+(i+1):'deposit-bag',API+'/bags/'+bag.id+'/deposit',
     holder.locator('[data-workspace-action="scan-bag-deposit"]'),
     b=>b?.from_unit_id===receipt.id&&b.allocation_id===alloc&&
       Number(b.quantity)===1&&b.evidence_method==='MANUAL'&&b.evidence_ref===PROOF);
    const deposited=await snapshot();validateBase(deposited);
    report.after_deposit=deposited;save();
    const active=deposited.units.filter(u=>u.active),inBag=active.filter(u=>u.id===bag.id);
    check(inBag.length===i+1&&inBag.every(u=>Number(u.quantity)===1&&u.evidence_method==='MANUAL'&&u.evidence_ref===PROOF)&&
      active.length===SC.items,'G6_BAG_DEPOSIT_PG_INVALID');
    const movedOut=deposited.custody.filter(e=>e.physical_unit_id===receipt.id&&e.event_type==='PLACEMENT_OUT'&&e.operation_type==='REPACK'&&Number(e.quantity)===1);
    const movedIn=movedOut.length===1?deposited.custody.filter(e=>e.physical_unit_id===bag.id&&e.event_type==='PLACEMENT_IN'&&e.operation_type==='REPACK'&&Number(e.quantity)===1&&e.operation_id===movedOut[0].operation_id):[];
    check(movedOut.length===1&&movedIn.length===1&&movedOut[0].operation_id&&
     movedOut[0].operation_id===movedIn[0].operation_id&&movedOut[0].actor_id&&
     movedOut[0].actor_id===movedIn[0].actor_id,'G6_BAG_DEPOSIT_CUSTODY_INVALID');
   }
   prep=await openDetails(actor.page);
   const holder=prep.locator('.kmc-hub-bag-open').filter({hasText:bag.reference+' · '+REF});
   await holder.waitFor({state:'visible',timeout:25000});
   await gesture(actor,'close-bag',API+'/bags/'+bag.id+'/close',
     holder.locator('[data-workspace-action="close-customer-bag"]'),
     b=>b&&Object.keys(b).length===0);
   const final=await snapshot();validateBase(final);report.after=final;save();
   check(final.bags.length===1&&final.bags[0].id===bag.id&&final.bags[0].state==='PACKED'&&
     final.units.filter(u=>u.active).length===SC.items&&final.units.filter(u=>u.active).every(u=>u.id===bag.id),
     'G6_BAG_SEAL_PG_INVALID');
   check(final.custody.some(e=>e.physical_unit_id===bag.id&&e.event_type==='STATE_TRANSITION'&&
     e.to_state==='PACKED'&&e.actor_id&&e.details?.operator_action==='close_customer_bag'),
     'G6_BAG_SEAL_CUSTODY_INVALID');
   await runtime();
   report.bag_id=bag.id;report.bag_ref=bag.reference;report.parcel_count=final.parcels.length;report.allocation_ids=before.orders.map(o=>o.allocation_id);
   report.next_stage='KOM_BOX';report.verdict='G6_CUSTOMER_BAG_SIMULATED_CHROMIUM_PG_PASS';
   save();
  }finally{await actor.ctx.close();}
 }catch(e){
  report.verdict='BLOCKED';report.error=fullError(e);
  if(browser){try{const pages=browser.contexts().flatMap(c=>c.pages());if(pages.length)await pages[0].screenshot({path:path.join(OUT,'blocked.png')});}catch(_){}}
  // A partial sequence may already have committed a move. Never restart automatically.
  try{if(report.db_fingerprint)report.failure_readback=await snapshot();}catch(_){}
  save();process.exitCode=2;
 }finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end().catch(()=>{});console.log(JSON.stringify(report));}
}
if(require.main===module)main();
