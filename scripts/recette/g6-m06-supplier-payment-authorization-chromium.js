#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-m06-supplier-payment-authorization-chromium
 * @domain purchasing
 * @layer script
 * @owner backend-core
 * @purpose Record the second, internal M06 supplier-payment authorization through the Hub UI from persisted manual-purchase totals.
 * @db-read purchase_orders, purchase_lines, order_items, orders, products, markets, purchase_order_authorizations, manual_purchase_executions, supplier_execution_payments, supplier_payment_settlements
 * @db-write none
 * @impact-areas staging-only, purchasing, hub
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {runtime}=require('./g6-hub-shipment-chromium');
const {marketProfile,marketOption}=require('./canonical/market-profile');
const {deriveM06SupplierPaymentAuthorization}=require('./canonical/m06-supplier-payment-authorization');
const {observe,fullError,startTraceAfterAuth}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill,humanSelect}=require('./canonical/actors/human-gestures');
const env=process.env,MK=marketProfile(env),BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE,PO=env.G6_CANONICAL_PO_ID;
const OUT=path.resolve('test-results/g6-m06-supplier-payment-authorization');
const UUID=/^[a-f0-9-]{36}$/i,SHA=/^[a-f0-9]{40}$/i;
let OBS=null;
const report={schema:'komerce-g6-m06-supplier-payment-authorization/1',scenario_id:'M06',market:'KM',
 order_id:ID||null,reference:REF||null,po_id:PO||null,verdict:'NOT_PROVEN',
 external_supplier_calls:0,external_payment_executed:false,production_permitted:false,
 ui_gestures:[],oracle_ids:['O-HUB','O-FIN']};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');};
const check=(ok,code)=>{if(!ok)throw Error(code);};
const digest=value=>crypto.createHash('sha256').update(String(value)).digest('hex');

async function readState(){
 const {rows}=await db.query(`SELECT po.id AS po_id,po.status::text AS po_status,po.trigger_mode,
    o.id AS order_id,o.reference,o.simulation_scope,o.payment_status::text AS payment_status,
    m.code AS market,pl.id AS line_id,pl.quantity,pl.confirmed_quantity,
    pl.confirmed_unit_price::text AS confirmed_unit_price,
    oi.quantity AS order_quantity,oi.procure_on_order,oi.fulfillment_source::text AS fulfillment_source,
    p.product_ref,
    (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='purchase_commitment') AS commitment_count,
    (SELECT max(a.amount)::text FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='purchase_commitment') AS commitment_amount,
    (SELECT max(a.currency) FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='purchase_commitment') AS commitment_currency,
    (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='supplier_payment') AS payment_authorization_count,
    (SELECT count(*)::int FROM supplier_execution_payments x WHERE x.purchase_order_id=po.id) AS external_payment_rows,
    (SELECT count(*)::int FROM supplier_payment_settlements s JOIN supplier_execution_payments x ON x.id=s.supplier_execution_payment_id WHERE x.purchase_order_id=po.id) AS settlement_rows
   FROM purchase_orders po JOIN purchase_lines pl ON pl.purchase_order_id=po.id AND pl.cancelled_at IS NULL
   JOIN order_items oi ON oi.id=pl.order_item_id JOIN products p ON p.id=oi.product_id
   JOIN orders o ON o.id=oi.order_id JOIN markets m ON m.id=o.market_id
   WHERE po.id=$1 AND o.id=$2 AND o.reference=$3 GROUP BY po.id,o.id,m.id,pl.id,oi.id,p.id`,[PO,ID,REF]);
 if(rows.length!==1)throw Error('G6_M06_PAYMENT_AUTH_PO_LINE_NOT_UNIQUE');
 const executions=(await db.query(`SELECT seller_label,quantity,amount::text AS amount,currency,proof_ref
   FROM manual_purchase_executions WHERE purchase_order_id=$1 ORDER BY id`,[PO])).rows;
 return {...rows[0],scenario_id:'M06',executions};
}

async function loginDirector(browser,expectedProofRef){
 const email=env.E2E_HUB_DIRECTOR_EMAIL,password=env.E2E_HUB_DIRECTOR_PASSWORD;
 check(email&&password,'G6_M06_PAYMENT_AUTH_DIRECTOR_CREDENTIALS_MISSING');
 const ctx=await browser.newContext({baseURL:BASE,viewport:{width:1440,height:900}}),page=await ctx.newPage();
 let authAllowed=true,writeEnabled=false,allowedWrites=0;const blocked=[];
 page.on('dialog',dialog=>dialog.accept());
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(['GET','HEAD','OPTIONS'].includes(req.method()))return route.continue();
  if(authAllowed&&req.method()==='POST'&&url.origin===BASE&&url.pathname==='/api/auth/login'){
   authAllowed=false;return route.continue();
  }
  if(writeEnabled&&req.method()==='POST'&&url.origin===BASE&&url.pathname==='/api/purchasing/po/'+PO+'/authorize-payment'){
   let body;try{body=req.postDataJSON()}catch(_){body=null;}
   if(allowedWrites===0&&body&&body.proof_ref===expectedProofRef&&
      Number(body.amount)===report.authorization_amount&&body.currency===report.authorization_currency){
    allowedWrites++;return route.continue();
   }
  }
  blocked.push({method:req.method(),path:url.pathname});
  return route.abort('blockedbyclient');
 });
 await humanGoto(page,'/login.html?next='+encodeURIComponent('/admin/hub-live?view=execute&market=KM'),{waitUntil:'domcontentloaded'});
 await humanFill(null,page.locator('#email'),email);await humanFill(null,page.locator('#password'),password);
 const loginResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
 await humanClick(null,page.locator('#btn-submit'));
 check((await loginResponse).status()===200,'G6_M06_PAYMENT_AUTH_LOGIN_FAILED');
 await page.waitForURL(u=>u.pathname!=='/login.html',{timeout:20000});
 const me=await page.request.get('/api/auth/me'),identity=await me.json().catch(()=>({}));
 check(me.ok()&&identity.role==='agent_hub','G6_M06_PAYMENT_AUTH_DIRECTOR_ROLE_INVALID');
 await startTraceAfterAuth(ctx);
 return {ctx,page,blocked,get allowedWrites(){return allowedWrites;},enableWrite(){writeEnabled=true;}};
}

async function openPo(page){
 await humanGoto(page,BASE+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});
 const market=page.locator('select').first();await market.waitFor({state:'visible',timeout:20000});
 const option=await marketOption(MK,market);if(await market.inputValue()!==option.value)await humanSelect(null,market,option);
 await page.locator('[data-hub-cockpit][data-hlc-ready="true"]').first().waitFor({timeout:25000});
 const po=page.locator('[data-hlc-po="'+PO+'"]');await po.waitFor({state:'visible',timeout:25000});
 await humanClick(null,po.locator('.hlc-ref').first());
 await po.and(page.locator('.is-selected')).waitFor({state:'visible',timeout:10000})
  .catch(()=>{throw Error('G6_M06_PAYMENT_AUTH_PO_NOT_SELECTED');});
}

async function main(){
 let browser;
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&
   env.STAGING_BASE_URL===BASE&&env.G6_CANONICAL_SCENARIO==='M06'&&
   env.G6_CANONICAL_PHASE==='M06_SUPPLIER_PAYMENT_AUTHORIZATION'&&env.G6_TARGET_MARKET==='KM'&&
   env.G6_DYNAMIC_FRESH_ORDER==='1'&&UUID.test(ID||'')&&UUID.test(PO||'')&&
   /^[A-Z0-9][A-Z0-9-]{5,63}$/.test(REF||'')&&SHA.test(env.E2E_EXPECTED_DEPLOY_SHA||'')&&
   !!env.G6_CANONICAL_DB_FINGERPRINT&&!!env.DATABASE_URL&&
   typeof env.G6_M06_PAYMENT_AUTHORIZATION_PROOF==='string'&&env.G6_M06_PAYMENT_AUTHORIZATION_PROOF.trim().length>=4,
   'G6_M06_PAYMENT_AUTH_OWNER_STAGING_GUARD');
  const target=await confirmTarget({db,env});
  check(target.confirmed&&target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_M06_PAYMENT_AUTH_DB_TARGET_MISMATCH');
  report.db_fingerprint=target.fingerprint;report.sha=await runtime();
  const before=await readState();
  const plan=deriveM06SupplierPaymentAuthorization(before,env.G6_M06_PAYMENT_AUTHORIZATION_PROOF);
  report.authorization_amount=plan.amount;report.authorization_currency=plan.currency;
  report.authorization_proof_ref_hash=digest(plan.proof_ref);
  report.before={po_status:before.po_status,commitment_count:before.commitment_count,
   commitment_amount:Number(before.commitment_amount),commitment_currency:before.commitment_currency,
   payment_authorization_count:before.payment_authorization_count,manual_execution_count:before.executions.length,
   purchase_total:plan.amount,distinct_sellers:plan.distinct_sellers,external_payment_rows:before.external_payment_rows,
   settlement_rows:before.settlement_rows,read_only:true};
  check(Number(before.external_payment_rows)===0&&Number(before.settlement_rows)===0,
   'G6_M06_PAYMENT_AUTH_EXTERNAL_PAYMENT_ALREADY_EXISTS');
  save();
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const director=await loginDirector(browser,plan.proof_ref);
  try{
   const grants=await director.page.request.get('/api/hub/administration'),grantData=await grants.json().catch(()=>({}));
   check(grants.status()===200&&grantData.viewer_grants?.supplier_payment===true,
    'G6_M06_PAYMENT_AUTH_DIRECTOR_GRANT_MISSING');
   await openPo(director.page);
   const action=director.page.locator('[data-hlc-action="authorize-payment"]');
   check(await action.count()===1&&await action.isEnabled(),'G6_M06_PAYMENT_AUTH_UI_ACTION_DISABLED');
   await director.page.screenshot({path:path.join(OUT,'payment-authorization-action.png')});
   await humanClick(null,action);
   await director.page.locator('[data-hub-decision-workspace]').waitFor({state:'visible',timeout:20000});
   await action.waitFor({state:'visible',timeout:20000});
   check(await action.isEnabled(),'G6_M06_PAYMENT_DIRECTION_ACTION_DISABLED');
   await humanClick(null,action);
   const form=director.page.locator('form[data-hlc-form="payment"]');
   await form.waitFor({state:'visible',timeout:15000});
   const amount=form.locator('input[name="amount"]'),currency=form.locator('input[name="currency"]');
   const proof=form.locator('input[name="proof_ref"]');
   check(await amount.count()===1&&await currency.count()===1&&await proof.count()===1,
    'G6_M06_PAYMENT_AUTH_FORM_FIELDS_MISSING');
   await humanFill(null,amount,String(plan.amount));await humanFill(null,currency,plan.currency);
   await humanFill(null,proof,plan.proof_ref);
   check(Number(await amount.inputValue())===plan.amount&&
     (await currency.inputValue()).trim().toUpperCase()===plan.currency&&
     await proof.inputValue()===plan.proof_ref,'G6_M06_PAYMENT_AUTH_FORM_CAPTURE_DRIFT');
   director.enableWrite();
   const pending=director.page.waitForResponse(r=>new URL(r.url()).pathname===
    '/api/purchasing/po/'+PO+'/authorize-payment'&&r.request().method()==='POST',{timeout:25000});
   await humanClick(null,form.locator('[data-hlc-action="submit-payment"]'));
   const response=await pending,json=await response.json().catch(()=>({}));
   report.authorization_http={status:response.status(),code:json.code||null};save();
   check(director.allowedWrites===1,'G6_M06_PAYMENT_AUTH_REQUEST_SCOPE_INVALID');
   check(response.status()===201,'G6_M06_PAYMENT_AUTH_HTTP_'+response.status());
   check(director.blocked.length===0,'G6_M06_PAYMENT_AUTH_UNEXPECTED_BROWSER_WRITE');
   report.ui_gestures.push({page:'/admin/hub-live',action:'authorize-payment',method:'pointer click',http:response.status()});
  }finally{await director.ctx.close();}
  await runtime();
  const after=await readState();
  const auth=(await db.query(`SELECT authorization_type,amount::text AS amount,currency,proof_ref,decided_by
    FROM purchase_order_authorizations WHERE purchase_order_id=$1 AND authorization_type='supplier_payment'`,[PO])).rows;
  check(after.po_status==='confirmed'&&Number(after.commitment_count)===1&&
   Number(after.payment_authorization_count)===1&&Number(after.external_payment_rows)===0&&
   Number(after.settlement_rows)===0&&auth.length===1&&Number(auth[0].amount)===plan.amount&&
   auth[0].currency===plan.currency&&auth[0].proof_ref===plan.proof_ref&&
   Number(after.commitment_amount)>=Number(auth[0].amount),
   'G6_M06_PAYMENT_AUTH_POSTGRES_READBACK_INVALID');
  report.after={po_status:after.po_status,commitment_count:after.commitment_count,
   payment_authorization_count:after.payment_authorization_count,external_payment_rows:after.external_payment_rows,
   settlement_rows:after.settlement_rows,authorized_amount:Number(auth[0].amount),currency:auth[0].currency,
   proof_ref:digest(auth[0].proof_ref),read_only:true};
  report.verdict='G6_M06_SEPARATE_PAYMENT_AUTHORIZATION_CHROMIUM_PG_PASS';
 }catch(e){report.error=fullError(e);report.verdict='BLOCKED';process.exitCode=2;}
 finally{save();if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end().catch(()=>{});
  console.log(JSON.stringify({verdict:report.verdict,error:report.error||null,reference:REF||null,po_id:PO||null,
   external_supplier_calls:0,external_payment_executed:false}));}
}

if(require.main===module)main();
module.exports={main,readState};
