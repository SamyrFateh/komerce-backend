#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-central-hub-product-chromium
 * @domain catalog
 * @layer test
 * @owner backend-core
 * @purpose Prérequis M03/M06 : produit manuel Fournisseur central Hub par les écrans (Sourcing Import manuel), idempotent, relecture PG seule ; SCREEN_MISSING_* sans contournement.
 * @impact-areas staging-only, catalog, sourcing
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {observe,fullError,startTraceAfterAuth}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill,humanSelect}=require('./canonical/actors/human-gestures');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const OUT=path.resolve('test-results/g6-central-hub-product');
// Marqueur recette G6 : le produit se retrouve par ce préfixe de nom et par le supplier_product_id.
const G6_PREFIX='[G6-HUB] ';
const G6_SUPPLIER_PRODUCT_ID='G6-CENTRAL-'+MK.code;
const PRODUCT_NAME=G6_PREFIX+'Produit central '+MK.code;
const PURCHASE_PRICE=1000,CURRENCY='EUR';
const report={schema:'komerce-g6-central-hub-product/1',market:MK.code,provenance:'SIMULATED / STAGING ONLY',
 verdict:'BLOCKED',events:[],external_supplier_calls:0,external_payment_executed:false,production_permitted:false};
const check=(v,e)=>{if(!v)throw Error(e)};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const ownerStagingGuard=e=>e.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&e.GITHUB_EVENT_NAME==='issues'&&
 e.GITHUB_ACTOR===e.GITHUB_REPOSITORY_OWNER&&e.NODE_ENV==='test'&&e.KOMERCE_ENV==='staging'&&
 e.KOMERCE_TARGET_ENV==='staging'&&e.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&e.STAGING_BASE_URL===BASE&&
 ['KM','CM','CG'].includes(e.G6_TARGET_MARKET)&&String(e.PGOPTIONS||'').includes('default_transaction_read_only=on');

// Lecture seule : produit G6 vendable rattaché au Fournisseur central (prix LOCAL_ACTIVE, exposition ENABLED, SKU actif).
const SELLABLE_SQL=`
 SELECT p.id,p.product_ref,s.system_key,d.amount
 FROM products p
 JOIN markets m ON m.code=$1
 JOIN suppliers s ON s.id=p.procurement_supplier_id AND s.system_key='central_hub'
 JOIN product_market_price_drafts d ON d.product_id=p.id AND d.market_id=m.id AND d.status='LOCAL_ACTIVE'
 JOIN product_market_exposure e ON e.product_id=p.id AND e.market_id=m.id AND e.commercial_exposure='ENABLED'
 WHERE p.name LIKE $2||'%' AND p.lifecycle_status='active' AND p.is_active=TRUE AND p.is_available=TRUE
  AND EXISTS (SELECT 1 FROM product_skus k WHERE k.product_id=p.id AND k.is_active=TRUE)
 ORDER BY p.product_ref LIMIT 2`;
const readSellable=async()=>(await db.query(SELLABLE_SQL,[MK.code,G6_PREFIX])).rows;
// Lecture seule : candidat G6 (issu de l'import manuel) et produit éventuel après promotion.
const CANDIDATE_SQL=`SELECT sc.candidate_ref,sc.state,sc.product_id,sc.supplier_name,p.product_ref,p.lifecycle_status
 FROM sourcing_candidates sc LEFT JOIN products p ON p.id=sc.product_id
 WHERE sc.supplier_product_id=$1 ORDER BY sc.created_at DESC LIMIT 1`;
const readCandidate=async()=>(await db.query(CANDIDATE_SQL,[G6_SUPPLIER_PRODUCT_ID])).rows[0]||null;
// Pur : prochain geste selon l'état lu. Aucun contournement : un écran absent donne SCREEN_MISSING_*.
function nextStep({sellable,candidate}){
 if(sellable&&sellable.length===1)return {verdict:'G6_CENTRAL_HUB_PRODUCT_ALREADY_SELLABLE_PASS',done:true};
 if(sellable&&sellable.length>1)return {verdict:'G6_CENTRAL_HUB_PRODUCT_DUPLICATE',done:true,fail:true};
 if(!candidate)return {step:'manual-import'};
 // Ni le Sourcing ni le Catalogue n'exposent de bouton « Promouvoir » (POST /candidates/:ref/promote jamais appelé par l'UI).
 if(!candidate.product_ref)return {verdict:'SCREEN_MISSING_CANDIDATE_PROMOTE',done:true};
 return {verdict:'SCREEN_MISSING_CENTRAL_PRODUCT_PRICE_EXPOSURE_DRIVER',done:true};
}
async function loginAdmin(browser){
 const email=env.E2E_ADMIN_EMAIL,password=env.E2E_ADMIN_PASSWORD;
 check(email&&password,'G6_CENTRAL_ADMIN_CREDENTIALS_MISSING');
 const ctx=await browser.newContext({baseURL:BASE,viewport:{width:1440,height:900}});
 const page=await ctx.newPage(),blocked=[];let authAllowed=true;
 await page.route(/.*/,route=>{
  const r=route.request(),u=new URL(r.url());
  if(['GET','HEAD','OPTIONS'].includes(r.method()))return route.continue();
  if(authAllowed&&r.method()==='POST'&&u.origin===BASE&&u.pathname==='/api/auth/login'){authAllowed=false;return route.continue()}
  blocked.push({method:r.method(),path:u.pathname});return route.abort('blockedbyclient');
 });
 await humanGoto(page,'/login.html?next='+encodeURIComponent('/admin/workspaces/sourcing'));
 await humanFill(null,page.locator('#email'),email);await humanFill(null,page.locator('#password'),password);
 const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
 await humanClick(null,page.locator('#btn-submit'));
 check((await pending).status()===200,'G6_CENTRAL_LOGIN_FAILED');
 await page.waitForURL(u=>u.pathname!=='/login.html',{timeout:20000});
 await startTraceAfterAuth(ctx);
 const me=await page.request.get('/api/auth/me');const user=await me.json();
 check(me.ok()&&(user.role||user.user?.role)==='admin','G6_CENTRAL_ROLE_INVALID');
 return {ctx,page,blocked};
}
// Un seul geste mutant : « Import manuel » (Sourcing), Fournisseur central Hub présélectionné par l'écran.
async function manualImport(actor){
 const url=BASE+'/api/admin/workspaces/sourcing/imports';let calls=0;
 await actor.page.unroute(/.*/);
 await actor.page.route(/.*/,route=>{
  const req=route.request(),u=new URL(req.url());
  if(['GET','HEAD','OPTIONS'].includes(req.method()))return route.continue();
  if(req.url()===url&&req.method()==='POST'&&calls++===0)return route.continue();
  actor.blocked.push({method:req.method(),path:u.pathname});return route.abort('blockedbyclient');
 });
 await humanGoto(actor.page,'/admin/workspaces/sourcing',{waitUntil:'domcontentloaded'});
 const open=actor.page.locator('[data-workspace-action="manual-import"]');
 try{await open.first().waitFor({state:'visible',timeout:30000})}
 catch(_){report.verdict='SCREEN_MISSING_MANUAL_IMPORT';save();process.exitCode=3;return false}
 await humanClick(null,open.first());
 const select=actor.page.locator('[data-manual-supplier]');
 await select.waitFor({state:'visible',timeout:15000});
 await actor.page.waitForFunction(()=>{const s=document.querySelector('[data-manual-supplier]');return s&&!s.disabled},null,{timeout:20000});
 const selected=await select.evaluate(s=>s.selectedOptions[0]?.getAttribute('data-system-key'));
 check(selected==='central_hub','G6_CENTRAL_HUB_SUPPLIER_NOT_PRESELECTED');
 await humanFill(null,actor.page.locator('[data-manual-products]'),JSON.stringify([{
  supplier_product_id:G6_SUPPLIER_PRODUCT_ID,product_name:PRODUCT_NAME,purchase_price:PURCHASE_PRICE,currency:CURRENCY}]));
 const pending=actor.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:45000});
 await humanClick(null,actor.page.locator('[data-workspace-action="submit-manual-import"]'));
 const res=await pending;
 check(res.status()<400&&calls===1&&actor.blocked.length===0,'G6_CENTRAL_IMPORT_REJECTED_'+res.status());
 report.events.push({key:'manual-import-central-hub',http:res.status(),role:'admin',ui:true,mutations:1});save();
 return true;
}
async function main(){
 let browser,OBS=null;
 try{
  save();
  check(ownerStagingGuard(env),'G6_CENTRAL_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});check(guard.confirmed,'G6_CENTRAL_DB_GUARD');
  report.db_fingerprint=guard.fingerprint;
  let state={sellable:await readSellable(),candidate:await readCandidate()};
  let step=nextStep(state);
  if(step.step==='manual-import'){
   const {chromium}=require('playwright');
   browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
   const actor=await loginAdmin(browser);
   try{if(!await manualImport(actor))return}finally{await actor.ctx.close()}
   state={sellable:await readSellable(),candidate:await readCandidate()};
   check(state.candidate,'G6_CENTRAL_CANDIDATE_NOT_FOUND_AFTER_IMPORT');
   step=nextStep(state);
  }
  report.candidate=state.candidate&&{candidate_ref:state.candidate.candidate_ref,state:state.candidate.state,product_ref:state.candidate.product_ref||null};
  report.verdict=step.verdict;
  if(step.fail||/^SCREEN_MISSING/.test(step.verdict))process.exitCode=3;
  save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main,ownerStagingGuard,nextStep,SELLABLE_SQL,G6_PREFIX,G6_SUPPLIER_PRODUCT_ID};
