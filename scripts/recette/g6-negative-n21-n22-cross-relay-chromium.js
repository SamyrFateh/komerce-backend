/** @komerce-arch-lite
 * @role g6-negative-n21-n22-cross-relay-chromium
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose N21 (agent d'un autre relais) et N22 (relais A/B, deux sens) : écriture refusée, aucune donnée divulguée en lecture (table R) ; staging only, aucune écriture SQL.
 * @db-read orders, users, relais, markets, scans, parcels, parcel_items
 * @db-write none
 * @impact-areas staging-only, pickup, security
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
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
const {guardCollect,counter,pageEvents,norm,check,URL_COLLECT}=require('./g6-negative-n23-n24-chromium');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE,SCEN=env.G6_CANONICAL_SCENARIO;
const PHASE={N21:'N21_CROSS_RELAY_ATTEMPTS',N22:'N22_TWO_RELAYS_ATTEMPTS'}[SCEN];
const OUT=path.resolve('test-results/g6-negative-n21-n22');
let OBS=null;
const report={schema:'komerce-g6-negative-n21-n22/1',scenario_id:SCEN,market:MK.code,reference:REF,order_id:ID,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],control:null,reverse:null,intruder:{reads:[],write:null,ui:{}},gaps:[],
 page_events:[],external_supplier_calls:0,external_payment_executed:false,plaintext_pickup_code_logged:false,production_permitted:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const reach=k=>{report.steps_reached.push(k);save()};
const labelled=(id,ref)=>[['order_by_id','/api/orders/'+id],['order_by_ref','/api/orders/'+ref],['parcels','/api/orders/'+id+'/parcels'],
 ['history','/api/orders/'+id+'/history'],['relay_list','/api/orders/relais']];
// Lectures authentifiées (GET) : une réponse 200 contenant l'identité de la commande est une divulgation.
async function probeReads(page,id,ref){
 const out=[];
 for(const [label,url] of labelled(id,ref)){
  const res=await page.request.get(url).catch(()=>null);
  const text=res?await res.text().catch(()=>''):'';
  out.push({label,http:res?res.status():null,contains_order:!!res&&res.status()===200&&(text.includes(ref)||text.includes(id))});
 }
 return out;
}
async function agentSession(browser,tag){
 const actor=await login(browser,'E2E_AGENT_RELAIS_','agent_relais');
 const me=await (await actor.page.request.get('/api/auth/me')).json();
 actor.page.on('dialog',d=>d.type()==='confirm'?d.accept():d.dismiss());
 pageEvents(actor.page,tag);
 return {actor,agentId:me.id};
}
async function relayOf(agentId){return (await db.query('SELECT relais_id FROM users WHERE id=$1',[agentId])).rows[0]?.relais_id}
async function main(){
 let browser,clientContext;
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
   !!PHASE&&env.G6_CANONICAL_PHASE===PHASE&&env.G6_DYNAMIC_FRESH_ORDER==='1'&&env.G6_TARGET_MARKET===MK.code&&
   /^[a-f0-9-]{36}$/i.test(ID||''),'G6_'+SCEN+'_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_'+SCEN+'_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  const {rows:[o]}=await db.query(`SELECT o.reference,o.status::text AS status,o.payment_status::text AS payment_status,o.relais_id,o.user_id,
    (o.pickup_secret_hash IS NOT NULL) AS has_secret,u.phone,u.email,u.role::text AS role FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=$1`,[ID]);
  check(o&&o.reference===REF&&o.status==='available'&&o.payment_status==='paid'&&o.has_secret,'G6_'+SCEN+'_PRECONDITION_NOT_PAID_AVAILABLE');
  // Second relais actif du même marché, lu en lecture seule ; sinon prérequis manquant.
  const {rows:[b]}=await db.query(`SELECT r.id,r.name FROM relais r JOIN markets m ON m.id=r.market_id AND m.code=$2
    WHERE r.is_active=TRUE AND r.id<>$1 ORDER BY r.created_at LIMIT 1`,[o.relais_id,MK.code]);
  if(!b)throw Error('PREREQ_MISSING_SECOND_RELAY_'+MK.code);
  report.relay_b_found=true;
  const buyer={id:o.user_id,email:o.email,phone:o.phone,role:o.role};
  check(await verifyMarkedG6Buyer(db,buyer,env),'G6_'+SCEN+'_EXISTING_MARKED_BUYER_REQUIRED');
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const c=await customer(browser,buyer);clientContext=c.ctx;reach('CLIENT_CODE_FROM_CLIENT_SCREEN');
  // Profil de contrôle (N22) : agent du relais de la commande ; lecture permise, et sens inverse (commande du relais B vue depuis A).
  let agentId;
  if(SCEN==='N22'){
   const s=await agentSession(browser,'control');agentId=s.agentId;
   try{
    check(await relayOf(agentId)===o.relais_id,'G6_N22_PRECONDITION_AGENT_NOT_AT_ORDER_RELAY');
    const list=(await probeReads(s.actor.page,ID,REF));
    report.control={profile:'agent_at_order_relay',reads:list};
    const {rows:[ob]}=await db.query('SELECT id,reference FROM orders WHERE relais_id=$1 ORDER BY created_at DESC LIMIT 1',[b.id]);
    if(ob){const rev=await probeReads(s.actor.page,ob.id,ob.reference);
     report.reverse={direction:'agent_at_A_vs_order_at_B',reads:rev};
     for(const r of rev)if(r.contains_order)report.gaps.push('N22_REVERSE_READ_'+r.label);
    }else {
     report.reverse={direction:'agent_at_A_vs_order_at_B',not_played:'NO_ORDER_AT_RELAY_B'};
     if(SCEN==='N22')throw Error('G6_N22_SCREEN_MISSING_REVERSE_ORDER_AT_RELAY_B');
    }
    await s.actor.ctx.close();
   }catch(e){await s.actor.ctx.close().catch(()=>{});throw e}
   reach('CONTROL_PROFILE_READ');
  }
  // Rattachement de l'agent au relais B par l'écran Réseau (jamais en SQL), puis nouvelle session.
  const first=await agentSession(browser,'pre-attach');agentId=first.agentId;await first.actor.ctx.close();
  await attachDedicatedRelayByUI(browser,agentId,b.id);
  check(await relayOf(agentId)===b.id,'G6_'+SCEN+'_AGENT_NOT_ATTACHED_TO_RELAY_B');
  reach('AGENT_ATTACHED_TO_OTHER_RELAY');
  const s=await agentSession(browser,'intruder'),actor=s.actor;
  try{
   const seen=[];
   actor.page.on('response',async r=>{try{if(new URL(r.url()).pathname.startsWith('/api/')&&r.request().method()==='GET'){
    const t=await r.text();if(t.includes(REF)||t.includes(ID))seen.push(new URL(r.url()).pathname.replace(ID,':id').replace(REF,':ref'))}}catch(_){}});
   const wait={expect:norm(c.code),used:false};
   await guardCollect(actor.page,wait,actor.blocked);
   // Lecture par l'écran : le comptoir/les listes du relais B ne doivent pas montrer la commande.
   let box=null;
   try{box=await openRelayLive(actor.page,{selector:'[data-manual-pickup-code]',timeout:20000,entry:'remises'})}catch(_){box=null}
   const body=await actor.page.locator('body').innerText().catch(()=>'');
   report.intruder.ui={counter_visible:!!box,order_reference_on_screen:body.includes(REF)};
   report.intruder.reads=await probeReads(actor.page,ID,REF);
   report.intruder.ui.api_responses_with_order=[...new Set(seen)];
   reach('INTRUDER_READS');
   // Écriture : le code juste, saisi au comptoir si l'écran l'offre ; sinon sonde API authentifiée (même origine), signalée comme telle.
   if(box&&await box.locator('[data-pickup-code-confirm]').isEnabled().catch(()=>false)){
    await humanFill(null,counter(actor.page).locator('[data-pickup-code-input]'),c.code);
    const pending=actor.page.waitForResponse(r=>r.url()===URL_COLLECT&&r.request().method()==='POST',{timeout:25000}).catch(()=>null);
    await humanClick(null,counter(actor.page).locator('[data-pickup-code-confirm]'));
    const res=await pending;
    report.intruder.write={via:'UI_COUNTER',http:res?res.status():null};
   }else{
    const res=await actor.page.request.post(URL_COLLECT,{headers:{origin:BASE},data:{pickup_code:c.code}}).catch(()=>null);
    const j=res?await res.json().catch(()=>({})):{};
    report.intruder.write={via:'API_PROBE_NO_COUNTER_FOR_RELAY_B',http:res?res.status():null,error_code:j.code||null};
   }
   c.code=null;reach('INTRUDER_WRITE');
   check(actor.blocked.length===0,'G6_'+SCEN+'_UNEXPECTED_RELAY_WRITE');
  }finally{await actor.ctx.close()}
  const w=report.intruder.write;
  if(w.http===200)report.gaps.push('WRITE_ACCEPTED');
  else if(/^csrf_/.test(w.error_code||''))throw Error('G6_'+SCEN+'_SCREEN_MISSING_WRITE_PROBE_'+w.error_code);
  else if(w.http===null)throw Error('G6_'+SCEN+'_SCREEN_MISSING_NO_WRITE_RESPONSE');
  else if(![403,404,401].includes(w.http))report.gaps.push('WRITE_UNEXPECTED_'+w.http);
  for(const r of report.intruder.reads)if(r.contains_order)report.gaps.push('READ_'+r.label);
  if(report.intruder.ui.order_reference_on_screen)report.gaps.push('READ_SCREEN');
  if(report.intruder.ui.api_responses_with_order.length)report.gaps.push('READ_UI_API');
  await runtime();
  if(report.gaps.length){report.verdict='PRODUCT_GAP';throw Error('G6_'+SCEN+'_PRODUCT_GAP_'+report.gaps.join('_'))}
  report.verdict='G6_'+SCEN+'_CROSS_RELAY_REFUSED_CHROMIUM_PASS';save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(clientContext)await clientContext.close().catch(()=>{});if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
