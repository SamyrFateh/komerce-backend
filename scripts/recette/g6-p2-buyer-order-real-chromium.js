/**
 * @komerce-arch-lite
 * @role          g6-buyer-otp-order-chromium
 * @domain        orders
 * @layer         test
 * @owner         backend-core
 * @purpose       Owner-only staging browser POST order; no external provider, OTP via bcrypt fixture.
 * @db-read       users, orders, order_items, e2e_test_accounts
 * @db-write      users via user-mutation-service, E2E via staging-e2e-provision, otp via auth fixture, order via HTTP only
 * @impact-areas  checkout, auth, orders
 */
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),bcrypt=require('bcryptjs');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {createAdminUser}=require('../../services/user-mutation-service');
const {markE2eTestAccount}=require('./staging-e2e-provision');
const {preseedG6BuyerOtp}=require('../../services/g6-staging-buyer-identity-guard');
const ORIGIN='https://komerce-backend-production.up.railway.app';
const PRODUCT='76dacd6c-c1d8-4313-9455-f0d8f063835b',REF='KPR-000099';
const OUT=path.resolve('test-results/g6-p2-buyer-order');
fs.mkdirSync(OUT,{recursive:true});
const run=crypto.randomBytes(4).toString('hex');
const report={run_id:process.env.GITHUB_RUN_ID||null,run8:run.toUpperCase(),
  phase:'G6-KM-CHROMIUM-REAL-OTP-ORDER',product_ref:REF,product_id:PRODUCT,
  verdict:'NOT_PROVEN',human_attestation:false,payment_real:false,supplier_order_real:false,
  blocked_requests:[],steps:[]};
const save=()=>fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');
const check=(bool,code)=>{if(!bool)throw Error(code)};
const record=(name,value)=>{report.steps.push({name,observed:value});save()};
async function runtime(){
 const r=await fetch(ORIGIN+'/health/version');
 check(r.ok,'VERSION_HTTP_'+r.status);
 const v=await r.json();
 check(/^[a-f0-9]{40}$/.test(String(v.commit||''))&&v.commit===process.env.E2E_EXPECTED_DEPLOY_SHA,'SHA_DEPLOY_DRIFT');
 report.runtime_sha=v.commit;
}
async function queryOrders(userId){
 const {rows}=await db.query(
 'SELECT o.id,o.reference,o.total_kmf,o.payment_mode::text AS payment_mode, '+
 'o.payment_status::text AS payment_status,o.status::text AS status,o.simulation_scope, '+
 'm.code AS market, '+
 '(SELECT COUNT(*)::int FROM order_items i WHERE i.order_id=o.id) AS lines, '+
 '(SELECT SUM(i.quantity)::int FROM order_items i WHERE i.order_id=o.id) AS qty, '+
 '(SELECT ARRAY_AGG(DISTINCT p.product_ref) FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=o.id) AS products '+
 'FROM orders o LEFT JOIN markets m ON m.id=o.market_id WHERE o.user_id=$1::uuid ORDER BY o.created_at',
 [userId]);
 return rows;
}
async function setup(){
 const email=process.env.E2E_ADMIN_EMAIL||'admin@komerce.km';
 check(!!process.env.E2E_ADMIN_PASSWORD,'E2E_ADMIN_PASSWORD_MISSING');
 const resp=await fetch(ORIGIN+'/api/auth/login',{method:'POST',
  headers:{origin:ORIGIN,'content-type':'application/json'},
  body:JSON.stringify({email,password:process.env.E2E_ADMIN_PASSWORD})});
 check(resp.status===200,'E2E_ADMIN_LOGIN_FAILED_'+resp.status);
 const admin=(await resp.json()).user;
 check(admin?.role==='admin','G6_ADMIN_SESSION_ROLE');
 const {rows:[actor]}=await db.query('SELECT id,role::text AS role FROM users WHERE id=$1',[admin.id]);
 check(actor?.role==='admin','G6_ADMIN_DB_ROLE');
 let phone=null;
 for(let n=0;n<18;n++){
  const p='+2693'+String(crypto.randomInt(0,1000000)).padStart(6,'0');
  const {rows}=await db.query('SELECT 1 FROM users WHERE phone=$1 OR whatsapp_phone=$1 LIMIT 1',[p]);
  if(!rows.length){phone=p;break}
 }
 check(!!phone,'G6_UNIQUE_PHONE_NOT_FOUND');
 const code=String(crypto.randomInt(100000,999999));
 const c=await db.getClient();let tx=false;
 try{
  await c.query('BEGIN');tx=true;
  const hash=await bcrypt.hash(crypto.randomBytes(20).toString('base64url'),10);
  const {rows:[buyer]}=await createAdminUser(c,{
    fullName:'G6 E2E '+run+' Client',email:'g6-e2e-'+run+'@komerce.test',
    phone,role:'client',currencyPref:'KMF',passwordHash:hash});
  check(!!buyer?.id,'G6_BUYER_MISSING');
  await markE2eTestAccount(c,{userId:buyer.id,actorId:actor.id});
  await preseedG6BuyerOtp(c,{buyer,phone,code,purpose:'login'});
  await c.query('COMMIT');tx=false;
  report.buyer_id=buyer.id;
  record('CLIENT_E2E_MARKED_AND_OTP_HASHED',{role:'client',marked:true,no_external_message:true});
  return {buyer,phone,code};
 }catch(e){if(tx)await c.query('ROLLBACK').catch(()=>{});throw e}
 finally{c.release()}
}
async function browserCheckout({buyer,phone,code}){
 const browser=await chromium.launch({headless:true});
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:900},locale:'fr-FR'});
  const page=await ctx.newPage();let orderRequests=0;
  await page.route('**/*',async route=>{
    const req=route.request(),method=req.method();
    if(['GET','HEAD','OPTIONS'].includes(method))return route.continue();
    const u=new URL(req.url());
    const meta={method,origin:u.origin,path:u.pathname,type:req.resourceType()};
    if(method==='POST'&&u.origin===ORIGIN&&
       ['/api/auth/otp/request','/api/auth/otp/verify','/api/orders'].includes(u.pathname)){
      if(u.pathname==='/api/orders'&&++orderRequests!==1){
        report.blocked_requests.push({...meta,reason:'duplicate_order_post'});
        return route.abort();
      }
      return route.continue();
    }
    if(method==='POST'&&u.origin==='https://m.stripe.com'&&u.pathname==='/6'&&req.resourceType()==='xhr')return route.abort();
    report.blocked_requests.push(meta);return route.abort();
  });
  const d=await page.goto(ORIGIN+'/boutique/?market=KM',{waitUntil:'domcontentloaded'});
  check(d?.status()===200,'BOUTIQUE_DOC_NOT_200');
  await page.locator('.k-header-nav-btn[data-tab="komerce"]').first().click();
  await page.locator('#k-kmc-identify').click();
  await page.locator('#k-id-step-phone').waitFor({state:'visible',timeout:15000});
  await page.locator('#k-id-name').fill('G6');
  await page.locator('#k-id-lastname').fill('E2E');
  await page.locator('#k-id-phone').fill(phone.slice(4));
  const req=page.waitForResponse(r=>r.url().endsWith('/api/auth/otp/request')&&r.request().method()==='POST',{timeout:15000});
  await page.locator('#k-id-phone-cta').click();
  const rr=await req,rb=await rr.json().catch(()=>null);
  check(rr.status()===200&&rb?.success===true&&!rb?._test&&!rb?._dev,'OTP_REQUEST_NOT_ISOLATED');
  await page.locator('#k-id-step-otp').waitFor({state:'visible',timeout:12000});
  await page.screenshot({path:path.join(OUT,'01-real-otp-without-whatsapp.png')});
  const ver=page.waitForResponse(r=>r.url().endsWith('/api/auth/otp/verify')&&r.request().method()==='POST',{timeout:16000});
  for(let i=0;i<6;i++)await page.locator('.k-id-otp-box').nth(i).fill(code[i]);
  const vr=await ver,vb=await vr.json().catch(()=>null);
  check(vr.status()===200&&vb?.user?.id===buyer.id&&!vb?._test,'OTP_REAL_BCRYPT_SESSION_FAIL');
  check((await ctx.cookies()).some(x=>x.name.endsWith('kmrc_jwt')&&x.httpOnly),'OTP_HTTPONLY_SESSION_NOT_SET');
  record('CHROMIUM_OTP_VERIFIED',{request_status:rr.status(),verify_status:vr.status(),session:true,external_notification:false});
  await page.goto(ORIGIN+'/boutique/?market=KM',{waitUntil:'domcontentloaded'});
  const {rows:[actualProduct]}=await db.query('SELECT name,product_ref FROM products WHERE id=$1',[PRODUCT]);
  check(actualProduct?.product_ref===REF&&!!actualProduct.name,'G6_PRODUCT_PROVENANCE_MISMATCH');
  await page.locator('#k-search-input').fill(actualProduct.name);
  const item=page.locator('#k-search-dropdown .k-search-item[data-id="'+PRODUCT+'"]');
  await item.waitFor({state:'visible',timeout:25000});await item.click();
  await page.locator('#k-modal-name').waitFor({state:'visible',timeout:13000});
  // Wait for the canonical desktop Product Detail renderer, not a legacy carousel
  // image that may already be loaded before SKU options finish rendering.
  await page.locator('#k-modal-variants [data-pdc5-root]').waitFor({state:'attached',timeout:20000});
  const variantEvidence=await page.locator('#k-modal-variants').evaluate(el=>({
   root:!!el.querySelector('[data-pdc5-root]'),
   axes:[...el.querySelectorAll('.k-vg')].map(group=>({
    key:group.dataset.axisKey,
    options:[...group.querySelectorAll('button[data-option-value]')].map(button=>({
     value:button.dataset.optionValue,state:button.dataset.optionState,
     selected:button.getAttribute('aria-pressed')
    }))
   }))
  }));
  record('PDP_VARIANT_MATRIX',variantEvidence);
  await page.waitForFunction(()=>[...document.querySelectorAll('#k-modal-carousel-track img')].some(x=>x.complete&&x.naturalWidth>0),null,{timeout:25000});
  const add=page.locator('#k-add-cart-btn');
  for(let n=0;n<12&&!await add.isEnabled();n++){
   const options=page.locator('#k-modal-variants button[data-option-state="AVAILABLE"][data-option-value]:not([aria-pressed="true"])');
   if(!await options.count())break;await options.first().click();
  }
  const addEnabled=await add.isEnabled();
  await page.screenshot({path:path.join(OUT,'02-real-authenticated-product.png')});
  record('PDP_SELECTION_RESULT',{
   add_enabled:addEnabled,
   selected_options:await page.locator('#k-modal-variants button[data-option-value][aria-pressed="true"]').evaluateAll(buttons=>buttons.map(button=>({
    axis:button.closest('.k-vg')?.dataset.axisKey,value:button.dataset.optionValue
   })))
  });
  check(addEnabled,'NO_PURCHASABLE_VARIANT');
  const before=Number(await page.locator('#k-modal-cart-badge').innerText().catch(()=>'0'))||0;
  await add.click();
  await page.waitForFunction(n=>Number(document.querySelector('#k-modal-cart-badge')?.textContent||0)>n,before,{timeout:10000});
  await page.locator('#k-modal-close').click();
  await page.locator('#k-side-cart.has-items').waitFor({state:'visible',timeout:12000});
  await page.screenshot({path:path.join(OUT,'03-real-cart.png')});
  const checkout=page.locator('#k-sc-checkout');
  if(await checkout.isVisible())await checkout.click();else await page.locator('#k-cart-btn').click();
  await page.locator('#k-order-modal.open').waitFor({state:'visible',timeout:15000});
  const confirm=page.locator('#btn-confirm-order');
  await confirm.waitFor({state:'visible',timeout:15000});
  await page.waitForFunction(()=>{const el=document.getElementById('btn-confirm-order');return el&&!el.disabled},null,{timeout:16000});
  const total=await page.locator('#ck-final-total-amount').innerText();
  check(/17[\s\u202f.,]*990/.test(total),'G6_CHECKOUT_TOTAL_NOT_17990');
  record('REAL_CHECKOUT',{display_total:total,relay:await page.locator('#ck-relais-summary').innerText().catch(()=>null)});
  await page.screenshot({path:path.join(OUT,'04-real-checkout-before-POST.png')});
  const response=page.waitForResponse(r=>r.url().endsWith('/api/orders')&&r.request().method()==='POST',{timeout:25000});
  await confirm.click();
  const created=await response,body=await created.json().catch(()=>null);
  record('CANONICAL_ORDER_HTTP',{status:created.status(),reference:body?.order?.reference||null,code:body?.code||null,error:body?.error||null});
  check(created.status()===201&&!!body?.order?.id,'G6_CANONICAL_ORDER_POST_NOT_201');
  await page.screenshot({path:path.join(OUT,'05-real-order-confirmation.png')});
  check(report.blocked_requests.length===0,'G6_UNEXPECTED_BROWSER_WRITE');
  return body.order;
 }finally{await browser.close()}
}
(async()=>{
 try{
  check(process.env.KOMERCE_ENV==='staging'&&process.env.NODE_ENV==='test'&&
   process.env.GITHUB_EVENT_NAME==='issues'&&process.env.GITHUB_ACTOR===process.env.GITHUB_REPOSITORY_OWNER&&
   process.env.STAGING_BASE_URL===ORIGIN&&/^\d{5,20}$/.test(String(process.env.GITHUB_RUN_ID||'')),
   'OWNER_ONLY_STAGING_GUARD');
  const target=await confirmTarget({db,env:process.env});
  check(target.confirmed,'STAGING_DB_IDENTITY_MISMATCH');
  report.db_fingerprint=target.fingerprint;await runtime();
  const fixture=await setup();
  check((await queryOrders(fixture.buyer.id)).length===0,'BUYER_HAS_PREEXISTING_ORDERS');
  const order=await browserCheckout(fixture);
  const orders=await queryOrders(fixture.buyer.id);
  check(orders.length===1,'G6_EXACTLY_ONE_ORDER_NOT_SATISFIED');
  const o=orders[0];
  check(o.id===order.id&&o.reference===order.reference&&o.simulation_scope==='G6-BUYER'&&
    o.market==='KM'&&Number(o.total_kmf)===17990&&o.payment_mode==='cash_relais'&&
    o.status==='pending'&&o.payment_status!=='paid'&&o.lines===1&&o.qty===1&&o.products?.includes(REF),
    'G6_POSTGRES_CANONICAL_ORDER_MISMATCH');
  report.order={id:o.id,reference:o.reference,status:o.status,payment_status:o.payment_status,
    scope:o.simulation_scope,total_kmf:Number(o.total_kmf),market:o.market,lines:o.lines,quantity:o.qty,products:o.products};
  record('INDEPENDENT_POSTGRES_READBACK',report.order);await runtime();
  report.verdict='G6_P2_REAL_OTP_CHROMIUM_ORDER_CREATED_NO_EXTERNAL_EFFECTS';
 }catch(e){report.verdict='BLOCKED';report.error=String(e.message||e).slice(0,480);process.exitCode=2}
 finally{save();await db.pool.end();
  console.log(JSON.stringify({verdict:report.verdict,error:report.error||null,
    order_id:report.order?.id||null,reference:report.order?.reference||null,
    runtime_sha:report.runtime_sha||null,steps:report.steps.map(x=>x.name),
    external_payments:false,external_notifications:false,external_suppliers:false,
    human_attestation:false,blocked_requests:report.blocked_requests}))}
})();
