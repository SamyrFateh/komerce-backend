/** @komerce-arch-lite
 * @role g6-negative-n39-cancel-chromium
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose N39 (staging only) : annulation par le client depuis « Mon Komerce » aux trois paliers : F1 avant achat (RELAY_CASH), F2 achat engagé (HUB_COMMITMENT), F3 embarqué (HUB_SHIPMENT). Le client clique « Annuler » ; la réponse du serveur est jugée, les effets sont relus par l'oracle PG. Aucune écriture SQL, aucun PSP.
 * @db-read orders, users
 * @db-write none
 * @impact-areas staging-only, orders, refunds
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
const {humanClick}=require('./canonical/actors/human-gestures');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const SCEN=env.G6_CANONICAL_SCENARIO,ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const PHASES={N39F1:'N39F1_CLIENT_CANCEL_ATTEMPT',N39F2:'N39F2_CLIENT_CANCEL_ATTEMPT',N39F3:'N39F3_CLIENT_CANCEL_ATTEMPT'};
const OUT=path.resolve('test-results/g6-negative-n39');
let OBS=null;
const report={schema:'komerce-g6-negative-n39/1',scenario_id:SCEN,market:MK.code,reference:REF,order_id:ID,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],cancel:null,gaps:[],ux_signal:null,page_events:[],
 external_supplier_calls:0,external_payment_executed:false,plaintext_pickup_code_logged:false,production_permitted:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const reach=k=>{report.steps_reached.push(k);save()};
const check=(ok,code)=>{if(!ok)throw Error(code)};
async function main(){
 let browser,clientContext;
 try{
  save();
  check(Object.hasOwn(PHASES,SCEN),'G6_N39_SCENARIO_UNKNOWN');
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
   env.G6_CANONICAL_PHASE===PHASES[SCEN]&&env.G6_DYNAMIC_FRESH_ORDER==='1'&&
   env.G6_TARGET_MARKET===MK.code&&/^[a-f0-9-]{36}$/i.test(ID||''),'G6_N39_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_N39_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  const {rows:[o]}=await db.query(`SELECT o.reference,o.status::text AS status,o.payment_status::text AS payment_status,o.user_id,u.phone,u.email,u.role::text AS role
   FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=$1`,[ID]);
  check(o&&o.reference===REF&&o.payment_status==='paid'&&!['cancelled','refunded','collected'].includes(o.status),'G6_N39_PRECONDITION_ORDER_PAID_OPEN');
  report.status_before=o.status;
  const buyer={id:o.user_id,email:o.email,phone:o.phone,role:o.role};
  check(await verifyMarkedG6Buyer(db,buyer,env),'G6_N39_EXISTING_MARKED_BUYER_REQUIRED');
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  // Le client s'identifie par OTP (même geste que la remise) et ouvre la commande dans « Mon Komerce » ; aucun code de retrait n'est attendu.
  const c=await customer(browser,buyer,{allowNoCode:true});clientContext=c.ctx;
  c.page.on('pageerror',e=>report.page_events.push({kind:'pageerror',msg:String(e.message).slice(0,160)}));
  c.page.on('dialog',d=>d.type()==='confirm'?d.accept():d.dismiss());
  reach('CLIENT_ORDER_OPEN');
  const url=BASE+'/api/orders/'+ID+'/cancel';
  let permitted=0;const blocked=[];
  await c.page.route(url,route=>{
   const req=route.request();let body;try{body=req.postDataJSON()}catch(_){body=null}
   if(req.method()==='POST'&&permitted===0&&(body==null||(typeof body==='object'&&!Object.keys(body).length))){permitted++;return route.continue()}
   blocked.push({method:req.method()});return route.abort('blockedbyclient');
  });
  const button=c.page.locator('.k-order-cancel-btn');
  const shown=await button.first().waitFor({state:'visible',timeout:15000}).then(()=>true,()=>false);
  report.cancel={button_visible:shown,http:null,message:null,message_visible:null,request_sent:false};
  if(!shown){
   // F1 : le geste attendu manque, verdict d'écran ; F2 et F3 : refus d'écran (bouton absent), signalé.
   if(SCEN==='N39F1')throw Error('G6_N39F1_SCREEN_MISSING_CANCEL_BUTTON');
   report.ux_signal='ANNULATION_NON_OFFERTE_SANS_MOTIF_AFFICHE';reach('CANCEL_NOT_OFFERED');
  }else{
   const pending=c.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:20000}).catch(()=>null);
   await humanClick(null,button.first());
   const res=await pending;
   if(res){
    const j=await res.json().catch(()=>({}));
    report.cancel.http=res.status();report.cancel.request_sent=true;
    report.cancel.message=String(j.message||j.error||'').slice(0,200)||null;
   }
   await c.page.waitForTimeout(1000);
   const shownText=await c.page.locator('.k-order-cancel-output').first().innerText().catch(()=>'');
   report.cancel.message_visible=!!shownText.trim();
   if(!report.cancel.message_visible)report.ux_signal='ANNULATION_SANS_MESSAGE_AFFICHE';
   reach('CANCEL_CLICKED');
   check(blocked.length===0,'G6_N39_UNEXPECTED_CLIENT_WRITE');
  }
  await runtime();
  report.verdict='G6_'+SCEN+'_CLIENT_CANCEL_ATTEMPTED_CHROMIUM_PASS';save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(clientContext)await clientContext.close().catch(()=>{});if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
