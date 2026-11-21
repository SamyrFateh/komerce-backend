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
const BASE='https://komerce-backend-production.up.railway.app',env=process.env;
const SCENARIO=String(env.G6_CANONICAL_SCENARIO||''),MARKET=String(env.G6_TARGET_MARKET||'').toUpperCase();
const PREFIX={KM:'+269',CM:'+237',CG:'+242'};
const OUT=path.resolve('test-results/g6-negative-g5a-'+SCENARIO+'-'+MARKET);
const report={schema:'komerce-g6-g5a-negative-storefront/1',scenario_id:SCENARIO,market:MARKET,
 verdict:'NOT_PROVEN',staging_only:true,production_permitted:false,external_psp_calls:0,
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
       AND e.commercial_exposure='ENABLED' AND EXISTS (SELECT 1 FROM product_skus k WHERE k.product_id=p.id AND k.is_active=TRUE)
       AND NOT EXISTS (SELECT 1 FROM product_market_price_drafts d WHERE d.product_id=p.id AND d.market_id=m.id AND d.status='LOCAL_ACTIVE'))
    OR ($3='N02' AND p.lifecycle_status='active' AND p.is_active=TRUE
       AND e.commercial_exposure='DISABLED' AND EXISTS (SELECT 1 FROM product_market_price_drafts d WHERE d.product_id=p.id AND d.market_id=m.id AND d.status='LOCAL_ACTIVE'))
    OR ($3='N03' AND m.lifecycle_status='SUSPENDED' AND p.lifecycle_status='active' AND p.is_active=TRUE)
    OR ($3='N05' AND p.lifecycle_status='candidate' AND
       NOT EXISTS (SELECT 1 FROM product_skus k WHERE k.product_id=p.id AND k.is_active=TRUE))
   )
 ORDER BY (p.product_ref='KPR-000165') DESC,p.product_ref LIMIT 1
 `,[MARKET,ref,SCENARIO]);
 if(!rows.length)throw Error('G6_'+SCENARIO+'_PREREQ_MISSING_NEGATIVE_FIXTURE_'+MARKET);
 const p=rows[0];check(!!p.id&&!!p.name&&!!p.product_ref,'G6_G5A_PRODUCT_IDENTITY_MISSING');
 return {id:p.id,ref:p.product_ref,name:p.name,
  precondition:SCENARIO==='N01'?{price_status:p.price_status||'MISSING'}
   :SCENARIO==='N02'?{exposure_recorded:p.exposure_recorded,commercial_exposure:p.commercial_exposure}
   :SCENARIO==='N03'?{market_lifecycle:p.market_lifecycle,route_available:null}
   :{product_candidate:true,sku_complete:false,soi_complete:false}};
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
 const vr=await rr,vb=await vr.json();
 check(vr.status()===200&&vb.user?.id===buyer.id,'G6_G5A_OTP_SESSION_WRONG_BUYER');
 await startTraceAfterAuth(ctx);
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
  const b=await fixtureBuyer();report.buyer_id=b.buyer.id;
  report.before=await snapshotBuyerEffects(db,b.buyer.id);
  browser=await chromium.launch({headless:true});obs=observe(browser,OUT);
  const ctx=await browser.newContext({viewport:{width:1440,height:900},locale:'fr-FR'});
  const page=await ctx.newPage();
  page.on('response',r=>{try{const u=new URL(r.url());if(u.origin===BASE&&u.pathname==='/api/orders'&&r.request().method()==='POST'){
   report.http_attempts.push({method:'POST',path:u.pathname,status:r.status()});save();
  }}catch(_){/* diagnostic only */}});
  await page.route('**/*',route=>{
   const req=route.request(),u=new URL(req.url());
   if(['GET','HEAD','OPTIONS'].includes(req.method()))return route.continue();
   if(req.method()==='POST'&&u.origin===BASE&&
     ['/api/auth/otp/request','/api/auth/otp/verify'].includes(u.pathname))return route.continue();
   if(req.method()==='POST'&&u.origin==='https://maps.googleapis.com'&&
     u.pathname==='/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetViewportInfo')return route.continue();
   if(req.method()==='POST'&&u.origin==='https://m.stripe.com'&&u.pathname==='/6')return route.abort();
   report.blocked.push({method:req.method(),path:u.pathname});save();return route.abort('blockedbyclient');
  });
  await authenticate(page,ctx,b);
  report.ui=await probe(page,f);
  check(report.blocked.length===0,'G6_G5A_UNEXPECTED_MUTATION_BLOCKED');
  report.after=await snapshotBuyerEffects(db,b.buyer.id);
  report.after_stock_available=await stockAvailable(f.id);
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
module.exports={main,guard};
