#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-n34a-real-api-negative-chromium
 * @domain purchasing
 * @layer test
 * @owner backend-core
 * @purpose Negative-only browser-authenticated API DELETE refusal on protected central Hub supplier, with independent read-only PG snapshots.
 * @db-read suppliers, purchase_orders, purchase_lines, purchase_order_authorizations, product_suppliers
 * @db-write none
 * @impact-areas staging-only, sourcing, purchasing
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{isDeepStrictEqual}=require('node:util');
const {chromium}=require('playwright'),db=require('../../db');
const {marketProfile}=require('./canonical/market-profile');
const {confirmTarget}=require('./target-guard');
const {centralHubIdentity}=require('./canonical/n34-source-oracles');
const {login}=require('./g6-canonical-forwarder-chromium');
const {humanGoto}=require('./canonical/actors/human-gestures');
const {fullError}=require('./canonical/observability');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const OUT=path.resolve('test-results/g6-n34a-delete-refusal');
const report={schema:'komerce-g6-n34a-api-delete-negative/1',scenario_id:'N34a',market:env.G6_TARGET_MARKET,
 verdict:'NOT_PROVEN',scenario_bound:false,production_permitted:false,db_write:false,
 external_supplier_calls:0,external_payment_executed:false,steps:[],attempts:[]};
function check(ok,code){if(!ok)throw Error('G6_N34A_'+code)}
function save(){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')}
function authorized(){
 return env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&
 env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&
 env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&
 env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
 ['KM','CM','CG'].includes(env.G6_TARGET_MARKET)&&env.G6_N34A_REFUSAL_ONLY==='1'&&
 String(env.PGOPTIONS||'').includes('default_transaction_read_only=on');
}
async function snapshot(id){
 const {rows}=await db.query(`SELECT
  (SELECT md5(to_jsonb(s)::text) FROM suppliers s WHERE s.id=$1) AS supplier_hash,
  (SELECT md5(COALESCE(jsonb_agg(to_jsonb(po) ORDER BY po.id)::text,'[]'))
     FROM purchase_orders po WHERE po.supplier_id=$1) AS po_hash,
  (SELECT COUNT(*)::int FROM purchase_orders po WHERE po.supplier_id=$1) AS po_count,
  (SELECT md5(COALESCE(jsonb_agg(to_jsonb(pl) ORDER BY pl.id)::text,'[]'))
     FROM purchase_lines pl WHERE pl.supplier_id=$1) AS purchase_line_hash,
  (SELECT COUNT(*)::int FROM purchase_lines pl WHERE pl.supplier_id=$1 AND pl.cancelled_at IS NULL) AS open_line_count,
  (SELECT md5(COALESCE(jsonb_agg(to_jsonb(ps) ORDER BY ps.id)::text,'[]'))
     FROM product_suppliers ps WHERE ps.supplier_id=$1) AS mapping_hash,
  (SELECT md5(COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id)::text,'[]'))
     FROM purchase_order_authorizations a
     JOIN purchase_orders po ON po.id=a.purchase_order_id WHERE po.supplier_id=$1) AS authorization_hash,
  (SELECT COUNT(*)::int FROM purchase_order_authorizations a
     JOIN purchase_orders po ON po.id=a.purchase_order_id WHERE po.supplier_id=$1) AS authorization_count`,[id]);
 check(rows.length===1&&!!rows[0].supplier_hash,'PG_SNAPSHOT_MISSING');
 return rows[0];
}
async function rejectDelete(actor,id,force){
 const uri='/api/purchasing/suppliers/'+id,url=BASE+uri;
 let permitted=0,blocked=0;
 const handler=route=>{
  const req=route.request(),headers=req.headers();
  if(req.method()==='DELETE'&&permitted===0&&
    (force?headers['x-force-delete']==='true':!headers['x-force-delete'])){
   permitted++;return route.continue();
  }
  blocked++;return route.abort('blockedbyclient');
 };
 await actor.page.route(url,handler);
 try{
  // Explicit NEGATIVE API probe via the authenticated browser session.
  // Supplier 360 offers no destructive button, by design; do NOT call this a UI gesture.
  const res=await actor.page.evaluate(async ({uri,force})=>{
   const response=await fetch(uri,{method:'DELETE',credentials:'same-origin',
    headers:force?{'x-force-delete':'true'}:{}});
   return {status:response.status,body:await response.json().catch(()=>({}))};
  },{uri,force});
  report.attempts.push({force,method:'DELETE',ui:false,api_negative:true,
   http_status:res.status,error_code:res.body?.code||null,allowed_count:permitted,
   unexpected_request_count:blocked});
  save();
  check(permitted===1&&blocked===0&&actor.blocked.length===0,'API_CALL_NOT_CANONICAL');
  check(res.status===409&&res.body?.code==='CENTRAL_HUB_SUPPLIER_IMMUTABLE',
   (force?'FORCE_':'NORMAL_')+'DELETE_NOT_REFUSED_409');
 }finally{await actor.page.unroute(url,handler)}
}
async function main(){
 let browser,actor;
 try{
  save();check(authorized(),'OWNER_STAGING_READONLY_GUARD');marketProfile(env);
  const target=await confirmTarget({db,env});
  check(target.confirmed&&!!target.fingerprint,'PG_TARGET_DRIFT');
  report.db_fingerprint=target.fingerprint;
  const health=await fetch(BASE+'/health/version');
  check(health.ok===true,'HEALTH_UNAVAILABLE');
  const version=await health.json();
  check(/^[a-f0-9]{40}$/.test(String(env.E2E_EXPECTED_DEPLOY_SHA||''))&&
   version.commit===env.E2E_EXPECTED_DEPLOY_SHA,'SHA_DRIFT');report.sha=version.commit;
  const hub=await centralHubIdentity(db);
  const id=hub.central_hub_id;report.supplier_id=id;
  const before=await snapshot(id);report.before=before;save();
  browser=await chromium.launch({headless:true});
  actor=await login(browser,'E2E_ADMIN_','admin');
  await humanGoto(actor.page,'/admin/suppliers/'+id,{waitUntil:'domcontentloaded'});
  const heading=actor.page.locator('.kmc-entity-title');
  await heading.waitFor({state:'visible',timeout:25000});
  check((await heading.innerText()).trim()==='Fournisseur central Hub','SUPPLIER_360_IDENTITY_DRIFT');
  const controls=actor.page.getByRole('button',{name:/supprimer|désactiver|modifier|archiver/i});
  check(await controls.count()===0,'DESTRUCTIVE_UI_ACTION_PRESENT');
  await actor.page.screenshot({path:path.join(OUT,'supplier360-no-destructive-ui.png')});
  report.steps.push({stage:'supplier360-readonly',ui:true,no_mutation_controls:true});save();
  for(const force of [false,true]){
   const stable=await snapshot(id);
   check(isDeepStrictEqual(stable,before),'PRE_ATTEMPT_PG_DRIFT');
   await rejectDelete(actor,id,force);
   const after=await snapshot(id);
   check(isDeepStrictEqual(after,before),'POST_REJECTION_BUSINESS_MUTATION');
   const identity=await centralHubIdentity(db);
   check(identity.central_hub_id===id,'POST_REJECTION_SUPPLIER_MISSING');
   report.steps.push({stage:force?'force-delete-rejected':'delete-rejected',
    status:409,code:'CENTRAL_HUB_SUPPLIER_IMMUTABLE',pg_unchanged:true});save();
  }
  report.after=await snapshot(id);
  check(isDeepStrictEqual(report.after,before),'FINAL_PG_DRIFT');
  report.verdict='N34A_CENTRAL_HUB_DELETE_REFUSED_HTTP409_PG_UNCHANGED_NOT_FULL';
  report.next_stage='N34A_OTHER_IMMUTABILITY_AND_N34B_PUBLICATION';
  save();
 }catch(e){report.error=fullError(e);report.verdict='NOT_PROVEN';process.exitCode=2;save();}
 finally{if(actor)await actor.ctx.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});
  await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
