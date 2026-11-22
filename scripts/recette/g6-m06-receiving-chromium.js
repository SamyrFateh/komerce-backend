#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-m06-physical-receipt-chromium
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Receive the exact M06 on-order purchase through the canonical Hub reception screen and read back its physical allocation from PostgreSQL.
 * @db-read purchase_orders, purchase_lines, order_items, orders, products, markets, purchase_order_authorizations, manual_purchase_executions, supplier_execution_payments, supplier_payment_settlements, v_purchase_line_progress, hub_purchase_allocations, hub_physical_units, hub_physical_unit_placements, local_stock_allocations
 * @db-write none
 * @impact-areas staging-only, hub, purchasing, logistics
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {marketProfile}=require('./canonical/market-profile');
const {login}=require('./g6-hub-commitment-chromium');
const {buildM06ReceiptPlan}=require('./canonical/m06-receipt-plan');
const {observe,fullError}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill,humanCheck}=require('./canonical/actors/human-gestures');
const env=process.env,MK=marketProfile(env),BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE,PO=env.G6_CANONICAL_PO_ID;
const OUT=path.resolve('test-results/g6-m06-receiving');
const UUID=/^[a-f0-9-]{36}$/i,SHA=/^[a-f0-9]{40}$/i;
let OBS=null;
const report={schema:'komerce-g6-m06-receiving/1',scenario_id:'M06',market:'KM',
 order_id:ID||null,reference:REF||null,po_id:PO||null,verdict:'NOT_PROVEN',
 physical_receipt_certified:false,external_supplier_calls:0,external_payment_executed:false,
 production_permitted:false,ui_gestures:[],oracle_ids:['O-HUB','O-FIN']};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');};
const check=(ok,code)=>{if(!ok)throw Error(code);};
const digest=value=>crypto.createHash('sha256').update(String(value)).digest('hex');

async function runtime(){
 const r=await fetch(BASE+'/health/version',{redirect:'error'});
 check(r.status===200,'G6_M06_RECEIPT_HEALTH_HTTP_'+r.status);
 const sha=String((await r.json()).commit||'');
 check(SHA.test(sha)&&sha===env.E2E_EXPECTED_DEPLOY_SHA,'G6_M06_RECEIPT_RUNTIME_SHA_DRIFT');
 return sha;
}

async function readState(){
 const {rows}=await db.query(`SELECT po.id AS po_id,po.status::text AS po_status,po.trigger_mode,
    o.id AS order_id,o.reference,o.simulation_scope,o.payment_status::text AS payment_status,
    m.code AS market,pl.id AS line_id,pl.product_sku_id,pl.quantity,pl.confirmed_quantity,
    oi.quantity AS order_quantity,oi.procure_on_order,oi.fulfillment_source::text AS fulfillment_source,
    p.product_ref,
    (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='purchase_commitment') AS commitment_count,
    (SELECT max(a.amount)::text FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='purchase_commitment') AS commitment_amount,
    (SELECT max(a.currency) FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='purchase_commitment') AS commitment_currency,
    (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='supplier_payment') AS payment_authorization_count,
    (SELECT max(a.amount)::text FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='supplier_payment') AS payment_authorization_amount,
    (SELECT max(a.currency) FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='supplier_payment') AS payment_authorization_currency,
    (SELECT count(*)::int FROM supplier_execution_payments x WHERE x.purchase_order_id=po.id) AS external_payment_rows,
    (SELECT count(*)::int FROM supplier_payment_settlements s JOIN supplier_execution_payments x ON x.id=s.supplier_execution_payment_id WHERE x.purchase_order_id=po.id) AS settlement_rows,
    (SELECT coalesce(sum(v.received_quantity),0)::int FROM v_purchase_line_progress v WHERE v.line_id=pl.id) AS received_quantity,
    (SELECT count(*)::int FROM hub_purchase_allocations a WHERE a.purchase_line_id=pl.id) AS purchase_allocations_count,
    (SELECT count(*)::int FROM hub_purchase_allocations a JOIN hub_physical_unit_placements h ON h.allocation_id=a.id AND h.removed_at IS NULL WHERE a.purchase_line_id=pl.id AND h.operation_type='RECEIVE') AS receive_placements_count,
    (SELECT count(*)::int FROM local_stock_allocations l WHERE l.order_id=o.id) AS local_stock_allocations_count
   FROM purchase_orders po JOIN purchase_lines pl ON pl.purchase_order_id=po.id AND pl.cancelled_at IS NULL
   JOIN order_items oi ON oi.id=pl.order_item_id JOIN products p ON p.id=oi.product_id
   JOIN orders o ON o.id=oi.order_id JOIN markets m ON m.id=o.market_id
   WHERE po.id=$1 AND o.id=$2 AND o.reference=$3 GROUP BY po.id,o.id,m.id,pl.id,oi.id,p.id`,[PO,ID,REF]);
 if(rows.length!==1)throw Error('G6_M06_RECEIPT_PO_LINE_NOT_UNIQUE');
 const executions=(await db.query(`SELECT seller_label,quantity,amount::text AS amount,currency,proof_ref
   FROM manual_purchase_executions WHERE purchase_order_id=$1 ORDER BY id`,[PO])).rows;
 return {...rows[0],scenario_id:'M06',executions};
}

async function readPhysical(reference){
 return (await db.query(`SELECT u.id,u.reference,u.unit_type::text AS unit_type,u.state::text AS state,
    a.id AS allocation_id,a.purchase_order_id,a.purchase_line_id,a.quantity AS allocation_quantity,
    p.quantity AS received_quantity,p.operation_type::text AS operation_type,
    p.evidence_method::text AS evidence_method,p.evidence_ref
   FROM hub_physical_units u JOIN hub_physical_unit_placements p ON p.physical_unit_id=u.id AND p.removed_at IS NULL
   JOIN hub_purchase_allocations a ON a.id=p.allocation_id
   WHERE u.reference=$1 AND a.purchase_order_id=$2 ORDER BY p.id`,[reference,PO])).rows;
}

async function main(){
 let browser;
 try{
  save();
  const proof=typeof env.G6_M06_RECEIPT_PROOF_REF==='string'?env.G6_M06_RECEIPT_PROOF_REF.trim():'';
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&
   env.STAGING_BASE_URL===BASE&&env.G6_CANONICAL_SCENARIO==='M06'&&
   env.G6_CANONICAL_PHASE==='M06_HUB_RECEIVING'&&env.G6_TARGET_MARKET==='KM'&&
   env.G6_DYNAMIC_FRESH_ORDER==='1'&&UUID.test(ID||'')&&UUID.test(PO||'')&&
   /^[A-Z0-9][A-Z0-9-]{5,63}$/.test(REF||'')&&SHA.test(env.E2E_EXPECTED_DEPLOY_SHA||'')&&
   !!env.G6_CANONICAL_DB_FINGERPRINT&&!!env.DATABASE_URL&&proof.length>=6&&proof.length<=500,
   'G6_M06_RECEIPT_OWNER_STAGING_GUARD');
  const target=await confirmTarget({db,env});
  check(target.confirmed&&target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_M06_RECEIPT_DB_TARGET_MISMATCH');
  report.db_fingerprint=target.fingerprint;report.sha=await runtime();
  const before=await readState(),plan=buildM06ReceiptPlan(before,proof);
  check(Number(before.local_stock_allocations_count)===0,'G6_M06_RECEIPT_LOCAL_STOCK_ALLOCATION_PRESENT');
  report.before={po_status:before.po_status,quantity:plan.quantity,received_quantity:before.received_quantity,
   purchase_allocations_count:before.purchase_allocations_count,receive_placements_count:before.receive_placements_count,
   commitment_amount:Number(before.commitment_amount),authorized_amount:Number(before.payment_authorization_amount),
   purchase_total:plan.confirmed_total,manual_execution_count:plan.execution_count,
   distinct_sellers:plan.distinct_sellers,local_stock_allocations_count:before.local_stock_allocations_count,
   external_payment_rows:before.external_payment_rows,settlement_rows:before.settlement_rows,read_only:true};
  report.receipt_proof_ref_hash=digest(plan.proof_ref);save();
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const actor=await login(browser,'E2E_AGENT_HUB_',{readOnly:true});
  try{
   let allowed=0,blocked=0,receiptRef=null;
   const endpoint=BASE+'/api/scans/hub/receive';
   await actor.page.route(endpoint,async route=>{
    const req=route.request();let body;try{body=req.postDataJSON()}catch(_){body=null;}
    const contents=Array.isArray(body?.contents)?body.contents:[];
    const exact=contents.length===1&&contents[0].purchase_order_id===PO&&
     contents[0].product_sku_id===plan.product_sku_id&&Number(contents[0].quantity)===plan.quantity&&
     contents[0].evidence_method==='MANUAL'&&contents[0].evidence_ref===plan.proof_ref&&
     /^SUPPLIER_PACKAGE-[a-f0-9-]{36}$/i.test(String(body?.reference||''));
    if(req.method()==='POST'&&allowed===0&&exact){allowed++;receiptRef=body.reference;return route.continue();}
    blocked++;return route.abort('blockedbyclient');
   });
   await humanGoto(actor.page,BASE+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});
   await humanClick(null,actor.page.getByRole('tab',{name:'Réceptions'}));
   const card=actor.page.locator('[data-receive-po="'+PO+'"]');
   await card.waitFor({state:'visible',timeout:25000});
   await actor.page.screenshot({path:path.join(OUT,'receiving-screen-before-entry.png')});
   await humanCheck(null,card.locator('[data-receive-manual-toggle]'));
   await humanFill(null,card.locator('[data-receive-manual-proof]'),plan.proof_ref);
   const quantity=card.locator('[data-receive-line="0"]');
   check(await card.locator('[data-receive-line]').count()===1,'G6_M06_RECEIPT_UI_LINE_NOT_UNIQUE');
   await humanFill(null,quantity,String(plan.quantity));
   const button=card.locator('[data-workspace-action="receive-supplier"]');
   check(await button.isEnabled(),'G6_M06_RECEIPT_UI_ACTION_DISABLED');
   const pending=actor.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/scans/hub/receive'&&
    r.request().method()==='POST',{timeout:30000});
   await humanClick(null,button);
   const response=await pending,json=await response.json().catch(()=>({}));
   check(allowed===1&&blocked===0,'G6_M06_RECEIPT_REQUEST_SCOPE_INVALID');
   check([200,201].includes(response.status())&&!json.quarantined&&
    json.unit?.reference===receiptRef&&json.unit?.unit_type==='SUPPLIER_PACKAGE'&&
    json.reconciliation_pending===false,'G6_M06_RECEIPT_UI_HTTP_OR_RECONCILIATION_INVALID');
   check(actor.blocked.length===0,'G6_M06_RECEIPT_UNEXPECTED_BROWSER_WRITE');
   report.receipt={http:response.status(),reference:receiptRef,unit_type:json.unit.unit_type,
    state:json.unit.state,allocated_quantity:plan.quantity,manual_evidence:true};save();
   report.ui_gestures.push({page:'/admin/hub-live',tab:'Réceptions',action:'receive-supplier',method:'pointer click',http:response.status()});
  }finally{await actor.ctx.close();}
  await runtime();
  const after=await readState(),physical=await readPhysical(report.receipt.reference);
  check(after.po_status==='hub_received'&&Number(after.received_quantity)===3&&
   Number(after.purchase_allocations_count)===1&&Number(after.receive_placements_count)===1&&
   Number(after.payment_authorization_count)===1&&Number(after.external_payment_rows)===0&&
   Number(after.settlement_rows)===0&&Number(after.local_stock_allocations_count)===0,
   'G6_M06_RECEIPT_POSTGRES_PROGRESS_INVALID');
  check(physical.length===1&&physical[0].unit_type==='SUPPLIER_PACKAGE'&&
   physical[0].state==='IDENTIFIED'&&Number(physical[0].allocation_quantity)===3&&
   Number(physical[0].received_quantity)===3&&physical[0].operation_type==='RECEIVE'&&
   physical[0].evidence_method==='MANUAL'&&physical[0].evidence_ref===proof,
   'G6_M06_RECEIPT_POSTGRES_PHYSICAL_ORACLE_INVALID');
  report.after={po_status:after.po_status,received_quantity:Number(after.received_quantity),
   purchase_allocations_count:Number(after.purchase_allocations_count),receive_placements_count:Number(after.receive_placements_count),
   local_stock_allocations_count:Number(after.local_stock_allocations_count),external_payment_rows:Number(after.external_payment_rows),
   settlement_rows:Number(after.settlement_rows),read_only:true};
  report.after.receipt_proof_ref_hash=digest(physical[0].evidence_ref);
  report.physical_receipt_certified=true;report.verdict='G6_M06_PHYSICAL_RECEIPT_CHROMIUM_PG_PASS';
 }catch(e){report.error=fullError(e);report.verdict='BLOCKED';process.exitCode=2;}
 finally{save();if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end().catch(()=>{});
  console.log(JSON.stringify({verdict:report.verdict,error:report.error||null,reference:REF||null,po_id:PO||null,
   external_supplier_calls:0,external_payment_executed:false}));}
}

if(require.main===module)main();
module.exports={main,readState,readPhysical};
