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
const {humanGoto}=require('./canonical/actors/human-gestures');
const {check}=require('./g6-negative-n23-n24-chromium');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const OUT=path.resolve('test-results/g6-negative-n30');
let OBS=null;
const report={schema:'komerce-g6-negative-n30/1',scenario_id:'N30',market:MK.code,reference:REF,order_id:ID,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],order360:null,commerce:null,market_commerce:null,simulated_commerce:null,page_events:[],
 external_supplier_calls:0,external_payment_executed:false,production_permitted:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const reach=k=>{report.steps_reached.push(k);save()};
const norm=s=>String(s).replace(/\s+/gu,' ').trim();
const number=(n,digits)=>n==null?'—':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:digits}).format(Number(n));
const money=(n,unit,digits)=>n==null?'—':number(n,digits)+' '+unit;
async function loadScreen(page,route,endpoint,expectedQuery=null){
 const pending=page.waitForResponse(r=>{
  const u=new URL(r.url());
  return u.origin===BASE&&u.pathname===endpoint&&r.request().method()==='GET'&&(!expectedQuery||expectedQuery(u.searchParams));
 },{timeout:25000});
 await humanGoto(page,route,{waitUntil:'domcontentloaded'});
 const response=await pending;
 check(response.status()===200,'G6_N30_SCREEN_HTTP_'+response.status());
 return response.json();
}
async function requireMetric(host,key,expected){
 const value=host.locator('[data-metric-key="'+key+'"] .kmc-metric-value');
 await value.waitFor({state:'visible',timeout:25000});
 check(norm(await value.innerText())===norm(expected),'G6_N30_PRODUCT_GAP_RENDERED_METRIC_'+key);
}
async function readCommerce(page,market,simulation){
 const query=new URLSearchParams({period:'7'});
 if(market)query.set('market',market);
 if(simulation)query.set('simulation_scope',simulation);
 const endpoint='/api/admin/dashboard/commerce'+(market?'/market/'+encodeURIComponent(market):'');
 const payload=await loadScreen(page,'/admin/commerce?'+query,endpoint,p=>p.get('period')==='7'&&(p.get('simulation_scope')||null)===simulation);
 const dashboard=page.locator('[data-dashboard-id="commerce"]');
 await dashboard.waitFor({state:'visible',timeout:25000});
 check((await dashboard.getAttribute('data-simulation-scope'))===simulation,'G6_N30_WRONG_RENDERED_SIMULATION_SCOPE');
 const ca=(payload.kpis||[]).find(k=>k.key==='ca_encaisse');
 check(ca&&ca.value!=null&&ca.unit&&Number.isFinite(Number(ca.value))&&payload.period_definition?.from&&payload.period_definition?.to,'G6_N30_COMMERCE_KPI_UNAVAILABLE');
 check((payload.simulation?.scope||null)===simulation&&payload.data_quality?.scope_mode===(market?'market':'global'),'G6_N30_WRONG_API_SCOPE');
 await requireMetric(dashboard,'ca-encaisse',money(ca.value,ca.unit,ca.minor_unit??(ca.unit==='EUR'?2:0)));
 return {http:200,rendered:true,market,ca_value:ca.value,unit:ca.unit,from:payload.period_definition.from,to:payload.period_definition.to,simulation:payload.simulation||null};
}
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
  const orderPath='/api/admin/entities/orders/'+encodeURIComponent(REF);
  const j=await loadScreen(admin.page,'/admin/orders/'+encodeURIComponent(REF),orderPath);
  const title=admin.page.locator('.kmc-entity-title');
  await title.waitFor({state:'visible',timeout:25000});
  check((await title.innerText()).trim()===REF&&j.order?.reference===REF,'G6_N30_WRONG_ORDER_SCREEN');
  const metricHost=admin.page.locator('.kmc-entity-metrics');
  const payment=j.order?.payment||{},currency=j.order?.market?.currency;
  check(currency&&payment.total_kmf!=null&&j.order?.status&&payment.status,'G6_N30_ORDER_PROJECTION_INCOMPLETE');
  const total=currency==='KMF'?payment.total_kmf:payment.market_total;
  check(currency==='KMF'||(payment.market_total_available===true&&payment.market_currency===currency&&total!=null),'G6_N30_ORDER_DISPLAY_SNAPSHOT_MISSING');
  await requireMetric(metricHost,'status',j.order.status);
  await requireMetric(metricHost,'payment',payment.status);
  await requireMetric(metricHost,'total',money(total,currency,0));
  await requireMetric(metricHost,'parcels',number(j.summary?.parcels,0));
  report.order360={http:200,rendered:true,reference:REF,status:j.order.status,payment_status:payment.status,total_kmf:payment.total_kmf,
   display_currency:currency,display_total:total,simulation_scope:j.order.simulation_scope||null,items:j.summary?.items,quantity:j.summary?.quantity,parcels:j.summary?.parcels};
  reach('ORDER_360_RENDERED_AND_READ');
  report.commerce=await readCommerce(admin.page,null,null);
  reach('COMMERCE_GROUP_EUR_RENDERED_AND_READ');
  report.market_commerce=await readCommerce(admin.page,MK.code,null);
  reach('COMMERCE_MARKET_RENDERED_AND_READ');
  check(report.order360.simulation_scope==='G6-BUYER','G6_N30_FIXTURE_SCOPE_MISSING');
  report.simulated_commerce=await readCommerce(admin.page,MK.code,report.order360.simulation_scope);
  reach('COMMERCE_SIMULATION_ISOLATED_RENDERED_AND_READ');
  await runtime();
  report.verdict='G6_N30_ORDER_360_AND_DASHBOARD_READ_CHROMIUM_PASS';save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(admin)await admin.ctx.close().catch(()=>{});if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
