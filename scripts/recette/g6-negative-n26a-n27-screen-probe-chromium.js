/** @komerce-arch-lite
 * @role g6-negative-n26a-n27-screen-probe-chromium
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose N26a (annulation ou remboursement de ligne avant retrait, avoir partiel) et N27 (annulation du reliquat après retrait partiel) : sonde d'écran en lecture seule. L'admin parcourt la fiche commande et les Achats fournisseurs ; sans commande de ligne avec remboursement ou avoir, verdict SCREEN_MISSING. Aucun geste, aucune écriture.
 * @db-read orders
 * @db-write none
 * @impact-areas staging-only, orders, refunds
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
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const SCEN=env.G6_CANONICAL_SCENARIO,ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const PHASES={N26a:'N26A_LINE_REFUND_SCREEN_PROBE',N27:'N27_REMNANT_CANCEL_SCREEN_PROBE'};
const OUT=path.resolve('test-results/g6-negative-n26a-n27');
let OBS=null;
const report={schema:'komerce-g6-negative-n26a-n27/1',scenario_id:SCEN,market:MK.code,reference:REF,order_id:ID,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],screen:[],ux_signal:null,
 external_supplier_calls:0,external_payment_executed:false,production_permitted:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const check=(ok,code)=>{if(!ok)throw Error(code)};
const controls=page=>page.evaluate(()=>[...document.querySelectorAll('[data-workspace-action],button,a')].map(e=>((e.getAttribute('data-workspace-action')||'')+'|'+(e.textContent||'').trim().slice(0,60))));
async function main(){
 let browser;
 try{
  save();
  check(Object.hasOwn(PHASES,SCEN),'G6_N26A_N27_SCENARIO_UNKNOWN');
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
   env.G6_CANONICAL_PHASE===PHASES[SCEN]&&env.G6_DYNAMIC_FRESH_ORDER==='1'&&
   env.G6_TARGET_MARKET===MK.code&&/^[a-f0-9-]{36}$/i.test(ID||''),'G6_'+SCEN+'_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_'+SCEN+'_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const admin=await login(browser,'E2E_ADMIN_','admin');
  try{
   const pages=[['order-360','/admin/orders/'+encodeURIComponent(REF)],['purchasing','/admin/workspaces/purchasing']];
   let lineRefund=false;
   for(const [name,url] of pages){
    await humanGoto(admin.page,url,{waitUntil:'domcontentloaded'});
    await admin.page.waitForLoadState('networkidle',{timeout:15000}).catch(()=>{});
    await admin.page.waitForTimeout(1500);
    const c=await controls(admin.page);
    const hit=c.some(x=>/rembours.*ligne|ligne.*rembours|avoir|credit.?note|annuler.*(ligne|reliquat)|refund-reservation/i.test(x)&&!/cancel-line\|/.test(x.split('|')[0]+'|'));
    report.screen.push({page:name,controls_seen:c.length,line_refund_or_credit_control:hit});
    lineRefund=lineRefund||hit;
   }
   report.steps_reached.push('SCREENS_SCANNED');save();
   await runtime();
   const present=lineRefund;
   if(SCEN==='N26a')throw Error(present?'G6_N26A_SCREEN_PRESENT_GESTURE_NOT_MOUNTED':'G6_N26A_SCREEN_MISSING_LINE_REFUND_AND_PARTIAL_CREDIT');
   throw Error(present?'G6_N27_SCREEN_PRESENT_GESTURE_NOT_MOUNTED':'G6_N27_SCREEN_MISSING_REMNANT_CANCEL_BY_TIER_AND_ITEM_REFUND');
  }finally{await admin.ctx.close()}
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
