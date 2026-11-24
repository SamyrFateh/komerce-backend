#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-m06-pickup-sav-ui-oracle-chromium
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Verify the collected M06 line is eligible in the real SAV screen without opening a dossier or writing data.
 * @impact-areas staging-only, orders, logistics
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
// The forwarder exports the authenticated actor, not the runtime attestation.
const {login}=require('./g6-canonical-forwarder-chromium');
const {runtime}=require('./g6-hub-shipment-chromium');
const {humanGoto,humanFill,humanClick}=require('./canonical/actors/human-gestures');
const {observe,fullError}=require('./canonical/observability');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const ORDER=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE,ITEM=env.G6_CANONICAL_ORDER_ITEM_ID;
const OUT=path.resolve('test-results/g6-m06-sav-ui-oracle');
let OBS=null;
const report={schema:'komerce-g6-m06-sav-ui-oracle/1',scenario_id:'M06',market:'KM',order_id:ORDER||null,
 reference:REF||null,read_only:true,sav_create_post_count:0,pickup_scan_count:0,
 external_supplier_calls:0,external_payment_executed:false,production_permitted:false,verdict:'BLOCKED'};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const check=(v,code)=>{if(!v)throw Error(code)};
async function main(){
 let browser,actor;
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&
   env.STAGING_BASE_URL===BASE&&env.G6_CANONICAL_SCENARIO==='M06'&&env.G6_CANONICAL_PHASE==='M06_SAV_ORACLE'&&
   env.G6_DYNAMIC_FRESH_ORDER==='1'&&/^[a-f0-9-]{36}$/i.test(ORDER||'')&&/^[a-f0-9-]{36}$/i.test(ITEM||''),
   'G6_M06_SAV_ORACLE_OWNER_STAGING_GUARD');
  const target=await confirmTarget({db,env});check(target.confirmed&&target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_M06_SAV_ORACLE_DB_DRIFT');
  report.db_fingerprint=target.fingerprint;report.sha=await runtime();
  const {rows}=await db.query(`SELECT o.id,o.reference,o.status::text AS status,m.code AS market,
    i.quantity, i.qty_collected, i.id AS item_id FROM orders o JOIN markets m ON m.id=o.market_id
    JOIN order_items i ON i.order_id=o.id WHERE o.id=$1 AND o.reference=$2`,[ORDER,REF]);
  check(rows.length===1&&rows[0].item_id===ITEM&&rows[0].market==='KM'&&rows[0].status==='collected'&&
   Number(rows[0].quantity)===3&&Number(rows[0].qty_collected)===3,'G6_M06_SAV_ORACLE_PICKUP_NOT_FINAL');
  const scans=await db.query("SELECT COUNT(*)::int AS n FROM scans WHERE order_id=$1 AND step='collected'",[ORDER]);
  report.pickup_scan_count=Number(scans.rows[0]?.n||0);check(report.pickup_scan_count===1,'G6_M06_SAV_ORACLE_PICKUP_SCAN_INVALID');
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  actor=await login(browser,'E2E_AGENT_RELAIS_','agent_relais');
  const blocked=[];await actor.page.route('**/*',route=>{
   if(route.request().method()==='POST'){report.sav_create_post_count++;blocked.push(route.request().url());return route.abort('blockedbyclient')}
   return route.continue();
  });
  await humanGoto(actor.page,'/admin/relais-live?view=execute&market=KM&focus=returns',{waitUntil:'domcontentloaded'});
  const section=actor.page.locator('[data-relay-return-requests]');await section.waitFor({state:'visible',timeout:25000});
  const lookup=section.locator('form[data-relay-return-lookup]');
  await humanFill(null,lookup.locator('[data-relay-return-reference]'),REF);
  await humanClick(null,lookup.locator('button[type="submit"]'));
  const create=section.locator('form[data-relay-return-create]');await create.waitFor({state:'visible',timeout:20000});
  const selected=await create.locator('[data-relay-return-product]').inputValue();
  const qty=await create.locator('input[aria-label="Quantité concernée"]').inputValue();
  check(selected===ITEM&&qty==='1'&&report.sav_create_post_count===0&&blocked.length===0,
   'G6_M06_SAV_ORACLE_SCREEN_SCOPE_INVALID');
  report.screen={page:'/admin/relais-live?focus=returns',eligible_item_id:selected,remaining_quantity:qty,
   dossier_opened:false,physical_intake_performed:false};
  report.verdict='G6_M06_PICKUP_SAV_UI_ORACLES_CHROMIUM_PG_PASS';await runtime();save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(actor)await actor.ctx.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end().catch(()=>{});console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
