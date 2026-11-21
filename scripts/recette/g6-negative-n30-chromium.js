/** @komerce-arch-lite
 * @role g6-negative-n30-chromium
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose N30 (staging only) : l'admin relit Order 360 de la commande et le KPI Commerce global ; les valeurs sont comparées à PostgreSQL par le runner. Lectures GET seulement.
 * @db-read orders
 * @db-write none
 * @impact-areas staging-only, dashboards
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {runtime}=require('./g6-hub-shipment-chromium');
const {login}=require('./g6-canonical-forwarder-chromium');
const {observe,fullError}=require('./canonical/observability');
const {check}=require('./g6-negative-n23-n24-chromium');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const OUT=path.resolve('test-results/g6-negative-n30');
let OBS=null;
const report={schema:'komerce-g6-negative-n30/1',scenario_id:'N30',market:MK.code,reference:REF,order_id:ID,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],order360:null,commerce:null,page_events:[],
 external_supplier_calls:0,external_payment_executed:false,production_permitted:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const reach=k=>{report.steps_reached.push(k);save()};
async function main(){
 let browser,admin;
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
   env.G6_CANONICAL_PHASE==='N30_TRUTH_COMPARE'&&env.G6_CANONICAL_SCENARIO==='N30'&&env.G6_DYNAMIC_FRESH_ORDER==='1'&&
   env.G6_TARGET_MARKET===MK.code&&/^[a-f0-9-]{36}$/i.test(ID||''),'G6_N30_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_N30_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  admin=await login(browser,'E2E_ADMIN_','admin');reach('ADMIN_SESSION');
  const r=await admin.page.request.get('/api/admin/entities/orders/'+encodeURIComponent(REF)).catch(()=>null);
  if(!r||r.status()!==200)throw Error('G6_N30_SCREEN_MISSING_ORDER_360_HTTP_'+(r?r.status():null));
  const j=await r.json();
  report.order360={http:200,status:j.order?.status,payment_status:j.order?.payment?.status,total_kmf:j.order?.payment?.total_kmf,
   simulation_scope:j.order?.simulation_scope||null,items:j.summary?.items,quantity:j.summary?.quantity,parcels:j.summary?.parcels};
  reach('ORDER_360_READ');
  const c=await admin.page.request.get('/api/admin/dashboard/commerce?period=7').catch(()=>null);
  if(!c||c.status()!==200)throw Error('G6_N30_SCREEN_MISSING_COMMERCE_DASHBOARD_HTTP_'+(c?c.status():null));
  const cj=await c.json();
  const ca=(cj.kpis||[]).find(k=>k.key==='ca_encaisse');
  report.commerce={http:200,ca_value:ca?ca.value:null,unit:ca?ca.unit:null,from:cj.period_definition?.from,to:cj.period_definition?.to,simulation:cj.simulation||null};
  reach('COMMERCE_KPI_READ');
  if(!ca||!report.commerce.from)throw Error('G6_N30_SCREEN_MISSING_COMMERCE_KPI_ca_encaisse');
  await runtime();
  report.verdict='G6_N30_ORDER_360_AND_DASHBOARD_READ_CHROMIUM_PASS';save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(admin)await admin.ctx.close().catch(()=>{});if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
