/** @komerce-arch-lite
 * @role g6-negative-n29-authz-chromium
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose N29 (staging only) : mutation avec session expirée (401) puis geste réservé tenté par un rôle non autorisé (403) ; aucune mutation attendue, aucune écriture SQL.
 * @db-read orders, users, scans, parcels, parcel_items
 * @db-write none
 * @impact-areas staging-only, security
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {verifyMarkedG6Buyer}=require('../../services/g6-staging-buyer-identity-guard');
const {runtime}=require('./g6-hub-shipment-chromium');
const {customer}=require('./g6-canonical-client-pickup-chromium');
const {observe,fullError}=require('./canonical/observability');
const {humanClick,humanFill}=require('./canonical/actors/human-gestures');
const {guardCollect,counter,openCounter,check,URL_COLLECT,bindAgent,norm}=require('./g6-negative-n23-n24-chromium');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const OUT=path.resolve('test-results/g6-negative-n29');
let OBS=null;
const report={schema:'komerce-g6-negative-n29/1',scenario_id:'N29',market:MK.code,reference:REF,order_id:ID,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],expired_session:null,forbidden_role:[],page_events:[],gaps:[],
 external_supplier_calls:0,external_payment_executed:false,plaintext_pickup_code_logged:false,production_permitted:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const reach=k=>{report.steps_reached.push(k);save()};
async function main(){
 let browser,clientContext;
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
   env.G6_CANONICAL_PHASE==='N29_SESSION_ROLE_ATTEMPTS'&&env.G6_CANONICAL_SCENARIO==='N29'&&env.G6_DYNAMIC_FRESH_ORDER==='1'&&
   env.G6_TARGET_MARKET===MK.code&&/^[a-f0-9-]{36}$/i.test(ID||''),'G6_N29_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_N29_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  const {rows:[o]}=await db.query(`SELECT o.reference,o.status::text AS status,o.payment_status::text AS payment_status,o.relais_id,o.user_id,
    (o.pickup_secret_hash IS NOT NULL) AS has_secret,u.phone,u.email,u.role::text AS role FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=$1`,[ID]);
  check(o&&o.reference===REF&&o.status==='available'&&o.payment_status==='paid'&&o.has_secret,'G6_N29_PRECONDITION_NOT_PAID_AVAILABLE');
  const buyer={id:o.user_id,email:o.email,phone:o.phone,role:o.role};
  check(await verifyMarkedG6Buyer(db,buyer,env),'G6_N29_EXISTING_MARKED_BUYER_REQUIRED');
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const c=await customer(browser,buyer);clientContext=c.ctx;reach('CLIENT_CODE_FROM_CLIENT_SCREEN');
  const code=c.code;
  // 403 : un client (rôle non autorisé) tente le geste réservé aux agents relais et admins ; sonde API authentifiée même origine (aucun écran client n'offre ce geste).
  const hit=await c.page.request.post(URL_COLLECT,{headers:{origin:BASE},data:{pickup_code:code}}).catch(()=>null);
  const hj=hit?await hit.json().catch(()=>({})):{};
  report.forbidden_role.push({role:'client',gesture:'scans/collect',via:'API_PROBE_NO_CLIENT_SCREEN',http:hit?hit.status():null,error_code:hj.code||null});
  reach('CLIENT_FORBIDDEN_TRIED');
  // 401 : l'agent saisit le bon code au comptoir Remises, la session est supprimée (cookies vidés, comme une expiration), puis il valide.
  const {actor}=await bindAgent(browser,o.relais_id);
  try{
   const wait={expect:null,used:false};
   wait.expect=norm(code);
   await guardCollect(actor.page,wait,actor.blocked);
   await openCounter(actor.page);reach('REMISES_COUNTER_OPEN');
   await humanFill(null,counter(actor.page).locator('[data-pickup-code-input]'),code);
   c.code=null;
   await actor.ctx.clearCookies();reach('SESSION_EXPIRED');
   const pending=actor.page.waitForResponse(r=>r.url()===URL_COLLECT&&r.request().method()==='POST',{timeout:25000}).catch(()=>null);
   await humanClick(null,counter(actor.page).locator('[data-pickup-code-confirm]'));
   const res=await pending;
   await actor.page.waitForTimeout(1500);
   const bodyText=await actor.page.locator('body').innerText().catch(()=>'');
   const j=res?await res.json().catch(()=>({})):{};
   const msg=String(j.error||j.message||'').slice(0,160);
   report.expired_session={http:res?res.status():null,final_path:new URL(actor.page.url()).pathname,
    redirected_to_login:/login|connexion|auth/i.test(new URL(actor.page.url()).pathname),
    message:msg||null,message_visible:!!msg&&bodyText.includes(msg)};
   report.expired_session.ux_signal=(!report.expired_session.redirected_to_login&&!report.expired_session.message_visible)?'SESSION_EXPIREE_SANS_REDIRECTION_NI_MESSAGE':null;
   reach('EXPIRED_SESSION_MUTATION_TRIED');
   check(actor.blocked.length===0,'G6_N29_UNEXPECTED_RELAY_WRITE');
  }finally{await actor.ctx.close()}
  const f=report.forbidden_role[0],x=report.expired_session;
  if(f.http===200)report.gaps.push('CLIENT_COLLECT_ACCEPTED');
  else if(/^csrf_/.test(f.error_code||''))throw Error('G6_N29_SCREEN_MISSING_PROBE_'+f.error_code);
  else if(![401,403].includes(f.http))report.gaps.push('CLIENT_COLLECT_HTTP_'+f.http);
  if(x.http===200)report.gaps.push('EXPIRED_SESSION_ACCEPTED');
  else if(x.http===null)throw Error('G6_N29_SCREEN_MISSING_NO_RESPONSE_EXPIRED_SESSION');
  else if(x.http!==401)report.gaps.push('EXPIRED_SESSION_HTTP_'+x.http);
  await runtime();
  if(report.gaps.length){report.verdict='PRODUCT_GAP';throw Error('G6_N29_PRODUCT_GAP_'+report.gaps.join('_'))}
  report.verdict='G6_N29_SESSION_401_ROLE_403_REFUSED_CHROMIUM_PASS';save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(clientContext)await clientContext.close().catch(()=>{});if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
