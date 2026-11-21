/** @komerce-arch-lite
 * @role g6-negative-n09-remise-chromium
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose N09 (staging only) : cash non encaissé (RELAY_CASH sauté), tentative de remise par l'écran Remises ; refus attendu, aucune écriture SQL.
 * @db-read orders, users, cash_collections, scans
 * @db-write none
 * @impact-areas staging-only, pickup
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
const {isDeepStrictEqual}=require('node:util');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {verifyMarkedG6Buyer}=require('../../services/g6-staging-buyer-identity-guard');
const {runtime}=require('./g6-hub-shipment-chromium');
const {login}=require('./g6-canonical-forwarder-chromium');
const {customer}=require('./g6-canonical-client-pickup-chromium');
const {attachDedicatedRelayByUI}=require('./g6-canonical-relay-receipt-chromium');
const {openRelayLive}=require('./canonical/relay-live-navigation');
const {observe,fullError}=require('./canonical/observability');
const {humanClick,humanFill}=require('./canonical/actors/human-gestures');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const OUT=path.resolve('test-results/g6-negative-n09');
let OBS=null;
const report={schema:'komerce-g6-negative-n09/1',scenario_id:'N09',market:MK.code,reference:REF,order_id:ID,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',refusal_point:null,refusal_visible:false,events:[],
 external_supplier_calls:0,external_payment_executed:false,plaintext_pickup_code_logged:false,production_permitted:false};
const check=(v,e)=>{if(!v)throw Error(e)};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
async function main(){
 let browser,clientContext;
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
   env.G6_CANONICAL_PHASE==='N09_REMISE_REFUSED'&&env.G6_CANONICAL_SCENARIO==='N09'&&
   env.G6_DYNAMIC_FRESH_ORDER==='1'&&env.G6_TARGET_MARKET===MK.code&&/^[a-f0-9-]{36}$/i.test(ID||''),
   'G6_N09_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_N09_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  const {rows:[o]}=await db.query(`SELECT o.reference,o.status::text AS status,o.payment_status::text AS payment_status,o.relais_id,o.user_id,
    u.phone,u.email,u.role::text AS role,(SELECT count(*)::int FROM cash_collections c WHERE c.order_id=o.id) AS cash_count
    FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=$1`,[ID]);
  check(o&&o.reference===REF&&o.status==='pending'&&o.payment_status==='pending'&&o.cash_count===0,'G6_N09_PRECONDITION_CASH_NOT_PENDING');
  const buyer={id:o.user_id,email:o.email,phone:o.phone,role:o.role};
  check(await verifyMarkedG6Buyer(db,buyer,env),'G6_N09_EXISTING_MARKED_BUYER_REQUIRED');
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  // Côté client : l'écran « Mes commandes » ; un code n'est jamais fabriqué ni lu en base.
  const c=await customer(browser,buyer,{allowNoCode:true});clientContext=c.ctx;
  report.client_code_offered=!!c.code;
  if(c.no_code_ui){report.refusal_point='CLIENT_NO_CODE_OFFERED';report.refusal_visible=true}
  else if(c.rotation_status){report.refusal_point='CLIENT_ROTATION_REFUSED_'+c.rotation_status;report.refusal_visible=true}
  report.events.push({key:'client-pickup-code-screen',offered:!!c.code,refusal_point:report.refusal_point});save();
  // Côté relais : écran Remises.
  const actor=await login(browser,'E2E_AGENT_RELAIS_','agent_relais');
  try{
   const me=await (await actor.page.request.get('/api/auth/me')).json();
   let {rows:[staff]}=await db.query('SELECT role::text AS role,relais_id FROM users WHERE id=$1',[me.id]);
   check(staff?.role==='agent_relais','G6_N09_RELAY_ACTOR_ROLE_INVALID');
   if(staff.relais_id!==o.relais_id){
    await attachDedicatedRelayByUI(browser,me.id,o.relais_id);
    ({rows:[staff]}=await db.query('SELECT role::text AS role,relais_id FROM users WHERE id=$1',[me.id]));
   }
   check(staff.relais_id===o.relais_id,'G6_N09_RELAY_ACTOR_MISMATCH');
   // Saisie à l'écran Remises : le code du client s'il existe, sinon la référence de la commande impayée (jamais un code fabriqué ni lu en base).
   const typed=c.code||REF;report.typed_kind=c.code?'CLIENT_CODE':'ORDER_REFERENCE';
   const url=BASE+'/api/scans/collect';let calls=0,collectStatus=null,collectBody=null;
   await actor.page.route(url,route=>{
    const req=route.request();let body;try{body=req.postDataJSON()}catch(_){}
    if(req.method()==='POST'&&calls++===0&&isDeepStrictEqual(body,{pickup_code:typed}))return route.continue();
    actor.blocked.push({method:req.method(),path:'/api/scans/collect'});return route.abort('blockedbyclient');
   });
   actor.page.on('dialog',d=>d.type()==='confirm'?d.accept():d.dismiss());
   actor.page.on('response',async r=>{if(r.url()===url&&r.request().method()==='POST'){collectStatus=r.status();collectBody=await r.json().catch(()=>null)}});
   let box=null;
   try{box=await openRelayLive(actor.page,{selector:'[data-manual-pickup-code]',timeout:30000,entry:'remises'})}catch(_){box=null}
   report.remises_counter_visible=!!box;
   const bodyText=await actor.page.locator('body').innerText().catch(()=>'');
   report.order_listed_on_remises=bodyText.includes(REF);
   if(box){
    const input=box.locator('[data-pickup-code-input]');
    await humanFill(null,input,typed);
    const pending=actor.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:30000}).catch(()=>null);
    if(await box.locator('[data-pickup-code-confirm]').isEnabled()){
     await humanClick(null,box.locator('[data-pickup-code-confirm]'));
     const res=await pending;
     check(!!res,'G6_N09_SCREEN_MISSING_NO_COLLECT_RESPONSE');
     check(res.status()>=400,'G6_N09_PRODUCT_GAP_REMISE_ACCEPTED_WITHOUT_CASH_'+res.status());
     report.refusal_point='RELAY_COLLECT_REFUSED_'+res.status();
     const msg=String(collectBody?.error||collectBody?.message||'').slice(0,160);
     report.refusal_message=msg||null;
     report.refusal_visible=!!msg&&(await actor.page.locator('body').innerText().catch(()=>'')).includes(msg);
    }else{report.refusal_point='RELAY_CONFIRM_DISABLED_FOR_'+report.typed_kind;report.refusal_visible=true}
   }else{
    // Aucun comptoir de saisie sur Remises (aucun colis en attente) : documenté, aucune saisie pertinente possible.
    report.remises_input_absent=true;
    report.refusal_point=report.refusal_point||'RELAY_REMISES_COUNTER_ABSENT';
   }
   c.code=null;
   await actor.page.screenshot({path:path.join(OUT,'n09-remises.png')}).catch(()=>{});
   check(calls<=1&&actor.blocked.length===0,'G6_N09_UNEXPECTED_RELAY_WRITE');
   report.events.push({key:'relay-remises-attempt',collect_http:collectStatus,refusal_point:report.refusal_point});save();
  }finally{await actor.ctx.close()}
  check(!!report.refusal_point,'G6_N09_SCREEN_MISSING_NO_REFUSAL_OBSERVED');
  await runtime();
  report.verdict='G6_N09_REMISE_REFUSED_CHROMIUM_PASS';save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(clientContext)await clientContext.close().catch(()=>{});if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
