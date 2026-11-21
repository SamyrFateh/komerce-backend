#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-local-relay-available-chromium
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose M02 (LOCAL_STOCK) : l'agent relais atteste la réception locale sur l'écran Relais (colis disponible), sans Hub ni transport.
 * @impact-areas staging-only, logistics
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {runtime}=require('./g6-hub-shipment-chromium');
const {login}=require('./g6-canonical-forwarder-chromium');
const {openRelayLive}=require('./canonical/relay-live-navigation');
const {attachDedicatedRelayByUI}=require('./g6-canonical-relay-receipt-chromium');
const {assertNoHubOrTransport}=require('./canonical/local-stock-oracles');
const {assertMixedPhase}=require('./canonical/m03-oracles');
const {observe,fullError}=require('./canonical/observability');
const {humanClick,humanFill,humanCheck}=require('./canonical/actors/human-gestures');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const OUT=path.resolve('test-results/g6-local-relay-available');
let OBS=null;
const SCEN=process.env.G6_CANONICAL_SCENARIO==='M03'?'M03':'M02';
// M02 : oracles stricts de commande 100 % locale ; M03 : mêmes gestes, oracles de panier mixte (branche locale seulement).
const oracle=(db,id,phase)=>SCEN==='M03'?assertMixedPhase(db,id,phase==='cash'?'structure':'local_available'):assertNoHubOrTransport(db,id,phase);
const report={schema:'komerce-g6-local-relay-available/1',scenario_id:SCEN,market:MK.code,reference:REF,order_id:ID,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',events:[],external_supplier_calls:0,
 external_payment_executed:false,production_permitted:false};
const check=(v,e)=>{if(!v)throw Error(e)};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
async function main(){
 let browser;
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
   env.G6_CANONICAL_PHASE==='LOCAL_RELAY_AVAILABLE'&&['M02','M03','N23','N24','N21','N22','N29'].includes(env.G6_CANONICAL_SCENARIO)&&
   env.G6_DYNAMIC_FRESH_ORDER==='1'&&env.G6_TARGET_MARKET===MK.code&&/^[a-f0-9-]{36}$/i.test(ID||''),
   'G6_LOCAL_RELAY_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_LOCAL_RELAY_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  const {rows:[o]}=await db.query('SELECT reference,relais_id,status::text AS status,payment_status::text AS payment_status FROM orders WHERE id=$1',[ID]);
  check(o&&o.reference===REF&&o.payment_status==='paid','G6_LOCAL_RELAY_PRECONDITION_INVALID');
  report.before=await oracle(db,ID,'cash');save();
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const actor=await login(browser,'E2E_AGENT_RELAIS_','agent_relais');
  try{
   const me=await (await actor.page.request.get('/api/auth/me')).json();
   let {rows:[staff]}=await db.query('SELECT role::text AS role,relais_id FROM users WHERE id=$1',[me.id]);
   check(staff?.role==='agent_relais','G6_LOCAL_RELAY_ACTOR_ROLE_INVALID');
   // Même geste que M01 (g6-canonical-relay-receipt) : rattachement par l'écran Réseau admin, jamais en SQL.
   if(staff.relais_id!==o.relais_id){
    await attachDedicatedRelayByUI(browser,me.id,o.relais_id);
    ({rows:[staff]}=await db.query('SELECT role::text AS role,relais_id FROM users WHERE id=$1',[me.id]));
    report.events.push({key:'relay-agent-attached-by-ui',role:'admin',ui:true});
   }
   check(staff.relais_id===o.relais_id,'G6_LOCAL_RELAY_ACTOR_MISMATCH');
   const url=BASE+'/api/orders/'+ID+'/local-relay-receipt';let calls=0;
   await actor.page.route(url,route=>{
    const req=route.request();let body;try{body=req.postDataJSON()}catch(_){}
    if(req.method()==='POST'&&calls++===0&&body?.physical_received===true)return route.continue();
    actor.blocked.push({method:req.method(),path:'/local-relay-receipt'});return route.abort('blockedbyclient');
   });
   actor.page.on('dialog',d=>d.type()==='confirm'?d.accept():d.dismiss());
   // Écran : Flux Relais, atelier de réception, file « Réception locale » (lien humain, jamais d'URL forgée).
   await openRelayLive(actor.page,{selector:'[data-relay-execution-jump="receive"]',entry:'execute',timeout:30000});
   await humanClick(null,actor.page.locator('[data-relay-execution-jump="receive"]'));
   const card=actor.page.locator('#relay-execution-receive [data-relay-local-order="'+REF+'"]');
   await card.waitFor({state:'visible',timeout:25000});
   await humanCheck(null,card.locator('[data-local-physical-proof]'));
   await humanFill(null,card.locator('[data-local-receipt-note]'),'RECETTE M02 '+MK.code+' reception locale');
   const pending=actor.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:30000});
   await humanClick(null,card.locator('[data-workspace-action="local-relay-receipt"]'));
   const res=await pending;
   check(res.status()===200&&calls===1&&actor.blocked.length===0,'G6_LOCAL_RELAY_RECEIPT_REJECTED_'+res.status());
   report.events.push({key:'local-relay-receipt',http:200,role:'agent_relais',ui:true});save();
  }finally{await actor.ctx.close()}
  report.after=await oracle(db,ID,'available');
  await runtime();
  report.verdict='G6_LOCAL_RELAY_AVAILABLE_SIMULATED_CHROMIUM_PG_PASS';save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
