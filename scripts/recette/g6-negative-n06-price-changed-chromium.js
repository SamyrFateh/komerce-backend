#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-negative-n06-price-reconfirmation-chromium
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N06 : vrai client OTP, devis de checkout, changement de prix via Catalogue pays, 409 puis second clic et restauration par le même écran.
 * @db-read products, product_skus, markets, product_market_price_drafts, product_market_exposure, orders, order_items, cash_collections, local_stock_allocations, purchase_lines
 * @db-write fixture-user-only
 * @impact-areas staging-only, checkout, market-pricing
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {observe,fullError,startTraceAfterAuth}=require('./canonical/observability');
const {humanGoto,humanFill,humanClick}=require('./canonical/actors/human-gestures');
const {login}=require('./g6-canonical-forwarder-chromium');
const {fixtureBuyer,authenticate}=require('./g6-negative-g5a-storefront-chromium');
const {snapshotBuyerEffects,validateG5aEvidence}=require('./canonical/g5a-checkout-negative-oracles');
const BASE='https://komerce-backend-production.up.railway.app',env=process.env;
const MARKET=String(env.G6_TARGET_MARKET||''),SCENARIO=String(env.G6_CANONICAL_SCENARIO||'');
const REF=String(env.G6_N06_PRODUCT_REF||'KPR-000165');
const OUT=path.resolve('test-results/g6-negative-g5a-N06-'+MARKET);
const report={schema:'komerce-g6-g5a-n06-reconfirmation/1',scenario_id:'N06',market:MARKET,
 actor_role:'client',gesture_source:'CHROMIUM',staging_only:true,production_permitted:false,external_psp_calls:0,
 verdict:'NOT_PROVEN',http_attempts:[],events:[],blocked:[],screens:[],restore:{required:false,success:false}};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const check=(c,m)=>{if(!c)throw Error(m)};
const event=(action,value)=>{report.events.push({action,value});save()};
const priceUrl=()=>BASE+'/api/admin/workspaces/pricing/market/'+MARKET+'/products/'+encodeURIComponent(REF);
const marketUrl=()=>BASE+'/dashboards/canonical/market-catalog.html?market='+MARKET+'&price_search='+encodeURIComponent(REF)+'&product_ref='+encodeURIComponent(REF);
const targetPrice=p=>p+1;
function guard(){
 check(SCENARIO==='N06'&&['KM','CM','CG'].includes(MARKET)&&/^KPR-[0-9]{6}$/.test(REF),
  'G6_N06_SCENARIO_OR_PRODUCT_INVALID');
 check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
  env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&
  env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&
  env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
  /^\d{8,}$/.test(String(env.GITHUB_RUN_ID||'')),'G6_N06_OWNER_STAGING_GUARD');
}
async function version(){
 const r=await fetch(BASE+'/health/version'),v=await r.json();
 check(r.ok&&/^[a-f0-9]{40}$/.test(String(v.commit||''))&&v.commit===env.E2E_EXPECTED_DEPLOY_SHA,'G6_N06_STAGING_SHA_DRIFT');
 report.staging_sha=v.commit;
}
async function productState(){
 const {rows:[p]}=await db.query(
  "SELECT p.id,p.product_ref,p.name,d.amount,p.is_active,p.is_available,p.lifecycle_status, e.commercial_exposure, m.lifecycle_status AS market_lifecycle"+
  " FROM products p JOIN markets m ON m.code=$2"+
  " JOIN product_market_price_drafts d ON d.product_id=p.id AND d.market_id=m.id AND d.status='LOCAL_ACTIVE'"+
  " JOIN product_market_exposure e ON e.product_id=p.id AND e.market_id=m.id"+
  " WHERE p.product_ref=$1 AND p.lifecycle_status='active' AND p.is_active=TRUE AND p.is_available=TRUE"+
  " AND e.commercial_exposure='ENABLED' AND m.lifecycle_status='ACTIVE'"+
  " AND EXISTS(SELECT 1 FROM product_skus k WHERE k.product_id=p.id AND k.is_active=TRUE AND k.stock>0)",
  [REF,MARKET]);
 if(!p||!Number.isSafeInteger(Number(p.amount))||Number(p.amount)<=0)
  throw Error('G6_N06_PREREQ_MISSING_ACTIVE_SELLABLE_PRODUCT_'+REF);
 return {...p,amount:Number(p.amount)};
}
async function readPrice(){
 const {rows:[p]}=await db.query(
  "SELECT d.amount FROM product_market_price_drafts d JOIN products p ON p.id=d.product_id"+
  " JOIN markets m ON m.id=d.market_id WHERE p.product_ref=$1 AND m.code=$2 AND d.status='LOCAL_ACTIVE'",
  [REF,MARKET]);
 check(p&&Number.isSafeInteger(Number(p.amount)),'G6_N06_PRICE_NOT_READABLE');
 return Number(p.amount);
}
async function openProduct(page,product){
 await humanGoto(page,BASE+'/boutique/?market='+MARKET,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>{const count=document.getElementById('k-hero-count');
  return !!count&&!count.hidden&&/[1-9]/.test(count.textContent||'')},null,{timeout:30000});
 await humanFill(null,page.locator('#k-search-input'),product.name);
 const item=page.locator('#k-search-dropdown .k-search-item[data-id="'+product.id+'"]');
 await item.waitFor({state:'visible',timeout:25000});await humanClick(null,item);
 await page.locator('#k-modal-name').waitFor({state:'visible',timeout:15000});
 await page.locator('#k-modal-variants [data-pdc5-root]').waitFor({state:'attached',timeout:25000});
 const axes=page.locator('#k-modal-variants [data-axis-key]');
 check(await axes.count()>0,'G6_N06_SCREEN_MISSING_VARIANTS');
 for(let i=0;i<await axes.count();i++){
  const axis=axes.nth(i),selected=axis.locator('button[data-option-state="AVAILABLE"][aria-pressed="true"]');
  if(await selected.count())continue;
  const choice=axis.locator('button[data-option-state="AVAILABLE"][data-option-value]').first();
  check(await choice.count()===1,'G6_N06_SCREEN_MISSING_SKU_OPTION');
  await humanClick(null,choice);
 }
 const add=page.locator('#k-add-cart-btn');
 check(await add.isVisible()&&await add.isEnabled(),'G6_N06_SCREEN_MISSING_ADD_TO_CART');
 const prev=Number(await page.locator('#k-modal-cart-badge').innerText().catch(()=>'0'))||0;
 await humanClick(null,add);
 await page.waitForFunction(n=>Number(document.querySelector('#k-modal-cart-badge')?.textContent||0)>n,prev,{timeout:12000});
 await humanClick(null,page.locator('#k-modal-close'));
 await page.locator('#k-side-cart.has-items').waitFor({state:'visible',timeout:15000});
 const checkout=page.locator('#k-sc-checkout');
 if(await checkout.isVisible())await humanClick(null,checkout);
 else await humanClick(null,page.locator('#k-cart-btn'));
 await page.locator('#k-order-modal.open').waitFor({state:'visible',timeout:15000});
 await page.waitForFunction(()=>{const c=document.getElementById('btn-confirm-order');return !!c&&!c.disabled},null,{timeout:18000});
 return page.locator('#btn-confirm-order');
}
async function displayedTotal(page){
 const text=await page.locator('#ck-final-total-amount').innerText({timeout:6000});
 return Number(text.replace(/[^0-9]/g,''));
}
async function changePriceFromMarketUI(actor,{from,to,kind}){
 check(Number.isSafeInteger(from)&&Number.isSafeInteger(to)&&from>0&&to>0&&from!==to,
  'G6_N06_PRICE_CHANGE_ARGUMENTS_INVALID');
 const page=actor.page;
 const route=priceUrl();
 const allowed=[route+'/local-price/price-preview',route+'/local-price/change-active'];
 const handler=async request=>{
  const req=request.request(),u=req.url(),method=req.method();
  if(method==='POST'&&allowed.includes(u))return request.continue();
  actor.blocked.push({method,url:new URL(u).pathname});return request.abort('blockedbyclient');
 };
 for(const u of allowed)await page.route(u,handler);
 try{
  await humanGoto(page,marketUrl(),{waitUntil:'domcontentloaded'});
  const row=page.locator('[data-market-price-catalog] tr[data-product-ref="'+REF+'"]');
  await row.waitFor({state:'visible',timeout:30000});
  const input=row.locator('input[type="number"]');
  check(Number(await input.inputValue())===from,'G6_N06_PRICE_UI_STALE_'+kind);
  const pending=page.waitForResponse(r=>r.url()===allowed[0]&&r.request().method()==='POST',{timeout:30000});
  await humanFill(null,input,String(to));
  const preview=await pending,body=await preview.json().catch(()=>null);
  check(preview.ok()&&body?.can_proceed===true,'G6_N06_PREREQ_MISSING_PRICE_PREVIEW_'+kind);
  const action=row.locator('button.kmc-price-action-button');
  await action.waitFor({state:'visible',timeout:15000});
  check(await action.isEnabled(),'G6_N06_PRICE_CHANGE_UI_DISABLED_'+kind);
  // Le message « Confirmer ce prix » demande un premier clic de simple acquittement.
  if(body.requires_acknowledgement){
   await humanClick(null,action);
   check(await action.isEnabled(),'G6_N06_PRICE_ACK_NOT_CONFIRMED_'+kind);
  }
  const changed=page.waitForResponse(r=>r.url()===allowed[1]&&r.request().method()==='POST',{timeout:30000});
  await humanClick(null,action);
  const response=await changed;
  check(response.ok()&&actor.blocked.length===0,'G6_N06_PRICE_CHANGE_HTTP_'+kind+'_'+response.status());
  check(await readPrice()===to,'G6_N06_PRICE_CHANGE_PG_MISMATCH_'+kind);
  event('MARKET_PRICE_UI_'+kind,{role:'market_operator',before:from,after:to,http:response.status()});
  await page.screenshot({path:path.join(OUT,'catalog-price-'+kind+'.png')});
 }finally{for(const u of allowed)await page.unroute(u,handler).catch(()=>{})}
}
async function main(){
 let browser=null,obs=null,actor=null,original=null;
 try{
  save();guard();
  const target=await confirmTarget({db,env});
  check(target.confirmed,'G6_N06_DB_IDENTITY_MISMATCH');
  report.db_fingerprint=target.fingerprint;await version();
  const product=await productState();
  original=product.amount;report.product_id=product.id;report.product_ref=REF;
  report.market_price_before=original;report.restore.required=true;save();
  const buyer=await fixtureBuyer();report.buyer_id=buyer.buyer.id;
  report.before=await snapshotBuyerEffects(db,buyer.buyer.id);
  browser=await chromium.launch({headless:true});obs=observe(browser,OUT);
  const ctx=await browser.newContext({viewport:{width:1440,height:900},locale:'fr-FR'});
  const page=await ctx.newPage();
  let attempts=0;
  // Les requêtes sont journalisées dans leur ordre de geste (après waitForResponse),
  // jamais par listener asynchrone pouvant inverser ou dupliquer les réponses.
  await page.route('**/*',route=>{
   const req=route.request(),u=new URL(req.url());
   if(['GET','HEAD','OPTIONS'].includes(req.method()))return route.continue();
   if(req.method()==='POST'&&u.origin===BASE&&
     ['/api/auth/otp/request','/api/auth/otp/verify'].includes(u.pathname))return route.continue();
   if(req.method()==='POST'&&u.origin===BASE&&u.pathname==='/api/orders'&&attempts++<2)
    return route.continue();
   if(req.method()==='POST'&&u.origin===BASE&&u.pathname==='/api/orders/preview')return route.continue();
   if(req.method()==='POST'&&u.origin==='https://maps.googleapis.com'&&
     u.pathname==='/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetViewportInfo')return route.continue();
   if(req.method()==='POST'&&u.origin==='https://m.stripe.com'&&u.pathname==='/6')return route.abort();
   report.blocked.push({method:req.method(),path:u.pathname});save();return route.abort('blockedbyclient');
  });
  await authenticate(page,ctx,buyer);
  // L'authentification OTP est achevée par le helper ; trace post-auth, jamais les secrets.
  await page.waitForURL(u=>u.pathname==='/boutique/'||u.pathname==='/boutique',{timeout:10000});
  await startTraceAfterAuth(ctx);
  const confirm=await openProduct(page,product);
  const before=await displayedTotal(page);
  check(Number.isSafeInteger(before)&&before>0,'G6_N06_CHECKOUT_INITIAL_TOTAL_UNREADABLE');
  const newPrice=targetPrice(original);
  report.precondition={quote_before:before,quote_after:0};
  report.ui={old_total_shown:before,new_total_shown:0,explicit_second_click:false};
  await page.screenshot({path:path.join(OUT,'buyer-before-price-change.png')});
  actor=await login(browser,'E2E_MARKET_OPERATOR_'+MARKET+'_','market_operator');
  check(await readPrice()===original,'G6_N06_INITIAL_PRICE_DRIFT');
  await changePriceFromMarketUI(actor,{from:original,to:newPrice,kind:'CHANGE'});
  await version();
  const stale=page.waitForResponse(r=>r.url()===BASE+'/api/orders'&&r.request().method()==='POST',{timeout:30000});
  await humanClick(null,confirm);
  const first=await stale,firstBody=await first.json().catch(()=>null);
  report.http_attempts.push({method:'POST',path:'/api/orders',status:first.status(),
   code:firstBody?.code||null,order_id:firstBody?.order?.id||null});save();
  check(first.status()===409&&firstBody?.code==='price_changed',
   'G6_N06_PRODUCT_GAP_OLD_PRICE_CHECKOUT_NOT_REJECTED');
  const noEffects=await snapshotBuyerEffects(db,buyer.buyer.id);
  check(noEffects.orders===0&&noEffects.order_items===0&&noEffects.cash_collections===0&&
   noEffects.allocations===0&&noEffects.purchase_lines===0,'G6_N06_PRODUCT_GAP_STALE_QUOTE_MUTATED_ORDER');
  await page.waitForFunction(old=>{
   const el=document.getElementById('ck-final-total-amount');
   return !!el && Number((el.textContent||'').replace(/[^0-9]/g,''))!==old;
  },before,{timeout:20000});
  const after=await displayedTotal(page);
  check(after>0&&after!==before,'G6_N06_PRODUCT_GAP_NEW_PRICE_NOT_PRESENTED');
  report.precondition.quote_after=after;
  report.ui.new_total_shown=after;
  await page.screenshot({path:path.join(OUT,'buyer-new-price-confirmation.png')});
  check(await confirm.isEnabled(),'G6_N06_SCREEN_MISSING_SECOND_CONFIRMATION');
  // Deuxième clic humain, jamais la réémission automatique de la première requête.
  report.ui.explicit_second_click=true;
  const next=page.waitForResponse(r=>r.url()===BASE+'/api/orders'&&r.request().method()==='POST',{timeout:30000});
  await humanClick(null,confirm);
  const second=await next,secondBody=await second.json().catch(()=>null);
  report.http_attempts.push({method:'POST',path:'/api/orders',status:second.status(),
   code:secondBody?.code||null,order_id:secondBody?.order?.id||null});save();
  check(second.status()===201&&!!secondBody?.order?.id,'G6_N06_PRODUCT_GAP_SECOND_CONFIRMATION_NOT_ACCEPTED');
  const {rows:[order]}=await db.query(
   'SELECT id,display_total_amount FROM orders WHERE id=$1 AND user_id=$2',
   [secondBody.order.id,buyer.buyer.id]);
  check(!!order,'G6_N06_PRODUCT_GAP_ORDER_NOT_FOUND_IN_PG');
  report.after=await snapshotBuyerEffects(db,buyer.buyer.id);
  report.after.order_display_total=Number(order.display_total_amount);
  report.after.order_id=order.id;
  await page.screenshot({path:path.join(OUT,'buyer-order-after-price-reconfirmation.png')});
  // Vérifier les réponses observées et le vrai état PG par l'oracle, après la restauration également.
  report.staging_trace_ready=true;save();
 }catch(e){
  report.verdict=/PREREQ_MISSING/.test(String(e.message))?'PREREQ_MISSING':
   /PRODUCT_GAP/.test(String(e.message))?'PRODUCT_GAP':
   /SCREEN_MISSING/.test(String(e.message))?'SCREEN_MISSING':'NOT_PROVEN';
  report.error=fullError(e);process.exitCode=2;save();
 }finally{
  if(original!==null){
   try{
    const actual=await readPrice();
    if(actual!==original){
     check(!!actor,'G6_N06_RESTORE_ACTOR_MISSING');
     await changePriceFromMarketUI(actor,{from:actual,to:original,kind:'RESTORE'});
    }
    report.market_price_after=await readPrice();
    check(report.market_price_after===original,'G6_N06_RESTORE_PRICE_MISMATCH');
    report.restore.success=true;
   }catch(e){
    report.restore.success=false;report.restore.error=fullError(e);
    report.verdict='G6_N06_RESTORE_FAILED_REQUIRES_MANUAL_STAGING_REPAIR';process.exitCode=2;
   }
  }
  try{if(obs){await obs.finish(true);obs=null}
   const traces=fs.existsSync(OUT)?fs.readdirSync(OUT).filter(n=>/^trace-ctx[0-9]+\.zip$/.test(n)):[];
   if(!process.exitCode&&report.after){
    check(report.restore.success,'G6_N06_NOT_PROVEN_RESTORE');
    check(traces.length>=2,'G6_N06_NOT_PROVEN_BROWSER_TRACES');
    report.trace_path='test-results/g6-negative-g5a-N06-'+MARKET+'/'+traces[0];
    report.screenshot_path='test-results/g6-negative-g5a-N06-'+MARKET+'/buyer-new-price-confirmation.png';
    check(report.blocked.length===0,'G6_N06_NOT_PROVEN_UNEXPECTED_HTTP_WRITE');
    report.oracle=validateG5aEvidence('N06',report);
    await version();
    report.verdict='G6_N06_PRICE_CHANGED_EXPLICIT_RECONFIRMATION_RESTORED_CHROMIUM_PG_PASS';
   }
  }catch(e){
   report.error=report.error||fullError(e);report.verdict='NOT_PROVEN';process.exitCode=2;
  }finally{
   save();if(browser)await browser.close().catch(()=>{});
   await db.pool.end();
   console.log(JSON.stringify({scenario:SCENARIO,market:MARKET,verdict:report.verdict,
    reference:REF,restore:report.restore.success,error:report.error||report.restore.error||null}));
  }}
}
if(require.main===module)main();
module.exports={main,guard};
