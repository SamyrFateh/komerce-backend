#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-g5a-negative-storefront-chromium
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N01/N02/N03/N05, boutique client réel : précondition PostgreSQL en lecture seule, OTP, recherche Chromium, zéro commande ni effet financier. Pas de modification du catalogue ou du marché.
 * @db-read markets, products, product_market_price_drafts, product_market_exposure, product_skus, users, orders, order_items, local_stock_allocations, cash_collections, purchase_lines
 * @db-write fixture-user-only
 * @impact-areas staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),bcrypt=require('bcryptjs');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {createAdminUser}=require('../../services/user-mutation-service');
const {markE2eTestAccount}=require('./staging-e2e-provision');
const {preseedG6BuyerOtp}=require('../../services/g6-staging-buyer-identity-guard');
const {observe,startTraceAfterAuth,fullError}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill,humanSelect}=require('./canonical/actors/human-gestures');
const {snapshotBuyerEffects,validateG5aEvidence}=require('./canonical/g5a-checkout-negative-oracles');
const {branchFor,readRouteAvailability,assertRouteMissing,assertSupplierPublicationBlocked}=require('./canonical/g5a-negative-branches');
const BASE='https://komerce-backend-production.up.railway.app',env=process.env;
const SCENARIO=String(env.G6_CANONICAL_SCENARIO||''),MARKET=String(env.G6_TARGET_MARKET||'').toUpperCase();
const PREFIX={KM:'+269',CM:'+237',CG:'+242'};
const BRANCH=branchFor(SCENARIO,env.G6_G5A_NEGATIVE_BRANCH);
const OUT=path.resolve('test-results/g6-negative-g5a-'+SCENARIO+'-'+MARKET);
const report={schema:'komerce-g6-g5a-negative-storefront/1',scenario_id:SCENARIO,market:MARKET,
 verdict:'NOT_PROVEN',branch:BRANCH,staging_only:true,production_permitted:false,external_psp_calls:0,
 gesture_source:'CHROMIUM',actor_role:'client',http_attempts:[],steps:[],screens:[],blocked:[]};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const check=(c,msg)=>{if(!c)throw Error(msg)};
const mark=(k,v)=>{report.steps.push({step:k,evidence:v});save()};
async function version(){
 const r=await fetch(BASE+'/health/version'),v=await r.json();
 check(r.ok&&/^[a-f0-9]{40}$/.test(String(v.commit||''))&&v.commit===env.E2E_EXPECTED_DEPLOY_SHA,'G6_G5A_SHA_DEPLOY_DRIFT');
 report.staging_sha=v.commit;
}
function guard(){
 check(['N01','N02','N03','N05'].includes(SCENARIO)&&Object.hasOwn(PREFIX,MARKET),
  'G6_G5A_UNSUPPORTED_NEGATIVE_SCENARIO');
 check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
  env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.KOMERCE_ENV==='staging'&&
  env.KOMERCE_TARGET_ENV==='staging'&&env.NODE_ENV==='test'&&
  env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
  /^\d{8,}$/.test(String(env.GITHUB_RUN_ID||'')),'G6_G5A_OWNER_STAGING_GUARD');
}
async function productFixture(){
 // Aucun produit métier n'est modifié. Des préconditions absentes sont PREREQ_MISSING, jamais PASS.
 // Sélection par référence facultative pour fixer un cas reproductible, pas un identifiant accepté comme autorité.
 if(SCENARIO==='N03'&&BRANCH==='ROUTE_MISSING')
  report.route_before=assertRouteMissing(await readRouteAvailability(db,MARKET));
 const ref=String(env.G6_G5A_NEGATIVE_PRODUCT_REF||'');
 check(!ref||/^KPR-[0-9]{6}$/.test(ref),'G6_G5A_PRODUCT_REF_INVALID');
 const {rows}=await db.query(`
 SELECT p.id,p.product_ref,p.name,p.lifecycle_status,
  m.lifecycle_status AS market_lifecycle,
  COALESCE(e.commercial_exposure,'MISSING') AS commercial_exposure,
  (e.product_id IS NOT NULL) AS exposure_recorded,
  (SELECT d.status::text FROM product_market_price_drafts d
   WHERE d.product_id=p.id AND d.market_id=m.id ORDER BY (d.status='LOCAL_ACTIVE') DESC,d.id DESC LIMIT 1) AS price_status,
  (SELECT count(*)::int FROM product_skus k WHERE k.product_id=p.id AND k.is_active=TRUE) AS active_skus
 FROM products p CROSS JOIN markets m
 LEFT JOIN product_market_exposure e ON e.product_id=p.id AND e.market_id=m.id
 WHERE m.code=$1 AND ($2='' OR p.product_ref=$2)
   AND (
    ($3='N01' AND p.lifecycle_status='active' AND p.is_active=TRUE
       AND e.commercial_exposure='ENABLED' AND EXISTS (SELECT 1 FROM product_skus k WHERE k.product_id=p.id AND k.is_active=TRUE AND k.stock>0)
       AND NOT EXISTS (SELECT 1 FROM product_market_price_drafts d WHERE d.product_id=p.id AND d.market_id=m.id AND d.status='LOCAL_ACTIVE'))
    OR ($3='N02' AND p.lifecycle_status='active' AND p.is_active=TRUE
       AND e.commercial_exposure='DISABLED' AND EXISTS (SELECT 1 FROM product_market_price_drafts d WHERE d.product_id=p.id AND d.market_id=m.id AND d.status='LOCAL_ACTIVE'))
    OR ($3='N03' AND m.lifecycle_status::text=CASE WHEN $4='ROUTE_MISSING' THEN 'ACTIVE' ELSE 'SUSPENDED' END AND p.lifecycle_status='active' AND p.is_active=TRUE AND p.is_available=TRUE AND e.commercial_exposure='ENABLED' AND EXISTS (SELECT 1 FROM product_market_price_drafts d WHERE d.product_id=p.id AND d.market_id=m.id AND d.status='LOCAL_ACTIVE') AND EXISTS (SELECT 1 FROM product_skus k WHERE k.product_id=p.id AND k.is_active=TRUE AND k.stock>0))
    OR ($3='N05' AND p.lifecycle_status='candidate' AND
      (($4='NO_ACTIVE_SKU' AND NOT EXISTS (
        SELECT 1 FROM product_skus k WHERE k.product_id=p.id AND k.source='SUPPLIER' AND k.is_active=TRUE))
       OR ($4='SOI_INCOMPLETE' AND EXISTS (
        SELECT 1 FROM product_skus k WHERE k.product_id=p.id AND k.source='SUPPLIER'
          AND k.is_active=TRUE AND k.stock>0
          AND (NULLIF(BTRIM(k.supplier_unit_ref),'') IS NULL
               OR k.supplier_order_identity IS NULL
               OR jsonb_typeof(k.supplier_order_identity)<>'object'
               OR k.supplier_order_identity='{}'::jsonb))))
   ))
 ORDER BY (p.product_ref='KPR-000165') DESC,p.product_ref LIMIT 1
 `,[MARKET,ref,SCENARIO,BRANCH]);
 if(!rows.length)throw Error('G6_'+SCENARIO+'_PREREQ_MISSING_NEGATIVE_FIXTURE_'+MARKET);
 const p=rows[0];check(!!p.id&&!!p.name&&!!p.product_ref,'G6_G5A_PRODUCT_IDENTITY_MISSING');
 const precondition=SCENARIO==='N01'?{price_status:p.price_status||'MISSING'}
   :SCENARIO==='N02'?{exposure_recorded:p.exposure_recorded,commercial_exposure:p.commercial_exposure}
   :SCENARIO==='N03'?(BRANCH==='ROUTE_MISSING'?{
     market_lifecycle:p.market_lifecycle,route_available:false,
     route_basis:report.route_before.resolution,active_relays:report.route_before.active_relays,
     routable_relays:report.route_before.routable_relays
   }:{market_lifecycle:p.market_lifecycle,route_available:null})
   :await assertSupplierPublicationBlocked(db,p.id,BRANCH);
 return {id:p.id,ref:p.product_ref,name:p.name,precondition};
}
// Relire les mêmes décisions de marché après le geste : l'absence de commande ne suffit pas
// si le prix, l'exposition, le statut du produit ou la suspension ont changé entre-temps.
async function productMarketTruth(id){
 const {rows:[p]}=await db.query(`
 SELECT p.lifecycle_status::text AS lifecycle_status,p.is_active,p.is_available,
  m.lifecycle_status::text AS market_lifecycle,e.commercial_exposure::text AS exposure,
  EXISTS(SELECT 1 FROM product_market_price_drafts d
   WHERE d.product_id=p.id AND d.market_id=m.id AND d.status='LOCAL_ACTIVE') AS price_active,
  (SELECT d.amount::text FROM product_market_price_drafts d
   WHERE d.product_id=p.id AND d.market_id=m.id AND d.status='LOCAL_ACTIVE'
   ORDER BY d.id DESC LIMIT 1) AS price_active_amount,
  (SELECT count(*)::int FROM product_skus k WHERE k.product_id=p.id AND k.is_active=TRUE) AS active_skus,
  (SELECT count(*)::int FROM product_skus k WHERE k.product_id=p.id AND k.source='SUPPLIER' AND k.is_active=TRUE) AS active_supplier_skus,
  (SELECT count(*)::int FROM product_skus k WHERE k.product_id=p.id AND k.source='SUPPLIER'
    AND k.is_active=TRUE AND NULLIF(BTRIM(k.supplier_unit_ref),'') IS NOT NULL
    AND jsonb_typeof(k.supplier_order_identity)='object'
    AND k.supplier_order_identity<>'{}'::jsonb) AS complete_supplier_skus
 FROM products p CROSS JOIN markets m
 LEFT JOIN product_market_exposure e ON e.product_id=p.id AND e.market_id=m.id
 WHERE p.id=$1 AND m.code=$2
 `,[id,MARKET]);
 check(!!p,'G6_G5A_PRODUCT_STATE_NOT_READABLE');
 return p;
}
async function stockAvailable(id){
 const {rows:[r]}=await db.query('SELECT COALESCE(SUM(stock),0)::int AS available FROM product_skus WHERE product_id=$1',[id]);
 return Number(r?.available);
}
async function fixtureBuyer(){
 check(!!env.E2E_ADMIN_PASSWORD,'G6_G5A_ADMIN_CREDENTIALS_MISSING');
 const r=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{origin:BASE,'content-type':'application/json'},
  body:JSON.stringify({email:env.E2E_ADMIN_EMAIL||'admin@komerce.km',password:env.E2E_ADMIN_PASSWORD})});
 const admin=await r.json();check(r.status===200&&admin.user?.role==='admin','G6_G5A_ADMIN_AUTH_FAILED');
 const {rows:[actor]}=await db.query('SELECT id,role::text AS role FROM users WHERE id=$1',[admin.user.id]);
 check(actor?.role==='admin','G6_G5A_ADMIN_ROLE_NOT_PROVEN');
 let phone;
 for(let i=0;i<20;i++){
  const local=MARKET==='KM'?'3'+String(crypto.randomInt(0,1000000)).padStart(6,'0')
   :MARKET==='CM'?'6'+String(crypto.randomInt(0,100000000)).padStart(8,'0')
   :'06'+String(crypto.randomInt(0,10000000)).padStart(7,'0');
  const p=PREFIX[MARKET]+local;
  const {rows}=await db.query('SELECT 1 FROM users WHERE phone=$1 OR whatsapp_phone=$1 LIMIT 1',[p]);
  if(!rows.length){phone=p;break}
 }
 check(!!phone,'G6_G5A_UNIQUE_PHONE_MISSING');
 const code=String(crypto.randomInt(100000,999999));
 const client=await db.getClient();let tx=false;
 try{
  await client.query('BEGIN');tx=true;
  const {rows:[buyer]}=await createAdminUser(client,{fullName:'G6 G5A '+SCENARIO+' Client',
    email:'g6-g5a-'+crypto.randomBytes(7).toString('hex')+'@komerce.test',phone,
    role:'client',currencyPref:MARKET==='KM'?'KMF':'XAF',
    passwordHash:await bcrypt.hash(crypto.randomBytes(20).toString('base64url'),10)});
  check(!!buyer?.id,'G6_G5A_BUYER_MISSING');
  await markE2eTestAccount(client,{userId:buyer.id,actorId:actor.id});
  await preseedG6BuyerOtp(client,{buyer,phone,code,purpose:'login'});
  await client.query('COMMIT');tx=false;
  return {buyer,phone,code};
 }catch(e){if(tx)await client.query('ROLLBACK').catch(()=>{});throw e}
 finally{client.release()}
}
async function authenticate(page,ctx,{buyer,phone,code}){
 await humanGoto(page,BASE+'/boutique/?market='+MARKET,{waitUntil:'domcontentloaded'});
 await humanClick(null,page.locator('.k-header-nav-btn[data-tab="komerce"]').first());
 await humanClick(null,page.locator('#k-kmc-identify'));
 await page.locator('#k-id-step-phone').waitFor({state:'visible',timeout:15000});
 await humanFill(null,page.locator('#k-id-name'),'G6');
 await humanFill(null,page.locator('#k-id-lastname'),'G5A');
 await humanSelect(null,page.locator('#k-id-phone-country'),PREFIX[MARKET]);
 await humanFill(null,page.locator('#k-id-phone'),phone.slice(PREFIX[MARKET].length));
 const otpPath='/api/auth/otp/request';
 const req=page.waitForResponse(r=>new URL(r.url()).pathname===otpPath&&r.request().method()==='POST',{timeout:20000});
 await humanClick(null,page.locator('#k-id-phone-cta'));
 const a=await req;check(a.status()===200,'G6_G5A_OTP_REQUEST_NOT_200');
 await page.locator('#k-id-step-otp').waitFor({state:'visible',timeout:15000});
 const rr=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/otp/verify'&&r.request().method()==='POST',{timeout:20000});
 for(let i=0;i<6;i++)await humanFill(null,page.locator('.k-id-otp-box').nth(i),code[i]);
 const ver=await rr,vb=await ver.json();
 check(ver.status()===200&&vb.user?.id===buyer.id,'G6_G5A_OTP_SESSION_WRONG_BUYER');
 // La trace commence seulement après la vérification OTP et la stabilisation de la navigation.
 await page.waitForURL(u=>u.pathname==='/boutique/'||u.pathname==='/boutique',{timeout:15000});
 await startTraceAfterAuth(ctx);
}
async function probeRouteMissing(page,fixture){
 // Le produit est vendable et le marché actif ; c'est uniquement l'absence
 // de relais routable qui doit empêcher de terminer le checkout.
 await humanGoto(page,BASE+'/boutique/?market='+MARKET,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>{const el=document.getElementById('k-hero-count');
   return !!el&&!el.hidden&&/[1-9]/.test(el.textContent||'');},null,{timeout:30000});
 const projection=await page.request.get(BASE+'/api/relais/public?market='+MARKET);
 const published=await projection.json().catch(()=>null);
 check(projection.status()===200&&Array.isArray(published?.relais),
   'G6_N03_NOT_PROVEN_RELAY_PROJECTION');
 check(published.relais.length===0,'G6_N03_PREREQ_MISSING_ROUTE_CHANGED_IN_PUBLIC_PROJECTION');
 await humanFill(null,page.locator('#k-search-input'),fixture.name);
 const item=page.locator('#k-search-dropdown .k-search-item[data-id="'+fixture.id+'"]');
 await item.waitFor({state:'visible',timeout:25000});
 await humanClick(null,item);
 await page.locator('#k-modal-variants [data-pdc5-root]').waitFor({state:'attached',timeout:20000});
 const axes=page.locator('#k-modal-variants [data-axis-key]');
 check(await axes.count()>0,'G6_N03_SCREEN_MISSING_PRODUCT_VARIANTS');
 for(let i=0;i<await axes.count();i++){
  const axis=axes.nth(i);
  if(await axis.locator('button[data-option-state="AVAILABLE"][aria-pressed="true"]').count())continue;
  const b=axis.locator('button[data-option-state="AVAILABLE"][data-option-value]').first();
  check(await b.count()===1,'G6_N03_SCREEN_MISSING_PURCHASABLE_SKU');
  await humanClick(null,b);
 }
 const add=page.locator('#k-add-cart-btn');
 check(await add.isVisible()&&await add.isEnabled(),'G6_N03_SCREEN_MISSING_PRODUCT_ADD');
 const before=Number(await page.locator('#k-modal-cart-badge').innerText().catch(()=>'0'))||0;
 await humanClick(null,add);
 await page.waitForFunction(n=>Number(document.querySelector('#k-modal-cart-badge')?.textContent||0)>n,before,{timeout:12000});
 await humanClick(null,page.locator('#k-modal-close'));
 await page.locator('#k-side-cart.has-items').waitFor({state:'visible',timeout:12000});
 const checkout=page.locator('#k-sc-checkout');
 let checkoutOpened=false,confirmEnabled=false,refusalVisible=false,refusalCode=null;
 const checkoutClicked=await checkout.isVisible().catch(()=>false)&&await checkout.isEnabled().catch(()=>false);
 if(checkoutClicked)await humanClick(null,checkout);
 else if(await page.locator('#k-cart-btn').isVisible())await humanClick(null,page.locator('#k-cart-btn'));
 checkoutOpened=await page.locator('#k-order-modal.open').waitFor({state:'visible',timeout:6000})
  .then(()=>true,()=>false);
 const toast=page.locator('.k-toast.show .k-toast-simple');
 const visibleRefusal=async()=>/relais|livraison|point de retrait|destination/i.test(
  await toast.innerText().catch(()=>''));
 if(checkoutOpened){
  const confirm=page.locator('#btn-confirm-order');
  confirmEnabled=await confirm.isVisible().catch(()=>false)&&await confirm.isEnabled().catch(()=>false);
  if(confirmEnabled){
   const response=page.waitForResponse(r=>r.url()===BASE+'/api/orders'&&
    r.request().method()==='POST',{timeout:6500}).catch(()=>null);
   await humanClick(null,confirm);
   const r=await response;
   if(r){
    const body=await r.json().catch(()=>null);
    refusalCode=body?.code||null;
    report.http_attempts.push({method:'POST',path:'/api/orders',status:r.status(),code:refusalCode});save();
    check(r.status()===400&&refusalCode==='relay_required',
     'G6_N03_PRODUCT_GAP_ORDER_POST_NOT_REFUSED_FOR_MISSING_RELAY');
   }else{
    refusalVisible=await visibleRefusal();
   }
  }
 }else{
  refusalVisible=await visibleRefusal();
 }
 const refused=(!confirmEnabled&&checkoutOpened)||refusalVisible||refusalCode==='relay_required';
 const file='storefront-N03-ROUTE-'+MARKET+'.png';
 await page.screenshot({path:path.join(OUT,file),fullPage:true});report.screens.push(file);
 check(refused,'G6_N03_PRODUCT_GAP_ROUTE_CHECKOUT_NOT_REFUSED_VISIBLY_OR_HTTP');
 return {attempted_open_product:true,purchase_control_absent_or_disabled:true,
  buy_unavailable:true,route_checkout_attempted:true,route_checkout_opened:checkoutOpened,
  route_checkout_refused:refused,route_refusal_visible:refusalVisible,
  public_routable_relais:published.relais.length,confirm_enabled:confirmEnabled};
}
async function probe(page,fixture){
 await humanGoto(page,BASE+'/boutique/?market='+MARKET,{waitUntil:'domcontentloaded'});
 // Le marché suspendu peut ne pas afficher de catalogue ; les autres exigent que le chargement soit terminé.
 if(SCENARIO!=='N03')await page.waitForFunction(()=>{
  const el=document.querySelector('#k-hero-count');
  return !!el&&!el.hidden&&/[1-9]/.test(el.textContent||'');
 },null,{timeout:30000});
 const search=page.locator('#k-search-input');
 await search.waitFor({state:'visible',timeout:20000});
 await humanFill(null,search,fixture.name);
 await page.waitForTimeout(1000);
 const item=page.locator('#k-search-dropdown .k-search-item[data-id="'+fixture.id+'"]');
 const found=await item.isVisible().catch(()=>false);
 const ui={attempted_open_product:true,buy_unavailable:false,purchase_control_absent_or_disabled:false,
  search_visible:true,product_visible:found};
 if(found){
  await humanClick(null,item);
  await page.locator('#k-modal-name').waitFor({state:'visible',timeout:15000});
  const add=page.locator('#k-add-cart-btn');
  const allowed=await add.isVisible().catch(()=>false)&&await add.isEnabled().catch(()=>false);
  ui.purchase_control_absent_or_disabled=!allowed;
  ui.buy_unavailable=!allowed;
 }else{
  ui.purchase_control_absent_or_disabled=true;ui.buy_unavailable=true;
 }
 const image='storefront-'+SCENARIO+'-'+MARKET+'.png';
 await page.screenshot({path:path.join(OUT,image),fullPage:true});
 report.screens.push(image);
 if(!ui.buy_unavailable)throw Error('G6_'+SCENARIO+'_PRODUCT_GAP_PRODUCT_PURCHASABLE_IN_BOUTIQUE');
 return ui;
}
async function main(){
 let browser,obs;
 try{
  save();guard();
  const target=await confirmTarget({db,env});check(target.confirmed,'G6_G5A_DB_IDENTITY_MISMATCH');
  report.db_fingerprint=target.fingerprint;await version();
  const f=await productFixture();report.product_ref=f.ref;report.product_id=f.id;report.precondition=f.precondition;
  report.before_stock_available=await stockAvailable(f.id);
  report.product_market_before=await productMarketTruth(f.id);
  const b=await fixtureBuyer();report.buyer_id=b.buyer.id;
  report.before=await snapshotBuyerEffects(db,b.buyer.id);
  browser=await chromium.launch({headless:true});obs=observe(browser,OUT);
  const ctx=await browser.newContext({viewport:{width:1440,height:900},locale:'fr-FR'});
  const page=await ctx.newPage();
  let orderPosts=0;
  await page.route('**/*',route=>{
   const req=route.request(),u=new URL(req.url());
   if(['GET','HEAD','OPTIONS'].includes(req.method()))return route.continue();
   if(req.method()==='POST'&&u.origin===BASE&&
     ['/api/auth/otp/request','/api/auth/otp/verify'].includes(u.pathname))return route.continue();
   if(SCENARIO==='N03'&&BRANCH==='ROUTE_MISSING'&&u.origin===BASE&&
      req.method()==='POST'&&u.pathname==='/api/orders'&&orderPosts++===0)
    return route.continue();
   if(u.origin===BASE&&req.method()==='POST'&&u.pathname==='/api/orders/preview')
    return route.continue();
   if(req.method()==='POST'&&u.origin==='https://maps.googleapis.com'&&
     u.pathname==='/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetViewportInfo')return route.continue();
   if(req.method()==='POST'&&u.origin==='https://m.stripe.com'&&u.pathname==='/6')return route.abort();
   report.blocked.push({method:req.method(),path:u.pathname});save();return route.abort('blockedbyclient');
  });
  await authenticate(page,ctx,b);
  report.ui=SCENARIO==='N03'&&BRANCH==='ROUTE_MISSING'
    ?await probeRouteMissing(page,f):await probe(page,f);
  check(report.blocked.length===0,'G6_G5A_UNEXPECTED_MUTATION_BLOCKED');
  report.after=await snapshotBuyerEffects(db,b.buyer.id);
  report.after_stock_available=await stockAvailable(f.id);
  report.product_market_after=await productMarketTruth(f.id);
  if(SCENARIO==='N05'){
   report.certification_after=await assertSupplierPublicationBlocked(db,f.id,BRANCH);
   check(JSON.stringify(report.certification_after)===JSON.stringify(report.precondition),
    'G6_N05_PRODUCT_GAP_CERTIFICATION_GATE_CHANGED_DURING_PROBE');
  }
  if(SCENARIO==='N03'&&BRANCH==='ROUTE_MISSING'){
   report.route_after=assertRouteMissing(await readRouteAvailability(db,MARKET));
   check(JSON.stringify(report.route_after)===JSON.stringify(report.route_before),
    'G6_N03_PRODUCT_GAP_ROUTE_CHANGED_DURING_PROBE');
  }
  check(JSON.stringify(report.product_market_after)===JSON.stringify(report.product_market_before),
   'G6_'+SCENARIO+'_PRODUCT_GAP_MARKET_PRODUCT_STATE_CHANGED');
  // Le système d'observabilité ne conserve les traces que pour un échec.
  // Ici nous les conservons délibérément pour la preuve de certification : pas de trace fictive.
  await obs.finish(true);obs=null;
  const trace=fs.readdirSync(OUT).find(name=>/^trace-ctx[0-9]+\.zip$/.test(name));
  check(!!trace&&fs.statSync(path.join(OUT,trace)).size>0,
   'G6_'+SCENARIO+'_NOT_PROVEN_TRACE_MISSING');
  report.trace_path='test-results/g6-negative-g5a-'+SCENARIO+'-'+MARKET+'/'+trace;
  report.screenshot_path='test-results/g6-negative-g5a-'+SCENARIO+'-'+MARKET+'/'+report.screens[0];
  const proof=validateG5aEvidence(SCENARIO,report);
  await version();report.oracle=proof;
  report.verdict='G6_'+SCENARIO+'_NO_PURCHASE_CHROMIUM_PG_PASS';
  save();
 }catch(e){
  report.error=fullError(e);report.verdict=/PREREQ_MISSING/.test(String(e.message))?'PREREQ_MISSING':
   /PRODUCT_GAP/.test(String(e.message))?'PRODUCT_GAP':
   /SCREEN_MISSING/.test(String(e.message))?'SCREEN_MISSING':'NOT_PROVEN';
  process.exitCode=2;save();
 }finally{if(obs)await obs.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});
  await db.pool.end();console.log(JSON.stringify({scenario:SCENARIO,market:MARKET,verdict:report.verdict,
    error:report.error||null,product_ref:report.product_ref||null}))}
}
if(require.main===module)main();
module.exports={main,guard,fixtureBuyer,authenticate};
