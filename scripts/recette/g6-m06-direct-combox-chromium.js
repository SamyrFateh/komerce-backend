#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-m06-direct-combox-chromium
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Compose the exact three-unit M06 supplier package directly into one COMBOX, close it through Hub UI and verify persisted custody.
 * @db-read purchase_orders, purchase_lines, order_items, orders, products, markets, purchase_order_authorizations, hub_purchase_allocations, hub_physical_units, hub_physical_unit_placements, hub_custody_events, hub_scan_labels, hub_scan_label_box_scans, local_stock_allocations
 * @db-write none
 * @impact-areas staging-only, hub, logistics
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright'),db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {login}=require('./g6-hub-commitment-chromium');
const {marketProfile}=require('./canonical/market-profile');
const {buildM06ComboxPlan}=require('./canonical/m06-combox-plan');
const {observe,fullError}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill,humanSelect}=require('./canonical/actors/human-gestures');
const env=process.env,MK=marketProfile(env),BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE,PO=env.G6_CANONICAL_PO_ID;
const OUT=path.resolve('test-results/g6-m06-direct-combox');
const API='/api/admin/workspaces/operations/market/KM';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,SHA=/^[a-f0-9]{40}$/i;
const BOXREF='G6-M06-COMBOX-'+String(REF||'').replace(/[^A-Z0-9-]/g,'-');
let OBS=null;
const report={schema:'komerce-g6-m06-direct-combox/1',scenario_id:'M06',market:'KM',
 order_id:ID||null,reference:REF||null,po_id:PO||null,box_reference:BOXREF,
 verdict:'NOT_PROVEN',direct_combox_certified:false,external_supplier_calls:0,
 external_payment_executed:false,production_permitted:false,ui_gestures:[],
 oracle_ids:['O-HUB','O-FIN']};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');};
const check=(ok,code)=>{if(!ok)throw Error(code);};
const digest=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
async function runtime(){
 const r=await fetch(BASE+'/health/version',{redirect:'error'});
 check(r.status===200,'G6_M06_COMBOX_HEALTH_HTTP_'+r.status);
 const sha=String((await r.json()).commit||'');
 check(SHA.test(sha)&&sha===env.E2E_EXPECTED_DEPLOY_SHA,'G6_M06_COMBOX_RUNTIME_SHA_DRIFT');
 return sha;
}
async function readState(){
 const {rows}=await db.query(`SELECT po.id AS po_id,po.status::text AS po_status,
   o.id AS order_id,o.reference,o.simulation_scope,o.payment_status::text AS payment_status,
   m.code AS market,pl.id AS line_id,pl.product_sku_id,oi.quantity AS order_quantity,
   oi.procure_on_order,oi.fulfillment_source::text AS fulfillment_source,p.product_ref,
   (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='supplier_payment') AS payment_authorization_count,
   (SELECT count(*)::int FROM supplier_execution_payments x WHERE x.purchase_order_id=po.id) AS external_payment_rows,
   (SELECT count(*)::int FROM supplier_payment_settlements s JOIN supplier_execution_payments x ON x.id=s.supplier_execution_payment_id WHERE x.purchase_order_id=po.id) AS settlement_rows,
   (SELECT coalesce(sum(v.received_quantity),0)::int FROM v_purchase_line_progress v WHERE v.line_id=pl.id) AS received_quantity,
   (SELECT count(*)::int FROM local_stock_allocations l WHERE l.order_id=o.id) AS local_stock_allocations_count,
   a.id AS allocation_id,a.quantity AS allocation_quantity,u.id AS receipt_unit_id,u.reference AS receipt_reference,
   u.state::text AS receipt_state,p0.removed_at AS receipt_placement_removed_at,p0.quantity AS placement_quantity,p0.operation_type::text AS placement_operation,
   p0.evidence_method::text AS receipt_evidence_method,p0.evidence_ref AS receipt_evidence_ref,
   (SELECT count(DISTINCT p1.physical_unit_id)::int FROM hub_physical_unit_placements p1
      WHERE p1.allocation_id=a.id AND p1.operation_type='REPACK' AND p1.removed_at IS NULL) AS box_count,(SELECT count(*)::int FROM hub_physical_unit_placements p2 WHERE p2.allocation_id=a.id AND p2.operation_type='REPACK' AND p2.removed_at IS NULL) AS direct_combox_placement_count
  FROM purchase_orders po JOIN purchase_lines pl ON pl.purchase_order_id=po.id AND pl.cancelled_at IS NULL
  JOIN order_items oi ON oi.id=pl.order_item_id JOIN products p ON p.id=oi.product_id
  JOIN orders o ON o.id=oi.order_id JOIN markets m ON m.id=o.market_id
  LEFT JOIN hub_purchase_allocations a ON a.purchase_line_id=pl.id
  LEFT JOIN hub_physical_unit_placements p0 ON p0.allocation_id=a.id AND p0.operation_type='RECEIVE'
  LEFT JOIN hub_physical_units u ON u.id=p0.physical_unit_id
  WHERE po.id=$1 AND o.id=$2 AND o.reference=$3
  GROUP BY po.id,o.id,m.id,pl.id,oi.id,p.id,a.id,u.id,p0.id`,[PO,ID,REF]);
 if(rows.length!==1)throw Error('G6_M06_COMBOX_PO_LINE_NOT_UNIQUE');
 const direct=(await db.query(`SELECT box.id AS box_id,box.reference,box.unit_type::text AS unit_type,
   box.state::text AS state,p.id AS placement_id,p.allocation_id,p.quantity,p.operation_type::text AS operation_type,
   p.evidence_method::text AS evidence_method,p.evidence_ref,p.evidence_code,p.created_by
  FROM hub_physical_units box JOIN hub_physical_unit_placements p ON p.physical_unit_id=box.id AND p.removed_at IS NULL
  WHERE box.reference=$1 AND box.unit_type='MARKET_PARCEL' ORDER BY p.id`,[BOXREF])).rows;
 const custody=(await db.query(`SELECT e.event_type,e.from_state::text AS from_state,e.to_state::text AS to_state,e.actor_id
  FROM hub_custody_events e JOIN hub_physical_units box ON box.id=e.physical_unit_id
  WHERE box.reference=$1 ORDER BY e.created_at,e.id`,[BOXREF])).rows;
 const scans=(await db.query(`SELECT s.label_id,l.short_alias,s.allocation_id,s.box_unit_id
  FROM hub_scan_label_box_scans s JOIN hub_scan_labels l ON l.id=s.label_id
  WHERE s.allocation_id=$1 ORDER BY l.unit_number`,[rows[0].allocation_id])).rows;
 return {...rows[0],direct,custody,scans};
}
async function openBoxes(page){
 await humanGoto(page,BASE+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});
 const tab=page.getByRole('tab',{name:'Dossiers'});
 await tab.waitFor({state:'visible',timeout:25000});await humanClick(null,tab);
 const details=page.locator('[data-hub-physical-details]');
 await details.waitFor({state:'visible',timeout:25000});
 const section=page.locator('[data-supply-boxes]');
 await section.waitFor({state:'visible',timeout:25000});
 return section;
}
function rowFor(section,page){return section.locator('tr').filter({has:page.getByText(BOXREF,{exact:true})});}
async function gesture(actor,key,endpoint,button,validate){
 const url=BASE+endpoint;let count=0;
 const handler=async route=>{
  const req=route.request();if(req.method()!=='POST')return route.fallback();
  let body;try{body=req.postDataJSON()}catch(_){body=null;}
  if(count===0&&validate(body,req)){count++;return route.continue();}
  actor.blocked.push({method:req.method(),path:new URL(req.url()).pathname});
  return route.abort('blockedbyclient');
 };
 await actor.page.route(url,handler);
 try{
  check(await button.isEnabled(),'G6_M06_COMBOX_UI_DISABLED_'+key);
  const pending=actor.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:30000});
  await humanClick(null,button);
  const response=await pending,json=await response.json().catch(()=>({}));
  check(count===1&&response.status()>=200&&response.status()<300,
   'G6_M06_COMBOX_HTTP_'+key+'_'+response.status()+'_'+(json.code||''));
  check(actor.blocked.length===0,'G6_M06_COMBOX_UNEXPECTED_UI_WRITE');
  report.ui_gestures.push({action:key,method:'pointer click',http:response.status()});
  save();await actor.page.screenshot({path:path.join(OUT,key+'.png')});
  return json;
 }finally{await actor.page.unroute(url,handler);}
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
  check(await preview.locator('.ticket img.qr[src^="data:image/"]').count()===expected.length,'G6_HUB_PRINT_QR_MISSING_'+key);
  await preview.screenshot({path:path.join(OUT,key+'.png'),fullPage:true});
  report.ui_gestures.push({action:key,method:'pointer click',http:response.status(),ticket_count:aliases.length});
  report.hardware_status='HARDWARE_NOT_PROVEN';save();
 }finally{await preview.close();}
}
async function main(){
 let browser;
 try{
  save();const proof=String(env.G6_M06_COMBOX_PROOF_REF||'').trim();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&
   env.STAGING_BASE_URL===BASE&&env.G6_CANONICAL_SCENARIO==='M06'&&
   env.G6_CANONICAL_PHASE==='M06_DIRECT_COMBOX'&&env.G6_TARGET_MARKET==='KM'&&env.G6_DYNAMIC_FRESH_ORDER==='1'&&
   UUID.test(ID||'')&&UUID.test(PO||'')&&/^[A-Z0-9][A-Z0-9-]{5,63}$/.test(REF||'')&&
   SHA.test(env.E2E_EXPECTED_DEPLOY_SHA||'')&&!!env.G6_CANONICAL_DB_FINGERPRINT&&!!env.DATABASE_URL&&
   proof.length>=6&&proof.length<=500,'G6_M06_COMBOX_OWNER_STAGING_GUARD');
  const target=await confirmTarget({db,env});
  check(target.confirmed&&target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_M06_COMBOX_DB_TARGET_MISMATCH');
  report.db_fingerprint=target.fingerprint;report.sha=await runtime();
  const before=await readState(),plan=buildM06ComboxPlan({...before,scenario_id:'M06'},proof);
  check(before.po_status==='hub_received'&&before.market==='KM','G6_M06_COMBOX_PRECONDITION_SCOPE');
  report.before={po_status:before.po_status,receipt_reference:plan.receipt_reference,
   receipt_state:before.receipt_state,receipt_quantity:plan.quantity,
   receipt_proof_ref_hash:digest(plan.receipt_proof_ref),box_count:before.box_count,
   payment_authorization_count:before.payment_authorization_count,external_payment_rows:before.external_payment_rows,
   settlement_rows:before.settlement_rows,local_stock_allocations_count:before.local_stock_allocations_count,read_only:true};
  report.combox_proof_ref_hash=digest(plan.proof_ref);save();
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const actor=await login(browser,'E2E_AGENT_HUB_',{readOnly:true});
  try{
   let section=await openBoxes(actor.page);
   await humanFill(null,section.getByRole('textbox',{name:'Référence de la nouvelle COMBOX'}),BOXREF);
   await gesture(actor,'create-combox',API+'/boxes',section.locator('[data-workspace-action="create-box"]'),
    (b,req)=>b&&Object.keys(b).length===1&&b.reference===BOXREF&&!!req.headers()['idempotency-key']);
   let after=await readState();
   check(after.receipt_unit_id===plan.receipt_unit_id&&after.receipt_state==='RECEIVED'&&
    after.receipt_placement_removed_at==null&&after.box_count===0&&after.direct.length===0,'G6_M06_COMBOX_CREATE_PG_INVALID');
   const boxId=(await db.query('SELECT id FROM hub_physical_units WHERE reference=$1',[BOXREF])).rows[0]?.id;
   check(UUID.test(String(boxId||'')),'G6_M06_COMBOX_CREATED_UNIT_MISSING');
   report.box_id=boxId;save();
   section=await openBoxes(actor.page);
   const articleBase=API+'/labels/articles/'+plan.allocation_id;
   const labelRow=section.locator('[data-hub-label-printing] .kmc-workspace-receive-footer').filter({
    has:actor.page.locator('a[href="'+articleBase+'/print?format=thermal"]')});
   await labelRow.waitFor({state:'visible',timeout:25000});
   const issued=await gesture(actor,'issue-article-labels',articleBase+'/issue',
    labelRow.locator('[data-workspace-action="issue-article-labels"]'),b=>b&&Object.keys(b).length===0);
   const aliases=(issued.labels||[]).map(x=>x.alias);
   check(issued.type==='ARTICLE'&&issued.count===3&&aliases.length===3&&new Set(aliases).size===3,
    'G6_M06_ARTICLE_LABEL_COUNT');
   const persisted=(await db.query("SELECT short_alias FROM hub_scan_labels WHERE allocation_id=$1 AND target_type='ARTICLE' ORDER BY unit_number",[plan.allocation_id])).rows;
   check(persisted.length===3&&persisted.every(x=>aliases.includes(x.short_alias)),'G6_M06_ARTICLE_LABEL_PG_INVALID');
   await printLabels(actor,labelRow.locator('[data-hub-print-article]'),articleBase+'/print?format=thermal','print-article-labels',aliases);
   for(const [index,alias] of aliases.entries()){
    section=await openBoxes(actor.page);const row=rowFor(section,actor.page);
    await row.waitFor({state:'visible',timeout:25000});
    await humanFill(null,row.locator('[data-hub-box-scan]'),BOXREF);
    const item=row.getByRole('combobox',{name:'Article réceptionné à placer dans '+BOXREF});
    await item.waitFor({state:'visible',timeout:15000});
    const matches=[];for(const opt of await item.locator('option').all()){
     const label=(await opt.textContent())||'';if(label.includes(plan.receipt_reference))matches.push(await opt.getAttribute('value'));
    }
    check(matches.length===1,'G6_M06_COMBOX_FILLABLE_UNIT_NOT_UNIQUE');
    await humanSelect(null,item,matches[0]);
    const method=row.getByRole('combobox',{name:'Mode de preuve du scan article dans '+BOXREF});
    await humanSelect(null,method,'SCAN');
    await humanFill(null,row.getByRole('textbox',{name:'Code physique de l’article à placer dans '+BOXREF}),alias);
    await humanFill(null,row.getByRole('spinbutton',{name:'Quantité de cet article à placer dans '+BOXREF}),'1');
    await gesture(actor,'fill-combox-'+(index+1),API+'/boxes/'+boxId+'/fill',
     row.locator('[data-workspace-action="fill-box"]'),b=>b&&b.from_unit_id===plan.receipt_unit_id&&
      b.allocation_id===plan.allocation_id&&Number(b.quantity)===1&&b.box_reference_scan===BOXREF&&
      b.evidence_method==='SCAN'&&b.evidence_code===alias&&Object.keys(b).length===6);
    after=await readState();
    check(after.direct.length===index+1&&after.scans.length===index+1&&
     after.direct.every(x=>x.box_id===boxId&&x.allocation_id===plan.allocation_id&&Number(x.quantity)===1&&
      x.operation_type==='REPACK'&&x.evidence_method==='SCAN')&&
     after.scans.every(x=>x.box_unit_id===boxId&&aliases.slice(0,index+1).includes(x.short_alias)),
     'G6_M06_COMBOX_FILL_PG_INVALID');
   }
   check(after.receipt_unit_id===plan.receipt_unit_id&&after.receipt_state==='SUPERSEDED'&&
    !!after.receipt_placement_removed_at&&new Set(after.scans.map(x=>x.label_id)).size===3,'G6_M06_COMBOX_SOURCE_PG_INVALID');
   report.after_fill={receipt_state:after.receipt_state,receipt_placement_closed:!!after.receipt_placement_removed_at,
    box_state:after.direct[0].state,placement_quantity:3,operation_type:'REPACK',evidence_method:'SCAN',
    label_scan_count:after.scans.length,read_only:true};save();
   section=await openBoxes(actor.page);const closeRow=rowFor(section,actor.page);
   await closeRow.waitFor({state:'visible',timeout:25000});
   await humanFill(null,closeRow.locator('[data-hub-box-scan]'),BOXREF);
   const closeBody={box_reference_scan:BOXREF};
   const closed=await gesture(actor,'close-combox',API+'/boxes/'+boxId+'/close',
    closeRow.locator('[data-workspace-action="close-box"]'),
    b=>b&&b.box_reference_scan===BOXREF&&Object.keys(b).length===1);
   check(closed.state==='PACKED','G6_M06_COMBOX_CLOSE_RESPONSE_INVALID');
  }finally{await actor.ctx.close();}
  await runtime();
  const after=await readState();
  const expected=['IDENTIFIED','QUALITY_CHECKED','LOCATED','ALLOCATED','PICKED','PACKED'];
  const transitions=after.custody.filter(e=>e.event_type==='STATE_TRANSITION').map(e=>[e.from_state,e.to_state]);
  check(after.direct.length===3&&after.scans.length===3&&new Set(after.scans.map(x=>x.label_id)).size===3&&
   after.direct.every(x=>x.box_id===report.box_id&&x.unit_type==='MARKET_PARCEL'&&x.state==='PACKED'&&
    Number(x.quantity)===1&&x.operation_type==='REPACK'&&x.evidence_method==='SCAN')&&expected.every((state,i)=>transitions.some(t=>
    t[0]===(i===0?'RECEIVED':expected[i-1])&&t[1]===state)),
   'G6_M06_COMBOX_POSTGRES_CUSTODY_INVALID');
  report.after={box_id:report.box_id,state:after.direct[0].state,unit_type:after.direct[0].unit_type,
   quantity:after.direct.reduce((sum,x)=>sum+Number(x.quantity),0),label_scan_count:after.scans.length,placement_operation:after.direct[0].operation_type,
   receipt_unit_id:plan.receipt_unit_id,allocation_id:plan.allocation_id,
   custody_transitions:transitions,external_payment_rows:Number(after.external_payment_rows),
   settlement_rows:Number(after.settlement_rows),local_stock_allocations_count:Number(after.local_stock_allocations_count),
   combox_proof_ref_hash:digest(proof),read_only:true};
  report.direct_combox_certified=true;report.verdict='G6_M06_DIRECT_COMBOX_CHROMIUM_PG_PASS';
  report.next_stage='HUB_SHIPMENT';save();
 }catch(e){report.error=fullError(e);report.verdict='BLOCKED';process.exitCode=2;}
 finally{save();if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});
  await db.pool.end().catch(()=>{});console.log(JSON.stringify({verdict:report.verdict,error:report.error||null,
   reference:REF||null,box_reference:BOXREF,external_supplier_calls:0,external_payment_executed:false}));}
}
if(require.main===module)main();
module.exports={main,readState};
