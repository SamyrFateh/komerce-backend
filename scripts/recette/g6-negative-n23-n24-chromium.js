/** @komerce-arch-lite
 * @role g6-negative-n23-n24-chromium
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose N23 (retrait sans code, 4 chiffres, codes erronés, force brute) et N24 (deux remises simultanées) au comptoir Remises du relais ; staging only, aucune écriture SQL.
 * @db-read orders, users, scans, parcels, parcel_items, pickup_collect_failures
 * @db-write none
 * @impact-areas staging-only, pickup
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
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
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE,SCEN=env.G6_CANONICAL_SCENARIO;
const PHASE={N23:'N23_WITHDRAWAL_ATTEMPTS',N24:'N24_PARALLEL_HANDOFF'}[SCEN];
const OUT=path.resolve('test-results/g6-negative-n23-n24');
const URL_COLLECT=BASE+'/api/scans/collect';
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// Seuil du verrouillage agent (services/pickup-agent-lockout.js) : 5 échecs en 15 min ; on tente au-delà.
const WRONG_BEFORE_LOCK=5,BEYOND_LOCK=2;
let OBS=null;
const report={schema:'komerce-g6-negative-n23-n24/1',scenario_id:SCEN,market:MK.code,reference:REF,order_id:ID,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],attempts:[],events:[],page_events:[],
 external_supplier_calls:0,external_payment_executed:false,plaintext_pickup_code_logged:false,production_permitted:false};
const norm=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const check=(v,e)=>{if(!v)throw Error(e)};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const reach=k=>{report.steps_reached.push(k);save()};
function wrongCode(real){
 for(;;){let c='';for(let i=0;i<8;i++)c+=ALPHABET[crypto.randomInt(ALPHABET.length)];if(c!==real)return c}
}
// Garde de route : le corps normalisé doit être exactement {pickup_code:<saisi>} et n'est émis qu'une fois par attente.
function guardCollect(page,wait,blocked){
 return page.route(URL_COLLECT,route=>{
  const req=route.request();let body;try{body=req.postDataJSON()}catch(_){}
  if(req.method()==='POST'&&wait.expect&&!wait.used&&Object.keys(body||{}).length===1&&norm(body.pickup_code)===wait.expect){
   wait.used=true;return route.continue();
  }
  blocked.push({method:req.method(),path:'/api/scans/collect'});return route.abort('blockedbyclient');
 });
}
function pageEvents(page,tag){
 page.on('pageerror',e=>report.page_events.push({tag,kind:'pageerror',msg:String(e.message).slice(0,160)}));
 page.on('close',()=>report.page_events.push({tag,kind:'close'}));
}
// Comptoir réellement visible : le comptoir Remises est reconstruit après chaque réponse (cycle de rendu).
const counter=page=>page.locator('[data-manual-pickup-code]').first();
async function openCounter(page){
 return openRelayLive(page,{selector:'[data-manual-pickup-code]',timeout:30000,entry:'remises'});
}
async function bindAgent(browser,relaisId){
 const actor=await login(browser,'E2E_AGENT_RELAIS_','agent_relais');
 const me=await (await actor.page.request.get('/api/auth/me')).json();
 let {rows:[staff]}=await db.query('SELECT role::text AS role,relais_id FROM users WHERE id=$1',[me.id]);
 check(staff?.role==='agent_relais','G6_'+SCEN+'_RELAY_ACTOR_ROLE_INVALID');
 if(staff.relais_id!==relaisId){
  await attachDedicatedRelayByUI(browser,me.id,relaisId);
  ({rows:[staff]}=await db.query('SELECT role::text AS role,relais_id FROM users WHERE id=$1',[me.id]));
 }
 check(staff.relais_id===relaisId,'G6_'+SCEN+'_RELAY_ACTOR_MISMATCH');
 actor.page.on('dialog',d=>d.type()==='confirm'?d.accept():d.dismiss());
 pageEvents(actor.page,'agent');
 return {actor,agentId:me.id};
}
// Une tentative à l'écran : saisie réelle puis clic sur « Vérifier et remettre ». wait.expect = code attendu à l'émission (null = aucune requête permise).
async function attempt(page,wait,kind,typed,{expectRequest}){
 wait.expect=expectRequest?norm(typed):null;wait.used=false;
 const row={kind,request_expected:expectRequest,http:null,request_sent:false,message:null,message_visible:false,ui_blocked:false};
 const box=counter(page);
 if(!(await box.count())){row.ui_blocked=true;row.counter_absent=true;report.attempts.push(row);save();return row}
 const before=await page.locator('body').innerText().catch(()=>'');
 await humanFill(null,box.locator('[data-pickup-code-input]'),typed);
 const button=box.locator('[data-pickup-code-confirm]');
 // Bouton masqué ou remplacé : on n'agit que sur l'élément réellement visible et actif.
 if(!(await button.isVisible().catch(()=>false))||!(await button.isEnabled().catch(()=>false))){
  row.ui_blocked=true;report.attempts.push(row);save();return row;
 }
 const pending=expectRequest?page.waitForResponse(r=>r.url()===URL_COLLECT&&r.request().method()==='POST',{timeout:25000}).catch(()=>null):null;
 await humanClick(null,button);
 if(pending){
  const res=await pending;
  if(res){
   row.request_sent=true;row.http=res.status();
   const body=await res.json().catch(()=>null);
   row.message=String(body?.error||body?.message||'').slice(0,160)||null;
   // Message visible : à l'écran, hors saisie ; un refus muet reste un PASS (signal d'ergonomie).
   await page.waitForTimeout(600);
   row.message_visible=!!row.message&&(await page.locator('body').innerText().catch(()=>'')).includes(row.message);
  }
 }else{
  await page.waitForTimeout(800);
  const after=await page.locator('body').innerText().catch(()=>'');
  row.screen_message=/Code complet de 8 caract/.test(after);row.message_visible=row.screen_message;row.screen_changed=after!==before;
 }
 report.attempts.push(row);save();return row;
}
async function runN23(browser,c,relaisId){
 const {actor,agentId}=await bindAgent(browser,relaisId);
 report.agent_id=agentId;
 try{
  const wait={expect:null,used:false};
  await guardCollect(actor.page,wait,actor.blocked);
  await openCounter(actor.page);reach('REMISES_COUNTER_OPEN');
  const real=c.code;
  await attempt(actor.page,wait,'NO_CODE','',{expectRequest:false});
  await attempt(actor.page,wait,'LAST4_ONLY',real.slice(-4),{expectRequest:false});reach('FORMAT_REFUSALS');
  for(let i=0;i<WRONG_BEFORE_LOCK;i++)await attempt(actor.page,wait,'WRONG_'+(i+1),wrongCode(real),{expectRequest:true});
  reach('WRONG_CODES_TRIED');
  for(let i=0;i<BEYOND_LOCK;i++)await attempt(actor.page,wait,'BRUTE_FORCE_'+(i+1),wrongCode(real),{expectRequest:true});
  reach('BEYOND_THRESHOLD_TRIED');
  const right=await attempt(actor.page,wait,'RIGHT_CODE_WHILE_LOCKED',real,{expectRequest:true});reach('RIGHT_CODE_TRIED');
  c.code=null;
  const sent=report.attempts.filter(a=>a.request_sent);
  check(!sent.some(a=>a.http===200),'G6_N23_PRODUCT_GAP_ACCEPTED_'+sent.find(a=>a.http===200).kind);
  check(right.http===429||right.ui_blocked,'G6_N23_PRODUCT_GAP_RIGHT_CODE_NOT_LOCKED_'+right.http);
  report.lock_http_429=sent.filter(a=>a.http===429).length;
  report.silent_refusals=report.attempts.filter(a=>(a.request_sent||a.ui_blocked)&&!a.message_visible).map(a=>a.kind);
  report.ux_signal=report.silent_refusals.length?'REFUS_SANS_MESSAGE_VISIBLE':null;
  report.legit_handoff_after_lock='NOT_PLAYED_RULE_LOCKS_AGENT_15_MIN_ORDER_LEFT_AVAILABLE_FOR_CLEANUP';
  check(actor.blocked.length===0,'G6_N23_UNEXPECTED_RELAY_WRITE_'+JSON.stringify(actor.blocked));
 }finally{await actor.ctx.close()}
}
async function runN24(browser,c,relaisId){
 const {actor,agentId}=await bindAgent(browser,relaisId);
 report.agent_id=agentId;
 try{
  const second=await actor.ctx.newPage();pageEvents(second,'tab2');
  second.on('dialog',d=>d.type()==='confirm'?d.accept():d.dismiss());
  const w1={expect:norm(c.code),used:false},w2={expect:norm(c.code),used:false},blocked2=[];
  await guardCollect(actor.page,w1,actor.blocked);await guardCollect(second,w2,blocked2);
  await openCounter(actor.page);await openCounter(second);reach('TWO_TABS_ON_REMISES');
  await humanFill(null,counter(actor.page).locator('[data-pickup-code-input]'),c.code);
  await humanFill(null,counter(second).locator('[data-pickup-code-input]'),c.code);
  c.code=null;reach('BOTH_CODES_TYPED');
  const b1=counter(actor.page).locator('[data-pickup-code-confirm]'),b2=counter(second).locator('[data-pickup-code-confirm]');
  check(await b1.isEnabled()&&await b2.isEnabled(),'G6_N24_SCREEN_MISSING_CONFIRM_DISABLED');
  const r1=actor.page.waitForResponse(r=>r.url()===URL_COLLECT&&r.request().method()==='POST',{timeout:40000}).catch(()=>null);
  const r2=second.waitForResponse(r=>r.url()===URL_COLLECT&&r.request().method()==='POST',{timeout:40000}).catch(()=>null);
  // Les deux clics partent ensemble : deux onglets, une seule action humaine par onglet.
  await Promise.all([humanClick(null,b1),humanClick(null,b2)]);reach('BOTH_CLICKED');
  const [a,b]=await Promise.all([r1,r2]);
  report.tabs=[{http:a?a.status():null},{http:b?b.status():null}];
  const ok200=report.tabs.filter(t=>t.http===200).length;
  check(report.tabs.every(t=>t.http!==null),'G6_N24_SCREEN_MISSING_NO_RESPONSE');
  check(ok200===1&&report.tabs.every(t=>t.http===200||t.http>=400),'G6_N24_PRODUCT_GAP_HTTP_'+report.tabs.map(t=>t.http).join('_'));
  check(actor.blocked.length===0&&blocked2.length===0,'G6_N24_UNEXPECTED_RELAY_WRITE');
 }finally{await actor.ctx.close()}
}
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
  const buyer={id:o.user_id,email:o.email,phone:o.phone,role:o.role};
  check(await verifyMarkedG6Buyer(db,buyer,env),'G6_'+SCEN+'_EXISTING_MARKED_BUYER_REQUIRED');
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  // Code de retrait : régénéré par l'écran client (jamais lu en base, jamais journalisé).
  const c=await customer(browser,buyer);clientContext=c.ctx;reach('CLIENT_CODE_FROM_CLIENT_SCREEN');
  if(SCEN==='N23')await runN23(browser,c,o.relais_id);else await runN24(browser,c,o.relais_id);
  await runtime();
  report.verdict='G6_'+SCEN+'_'+(SCEN==='N23'?'WITHDRAWAL_ATTEMPTS_REFUSED':'PARALLEL_HANDOFF_SINGLE')+'_CHROMIUM_PASS';save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(clientContext)await clientContext.close().catch(()=>{});if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
