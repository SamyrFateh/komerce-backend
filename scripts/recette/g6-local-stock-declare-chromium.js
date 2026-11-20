#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-local-stock-declare-chromium
 * @domain inventory
 * @layer test
 * @owner backend-core
 * @purpose Prérequis M02 : le responsable pays déclare 10 unités de stock local (écran W3) pour un produit éligible, une seule mutation, relecture PG seule.
 * @impact-areas staging-only, local-stock
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {login}=require('./g6-canonical-forwarder-chromium');
const {observe,fullError}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill,humanSelect}=require('./canonical/actors/human-gestures');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const QTY=10;
const OUT=path.resolve('test-results/g6-local-stock-declare');
let OBS=null;
const report={schema:'komerce-g6-local-stock-declare/1',market:MK.code,qty_declared:QTY,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',events:[],external_supplier_calls:0,
 external_payment_executed:false,production_permitted:false};
const check=(v,e)=>{if(!v)throw Error(e)};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const ownerStagingGuard=e=>e.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&e.GITHUB_EVENT_NAME==='issues'&&
 e.GITHUB_ACTOR===e.GITHUB_REPOSITORY_OWNER&&e.NODE_ENV==='test'&&e.KOMERCE_ENV==='staging'&&
 e.KOMERCE_TARGET_ENV==='staging'&&e.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&e.STAGING_BASE_URL===BASE&&
 ['KM','CM','CG'].includes(e.G6_TARGET_MARKET);
// Lecture seule : produit éligible (prix LOCAL_ACTIVE, exposition produit, SKU actif) ; ligne de stock du marché préférée ENABLED.
async function eligible(onlyId=null){
 const {rows}=await db.query(`
  SELECT p.id,p.product_ref,p.name,ls.commercial_exposure AS stock_exposure,COALESCE(ls.qty_physical,0)::int AS qty_physical,
   COALESCE(ls.qty_physical-(SELECT SUM(a.quantity) FROM local_stock_allocations a WHERE a.local_stock_id=ls.id
    AND a.consumed_at IS NULL AND a.released_at IS NULL),COALESCE(ls.qty_physical,0))::int AS available
  FROM products p JOIN markets m ON m.code=$1
  JOIN product_market_price_drafts d ON d.product_id=p.id AND d.market_id=m.id AND d.status='LOCAL_ACTIVE'
  JOIN product_market_exposure e ON e.product_id=p.id AND e.market_id=m.id AND e.commercial_exposure='ENABLED'
  LEFT JOIN local_stock ls ON ls.product_id=p.id AND ls.market_id=m.id AND ls.location='KM_MAIN'
  WHERE p.lifecycle_status='active' AND p.is_active=TRUE AND p.is_available=TRUE
   AND EXISTS (SELECT 1 FROM product_skus sku WHERE sku.product_id=p.id AND sku.is_active=TRUE)
   AND ($2::uuid IS NULL OR p.id=$2::uuid)
  ORDER BY (ls.commercial_exposure='ENABLED') DESC NULLS LAST,p.product_ref LIMIT 5`,[MK.code,onlyId]);
 return rows;
}
const readAvailable=async id=>(await eligible(id))[0];
function pickCandidate(rows){
 if(!rows.length)return {verdict:'SCREEN_MISSING_PRICE_OR_EXPOSURE'};
 // Ligne déjà exposée préférée ; sinon la déclaration crée/complète une ligne masquée, exposée ensuite par le bouton « Exposer » du même écran.
 return {candidate:rows.find(r=>r.stock_exposure==='ENABLED')||rows[0]};
}
async function main(){
 let browser;
 try{
  save();
  check(ownerStagingGuard(env),'G6_LOCAL_STOCK_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed,'G6_LOCAL_STOCK_DB_GUARD');
  report.db_fingerprint=guard.fingerprint;
  const pick=pickCandidate(await eligible());
  if(!pick.candidate){report.verdict=pick.verdict;save();process.exitCode=3;return}
  const prod=pick.candidate;
  report.product_ref=prod.product_ref;report.before={qty_physical:prod.qty_physical,available:prod.available};save();
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const actor=await login(browser,'E2E_MARKET_OPERATOR_'+MK.code+'_','market_operator');
  try{
   const url=BASE+'/api/markets/'+MK.code+'/local-stock/receipts';let calls=0;
   await actor.page.route(url,route=>{
    const req=route.request();let body;try{body=req.postDataJSON()}catch(_){}
    if(req.method()==='POST'&&calls++===0&&body?.qty_received===QTY&&body?.product_id===prod.id)return route.continue();
    actor.blocked.push({method:req.method(),path:'/local-stock/receipts'});return route.abort('blockedbyclient');
   });
   await humanGoto(actor.page,'/dashboards/canonical/market-autonomy.html?market='+MK.code,{waitUntil:'domcontentloaded'});
   const form=actor.page.locator('[data-market-local-offer] form:has(input[name="qty_received"])');
   try{await form.waitFor({state:'visible',timeout:30000})}
   catch(_){report.verdict='SCREEN_MISSING_DECLARATION';save();process.exitCode=3;return}
   await humanFill(null,form.locator('input[name="product_id"]'),prod.id);
   const relais=await form.locator('select[name="relais_id"] option').evaluateAll(o=>o.map(x=>x.value).filter(Boolean));
   check(relais.length>0,'G6_LOCAL_STOCK_NO_ACTIVE_RELAY');
   await humanSelect(null,form.locator('select[name="relais_id"]'),relais[0]);
   await humanFill(null,form.locator('input[name="qty_received"]'),String(QTY));
   await humanFill(null,form.locator('input[name="proof_ref"]'),'RECETTE-G6-'+(env.GITHUB_RUN_ID||'local'));
   await humanFill(null,form.locator('input[name="note"]'),'RECETTE G6 stock local '+MK.code);
   const pending=actor.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:30000});
   await humanClick(null,form.locator('button[type="submit"]'));
   const res=await pending;
   check(res.status()===201&&calls===1&&actor.blocked.length===0,'G6_LOCAL_STOCK_RECEIPT_REJECTED_'+res.status());
   report.events.push({key:'local-stock-receipt',http:201,role:'market_operator',ui:true,mutations:1});save();
   if((await readAvailable(prod.id))?.stock_exposure!=='ENABLED'){
    // 2e geste distinct, une seule mutation : bouton « Exposer » de la carte stock du produit.
    const expUrl=BASE+'/api/markets/'+MK.code+'/local-stock/'+encodeURIComponent(prod.id)+'/exposure';let put=0;
    await actor.page.route(expUrl,route=>{
     const req=route.request();let body;try{body=req.postDataJSON()}catch(_){}
     if(req.method()==='PUT'&&put++===0&&body?.commercial_exposure==='ENABLED')return route.continue();
     actor.blocked.push({method:req.method(),path:'/local-stock/:id/exposure'});return route.abort('blockedbyclient');
    });
    await humanGoto(actor.page,'/dashboards/canonical/market-autonomy.html?market='+MK.code,{waitUntil:'domcontentloaded'});
    const card=actor.page.locator('[data-market-local-offer] .kmc-team-member')
     .filter({has:actor.page.locator('strong',{hasText:prod.name||prod.id})})
     .filter({has:actor.page.locator('small',{hasText:'en stock'})});
    try{await card.first().waitFor({state:'visible',timeout:30000})}
    catch(_){report.verdict='SCREEN_MISSING_STOCK_EXPOSURE';save();process.exitCode=3;return}
    check(await card.count()===1,'G6_LOCAL_STOCK_CARD_NOT_UNIQUE');
    const waitPut=actor.page.waitForResponse(r=>r.url()===expUrl&&r.request().method()==='PUT',{timeout:30000});
    await humanClick(null,card.getByRole('button',{name:'Exposer',exact:true}));
    const er=await waitPut;
    check(er.ok()&&put===1&&actor.blocked.length===0,'G6_LOCAL_STOCK_EXPOSE_REJECTED_'+er.status());
    report.events.push({key:'local-stock-expose',http:er.status(),role:'market_operator',ui:true,mutations:1});save();
   }
  }finally{await actor.ctx.close()}
  const after=await readAvailable(prod.id);
  report.after={qty_physical:after&&after.qty_physical,available:after&&after.available};
  check(after&&after.stock_exposure==='ENABLED'&&after.available===prod.available+QTY&&after.qty_physical===prod.qty_physical+QTY,'G6_LOCAL_STOCK_READBACK_MISMATCH');
  report.verdict='G6_LOCAL_STOCK_DECLARED_SIMULATED_CHROMIUM_PG_PASS';save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main,ownerStagingGuard,pickCandidate,QTY};
