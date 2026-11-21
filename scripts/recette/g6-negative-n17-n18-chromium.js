/** @komerce-arch-lite
 * @role g6-negative-n17-n18-chromium
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose N17 (transitaire hors rôle ou hors marché : 403, aucune transition) et N18 (douane retenue puis mainlevée : aucun transit avant autorisation), staging only : gestes par l'écran Expéditions et douane, sondes API signalées, aucune écriture SQL.
 * @db-read orders, international_shipments, international_shipment_events, international_shipment_charges, customs_shipments, customs_shipment_holds, markets
 * @db-write none
 * @impact-areas staging-only, logistics, customs
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
const {isDeepStrictEqual}=require('node:util');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {runtime}=require('./g6-hub-shipment-chromium');
const {login,task,fillTask}=require('./g6-canonical-forwarder-chromium');
const {snapJourney,shipmentForOrder}=require('./canonical/negative-scenarios');
const {observe,fullError}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill}=require('./canonical/actors/human-gestures');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const SCEN=env.G6_CANONICAL_SCENARIO,ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const PHASES={N17:'N17_FORWARDER_ROLE_MARKET_ATTEMPTS',N18:'N18_CUSTOMS_HOLD_ATTEMPTS'};
const API='/api/admin/workspaces/shipping-customs/market/'+MK.code;
const CUSTOMS='SIM-STAGING-DOU-'+SCEN+'-'+REF;
const OUT=path.resolve('test-results/g6-negative-n17-n18');
let OBS=null;
const report={schema:'komerce-g6-negative-n17-n18/1',scenario_id:SCEN,market:MK.code,reference:REF,order_id:ID,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],screen:[],probes:[],attempts:[],gaps:[],ux_signal:null,page_events:[],
 external_supplier_calls:0,external_payment_executed:false,production_permitted:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const reach=k=>{report.steps_reached.push(k);save()};
const check=(ok,code)=>{if(!ok)throw Error(code)};
const is2xx=h=>h>=200&&h<300;
const proof=k=>'[SIMULATED / STAGING ONLY] G6-'+SCEN+'-'+k+'-'+REF;
const pageEvents=(page,tag)=>{
 page.on('pageerror',e=>report.page_events.push({tag,kind:'pageerror',msg:String(e.message).slice(0,160)}));
 page.on('close',()=>report.page_events.push({tag,kind:'close'}));
};
// Un geste d'écran = une requête POST permise (charge utile vérifiée), jamais de nouvel essai. Bouton absent ou inactif : refus d'écran, rien d'envoyé.
// Un écran qui n'envoie rien dans les 6 s compte comme un refus d'écran ; le verdict vient du serveur quand une requête part.
async function act(actor,endpoint,button,validate){
 let permitted=0;const guard=[];
 const url=BASE+endpoint;
 const handler=async route=>{
  const req=route.request();
  if(req.method()!=='POST')return route.fallback();
  let b;try{b=req.postDataJSON()}catch(_){b=null}
  if(permitted===0&&validate(b)){permitted++;return route.continue()}
  actor.blocked.push({method:req.method(),path:new URL(req.url()).pathname});
  guard.push({path:new URL(req.url()).pathname,body_keys:b&&typeof b==='object'?Object.keys(b).slice(0,12):null});
  return route.abort('blockedbyclient');
 };
 await actor.page.route(url,handler);
 try{
  if(!await button.count())return {present:false,enabled:false,http:null};
  if(!await button.first().isEnabled())return {present:true,enabled:false,http:null};
  let settle;const done=new Promise(r=>{settle=r});
  const onResp=r=>{if(r.url()===url&&r.request().method()==='POST')settle({res:r})};
  const onFail=q=>{if(q.url()===url&&q.method()==='POST')settle({failed:true})};
  actor.page.on('response',onResp);actor.page.on('requestfailed',onFail);
  try{
   await humanClick(null,button.first(),{timeout:15000});
   const quiet=new Promise(r=>setTimeout(()=>r({quiet:true}),6000));
   const out=await Promise.race([done,quiet]);
   if(out.res){const j=await out.res.json().catch(()=>({}));return {present:true,enabled:true,http:out.res.status(),code:j.code||j.error?.code||null};}
   if(out.failed||guard.length)return {present:true,enabled:true,http:null,code:null,guard_blocked:guard.slice(0,3)};
   return {present:true,enabled:true,http:null,code:null,no_request:true};
  }finally{actor.page.off('response',onResp);actor.page.off('requestfailed',onFail)}
 }finally{await actor.page.unroute(url,handler)}
}
async function probe(page,kind,endpoint,data){
 const res=await page.request.post(BASE+endpoint,{headers:{origin:BASE},data}).catch(()=>null);
 const j=res?await res.json().catch(()=>({})):{};
 const code=j.code||j.error?.code||null;
 const row={kind,via:'API_PROBE_NO_SCREEN_GESTURE',http:res?res.status():null,code:code&&String(code).slice(0,80)};
 report.probes.push(row);save();
 check(!/^csrf_/.test(row.code||''),'G6_'+SCEN+'_SCREEN_MISSING_PROBE_'+row.code);
 check(row.http!==null,'G6_'+SCEN+'_SCREEN_MISSING_NO_RESPONSE_'+kind);
 return row;
}
const SHIP=sh=>API+'/international/'+sh.reference;
async function otherMarket(){
 const {rows}=await db.query("SELECT code FROM markets WHERE is_active=TRUE AND lifecycle_status='ACTIVE' AND code<>$1 ORDER BY code LIMIT 1",[MK.code]);
 check(rows.length===1,'PREREQ_MISSING_OTHER_ACTIVE_MARKET_'+MK.code);
 return rows[0].code;
}
// Titres de tâches proposés à l'acteur sur l'expédition (lecture d'écran, aucun clic d'action) : sert au signal d'ergonomie.
async function offeredTasks(actor,sh){
 try{
  await humanGoto(actor.page,'/admin/workspaces/shipping-customs?market='+MK.code+'',{waitUntil:'domcontentloaded'});
  await actor.page.locator('[data-international-journey]').first().waitFor({state:'visible',timeout:20000});
  const row=actor.page.locator('tr').filter({has:actor.page.getByText(sh.reference,{exact:true})});
  await row.waitFor({state:'visible',timeout:15000});
  const open=row.getByRole('button',{name:'Consulter',exact:true});
  if(await open.count())await humanClick(null,open);
  await actor.page.waitForTimeout(800);
  return await actor.page.locator('details.kmc-journey-task summary').allInnerTexts();
 }catch(e){return {unreadable:String(e.message).slice(0,120)}}
}
async function runN17(browser,sh){
 const base=await snapJourney(db,sh.reference);
 check(base.stage==='handed_over','G6_N17_PRECONDITION_STAGE_'+base.stage);
 report.baseline=base;save();
 const other=await otherMarket();report.other_market=other;
 const T=SHIP(sh)+'/transition';
 const mk=async(prefix,role)=>{const a=await login(browser,prefix,role);pageEvents(a.page,role);return a};
 const forwarder=await mk('E2E_AGENT_TRANSITAIRE_','agent_transitaire');
 try{
  reach('FORWARDER_LOGGED_IN');
  const tasks=await offeredTasks(forwarder,sh);
  report.screen.push({role:'agent_transitaire',tasks_offered:tasks});
  if(Array.isArray(tasks)&&tasks.some(t=>/Mainlevée|Lier le dossier douane|Constater les droits/i.test(t)))report.ux_signal='TACHE_RESERVEE_ADMIN_OFFERTE_AU_TRANSITAIRE';
  // Gestes réservés à l'admin ou à un autre rôle (aucun écran transitaire ne les porte) : refus 403 attendu.
  const forb=[
   ['forwarder_customs_released',T,{to_stage:'customs_released',proof_ref:proof('MAINLEVEE-HORS-ROLE')}],
   ['forwarder_link_customs',SHIP(sh)+'/link-customs',{customs_reference:CUSTOMS,proof_ref:proof('LIEN-HORS-ROLE')}],
   ['forwarder_customs_amount',SHIP(sh)+'/customs-amount',{amount_kmf:'0',proof_ref:proof('DROITS-HORS-ROLE')}],
   ['forwarder_cost',SHIP(sh)+'/costs',{fee_type:'other',amount_kmf:'1',proof_ref:proof('FRAIS-HORS-ROLE')}],
   ['forwarder_release_hold',API+'/customs/shipments/'+CUSTOMS+'/release',{}]
  ];
  for(const [k,url,data] of forb){const r=await probe(forwarder.page,k,url,data);if(r.http!==403)report.gaps.push('ROLE_'+k.toUpperCase()+'_HTTP_'+r.http)}
  reach('FORWARDER_OUT_OF_ROLE_TRIED');
  // Hors marché : le marché de la route n'est pas celui de l'expédition ; 403 ou 404, jamais une transition.
  const m=await probe(forwarder.page,'forwarder_other_market','/api/admin/workspaces/shipping-customs/market/'+other+'/international/'+sh.reference+'/transition',
   {to_stage:'forwarder_received',proof_ref:proof('HORS-MARCHE')});
  if(is2xx(m.http))report.gaps.push('OTHER_MARKET_TRANSITION_ACCEPTED');
  else if(![403,404].includes(m.http))report.gaps.push('OTHER_MARKET_HTTP_'+m.http);
  else if(m.http===404)report.market_scope_note='HORS_MARCHE_404_EXPEDITION_INTROUVABLE_PAS_403';
  reach('FORWARDER_OTHER_MARKET_TRIED');
 }finally{await forwarder.ctx.close()}
 for(const [prefix,role,kind] of [['E2E_AGENT_HUB_','agent_hub','hub_forwarder_stage'],['E2E_AGENT_RELAIS_','agent_relais','relay_forwarder_stage']]){
  const a=await mk(prefix,role);
  try{
   const r=await probe(a.page,kind,T,{to_stage:'forwarder_received',proof_ref:proof('AUTRE-ROLE-'+role)});
   if(r.http!==403)report.gaps.push('ROLE_'+kind.toUpperCase()+'_HTTP_'+r.http);
   if(role==='agent_hub'){
    const t=await probe(a.page,'hub_tracking',SHIP(sh)+'/tracking',{tracking_reference:'SIM-N17-'+REF,proof_ref:proof('SUIVI-HUB')});
    if(t.http!==403)report.gaps.push('ROLE_HUB_TRACKING_HTTP_'+t.http);
   }
  }finally{await a.ctx.close()}
 }
 reach('OTHER_ROLES_TRIED');
 const after=await snapJourney(db,sh.reference);
 report.after=after;
 if(!isDeepStrictEqual(after,base))report.gaps.push('JOURNEY_CHANGED_AFTER_REFUSED_ATTEMPTS');
}
const date=()=>new Date().toISOString().slice(0,10);
// Un geste d'une tâche de l'expédition (<details>) joué par l'écran ; refus d'écran silencieux ou tâche absente = refus.
async function journeyGesture(actor,key,title,tab,tail,fields,expected){
 const row={key,title,http:null,code:null};
 let item;
 try{
  item=await task(actor.page,title,tab);
  for(const [n,v] of Object.entries(fields))await fillTask(item,n,v);
 }catch(e){row.screen_refusal='TACHE_ABSENTE_OU_INACCESSIBLE';row.detail=String(e.message).slice(0,140);report.attempts.push(row);save();return row}
 const out=await act(actor,SHIP_PATH+'/'+tail,item.locator('button[type="submit"]'),b=>isDeepStrictEqual(b,expected));
 Object.assign(row,out);
 if(out.http===null)row.screen_refusal=out.present?(out.enabled?'AUCUNE_REQUETE_ENVOYEE':'BOUTON_INACTIF'):'BOUTON_ABSENT';
 report.attempts.push(row);save();
 return row;
}
let SHIP_PATH='';
async function customsRow(actor){
 await humanGoto(actor.page,'/admin/workspaces/shipping-customs?market='+MK.code+'',{waitUntil:'domcontentloaded'});
 await actor.page.locator('[data-international-journey]').first().waitFor({state:'visible',timeout:25000});
 const tab=actor.page.locator('.kmc-journey-tab').filter({hasText:'Arrivée & douane'});
 if(!await tab.evaluate(e=>e.classList.contains('is-active')))await humanClick(null,tab);
 const row=actor.page.locator('tr[data-shipment-ref="'+CUSTOMS+'"]');
 await row.waitFor({state:'visible',timeout:25000});
 return row;
}
async function runN18(browser,sh){
 const base=await snapJourney(db,sh.reference);
 check(base.stage==='arrived'&&!base.customs_shipment_id,'G6_N18_PRECONDITION_STAGE_'+base.stage);
 SHIP_PATH=SHIP(sh);
 const admin=await login(browser,'E2E_ADMIN_','admin');pageEvents(admin.page,'admin');
 try{
  const answers=[CUSTOMS,date(),'1000',''];
  admin.page.on('dialog',async d=>{
   if(d.type()==='prompt'&&answers.length)return d.accept(answers.shift());
   if(d.type()==='confirm'&&d.message().includes(CUSTOMS)&&answers.length===0)return d.accept();
   return d.dismiss();
  });
  // 1. Dossier douane créé puis lié à l'expédition arrivée, par l'écran admin (même geste que la chaîne M01).
  await humanGoto(admin.page,'/admin/workspaces/shipping-customs?market='+MK.code+'',{waitUntil:'domcontentloaded'});
  await admin.page.locator('[data-international-journey]').first().waitFor({state:'visible',timeout:25000});
  await humanClick(null,admin.page.locator('.kmc-journey-tab').filter({hasText:'Arrivée & douane'}));
  const created=await act(admin,API+'/customs/shipments',admin.page.locator('[data-workspace-action="create-customs"]'),
   b=>isDeepStrictEqual(b,{reference:CUSTOMS,shipment_date:date(),cif_value_kmf:1000,parcel_refs:[]}));
  report.screen.push({step:'create_customs',...created});
  check(created.http!==null&&is2xx(created.http),'G6_N18_SCREEN_MISSING_CREATE_CUSTOMS_'+(created.http??'NO_REQUEST'));
  reach('CUSTOMS_CREATED');
  const link=await journeyGesture(admin,'link','Lier le dossier douane','Arrivée & douane','link-customs',
   {customs_reference:CUSTOMS,proof_ref:proof('LIEN-DOUANE')},{customs_reference:CUSTOMS,proof_ref:proof('LIEN-DOUANE')});
  check(link.http!==null&&is2xx(link.http),'G6_N18_SCREEN_MISSING_LINK_CUSTOMS_'+(link.http??'NO_REQUEST'));
  reach('CUSTOMS_LINKED');
  // 2. Retenue en douane avec motif, par l'écran Douane.
  const reason=proof('RETENUE');
  let row=await customsRow(admin);
  const holdBtn=row.locator('[data-workspace-action="hold-customs"]');
  check(await holdBtn.count(),'G6_N18_SCREEN_MISSING_HOLD_BUTTON');
  await humanClick(null,holdBtn.first());
  const form=admin.page.locator('[data-customs-hold-form="'+CUSTOMS+'"]');
  await form.waitFor({state:'visible',timeout:15000});
  await humanFill(null,form.locator('[data-customs-hold-reason]'),reason);
  const held=await act(admin,API+'/customs/shipments/'+CUSTOMS+'/hold',form.locator('[data-workspace-action="confirm-hold-customs"]'),b=>isDeepStrictEqual(b,{reason}));
  report.screen.push({step:'hold',...held});
  check(held.http!==null&&is2xx(held.http),'G6_N18_SCREEN_MISSING_HOLD_'+(held.http??'NO_REQUEST'));
  reach('CUSTOMS_HELD');
  const {rows:h1}=await db.query("SELECT h.status,h.held_by_role FROM customs_shipment_holds h JOIN customs_shipments c ON c.id=h.shipment_id WHERE c.reference=$1",[CUSTOMS]);
  check(h1.length===1&&h1[0].status==='held','G6_N18_PRODUCT_GAP_HOLD_NOT_RECORDED');
  const heldSnap=await snapJourney(db,sh.reference);
  // 3. Tentatives sous retenue : droits puis mainlevée d'étape ; aucune ne doit passer.
  await journeyGesture(admin,'amount_while_held','Constater les droits et taxes','Arrivée & douane','customs-amount',
   {amount_kmf:'0',proof_ref:proof('DROITS-RETENUS')},{amount_kmf:'0',proof_ref:proof('DROITS-RETENUS')});
  await journeyGesture(admin,'released_stage_while_held','Confirmer : Mainlevée confirmée','Arrivée & douane','transition',
   {proof_ref:proof('MAINLEVEE-RETENUE')},{proof_ref:proof('MAINLEVEE-RETENUE'),to_stage:'customs_released'});
  reach('TRANSIT_ATTEMPTS_WHILE_HELD');
  for(const a of report.attempts){
   if(a.http!==null&&is2xx(a.http))report.gaps.push('ACCEPTED_WHILE_HELD_'+a.key.toUpperCase());
   else if(a.http!==null&&a.http!==409)report.gaps.push('HELD_HTTP_'+a.key.toUpperCase()+'_'+a.http);
  }
  if(report.attempts.some(a=>a.screen_refusal&&a.screen_refusal!=='TACHE_ABSENTE_OU_INACCESSIBLE'))report.ux_signal='REFUS_MUET_SOUS_RETENUE_SANS_MOTIF_AFFICHE';
  const afterHeld=await snapJourney(db,sh.reference);
  report.held_snapshot=heldSnap;report.after_held=afterHeld;
  if(!isDeepStrictEqual(heldSnap,afterHeld))report.gaps.push('JOURNEY_CHANGED_WHILE_HELD');
  if(report.gaps.length)return;
  // 4. Mainlevée par l'écran (confirmation acceptée), puis étapes autorisées.
  row=await customsRow(admin);
  const rel=await act(admin,API+'/customs/shipments/'+CUSTOMS+'/release',row.locator('[data-workspace-action="release-customs"]'),b=>isDeepStrictEqual(b,{}));
  report.screen.push({step:'release',...rel});
  check(rel.http!==null&&is2xx(rel.http),'G6_N18_SCREEN_MISSING_RELEASE_'+(rel.http??'NO_REQUEST'));
  reach('CUSTOMS_RELEASED_HOLD');
  const amount=await journeyGesture(admin,'amount_after_release','Constater les droits et taxes','Arrivée & douane','customs-amount',
   {amount_kmf:'0',proof_ref:proof('DROITS')},{amount_kmf:'0',proof_ref:proof('DROITS')});
  const stage=await journeyGesture(admin,'stage_after_release','Confirmer : Mainlevée confirmée','Arrivée & douane','transition',
   {proof_ref:proof('MAINLEVEE')},{proof_ref:proof('MAINLEVEE'),to_stage:'customs_released'});
  for(const a of [amount,stage])if(!(a.http!==null&&is2xx(a.http)))report.gaps.push('AFTER_RELEASE_REFUSED_'+a.key.toUpperCase()+'_'+(a.http??a.screen_refusal));
  reach('STEPS_AFTER_RELEASE');
  report.after=await snapJourney(db,sh.reference);
 }finally{await admin.ctx.close()}
}
async function main(){
 let browser;
 try{
  save();
  check(['N17','N18'].includes(SCEN),'G6_N17_N18_SCENARIO_UNKNOWN');
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
   env.G6_CANONICAL_PHASE===PHASES[SCEN]&&env.G6_DYNAMIC_FRESH_ORDER==='1'&&
   env.G6_TARGET_MARKET===MK.code&&/^[a-f0-9-]{36}$/i.test(ID||''),'G6_'+SCEN+'_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_'+SCEN+'_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  const sh=await shipmentForOrder(db,ID);
  check(sh&&sh.reference&&sh.reference===env.G6_CANONICAL_SHIPMENT_REF,'G6_'+SCEN+'_SCREEN_MISSING_NO_SHIPMENT_FOR_ORDER');
  report.shipment_ref=sh.reference;
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  if(SCEN==='N17')await runN17(browser,sh);else await runN18(browser,sh);
  await runtime();
  if(report.gaps.length){report.verdict='PRODUCT_GAP';throw Error('G6_'+SCEN+'_PRODUCT_GAP_'+report.gaps.join('_'))}
  report.verdict=SCEN==='N17'?'G6_N17_FORWARDER_OUT_OF_ROLE_MARKET_REFUSED_CHROMIUM_PASS':'G6_N18_CUSTOMS_HOLD_NO_TRANSIT_THEN_RELEASE_CHROMIUM_PASS';save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
