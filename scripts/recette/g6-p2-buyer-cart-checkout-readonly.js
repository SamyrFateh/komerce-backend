/**
 * @komerce-arch-lite
 * @role          g6-staging-buyer-cart-checkout-readonly
 * @domain        catalog
 * @layer         test
 * @owner         catalog
 * @purpose       Proof of the real buyer's Chromium gestures before any order is placed.
 * @impact-areas  catalog, checkout
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const BASE='https://komerce-backend-production.up.railway.app';
const ID='76dacd6c-c1d8-4313-9455-f0d8f063835b';
const REF='KPR-000099';
const OUT=path.resolve('test-results/g6-p2-buyer-readonly');
fs.mkdirSync(OUT,{recursive:true});
const report={
 run_id:process.env.GITHUB_RUN_ID||null,
 phase:'G6-P2-KM-BUYER-CART-CHECKOUT-READONLY',
 product_ref:REF,product_id:ID,market:'KM',
 verdict:'NOT_PROVEN',order_created:false,otp_authenticated:false,customer_payment:false,
 human_attestation:false,blocked_requests:[],preview_http_statuses:[],steps:[]
};
function save(){fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');}
function step(name,observed){report.steps.push({name,observed});save();}
async function version(){
 const response=await fetch(BASE+'/health/version');
 if(!response.ok)throw Error('STAGING_VERSION_HTTP_'+response.status);
 const v=await response.json();
 if(!process.env.E2E_EXPECTED_DEPLOY_SHA||v.commit!==process.env.E2E_EXPECTED_DEPLOY_SHA)
   throw Error('STAGING_DEPLOY_SHA_CHANGED');
 report.runtime_sha=v.commit;
}
async function snapshot(){
 const {rows}=await db.query(
  "SELECT p.id,p.product_ref,p.name,p.is_active,p.is_available,m.code AS market, "+ 
  "e.commercial_exposure,d.status AS price_status,d.amount,d.currency, "+
  "(SELECT COUNT(*)::int FROM product_skus s WHERE s.product_id=p.id AND s.is_active=TRUE AND s.stock>0) AS stocked_skus "+
  "FROM products p JOIN markets m ON m.code='KM' AND m.is_active=TRUE "+
  "LEFT JOIN product_market_exposure e ON e.product_id=p.id AND e.market_id=m.id "+
  "LEFT JOIN product_market_price_drafts d ON d.product_id=p.id AND d.market_id=m.id AND d.status='LOCAL_ACTIVE' "+
  "WHERE p.id=$1",[ID]);
 if(rows.length!==1)throw Error('BUYER_PRICE_SNAPSHOT_NOT_UNIQUE');
 return rows[0];
}
async function run(){
 let browser;
 try{
  if(process.env.NODE_ENV!=='test'||process.env.KOMERCE_ENV!=='staging'||
     process.env.GITHUB_EVENT_NAME!=='issues'||process.env.GITHUB_ACTOR!==process.env.GITHUB_REPOSITORY_OWNER||
     process.env.STAGING_BASE_URL!==BASE||
     !String(process.env.PGOPTIONS||'').includes('default_transaction_read_only=on')||
     !/^\d{5,20}$/.test(String(process.env.GITHUB_RUN_ID||'')))throw Error('OWNER_STAGING_READONLY_GUARD');
  const t=await confirmTarget({db,env:process.env});
  if(!t.confirmed)throw Error('STAGING_DB_TARGET_NOT_CONFIRMED');
  report.fingerprint=t.fingerprint;
  await version();
  report.before=await snapshot();
  if(report.before.product_ref!==REF||!report.before.is_active||!report.before.is_available||
     report.before.commercial_exposure!=='ENABLED'||
     report.before.price_status!=='LOCAL_ACTIVE'||Number(report.before.amount)!==17990||
     Number(report.before.stocked_skus)<1)throw Error('PRODUCT_NOT_COMMERCIALLY_READY');
  browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:1440,height:900},locale:'fr-FR'});
  const page=await ctx.newPage();
  page.on('response',response=>{
   const req=response.request();
   const u=new URL(response.url());
   if(req.method()==='POST'&&u.origin===BASE&&u.pathname==='/api/orders/preview')
     report.preview_http_statuses.push(response.status());
  });
  await page.route('**/*',async route=>{
   const req=route.request();
   if(['GET','HEAD','OPTIONS'].includes(req.method()))return route.continue();
   const u=new URL(req.url());
   const hit={method:req.method(),origin:u.origin,path:u.pathname,type:req.resourceType()};
   // Business-legal POST with read-only semantics: server auth rejects
   // anonymous quote (401) and order-checkout previewOnly ROLLBACKs before order persistence.
   if(hit.method==='POST'&&hit.origin===BASE&&hit.path==='/api/orders/preview'&&hit.type==='fetch')
     return route.continue();
   if(!(hit.method==='POST'&&hit.origin==='https://m.stripe.com'&&hit.path==='/6'&&hit.type==='xhr'))
     report.blocked_requests.push(hit);
   return route.abort();
  });
  const publicResponse=await ctx.request.get(BASE+'/api/products/'+ID+'/detail?market=KM');
  if(publicResponse.status()!==200)throw Error('BUYER_PRODUCT_DETAIL_'+publicResponse.status());
  const detail=await publicResponse.json();
  if(detail.product?.reference!==REF||Number(detail.pricing?.price_kmf)!==17990)
    throw Error('BUYER_PRODUCT_PRICE_MISMATCH');
  step('PUBLIC_DETAIL',{status:200,price_kmf:detail.pricing.price_kmf});
  const doc=await page.goto(BASE+'/boutique/?market=KM',{waitUntil:'domcontentloaded'});
  if(!doc||doc.status()!==200)throw Error('BOUTIQUE_LOAD_FAILED');
  await page.locator('#k-search-input').fill(report.before.name);
  const result=page.locator('#k-search-dropdown .k-search-item[data-id="'+ID+'"]');
  await result.waitFor({state:'visible',timeout:25000});
  await result.click();
  await page.locator('#k-modal-name').waitFor({state:'visible',timeout:25000});
  const ready=await page.waitForFunction(()=>{
    const images=[...document.querySelectorAll('#k-modal-carousel-track img')];
    const hero=images.find(x=>x.complete&&x.naturalWidth>0&&x.getBoundingClientRect().width>0);
    const axes=document.querySelector('#k-modal-variants');
    return !!(hero&&axes&&axes.textContent.trim());
  },null,{timeout:25000});
  if(!await ready.jsonValue())throw Error('PDP_VISUAL_NOT_READY');
  await page.screenshot({path:path.join(OUT,'01-product-pdp.png')});
  step('PDP',{name:await page.locator('#k-modal-name').innerText(),price:await page.locator('#k-modal-price').innerText(),hero_loaded:true,variants_rendered:true});
  const add=page.locator('#k-add-cart-btn');
  for(let i=0;i<10 && !(await add.isEnabled());i++){
    const options=page.locator('#k-modal-variants button[data-option-value][data-option-state="AVAILABLE"]:not([aria-pressed="true"])');
    if(!(await options.count()))break;
    await options.first().click();
  }
  if(!(await add.isEnabled()))throw Error('NO_AVAILABLE_PRODUCT_VARIANT');
  const oldBadge=Number(await page.locator('#k-modal-cart-badge').innerText().catch(()=>'0'))||0;
  await add.click();
  await page.waitForFunction(before=>Number(document.querySelector('#k-modal-cart-badge')?.textContent||0)>before,oldBadge,{timeout:10000});
  await page.screenshot({path:path.join(OUT,'02-real-cart.png')});
  step('ADD_TO_CART',{badge_before:oldBadge,badge_after:Number(await page.locator('#k-modal-cart-badge').innerText())});
  await page.locator('#k-modal-close').click();
  await page.locator('#k-side-cart.has-items').waitFor({state:'visible',timeout:10000});
  const cartText=await page.locator('#k-side-cart').innerText();
  if(!cartText.includes(report.before.name))throw Error('CART_PRODUCT_MISMATCH');
  const checkout=page.locator('#k-sc-checkout');
  if(await checkout.isVisible())await checkout.click();
  else await page.locator('#k-cart-btn').click();
  await page.locator('#k-order-modal.open').waitFor({state:'visible',timeout:12000});
  await page.screenshot({path:path.join(OUT,'03-real-checkout.png')});
  const confirm=page.locator('#btn-confirm-order');
  const buyerState={
    checkout_open:true,
    confirm_present:await confirm.count()>0,
    confirm_enabled:await confirm.isEnabled().catch(()=>false),
    relay_summary:await page.locator('#ck-relais-summary').innerText().catch(()=>null),
    checkout_text:(await page.locator('#k-order-modal').innerText()).slice(0,650)
  };
  step('CHECKOUT_BEFORE_AUTH',buyerState);
  if(buyerState.confirm_enabled)throw Error('UNAUTHENTICATED_CONFIRM_ENABLED');
  report.after=await snapshot();
  if(JSON.stringify(report.before)!==JSON.stringify(report.after))
    throw Error('READONLY_BIZ_DB_CHANGED');
  if(report.blocked_requests.length)throw Error('UNEXPECTED_BROWSER_WRITE_ATTEMPTS');
  if(!report.preview_http_statuses.length||report.preview_http_statuses.some(x=>x!==401))
    throw Error('UNAUTHENTICATED_PREVIEW_MUST_BE_401');
  await version();
  report.verdict='P2_PREAUTH_CART_QUOTE_401_BROWSER_PASS_ORDER_NOT_ATTEMPTED';
 }catch(e){
  report.verdict='BLOCKED';report.error=String(e.message||e).slice(0,350);process.exitCode=2;
 }finally{
  if(browser)await browser.close();
  await db.pool.end();
  save();
  console.log(JSON.stringify({verdict:report.verdict,error:report.error,steps:report.steps.map(s=>s.name),order_created:false,customer_payment:false}));
 }
}
run();
