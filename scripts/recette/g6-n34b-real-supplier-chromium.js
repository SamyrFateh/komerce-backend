#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-n34b-real-supplier-chromium
 * @domain sourcing
 * @layer test
 * @owner backend-core
 * @purpose Real admin Chromium manual import with explicit non-Hub supplier, real candidate promotion, independent PG source lineage; never full N34 PASS.
 * @db-read suppliers, sourcing_candidates, products, purchase_orders, purchase_lines
 * @db-write-via:browser sourcing_candidates, supplier_catalog_imports, products
 * @impact-areas staging-only, sourcing, catalog
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {isDeepStrictEqual}=require('node:util');
const {chromium}=require('playwright');
const db=require('../../db'),{marketProfile}=require('./canonical/market-profile');
const {confirmTarget}=require('./target-guard');
const {centralHubIdentity,explicitSupplierProvenance}=require('./canonical/n34-source-oracles');
const {chooseSupplierFixtures}=require('./canonical/n34-screen-preflight');
const {login}=require('./g6-canonical-forwarder-chromium');
const {humanGoto,humanClick,humanSelect,humanFill}=require('./canonical/actors/human-gestures');
const {observe,fullError}=require('./canonical/observability');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const API='/api/admin/workspaces/sourcing',OUT=path.resolve('test-results/g6-n34b-real-supplier');
const report={schema:'komerce-g6-n34b-real-source/1',scenario_id:'N34b',market:env.G6_TARGET_MARKET,
 verdict:'NOT_PROVEN',scenario_bound:false,production_permitted:false,external_supplier_calls:0,
 external_payment_executed:false,events:[],steps:[],missing:[],db_write_via:'Chromium-UI-only'};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');};
const check=(v,c)=>{if(!v)throw Error('G6_N34B_'+c);};
const visible=async(loc,ms=15000)=>{try{await loc.first().waitFor({state:'visible',timeout:ms});return true}catch(_){return false}};
function ownerGuard(){
 return env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
  env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&
  env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&
  env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
  ['KM','CM','CG'].includes(env.G6_TARGET_MARKET)&&env.G6_N34B_ALLOW_SINGLE_IMPORT==='1'&&
  /^[0-9]+$/.test(String(env.GITHUB_RUN_ID||''))&&/^[0-9]+$/.test(String(env.GITHUB_RUN_ATTEMPT||''));
}
function fixture(){
 const suffix=String(env.GITHUB_RUN_ID)+'-A'+String(env.GITHUB_RUN_ATTEMPT);
 return Object.freeze({
  supplier_product_id:'G6-N34B-'+suffix,
  product_name:'[G6-N34] Coffret de tournevis '+env.G6_TARGET_MARKET+' '+suffix,
  purchase_price:10,currency:'EUR',supplier_category:'Bricolage > Outillage',
  weight_kg:0.75,dimensions:'25x15x5'
 });
}
async function stockHubEvidence(hubId){
 const {rows}=await db.query(
  `SELECT
    (SELECT COUNT(*)::int FROM purchase_orders WHERE supplier_id=$1) AS po_count,
    (SELECT COUNT(*)::int FROM purchase_lines WHERE supplier_id=$1 AND cancelled_at IS NULL) AS line_count,
    (SELECT COUNT(*)::int FROM purchase_order_authorizations a
       JOIN purchase_orders po ON po.id=a.purchase_order_id WHERE po.supplier_id=$1) AS authorization_count`,[hubId]);
 check(rows.length===1,'HUB_ECONOMIC_SNAPSHOT_MISSING');
 return rows[0];
}
async function allowedPost(actor,uri,payloadCheck,gesture,key){
 const url=BASE+uri;let count=0,blocked=0;
 const handler=async route=>{
  const r=route.request();
  let data=null;try{data=r.postDataJSON()}catch(_){}
  if(r.method()==='POST'&&count===0&&payloadCheck(data)){count++;return route.continue();}
  blocked++;return route.abort('blockedbyclient');
 };
 await actor.page.route(url,handler);
 try{
  const pending=actor.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:45000});
  await gesture();
  const response=await pending;
  const body=await response.json().catch(()=>({}));
  report.events.push({key,http:response.status(),ui:true,post_count:count});
  save();
  check(count===1&&blocked===0&&actor.blocked.length===0&&response.status()<400,
    'UI_'+key.toUpperCase()+'_HTTP_'+response.status());
  return body;
 }finally{await actor.page.unroute(url,handler);}
}
async function candidateRow(f){
 const {rows}=await db.query(
  `SELECT sc.id,sc.candidate_ref,sc.product_id,sc.supplier_id,sc.state,sc.scan_result,
     sc.komerce_category,sc.supplier_category,sc.data_sources
     FROM sourcing_candidates sc
     WHERE sc.supplier_product_id=$1 AND sc.supplier_id=$2 ORDER BY sc.created_at DESC LIMIT 3`,
  [f.supplier_product_id,report.real_supplier_id]);
 check(rows.length===1,'CANDIDATE_NOT_UNIQUE_OR_NOT_CREATED');
 return rows[0];
}
async function showCandidate(actor,ref){
 await humanGoto(actor.page,'/admin/workspaces/sourcing?candidate_ref='+encodeURIComponent(ref),{waitUntil:'domcontentloaded'});
 const row=actor.page.locator('[data-sourcing-candidate="'+ref+'"]');
 await row.waitFor({state:'visible',timeout:22000});
 return row;
}
async function main(){
 let browser,actor,obs;
 try{
  save();check(ownerGuard(),'STAGING_OWNER_GUARD');marketProfile(env);
  const guard=await confirmTarget({db,env});check(guard.confirmed&&!!guard.fingerprint,'DB_GUARD_FAILED');
  report.db_fingerprint=guard.fingerprint;
  const v=await fetch(BASE+'/health/version');check(v.ok(),'HEALTH_FAILED');
  const version=await v.json();
  check(/^[a-f0-9]{40}$/.test(String(env.E2E_EXPECTED_DEPLOY_SHA||''))&&
   version.commit===env.E2E_EXPECTED_DEPLOY_SHA,'SHA_DRIFT');
  report.sha=version.commit;
  const hub=await centralHubIdentity(db);
  const {rows}=await db.query(
   'SELECT id,name,platform,system_key,is_active,deleted_at FROM suppliers WHERE is_active=TRUE AND deleted_at IS NULL ORDER BY id');
  const selected=chooseSupplierFixtures(rows);
  check(hub.central_hub_id===selected.hub.id,'CENTRAL_IDENTITY_CHANGED');
  report.hub_supplier_id=selected.hub.id;report.real_supplier_id=selected.real.id;
  const f=fixture();report.fixture_ref=f.supplier_product_id;
  const {rows:existing}=await db.query('SELECT id FROM sourcing_candidates WHERE supplier_product_id=$1 LIMIT 1',[f.supplier_product_id]);
  check(existing.length===0,'FIXTURE_ALREADY_EXISTS_NO_REPLAY');
  const before=await stockHubEvidence(selected.hub.id);report.before_hub_finance=before;save();
  browser=await chromium.launch({headless:true});obs=observe(browser,OUT);
  actor=await login(browser,'E2E_ADMIN_','admin');
  await humanGoto(actor.page,'/admin/workspaces/sourcing?mode=manual',{waitUntil:'domcontentloaded'});
  const open=actor.page.locator('[data-workspace-action="manual-import"]');
  await open.waitFor({state:'visible',timeout:25000});await humanClick(null,open);
  const select=actor.page.locator('[data-manual-supplier]');
  await select.waitFor({state:'visible',timeout:20000});
  await actor.page.waitForFunction(()=>{const s=document.querySelector('[data-manual-supplier]');return s&&!s.disabled},null,{timeout:20000});
  await humanSelect(null,select,selected.real.id);
  check(await select.inputValue()===selected.real.id,'EXPLICIT_SUPPLIER_SELECTION_LOST');
  await humanFill(null,actor.page.locator('[data-manual-products]'),JSON.stringify([f]));
  await actor.page.screenshot({path:path.join(OUT,'selected-real-source-before-import.png')});
  const importBody=await allowedPost(actor,API+'/imports',
   p=>p&&p.source_type==='manual'&&p.supplier_id===selected.real.id&&Array.isArray(p.items)&&
      p.items.length===1&&p.items[0]?.supplier_product_id===f.supplier_product_id,
   ()=>humanClick(null,actor.page.locator('[data-workspace-action="submit-manual-import"]')),
   'manual-import');
  report.steps.push({step:'real-supplier-manual-import',ui:true,post_http:report.events.at(-1).http});
  let cand=await candidateRow(f);
  check(cand.supplier_id===selected.real.id,'CANDIDATE_SUPPLIER_REPLACED');
  report.candidate_ref=cand.candidate_ref;report.candidate_id=cand.id;report.candidate_state=cand.state;save();
  let row=await showCandidate(actor,cand.candidate_ref);
  const scan=row.locator('[data-workspace-action="scan-candidate"]');
  if(await visible(scan,5000)){
   await allowedPost(actor,API+'/candidates/'+cand.candidate_ref+'/scan',
    p=>p==null||isDeepStrictEqual(p,{}),
    ()=>humanClick(null,scan),'scan-candidate');
   report.steps.push({step:'scan-candidate',ui:true});save();
   cand=await candidateRow(f);row=await showCandidate(actor,cand.candidate_ref);
  }
  let promote=row.locator('[data-sourcing-promote]');
  if(!await visible(promote,5000)){
   // Only the real Catalogue screen may resolve a commercial classification
   // proposal; never auto-fill category or invoke its API as a shortcut.
   await humanGoto(actor.page,'/admin/workspaces/catalog?search='+encodeURIComponent(cand.candidate_ref),{waitUntil:'domcontentloaded'});
   const catalogRow=actor.page.locator('tr[data-candidate-ref="'+cand.candidate_ref+'"]');
   if(await visible(catalogRow,9000)){
    const inspect=catalogRow.locator('[data-workspace-action="inspect-candidate"]');
    if(await visible(inspect,4000)){
     await humanClick(null,inspect);
     const review=actor.page.locator('[data-workspace-action="candidate-economic-category-review"]');
     if(await visible(review,4000)){
      await humanClick(null,review);
      const apply=actor.page.locator('[data-workspace-action="candidate-apply-economic-suggestion"]');
      if(await visible(apply,4000)){
       await allowedPost(actor,API+'/candidates/'+cand.candidate_ref+'/resolve-category',
        p=>p==null||typeof p==='object',
        ()=>humanClick(null,apply),'resolve-category');
       report.steps.push({step:'resolve-classification-via-catalogue',ui:true});
      }
     }
    }
   }
   cand=await candidateRow(f);row=await showCandidate(actor,cand.candidate_ref);
   promote=row.locator('[data-sourcing-promote]');
  }
  if(!await visible(promote,7000)){
   await actor.page.screenshot({path:path.join(OUT,'promotion-not-eligible.png')});
   report.missing.push({code:'N34B_CANDIDATE_PROMOTION_SCREEN_NOT_ELIGIBLE',state:cand.state,
    category:cand.komerce_category,decision:cand.scan_result?.sourcing_decision||null});
   report.verdict='NOT_PROVEN';report.next_stage='CANDIDATE_CLASSIFICATION_OR_PROMOTION_REPAIR';save();process.exitCode=2;return;
  }
  const result=await allowedPost(actor,API+'/candidates/'+cand.candidate_ref+'/promote',
    p=>p==null||isDeepStrictEqual(p,{}),
    ()=>humanClick(null,promote),'promote');
  const product=await candidateRow(f);
  check(!!product.product_id&&product.state==='imported_to_catalog','PRODUCT_PROMOTION_NOT_PERSISTED');
  const proven=await explicitSupplierProvenance(db,{productId:product.product_id,
   candidateId:product.id,expectedSupplierId:selected.real.id});
  report.source_lineage=proven;report.catalogue_product_id=product.product_id;
  report.steps.push({step:'real-supplier-to-catalogue-draft',ui:true,post_http:report.events.at(-1).http});
  const after=await stockHubEvidence(selected.hub.id);
  check(isDeepStrictEqual(after,before),'CENTRAL_HUB_FICTITIOUS_DEBT_OR_PO');
  report.after_hub_finance=after;
  check(actor.blocked.length===0,'UNEXPECTED_MUTATION');
  report.verdict='N34B_REAL_SOURCE_DRAFT_CHROMIUM_PG_PASS_NOT_FULL';
  report.next_stage='CATALOGUE_PUBLICATION_AND_N34A_NEGATIVES';
  report.scenario_bound=false;save();
 }catch(e){report.error=fullError(e);report.verdict='NOT_PROVEN';process.exitCode=2;save();}
 finally{if(obs)await obs.finish(!!process.exitCode).catch(()=>{});if(actor)await actor.ctx.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report));}
}
if(require.main===module)main();
