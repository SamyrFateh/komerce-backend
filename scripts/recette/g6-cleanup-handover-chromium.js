#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-cleanup-handover-chromium
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose G6-CLEANUP classe D : vraie remise comptoir Remises d'UNE commande G6-BUYER disponible au relais (code lu sur l'écran client), après rattachement de l'agent au relais.
 * @db-read orders, users, relais, hub_physical_units, hub_physical_unit_placements, hub_purchase_allocations, scans
 * @impact-areas orders, staging-only
 */
'use strict';
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {verifyMarkedG6Buyer}=require('../../services/g6-staging-buyer-identity-guard');
const {customer,relay}=require('./g6-canonical-client-pickup-chromium');
const {attachDedicatedRelayByUI}=require('./g6-canonical-relay-receipt-chromium');
const {observe,fullError}=require('./canonical/observability');
const fs=require('node:fs'),path=require('node:path');
const env=process.env;
const OUT='test-results/g6-cleanup-handover';
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE,RELAY=env.G6_CLEANUP_RELAIS_ID;
const LOCK_WAIT_MS=Number(env.G6_CLEANUP_LOCK_WAIT_MS||16*60*1000);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const check=(ok,code)=>{if(!ok)throw Error(code);};
const out={schema:'komerce-g6-cleanup-handover/1',reference:REF,verdict:'BLOCKED',plaintext_pickup_code_logged:false};
// Lecture seule PG ; seules écritures : l'OTP client fixture (helper gardé) via customer() et le rattachement admin par écran.
async function main(){
 let browser,OBS=null;
 try{
  check(env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&
   env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&/^[a-f0-9-]{36}$/i.test(ID||'')&&
   /^[a-f0-9-]{36}$/i.test(RELAY||'')&&!!REF,'G6_CLEANUP_HANDOVER_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&(!env.G6_CLEANUP_DB_FINGERPRINT||guard.fingerprint===env.G6_CLEANUP_DB_FINGERPRINT),'G6_CLEANUP_HANDOVER_DB_DRIFT');
  const {rows:[o]}=await db.query(
   `SELECT o.reference,o.status::text AS status,o.payment_mode::text AS payment_mode,o.payment_status::text AS payment_status,
           o.simulation_scope,o.relais_id,o.user_id,o.pickup_secret_hash IS NOT NULL AS has_secret,o.pickup_secret_blocked_until AS blocked_until,
           u.phone,u.email,u.role::text AS role,
           (SELECT COUNT(*)::int FROM hub_physical_units h WHERE h.order_id=o.id) AS hub_units
      FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=$1`,[ID]);
  check(o&&o.reference===REF&&o.simulation_scope==='G6-BUYER','G6_CLEANUP_HANDOVER_NOT_G6_BUYER');
  check(o.payment_mode==='cash_relais'&&o.payment_status==='paid'&&o.status==='available'&&o.relais_id===RELAY&&o.has_secret&&!o.hub_units,
   'G6_CLEANUP_HANDOVER_PRECONDITION');
  const buyer={id:o.user_id,email:o.email,phone:o.phone,role:o.role};
  check(await verifyMarkedG6Buyer(db,buyer,env),'G6_CLEANUP_HANDOVER_MARKED_BUYER_REQUIRED');
  // Verrou N23 : attendre sa fin, jamais le contourner.
  const until=o.blocked_until?new Date(o.blocked_until).getTime():0,wait=until-Date.now();
  if(wait>0){
   if(wait>LOCK_WAIT_MS){out.verdict='BLOCKED_N23_LOCK';out.blocked_until=new Date(until).toISOString();return;}
   await sleep(wait+2000);
  }
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const email=String(env.E2E_AGENT_RELAIS_EMAIL||'').toLowerCase();
  const {rows:[agent]}=await db.query("SELECT id,relais_id FROM users WHERE lower(email)=$1 AND role::text='agent_relais'",[email]);
  check(agent,'G6_CLEANUP_HANDOVER_AGENT_MISSING');
  if(agent.relais_id!==RELAY)await attachDedicatedRelayByUI(browser,agent.id,RELAY);
  const c=await customer(browser,buyer);
  try{await relay(browser,c.code,RELAY);}finally{c.code=null;await c.ctx.close().catch(()=>{});}
  const {rows:[a]}=await db.query('SELECT status::text AS status FROM orders WHERE id=$1 AND simulation_scope=$2',[ID,'G6-BUYER']);
  check(a&&a.status==='collected','G6_CLEANUP_HANDOVER_READBACK');
  out.verdict='HANDOVER_DONE';
 }catch(e){out.error=fullError(e);process.exitCode=2;}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end().catch(()=>{});try{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report-'+String(REF).replace(/\W/g,'')+'.json'),JSON.stringify(out,null,2)+'\n');}catch(_){}console.log(JSON.stringify(out));}
}
if(require.main===module)main();
module.exports={main};
