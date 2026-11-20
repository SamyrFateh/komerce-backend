#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-local-client-pickup-chromium
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose M02 (LOCAL_STOCK) : code canonique du client, saisi au clavier au comptoir Remises du relais, puis remise.
 * @impact-areas staging-only, pickup, logistics
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {verifyMarkedG6Buyer}=require('../../services/g6-staging-buyer-identity-guard');
const {runtime}=require('./g6-hub-shipment-chromium');
const {customer,relay}=require('./g6-canonical-client-pickup-chromium');
const {assertNoHubOrTransport}=require('./canonical/local-stock-oracles');
const {observe,fullError}=require('./canonical/observability');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const OUT=path.resolve('test-results/g6-local-client-pickup');
let OBS=null;
const report={schema:'komerce-g6-local-client-pickup/1',scenario_id:'M02',market:MK.code,reference:REF,order_id:ID,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',external_supplier_calls:0,external_payment_executed:false,
 plaintext_pickup_code_logged:false,production_permitted:false};
const check=(v,e)=>{if(!v)throw Error(e)};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
async function main(){
 let browser,clientContext;
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
   env.G6_CANONICAL_PHASE==='LOCAL_CLIENT_PICKUP'&&env.G6_CANONICAL_SCENARIO==='M02'&&
   env.G6_DYNAMIC_FRESH_ORDER==='1'&&env.G6_TARGET_MARKET===MK.code&&/^[a-f0-9-]{36}$/i.test(ID||''),
   'G6_LOCAL_PICKUP_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_LOCAL_PICKUP_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  const {rows:[o]}=await db.query(`SELECT o.reference,o.status::text AS status,o.relais_id,o.user_id,o.pickup_secret_hash IS NOT NULL AS has_secret,
    u.phone,u.email,u.role::text AS role FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=$1`,[ID]);
  check(o&&o.reference===REF&&o.status==='available','G6_LOCAL_PICKUP_PRECONDITION_INVALID');
  // Le code canonique doit exister : jamais fabriqué ni lu en base, uniquement régénéré par l'écran client.
  check(o.has_secret,'G6_LOCAL_PICKUP_CANONICAL_SECRET_MISSING');
  report.before=await assertNoHubOrTransport(db,ID,'available');save();
  const buyer={id:o.user_id,email:o.email,phone:o.phone,role:o.role};
  check(await verifyMarkedG6Buyer(db,buyer,env),'G6_LOCAL_PICKUP_EXISTING_MARKED_BUYER_REQUIRED');
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const c=await customer(browser,buyer);clientContext=c.ctx;
  const agent=await relay(browser,c.code,o.relais_id);
  c.code=null;
  report.after=await assertNoHubOrTransport(db,ID,'collected');
  const {rows:[scan]}=await db.query("SELECT scanned_by,pickup_method,pickup_relais_id FROM scans WHERE order_id=$1 AND step='collected'",[ID]);
  check(scan&&scan.scanned_by===agent&&scan.pickup_method==='PICKUP_CODE'&&scan.pickup_relais_id===o.relais_id,'G6_LOCAL_PICKUP_FINAL_PG_INVALID');
  await runtime();
  report.verdict='G6_LOCAL_CLIENT_PICKUP_SIMULATED_CHROMIUM_PG_PASS_COLLECTED';save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(clientContext)await clientContext.close().catch(()=>{});if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
