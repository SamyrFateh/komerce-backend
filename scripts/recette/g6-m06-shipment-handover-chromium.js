#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-m06-shipment-handover-chromium
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Open a shipment for the exact packed M06 COMBOX, dispatch it from Hub and hand it to the operator supplied forwarder through Chromium.
 * @db-read purchase_orders, purchase_lines, order_items, orders, products, markets, purchase_order_authorizations, supplier_execution_payments, supplier_payment_settlements, local_stock_allocations, parcels, parcel_items, parcel_events, hub_purchase_allocations, hub_physical_units, hub_physical_unit_placements, hub_custody_events, international_shipments, international_shipment_hub_units, international_shipment_events, hub_scan_labels, hub_scan_label_box_scans, hub_box_custody_scans
 * @db-write none
 * @impact-areas staging-only, hub, logistics
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright'),db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {login}=require('./g6-hub-commitment-chromium');
const {marketProfile}=require('./canonical/market-profile');
const {buildM06HandoverPlan}=require('./canonical/m06-handover-plan');
const {assertM06HandoverResponse}=require('./canonical/m06-handover-response');
const {observe,fullError}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill,humanSelect,humanCheck}=require('./canonical/actors/human-gestures');
const env=process.env,MK=marketProfile(env),BASE='https://komerce-backend-production.up.railway.app';
const ORDER=env.G6_CANONICAL_ORDER_ID,PO=env.G6_CANONICAL_PO_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const BOXREF='G6-M06-COMBOX-'+String(REF||'').replace(/[^A-Z0-9-]/g,'-');
const SHIPMENT='G6-M06-EXP-'+String(REF||'').replace(/[^A-Z0-9-]/g,'-');
const OUT=path.resolve('test-results/g6-m06-shipment-handover');
const API='/api/admin/workspaces/operations/market/KM';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,SHA=/^[a-f0-9]{40}$/i;
let OBS=null;
const report={schema:'komerce-g6-m06-shipment-handover/1',scenario_id:'M06',market:'KM',
 order_id:ORDER||null,reference:REF||null,po_id:PO||null,box_reference:BOXREF,
 shipment_reference:SHIPMENT,verdict:'NOT_PROVEN',shipment_handover_certified:false,
 external_supplier_calls:0,external_payment_executed:false,production_permitted:false,
 ui_gestures:[],oracle_ids:['O-HUB','O-FIN']};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');};
const check=(ok,code)=>{if(!ok)throw Error(code);};
const digest=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
async function runtime(){
 const r=await fetch(BASE+'/health/version',{redirect:'error'});
 check(r.status===200,'G6_M06_HANDOVER_HEALTH_HTTP_'+r.status);
 const sha=String((await r.json()).commit||'');
 check(SHA.test(sha)&&sha===env.E2E_EXPECTED_DEPLOY_SHA,'G6_M06_HANDOVER_RUNTIME_SHA_DRIFT');
 return sha;
}
async function readback(){
 const {rows}=await db.query(`SELECT po.id AS po_id,po.status::text AS po_status,
   o.id AS order_id,o.reference AS order_reference,o.simulation_scope,o.payment_status::text AS payment_status,
   m.code AS market,pl.id AS line_id,pl.product_sku_id,oi.quantity AS order_quantity,
   oi.procure_on_order,oi.fulfillment_source::text AS fulfillment_source,p.product_ref,
   (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='supplier_payment') AS payment_authorization_count,
   (SELECT count(*)::int FROM supplier_execution_payments x WHERE x.purchase_order_id=po.id) AS external_payment_rows,
   (SELECT count(*)::int FROM supplier_payment_settlements s JOIN supplier_execution_payments x ON x.id=s.supplier_execution_payment_id WHERE x.purchase_order_id=po.id) AS settlement_rows,
   (SELECT coalesce(sum(v.received_quantity),0)::int FROM v_purchase_line_progress v WHERE v.line_id=pl.id) AS received_quantity,
   (SELECT count(*)::int FROM local_stock_allocations l WHERE l.order_id=o.id) AS local_stock_allocations_count,
   a.id AS allocation_id,
   box.id AS box_id,box.reference AS box_reference,box.unit_type::text AS box_unit_type,box.state::text AS box_state,
   (SELECT count(*)::int FROM hub_physical_unit_placements bx WHERE bx.physical_unit_id=box.id AND bx.removed_at IS NULL) AS box_placement_count,
   (SELECT coalesce(sum(bp.quantity),0)::int FROM hub_physical_unit_placements bp WHERE bp.physical_unit_id=box.id AND bp.allocation_id=a.id AND bp.removed_at IS NULL AND bp.operation_type='REPACK' AND bp.evidence_method='SCAN' AND bp.quantity=1) AS box_placement_quantity,
   (SELECT count(*)::int FROM hub_scan_label_box_scans s WHERE s.box_unit_id=box.id AND s.allocation_id=a.id) AS box_label_scan_count,
   (SELECT count(*)::int FROM hub_physical_units bu WHERE bu.order_id=o.id AND bu.unit_type='HANDLING_UNIT') AS customer_bag_count,
   parcel.id AS parcel_id,parcel.status::text AS parcel_status,
   (SELECT count(*)::int FROM parcels p2 JOIN parcel_items pi2 ON pi2.parcel_id=p2.id JOIN order_items oi2 ON oi2.id=pi2.order_item_id WHERE p2.order_id=o.id AND oi2.fulfillment_source='IMPORT' AND p2.status<>'cancelled') AS parcel_count,
   (SELECT count(*)::int FROM parcel_items i WHERE i.parcel_id=parcel.id) AS parcel_item_count,
   (SELECT coalesce(sum(i.quantity),0)::int FROM parcel_items i WHERE i.parcel_id=parcel.id) AS parcel_item_quantity,
   (SELECT coalesce(sum(i.qty_shipped),0)::int FROM parcel_items i WHERE i.parcel_id=parcel.id) AS parcel_qty_shipped,
   (SELECT count(*)::int FROM international_shipments s WHERE s.reference=$4 OR EXISTS(SELECT 1 FROM international_shipment_hub_units h WHERE h.shipment_id=s.id AND h.physical_unit_id=box.id)) AS shipment_count,
   (SELECT count(*)::int FROM international_shipment_hub_units h JOIN international_shipments s ON s.id=h.shipment_id WHERE s.reference=$4 AND h.physical_unit_id=box.id) AS shipment_link_count,
   (SELECT count(*)::int FROM hub_custody_events e WHERE e.physical_unit_id=box.id AND e.event_type='STATE_TRANSITION' AND e.from_state='PACKED' AND e.to_state='DISPATCHED') AS box_custody_dispatch_count,
   parcel.reference AS parcel_reference
  FROM purchase_orders po JOIN purchase_lines pl ON pl.purchase_order_id=po.id AND pl.cancelled_at IS NULL
  JOIN order_items oi ON oi.id=pl.order_item_id JOIN products p ON p.id=oi.product_id
  JOIN orders o ON o.id=oi.order_id JOIN markets m ON m.id=o.market_id
  LEFT JOIN hub_purchase_allocations a ON a.purchase_line_id=pl.id
  LEFT JOIN hub_physical_units box ON box.reference=$5
  LEFT JOIN parcels parcel ON parcel.order_id=o.id AND parcel.status<>'cancelled'
  WHERE po.id=$1 AND o.id=$2 AND o.reference=$3
  GROUP BY po.id,o.id,m.id,pl.id,oi.id,p.id,a.id,box.id,parcel.id`,
  [PO,ORDER,REF,SHIPMENT,BOXREF]);
 if(rows.length!==1)throw Error('G6_M06_HANDOVER_ORDER_CARDINALITY');
 const custody=(await db.query(`SELECT event_type,from_state::text AS from_state,to_state::text AS to_state,actor_id
   FROM hub_custody_events WHERE physical_unit_id=$1 ORDER BY created_at,id`,[rows[0].box_id])).rows;
 const shipments=(await db.query(`SELECT s.id,s.reference,s.stage,s.hub_draft,s.forwarder_name,s.transport_mode,s.market_id
   FROM international_shipments s WHERE s.reference=$1 OR EXISTS
    (SELECT 1 FROM international_shipment_hub_units h WHERE h.shipment_id=s.id AND h.physical_unit_id=$2)`,[SHIPMENT,rows[0].box_id])).rows;
 const links=(await db.query(`SELECT h.shipment_id,h.physical_unit_id FROM international_shipment_hub_units h
   JOIN international_shipments s ON s.id=h.shipment_id WHERE s.reference=$1 OR h.physical_unit_id=$2`,
   [SHIPMENT,rows[0].box_id])).rows;
 const shipmentEvents=(await db.query(`SELECT e.event_type,e.from_stage,e.to_stage,e.proof_ref,e.actor_id
   FROM international_shipment_events e JOIN international_shipments s ON s.id=e.shipment_id
   WHERE s.reference=$1 ORDER BY e.occurred_at,e.id`,[SHIPMENT])).rows;
 const parcelEvents=(await db.query(`SELECT event_type,actor_id,metadata FROM parcel_events
   WHERE parcel_id=$1 ORDER BY id`,[rows[0].parcel_id])).rows;
 const handoverScans=(await db.query(`SELECT s.box_unit_id,s.event_type,s.actor_id,s.proof_ref,l.short_alias
  FROM hub_box_custody_scans s JOIN hub_scan_labels l ON l.id=s.label_id
  JOIN international_shipments i ON i.id=s.shipment_id WHERE i.reference=$1`,[SHIPMENT])).rows;
 return {...rows[0],custody,shipments,links,shipmentEvents,parcelEvents,handoverScans};
}
async function openHub(page){
 await humanGoto(page,BASE+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});
 await humanClick(null,page.getByRole('tab',{name:'Dossiers'}));
 const details=page.locator('[data-hub-physical-details]');
 await details.waitFor({state:'visible',timeout:25000});
 const section=page.locator('[data-supply-boxes]');
 await section.waitFor({state:'visible',timeout:25000});
 return section;
}
function boxRow(section,page){return section.locator('tr').filter({has:page.getByText(BOXREF,{exact:true})});}
async function exactGesture(actor,key,url,button,validate){
 let allowed=0;const full=BASE+url;
 const route=async r=>{
  const req=r.request();if(req.method()!=='POST')return r.fallback();
  let body;try{body=req.postDataJSON()}catch(_){body=null;}
  if(allowed===0&&validate(body,req)){allowed++;return r.continue();}
  actor.blocked.push({method:req.method(),path:new URL(req.url()).pathname});
  return r.abort('blockedbyclient');
 };
 await runtime();await actor.page.route(full,route);
 try{
  check(await button.isEnabled(),'G6_M06_HANDOVER_ACTION_DISABLED_'+key);
  const pending=actor.page.waitForResponse(r=>r.url()===full&&r.request().method()==='POST',{timeout:30000});
  await humanClick(null,button);
  const response=await pending,json=await response.json().catch(()=>({}));
  check(allowed===1&&response.status()>=200&&response.status()<300,
   'G6_M06_HANDOVER_HTTP_'+key+'_'+response.status()+'_'+(json.code||''));
  check(actor.blocked.length===0,'G6_M06_HANDOVER_UNEXPECTED_UI_WRITE');
  report.ui_gestures.push({action:key,method:'pointer click',http:response.status()});
  save();await actor.page.screenshot({path:path.join(OUT,key+'.png')});
  return json;
 }finally{await actor.page.unroute(full,route);}
}
async function openTransport(page){
 await humanGoto(page,BASE+'/admin/workspaces/shipping-customs?market=KM',{waitUntil:'domcontentloaded'});
 await page.locator('[data-international-journey]').first().waitFor({state:'visible',timeout:25000});
 await humanClick(null,page.locator('.kmc-journey-tab').filter({hasText:'Transport & fret'}));
 const row=page.locator('tr').filter({has:page.getByText(SHIPMENT,{exact:true})});
 await row.waitFor({state:'visible',timeout:25000});
 const open=row.getByRole('button',{name:'Consulter',exact:true});
 if(await open.count())await humanClick(null,open);
 const task=page.locator('details.kmc-journey-task').filter({has:page.locator('summary',{hasText:'Confirmer : Remis au transitaire'})});
 await task.waitFor({state:'visible',timeout:25000});
 await task.locator('button[type="submit"]').waitFor({state:'visible',timeout:25000});
 return task;
}
async function printLabels(actor,link,endpoint,key,expected){
 const http=actor.page.waitForResponse(r=>r.url()===BASE+endpoint&&r.request().method()==='GET',{timeout:30000});
 const popup=actor.page.waitForEvent('popup',{timeout:30000});
 await humanClick(null,link);
 const [preview,response]=await Promise.all([popup,http]);
 try{
  check(response.status()===200,'G6_HUB_PRINT_HTTP_'+key);
  await preview.locator('.ticket').first().waitFor({state:'visible',timeout:30000});
  const aliases=await preview.locator('.ticket .alias').allTextContents();
  check(aliases.length===expected.length&&new Set(aliases).size===expected.length&&
   expected.every(x=>aliases.includes(x)),'G6_HUB_PRINT_ALIAS_MISMATCH_'+key);
  const qrSources=await preview.locator('.ticket img.qr').evaluateAll(images=>images.map(img=>img.getAttribute('src')));
  check(qrSources.length===expected.length&&qrSources.every(src=>/^data:image\\/png;base64,/.test(src||''))&&
   new Set(qrSources).size===expected.length,'G6_HUB_PRINT_QR_MISSING_OR_DUPLICATE_'+key);
  const printedText=await preview.locator('body').innerText();
  check(!printedText.includes(REF),'G6_HUB_PRINT_COMMERCIAL_REFERENCE_EXPOSED_'+key);
  await preview.screenshot({path:path.join(OUT,key+'.png'),fullPage:true});
  report.ui_gestures.push({action:key,method:'pointer click',http:response.status(),ticket_count:aliases.length});
  report.hardware_status='HARDWARE_NOT_PROVEN';save();
 }finally{await preview.close();}
}
async function main(){
 let browser;
 try{
  save();const forwarder=String(env.G6_M06_FORWARDER_NAME||'').trim();
  const mode=String(env.G6_M06_TRANSPORT_MODE||'').trim().toLowerCase();
  const handoverProof=String(env.G6_M06_HANDOVER_PROOF_REF||'').trim();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&
   env.STAGING_BASE_URL===BASE&&env.G6_CANONICAL_SCENARIO==='M06'&&
   env.G6_CANONICAL_PHASE==='M06_HUB_SHIPMENT_HANDOVER'&&env.G6_TARGET_MARKET==='KM'&&
   env.G6_DYNAMIC_FRESH_ORDER==='1'&&UUID.test(ORDER||'')&&UUID.test(PO||'')&&
   /^[A-Z0-9][A-Z0-9-]{5,63}$/.test(REF||'')&&SHA.test(env.E2E_EXPECTED_DEPLOY_SHA||'')&&
   !!env.G6_CANONICAL_DB_FINGERPRINT&&!!env.DATABASE_URL,
   'G6_M06_HANDOVER_OWNER_STAGING_GUARD');
  const target=await confirmTarget({db,env});
  check(target.confirmed&&target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_M06_HANDOVER_DB_TARGET_MISMATCH');
  report.db_fingerprint=target.fingerprint;report.sha=await runtime();
  const before=await readback();
  const plan=buildM06HandoverPlan({...before,scenario_id:'M06'},{forwarderName:forwarder,transportMode:mode,proofRef:handoverProof});
  check(before.market==='KM'&&before.order_reference===REF,'G6_M06_HANDOVER_MARKET_SCOPE');
  report.before={po_status:before.po_status,box_reference:plan.box_reference,box_state:before.box_state,
   quantity:plan.quantity,parcel_reference:before.parcel_reference,parcel_status:before.parcel_status,
   parcel_qty_shipped:before.parcel_qty_shipped,customer_bag_count:before.customer_bag_count,
   payment_authorization_count:before.payment_authorization_count,external_payment_rows:before.external_payment_rows,
   settlement_rows:before.settlement_rows,local_stock_allocations_count:before.local_stock_allocations_count,read_only:true};
  report.handover_proof_ref_hash=digest(plan.proof_ref);save();
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const actor=await login(browser,'E2E_AGENT_HUB_',{readOnly:true});
  try{
   let section=await openHub(actor.page),row=boxRow(section,actor.page);
   await row.waitFor({state:'visible',timeout:25000});
   await humanFill(null,section.getByRole('textbox',{name:'Référence de la nouvelle expédition'}),SHIPMENT);
   await humanCheck(null,row.getByRole('checkbox',{name:'Inclure '+BOXREF}));
   const open=await exactGesture(actor,'open-shipment',API+'/boxes/shipment',
    section.locator('[data-workspace-action="create-shipment-from-boxes"]'),
    b=>b&&b.reference===SHIPMENT&&Array.isArray(b.hub_unit_ids)&&b.hub_unit_ids.length===1&&
      b.hub_unit_ids[0]===plan.box_id&&Object.keys(b).length===2);
   check(open.result?.reference===SHIPMENT&&open.result?.stage==='hub_ready','G6_M06_HANDOVER_OPEN_RESPONSE_INVALID');
   let after=await readback();
   check(after.shipments.length===1&&after.shipments[0].reference===SHIPMENT&&
    after.shipments[0].stage==='hub_ready'&&after.links.length===1&&
    after.links[0].physical_unit_id===plan.box_id&&after.box_state==='PACKED'&&
    after.shipmentEvents.length===1&&after.shipmentEvents[0].event_type==='opened'&&
    after.parcel_status==='preparation'&&Number(after.parcel_qty_shipped)===0,
    'G6_M06_HANDOVER_OPEN_PG_INVALID');
   const shipmentId=after.shipments[0].id;report.shipment_id=shipmentId;report.parcel_id=after.parcel_id;report.box_id=after.box_id;save();
   section=await openHub(actor.page);row=boxRow(section,actor.page);
   await row.waitFor({state:'visible',timeout:25000});
   const labelBase=API+'/labels/boxes/'+plan.box_id;
   const issued=await exactGesture(actor,'issue-box-label',labelBase+'/issue',
    row.locator('[data-workspace-action="issue-box-label"]'),b=>b&&Object.keys(b).length===0);
   const alias=issued.alias;
   check(issued.type==='COMBOX'&&/^[A-HJ-NP-Z2-9]{8}$/.test(alias||''),'G6_M06_BOX_LABEL_INVALID');
   const labels=(await db.query("SELECT short_alias FROM hub_scan_labels WHERE physical_unit_id=$1 AND target_type='COMBOX'",[plan.box_id])).rows;
   check(labels.length===1&&labels[0].short_alias===alias,'G6_M06_BOX_LABEL_PG_INVALID');
   await printLabels(actor,row.locator('[data-hub-print-box]'),labelBase+'/print?format=thermal','print-box-label',[alias]);
   await humanFill(null,row.locator('[data-hub-final-box-scan]'),alias);
   await humanCheck(null,row.locator('[data-hub-box-label-applied]'));
   await exactGesture(actor,'dispatch-box',API+'/boxes/'+plan.box_id+'/advance',
    row.locator('[data-workspace-action="advance-box"]'),b=>b?.to_state==='DISPATCHED'&&
     b.box_qr_scan===alias&&b.label_applied_confirmed===true&&Object.keys(b).length===3);
   after=await readback();
   check(after.box_state==='DISPATCHED'&&after.shipments[0].stage==='hub_ready'&&
    after.custody.some(e=>e.event_type==='STATE_TRANSITION'&&e.from_state==='PACKED'&&
      e.to_state==='DISPATCHED'&&e.actor_id)&&Number(after.parcel_qty_shipped)===0,
    'G6_M06_HANDOVER_DISPATCH_PG_INVALID');
   await openTransport(actor.page);
   const scanTask=actor.page.locator('[data-journey-custody-scan="HUB_HANDOVER"]');
   await scanTask.waitFor({state:'visible',timeout:25000});
   await humanFill(null,scanTask.locator('[name="qr_code"]'),alias);
   await humanFill(null,scanTask.locator('[name="proof_ref"]'),plan.proof_ref);
   await humanSelect(null,scanTask.locator('[name="confirmed"]'),'yes');
   await exactGesture(actor,'scan-handover-box','/api/admin/workspaces/shipping-customs/market/KM/international/'+SHIPMENT+'/box-scan',
    scanTask.locator('button[type="submit"]'),b=>b?.qr_code===alias&&b.proof_ref===plan.proof_ref&&
     b.event_type==='HUB_HANDOVER'&&b.confirmed===true);
   after=await readback();
   check(after.shipments[0].stage==='hub_ready'&&Number(after.parcel_qty_shipped)===0&&
    after.handoverScans.length===1&&after.handoverScans[0].box_unit_id===plan.box_id&&
    after.handoverScans[0].short_alias===alias&&after.handoverScans[0].actor_id,
    'G6_M06_HANDOVER_SCAN_PG_INVALID');
   const task=await openTransport(actor.page);
   await humanFill(null,task.locator('[name="forwarder_name"]'),plan.forwarder_name);
   await humanSelect(null,task.locator('[name="transport_mode"]'),plan.transport_mode);
   await humanFill(null,task.locator('[name="proof_ref"]'),plan.proof_ref);
   const endpoint='/api/admin/workspaces/shipping-customs/market/KM/international/'+SHIPMENT+'/transition';
   const result=await exactGesture(actor,'handover-forwarder',endpoint,task.locator('button[type="submit"]'),
    b=>b&&b.to_stage==='handed_over'&&b.forwarder_name===plan.forwarder_name&&
     b.transport_mode===plan.transport_mode&&b.proof_ref===plan.proof_ref&&
     Object.keys(b).sort().join(',')==='forwarder_name,proof_ref,to_stage,transport_mode');
   // Shipping-customs responds with {ok:true,result:{reference,from_stage,stage}}.
   assertM06HandoverResponse(result,SHIPMENT);
  }finally{await actor.ctx.close();}
  await runtime();const after=await readback();
  const dispatched=after.custody.some(e=>e.event_type==='STATE_TRANSITION'&&
    e.from_state==='PACKED'&&e.to_state==='DISPATCHED'&&e.actor_id);
  check(after.shipments.length===1&&after.shipments[0].id===report.shipment_id&&
   after.shipments[0].stage==='handed_over'&&after.shipments[0].forwarder_name===plan.forwarder_name&&
   after.shipments[0].transport_mode===plan.transport_mode&&after.links.length===1&&
   after.links[0].physical_unit_id===plan.box_id&&after.box_state==='DISPATCHED'&&dispatched&&
   after.parcel_status==='shipped'&&Number(after.parcel_qty_shipped)===3&&
   after.handoverScans.length===1&&after.handoverScans[0].event_type==='HUB_HANDOVER'&&
   after.handoverScans[0].box_unit_id===plan.box_id&&
   after.shipmentEvents.length===2&&after.shipmentEvents.some(e=>e.event_type==='stage_changed'&&
    e.from_stage==='hub_ready'&&e.to_stage==='handed_over'&&e.proof_ref===plan.proof_ref&&e.actor_id)&&
   after.parcelEvents.some(e=>e.event_type==='shipped'&&e.actor_id&&e.metadata?.shipment_id===report.shipment_id&&
    e.metadata?.proof_ref===plan.proof_ref)&&Number(after.external_payment_rows)===0&&
   Number(after.settlement_rows)===0&&Number(after.local_stock_allocations_count)===0,
   'G6_M06_HANDOVER_POSTGRES_ORACLE_INVALID');
  report.after={shipment_id:report.shipment_id,shipment_stage:after.shipments[0].stage,
   box_state:after.box_state,parcel_status:after.parcel_status,parcel_qty_shipped:Number(after.parcel_qty_shipped),
   handover_scan_count:after.handoverScans.length,
   forwarder_name:plan.forwarder_name,transport_mode:plan.transport_mode,
   handover_proof_ref_hash:digest(plan.proof_ref),external_payment_rows:Number(after.external_payment_rows),
   settlement_rows:Number(after.settlement_rows),local_stock_allocations_count:Number(after.local_stock_allocations_count),
   read_only:true};
  report.shipment_handover_certified=true;report.next_stage='FORWARDER_RECEIPT';
  report.verdict='G6_M06_HUB_SHIPMENT_HANDOVER_CHROMIUM_PG_PASS';save();
 }catch(e){report.error=fullError(e);report.verdict='BLOCKED';process.exitCode=2;}
 finally{save();if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});
  await db.pool.end().catch(()=>{});console.log(JSON.stringify({verdict:report.verdict,error:report.error||null,
   reference:REF||null,shipment_reference:SHIPMENT,external_supplier_calls:0,external_payment_executed:false}));}
}
if(require.main===module)main();
module.exports={main,readback};
