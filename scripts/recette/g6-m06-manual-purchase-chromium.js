#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-m06-manual-purchase-chromium
 * @domain purchasing
 * @layer script
 * @owner backend-core
 * @purpose Record operator-supplied real seller allocations through the canonical Purchasing screen, then independently read back PostgreSQL.
 * @db-read purchase_orders, purchase_lines, order_items, orders, suppliers, purchase_order_authorizations, manual_purchase_executions, supplier_execution_payments
 * @db-write none
 * @impact-areas staging-only, purchasing, hub
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {runtime}=require('./g6-hub-shipment-chromium');
const {login}=require('./g6-canonical-forwarder-chromium');
const {captureFromEnv}=require('./canonical/m06-manual-purchase-capture');
const {observe,fullError}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill,humanSelect}=require('./canonical/actors/human-gestures');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE,PO=env.G6_CANONICAL_PO_ID;
const OUT=path.resolve('test-results/g6-m06-manual-purchase');
const UUID=/^[a-f0-9-]{36}$/i, SHA=/^[a-f0-9]{40}$/i;
let OBS=null;
const report={schema:'komerce-g6-m06-manual-purchase/1',scenario_id:'M06',market:'KM',
 order_id:ID||null,reference:REF||null,po_id:PO||null,verdict:'NOT_PROVEN',
 external_supplier_calls:0,external_payment_executed:false,production_permitted:false,
 ui_gestures:[],oracle_ids:['O-HUB','O-FIN']};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');};
const check=(ok,code)=>{if(!ok)throw Error(code);};
const digest=value=>crypto.createHash('sha256').update(String(value)).digest('hex');

async function readState(){
 const {rows}=await db.query(`SELECT po.id AS po_id,po.status::text AS po_status,po.trigger_mode,
    s.system_key,o.id AS order_id,o.reference,o.simulation_scope,o.payment_status::text AS payment_status,
    m.code AS market,pl.id AS line_id,pl.quantity,pl.confirmed_quantity,
    pl.confirmed_unit_price,pl.confirmed_currency,pl.supplier_unit_price,pl.supplier_currency,
    oi.quantity AS order_quantity,oi.procure_on_order,oi.fulfillment_source::text AS fulfillment_source,
    p.product_ref,
    (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='purchase_commitment') AS commitment_count,
    (SELECT max(a.amount)::numeric FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='purchase_commitment') AS commitment_amount,
    (SELECT max(a.currency) FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='purchase_commitment') AS commitment_currency,
    (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='supplier_payment') AS payment_authorization_count,
    (SELECT count(*)::int FROM manual_purchase_executions e WHERE e.purchase_order_id=po.id) AS execution_count,
    (SELECT count(*)::int FROM cash_collections c WHERE c.order_id=o.id) AS cash_count,
    (SELECT count(*)::int FROM cash_confirmation_controls c WHERE c.order_id=o.id AND c.state='CONFIRMED') AS cash_control_count
   FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id
   JOIN purchase_lines pl ON pl.purchase_order_id=po.id AND pl.cancelled_at IS NULL
   JOIN order_items oi ON oi.id=pl.order_item_id JOIN products p ON p.id=oi.product_id
   JOIN orders o ON o.id=oi.order_id JOIN markets m ON m.id=o.market_id
   WHERE po.id=$1 AND o.id=$2 AND o.reference=$3 ORDER BY pl.id`,[PO,ID,REF]);
 if(rows.length!==1)throw Error('G6_M06_MANUAL_PURCHASE_PO_LINE_NOT_UNIQUE');
 return rows[0];
}

function verifyPrecondition(state){
 check(state.po_id===PO&&state.order_id===ID&&state.reference===REF&&state.market==='KM'&&
   state.simulation_scope==='G6-BUYER'&&state.payment_status==='paid'&&
   state.cash_count===1&&state.cash_control_count===1,'G6_M06_MANUAL_PURCHASE_ORDER_NOT_PAID_CASH');
 check(state.product_ref==='KPR-000255'&&state.procure_on_order===true&&
   state.fulfillment_source==='IMPORT'&&Number(state.order_quantity)===3&&
   Number(state.quantity)===3,'G6_M06_MANUAL_PURCHASE_ON_ORDER_LINE_MISMATCH');
 check(state.system_key==='central_hub'&&state.trigger_mode==='manual'&&
   state.po_status==='notified'&&state.commitment_count===1&&
   state.payment_authorization_count===0&&state.execution_count===0&&
   state.confirmed_quantity===null&&state.supplier_unit_price===null&&state.supplier_currency===null,
  'G6_M06_MANUAL_PURCHASE_PRECONDITION_INVALID');
}

async function main(){
 let browser;
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
    env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
    env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&
    env.STAGING_BASE_URL===BASE&&env.G6_CANONICAL_SCENARIO==='M06'&&
    env.G6_CANONICAL_PHASE==='M06_MANUAL_PURCHASE'&&env.G6_TARGET_MARKET==='KM'&&
    env.G6_DYNAMIC_FRESH_ORDER==='1'&&UUID.test(ID||'')&&UUID.test(PO||'')&&
    /^[A-Z0-9][A-Z0-9-]{5,63}$/.test(REF||'')&&SHA.test(env.E2E_EXPECTED_DEPLOY_SHA||'')&&
    !!env.G6_CANONICAL_DB_FINGERPRINT&&!!env.DATABASE_URL,
   'G6_M06_MANUAL_PURCHASE_OWNER_STAGING_GUARD');
  const target=await confirmTarget({db,env});
  check(target.confirmed&&target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_M06_MANUAL_PURCHASE_DB_TARGET_MISMATCH');
  report.db_fingerprint=target.fingerprint;report.sha=await runtime();
  const before=await readState();verifyPrecondition(before);
  const capture=captureFromEnv(env,{orderQuantity:Number(before.quantity),
    commitmentAmount:Number(before.commitment_amount),currency:before.commitment_currency});
  const lineTotal=Number((capture.confirmed_unit_price*capture.confirmed_quantity).toFixed(4));
  const variance=Math.abs(lineTotal-capture.justified_total)>0.0001;
  check(!variance||!!capture.variance_reason,'G6_M06_MANUAL_PURCHASE_VARIANCE_REASON_REQUIRED');
  report.before={po_status:before.po_status,commitment_count:before.commitment_count,
   payment_authorization_count:before.payment_authorization_count,execution_count:before.execution_count,
   order_quantity:Number(before.order_quantity),procure_on_order:true,read_only:true};
  report.capture={allocation_count:capture.allocations.length,
   sellers:capture.allocations.map(a=>digest(a.seller_label)),
   proof_refs:capture.allocations.map(a=>digest(a.proof_ref)),
   quantities:capture.allocations.map(a=>a.quantity),amounts:capture.allocations.map(a=>a.amount),
   currency:capture.confirmed_currency,confirmed_unit_price:capture.confirmed_unit_price,
   confirmed_total:lineTotal,justified_total:capture.justified_total,
   purchase_proof_ref:digest(capture.purchase_proof_ref)};
  save();
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const admin=await login(browser,'E2E_ADMIN_','admin');
  try{
   await humanGoto(admin.page,BASE+'/admin/workspaces/purchasing?po='+encodeURIComponent(PO),{waitUntil:'domcontentloaded'});
   const form=admin.page.locator('[data-purchasing-po="'+PO+'"] form[data-purchasing-confirm]');
   await form.waitFor({state:'visible',timeout:30000});
   const quantities=form.locator('[data-confirmed-quantity]');
   const prices=form.locator('[data-confirmed-price]');
   const currencies=form.locator('[data-confirmed-currency]');
   check(await quantities.count()===1&&await prices.count()===1&&await currencies.count()===1,
    'G6_M06_MANUAL_PURCHASE_SCREEN_FIELDS_MISSING');
   await humanFill(null,quantities.first(),String(capture.confirmed_quantity));
   await humanFill(null,prices.first(),String(capture.confirmed_unit_price));
   await humanFill(null,currencies.first(),capture.confirmed_currency);
   await humanFill(null,form.locator('[data-purchase-proof-ref]'),capture.purchase_proof_ref);
   const varianceField=form.locator('[data-purchase-variance-reason]');
   if(capture.variance_reason){
    check(await varianceField.count()===1,'G6_M06_MANUAL_PURCHASE_VARIANCE_FIELD_MISSING');
    await humanFill(null,varianceField,capture.variance_reason);
   }
   const add=form.locator('[data-purchase-add-allocation]');
   for(let i=0;i<capture.allocations.length;i++)await humanClick(null,add);
   const rows=form.locator('[data-purchase-allocation-rows] .kmc-purchase-allocation');
   check(await rows.count()===capture.allocations.length,'G6_M06_MANUAL_PURCHASE_ALLOCATION_ROWS_MISSING');
   for(let i=0;i<capture.allocations.length;i++){
    const allocation=capture.allocations[i],row=rows.nth(i);
    await humanFill(null,row.locator('[data-purchase-execution-seller]'),allocation.seller_label);
    await humanSelect(null,row.locator('[data-purchase-execution-channel]'),allocation.channel);
    await humanFill(null,row.locator('[data-purchase-execution-quantity]'),String(allocation.quantity));
    await humanFill(null,row.locator('[data-purchase-execution-amount]'),String(allocation.amount));
    await humanFill(null,row.locator('[data-purchase-execution-currency]'),allocation.currency);
    await humanFill(null,row.locator('[data-purchase-execution-proof]'),allocation.proof_ref);
   }
   await admin.page.screenshot({path:path.join(OUT,'before-confirm.png')});
   const url=BASE+'/api/purchasing/po/'+PO+'/confirm';let allowed=0,blocked=0;
   await admin.page.route(url,route=>{
    const req=route.request();let body;try{body=req.postDataJSON()}catch(_){body=null}
    const lines=body?.lines||[],execs=body?.executions||[];
    const exactLine=lines.length===1&&lines[0].purchase_line_id===before.line_id&&
      lines[0].confirmed_quantity===capture.confirmed_quantity&&
      lines[0].confirmed_unit_price===capture.confirmed_unit_price&&
      lines[0].confirmed_currency===capture.confirmed_currency;
    const exactExecs=execs.length===capture.allocations.length&&capture.allocations.every(a=>
      execs.some(e=>e.purchase_line_id===before.line_id&&e.seller_label===a.seller_label&&
       e.channel===a.channel&&e.quantity===a.quantity&&e.amount===a.amount&&
       e.currency===a.currency&&e.proof_ref===a.proof_ref));
    if(req.method()==='POST'&&allowed===0&&exactLine&&exactExecs&&
       body.purchase_proof_ref===capture.purchase_proof_ref&&body.simulated!==true){
     allowed++;return route.continue();
    }
    blocked++;return route.abort('blockedbyclient');
   });
   const pending=admin.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:25000});
   await humanClick(null,form.locator('[data-workspace-action="confirm-po"]'));
   const response=await pending,json=await response.json().catch(()=>({}));
   report.confirm_http={status:response.status(),code:json.code||null};save();
   check(allowed===1&&blocked===0,'G6_M06_MANUAL_PURCHASE_REQUEST_SCOPE_INVALID');
   check(response.status()===200,'G6_M06_MANUAL_PURCHASE_CONFIRM_HTTP_'+response.status());
   await admin.page.screenshot({path:path.join(OUT,'after-confirm.png')});
   report.ui_gestures.push({page:'/admin/workspaces/purchasing',action:'confirm-po',method:'pointer click',http:response.status()});
  }finally{await admin.ctx.close();}
  await runtime();
  const {rows:after}=await db.query(`SELECT po.status::text AS po_status,
      (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='purchase_commitment') AS commitment_count,
      (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='supplier_payment') AS payment_authorization_count,
      (SELECT count(*)::int FROM manual_purchase_executions e WHERE e.purchase_order_id=po.id) AS execution_count,
      (SELECT COALESCE(sum(e.quantity),0)::int FROM manual_purchase_executions e WHERE e.purchase_order_id=po.id) AS execution_quantity,
      (SELECT COALESCE(sum(e.amount),0)::numeric FROM manual_purchase_executions e WHERE e.purchase_order_id=po.id) AS justified_total,
      (SELECT count(DISTINCT lower(e.seller_label))::int FROM manual_purchase_executions e WHERE e.purchase_order_id=po.id) AS distinct_sellers,
      (SELECT count(*)::int FROM supplier_execution_payments x WHERE x.purchase_order_id=po.id) AS external_payment_rows,
      pl.confirmed_quantity,pl.confirmed_unit_price::numeric AS confirmed_unit_price,pl.confirmed_currency
    FROM purchase_orders po JOIN purchase_lines pl ON pl.purchase_order_id=po.id AND pl.cancelled_at IS NULL
    WHERE po.id=$1 GROUP BY po.id,pl.id`,[PO]);
  check(after.length===1&&after[0].po_status==='confirmed'&&Number(after[0].commitment_count)===1&&
    Number(after[0].payment_authorization_count)===0&&Number(after[0].execution_count)===capture.allocations.length&&
    Number(after[0].execution_quantity)===capture.confirmed_quantity&&
    Math.abs(Number(after[0].justified_total)-capture.justified_total)<=0.0001&&
    Number(after[0].distinct_sellers)>=2&&Number(after[0].external_payment_rows)===0&&
    Number(after[0].confirmed_quantity)===capture.confirmed_quantity&&
    Number(after[0].confirmed_unit_price)===capture.confirmed_unit_price&&
    after[0].confirmed_currency===capture.confirmed_currency,
   'G6_M06_MANUAL_PURCHASE_POSTGRES_READBACK_INVALID');
  report.after={po_status:after[0].po_status,commitment_count:Number(after[0].commitment_count),
   payment_authorization_count:Number(after[0].payment_authorization_count),
   execution_count:Number(after[0].execution_count),execution_quantity:Number(after[0].execution_quantity),
   justified_total:Number(after[0].justified_total),distinct_sellers:Number(after[0].distinct_sellers),
   external_payment_rows:Number(after[0].external_payment_rows),read_only:true};
  report.verdict='G6_M06_MANUAL_PURCHASE_CAPTURE_CHROMIUM_PG_PASS';
 }catch(e){report.error=fullError(e);report.verdict='BLOCKED';process.exitCode=2;}
 finally{save();if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify({verdict:report.verdict,error:report.error||null,reference:REF||null,po_id:PO||null,external_supplier_calls:0,external_payment_executed:false}));}
}

if(require.main===module)main();
module.exports={main,readState,verifyPrecondition};
