#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-canonical-forwarder-chromium
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Continue exact M01 shipment by authenticated forwarder UI only, with fresh PG readback.
 * @impact-areas logistics, staging-only
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
const {isDeepStrictEqual}=require('node:util');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {readback,checkShipment,runtime,SC,sameSet}=require('./g6-hub-shipment-chromium');
const env=process.env, BASE='https://komerce-backend-production.up.railway.app';
const M06=env.G6_CANONICAL_SCENARIO==='M06';
const REF=env.G6_DYNAMIC_FRESH_ORDER==='1'?env.G6_CANONICAL_SHIPMENT_REF:'SIM-STAGING-EXP-KL1WGP6', ID=env.G6_DYNAMIC_FRESH_ORDER==='1'?env.G6_CANONICAL_SHIPMENT_ID:'ff8591fc-78bb-49a4-b154-247508368d16';
const BOX=env.G6_DYNAMIC_FRESH_ORDER==='1'?env.G6_CANONICAL_BOX_ID:'6ca614e5-869c-40ab-80d7-3684974092fe',
 PARCEL=env.G6_CANONICAL_PARCEL_ID, TRACK='SIM-STAGING-TRK-'+(env.G6_CANONICAL_ORDER_REFERENCE||'KL1WGP6'),
 CONTAINER='SIM-STAGING-CONT-'+(env.G6_CANONICAL_ORDER_REFERENCE||'KL1WGP6');
const OUT=path.resolve('test-results/g6-canonical-forwarder');
const {observe,fullError}=require("./canonical/observability");let OBS=null;
const {startTraceAfterAuth}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill,humanSelect,humanCheck,humanPress}=require('./canonical/actors/human-gestures');
const API='/api/admin/workspaces/shipping-customs/market/'+MK.code+'/international/'+REF;
const report={schema:'komerce-g6-forwarder/1',shipment_id:ID,shipment_ref:REF,order_id:env.G6_CANONICAL_ORDER_ID,
 reference:env.G6_CANONICAL_ORDER_REFERENCE||'KL1WGP6',scenario_id:M06?'M06':'M01',market:MK.code,role:'agent_transitaire',events:[],box_scans:[],verdict:'BLOCKED',
 provenance:'SIMULATED / STAGING ONLY',external_payment_executed:false,external_supplier_calls:0};
const check=(ok,code)=>{if(!ok)throw Error(code)};
function save(){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')}
function proof(key){return '[SIMULATED / STAGING ONLY] G6-'+(M06?'M06':'M01')+'-'+key+'-'+(env.G6_CANONICAL_ORDER_REFERENCE||'KL1WGP6')}
async function snapshot(stage,placement){
 const base=await readback();checkShipment(base,ID,stage);
 check(base.box[0].id===BOX&&base.box[0].state==='DISPATCHED'&&base.parcels[0].status==='shipped'&&
 sameSet(base.effective.map(e=>e.placement_id),placement)&&base.parcelItems.length===SC.items&&base.parcelItems.reduce((n,i)=>n+Number(i.qty_shipped),0)===SC.units&&
 base.parcelEvents.length===1,'G6_FORWARDER_PHYSICAL_DRIFT');
 const {rows}=await db.query('SELECT tracking_reference,container_reference,bill_of_lading_ref,departed_at,arrived_at FROM international_shipments WHERE id=$1',[ID]);
 check(rows.length===1,'G6_FORWARDER_SHIPMENT_NOT_UNIQUE');
 return {base,tracking:rows[0]};
}
async function login(browser,prefix='E2E_AGENT_TRANSITAIRE_',role='agent_transitaire'){
 const email=env[prefix+'EMAIL'],password=env[prefix+'PASSWORD'];
 check(email&&password,'G6_FORWARDER_CREDENTIALS_MISSING');
 const ctx=await browser.newContext({baseURL:BASE,viewport:{width:1440,height:900}});
 const page=await ctx.newPage(),blocked=[];
 let authAllowed=true;
 await page.route('**/*',route=>{
  const r=route.request(),u=new URL(r.url());
  if(['GET','HEAD','OPTIONS'].includes(r.method()))return route.continue();
  if(authAllowed&&r.method()==='POST'&&u.origin===BASE&&u.pathname==='/api/auth/login'){authAllowed=false;return route.continue()}
  blocked.push({method:r.method(),path:u.pathname});return route.abort('blockedbyclient');
 });
 await humanGoto(page,'/login.html?next='+encodeURIComponent('/admin/workspaces/shipping-customs?market='+MK.code+''));
 await humanFill(null,page.locator('#email'),email);await humanFill(null,page.locator('#password'),password);
 const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
 await humanClick(null,page.locator('#btn-submit'));
 check((await pending).status()===200,'G6_FORWARDER_LOGIN_FAILED');
 await page.waitForURL(u=>u.pathname!=='/login.html',{timeout:20000});
 const me=await page.request.get('/api/auth/me');
 const user=await me.json();check(me.ok()&&user.role===role,'G6_FORWARDER_ROLE_INVALID');
 await startTraceAfterAuth(ctx);
 return {ctx,page,blocked};
}
async function task(page,title,tabName='Transport & fret'){
 await humanGoto(page,'/admin/workspaces/shipping-customs?market='+MK.code+'',{waitUntil:'domcontentloaded'});
 await page.locator('[data-international-journey]').first().waitFor({state:'visible',timeout:25000});
 const tab=page.locator('.kmc-journey-tab').filter({hasText:tabName});
 if(!await tab.evaluate(e=>e.classList.contains('is-active')))await humanClick(null,tab);
 const row=page.locator('tr').filter({has:page.getByText(REF,{exact:true})});
 await row.waitFor({state:'visible',timeout:25000});
 const open=row.getByRole('button',{name:'Consulter',exact:true});
 if(await open.count())await humanClick(null,open);
 const item=page.locator('details.kmc-journey-task').filter({has:page.locator('summary').filter({hasText:title})});
 await item.waitFor({state:'visible',timeout:25000});
 // The workspace may repaint after switching transport/relay tabs and
 // reset a <details> disclosure to closed. Reopen via its real summary,
 // never force a hidden submit or mutate DOM state in Playwright.
 const submit=item.locator('button[type="submit"]');
 let visible=false;
 for(let attempt=0;attempt<4;attempt++){
  if(!await item.evaluate(e=>e.open))await humanClick(null,item.locator('summary'),{timeout:8000});
  try{
   await submit.waitFor({state:'visible',timeout:5000});
   if(await item.evaluate(e=>e.open)){visible=true;break}
  }catch(error){
   if(attempt===3)throw Error('G6_JOURNEY_SUBMIT_HIDDEN_AFTER_REAL_UI_DISCLOSURE: '+title);
  }
 }
 if(!visible)throw Error('G6_JOURNEY_DETAILS_NOT_OPEN: '+title);
 return item;
}
// Saisie dans une tâche <details> : un repaint asynchrone peut la refermer entre l'ouverture et la
// saisie. On la rouvre par son vrai résumé (geste humain) ; la saisie n'est pas une mutation serveur.
async function fillTask(item,name,val){
 for(let attempt=0;attempt<3;attempt++){
  if(!await item.evaluate(e=>e.open))await humanClick(null,item.locator('summary'),{timeout:8000});
  try{await humanFill(null,item.locator('[name="'+name+'"]'),val,{timeout:6000});return;}
  catch(error){if(attempt===2||!/not visible|Timeout/i.test(String(error&&error.message)))throw error;}
 }
}
async function gesture(actor,key,title,tail,fields,expected){
 await runtime();
 const item=await task(actor.page,title);
 for(const [name,value] of Object.entries(fields)){
  if(name==='container_sealed'){
   if(!await item.evaluate(e=>e.open))await humanClick(null,item.locator('summary'),{timeout:8000});
   await humanSelect(null,item.locator('[name="container_sealed"]'),value);
  }else await fillTask(item,name,value);
 }
 const url=BASE+API+'/'+tail;let count=0;
 const handler=async route=>{
  const req=route.request();
  if(req.method()!=='POST')return route.fallback();
  let body;try{body=req.postDataJSON()}catch(_){}
  if(count===0&&isDeepStrictEqual(body,expected)){count++;return route.continue()}
  actor.blocked.push({method:req.method(),path:new URL(req.url()).pathname});return route.abort('blockedbyclient');
 };
 await actor.page.route(url,handler);
 try{
  const pending=actor.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:30000});
  await humanClick(null,item.locator('button[type="submit"]'));
  const response=await pending;const payload=await response.json().catch(()=>null);
  report.events.push({key,http:response.status(),code:payload?.code||null});save();
  check(count===1&&response.ok()&&actor.blocked.length===0,'G6_FORWARDER_HTTP_'+key+'_'+response.status());
 }finally{await actor.page.unroute(url,handler)}
}
// A scan identifies and attests custody; it never transitions the shipment.
// New QR-tagged M06 shipments require two distinct carrier scan gestures.
async function custodyReadback(){
 const {rows}=await db.query(
  'SELECT c.id,c.box_unit_id,c.event_type,c.actor_id,c.proof_ref,l.short_alias,l.target_type '
  +'FROM hub_box_custody_scans c JOIN hub_scan_labels l ON l.id=c.label_id '
  +'WHERE c.shipment_id=$1 ORDER BY c.occurred_at,c.id',[ID]);
 return rows;
}
async function scanCarrierBox(actor,step,alias){
 check(M06&&['CARRIER_ACCEPTED','CARRIER_LOADED'].includes(step)&&/^[A-HJ-NP-Z2-9]{8}$/.test(alias),
  'G6_M06_CARRIER_SCAN_INPUT_INVALID');
 await runtime();
 const prior=await custodyReadback();
 const handover=prior.find(x=>x.event_type==='HUB_HANDOVER');
 const accepted=prior.find(x=>x.event_type==='CARRIER_ACCEPTED');
 check(handover&&handover.box_unit_id===BOX&&handover.target_type==='COMBOX'&&
  prior.every(x=>x.box_unit_id===BOX&&x.short_alias===alias)&&
  !prior.some(x=>x.event_type===step)&&
  (step==='CARRIER_ACCEPTED'?!accepted:!!accepted),
  'G6_M06_CARRIER_SCAN_PRIOR_INVALID_'+step);
 const title=step==='CARRIER_ACCEPTED'?'Transitaire · scanner et accepter chaque COMBOX':
  'Transitaire · rescanner chaque COMBOX chargée dans le conteneur';
 const item=await task(actor.page,title);
 const scanProof=proof(step);
 await fillTask(item,'qr_code',alias);
 await fillTask(item,'proof_ref',scanProof);
 if(!await item.evaluate(e=>e.open))await humanClick(null,item.locator('summary'),{timeout:8000});
 await humanSelect(null,item.locator('[name="confirmed"]'),'yes');
 const url=BASE+API+'/box-scan';let count=0;
 const expected={qr_code:alias,proof_ref:scanProof,confirmed:true,event_type:step};
 const handler=async route=>{
  const req=route.request();
  if(req.method()!=='POST')return route.fallback();
  let body;try{body=req.postDataJSON()}catch(_){}
  if(count===0&&isDeepStrictEqual(body,expected)){count++;return route.continue()}
  actor.blocked.push({method:req.method(),path:new URL(req.url()).pathname});
  return route.abort('blockedbyclient');
 };
 await actor.page.route(url,handler);
 try{
  const pending=actor.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:30000});
  await humanClick(null,item.locator('button[type="submit"]'));
  const response=await pending,payload=await response.json().catch(()=>({}));
  report.box_scans.push({step,http:response.status(),code:payload.code||null});save();
  check(count===1&&response.status()===201&&payload.ok===true&&
   payload.result?.event_type===step&&payload.result?.box_unit_id===BOX&&
   payload.result?.confirmed===true&&actor.blocked.length===0,
   'G6_M06_CARRIER_SCAN_HTTP_'+step+'_'+response.status()+'_'+(payload.code||''));
  const after=await custodyReadback(),latest=after.at(-1);
  check(after.length===prior.length+1&&isDeepStrictEqual(after.slice(0,-1),prior)&&
   latest.event_type===step&&latest.box_unit_id===BOX&&latest.short_alias===alias&&
   latest.proof_ref===scanProof&&latest.actor_id&&latest.actor_id!==handover.actor_id&&
   (step==='CARRIER_ACCEPTED'||latest.actor_id===accepted.actor_id),
   'G6_M06_CARRIER_SCAN_PG_INVALID_'+step);
  report.box_scans.at(-1).pg_confirmed=true;save();
  await actor.page.screenshot({path:path.join(OUT,'scan-'+step.toLowerCase()+'.png')});
 }finally{await actor.page.unroute(url,handler)}
}

async function main(){
 let browser,actor;
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&
   env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&
   env.STAGING_BASE_URL===BASE&&env.G6_CANONICAL_PHASE==='FORWARDER'&&(env.G6_CANONICAL_RESUME_RUN_ID==='44210239102'||env.G6_DYNAMIC_FRESH_ORDER==='1')&&
   ['M01','M03','M06'].includes(env.G6_CANONICAL_SCENARIO)&&env.G6_TARGET_MARKET===MK.code&&(env.G6_CANONICAL_ORDER_ID==='56adad65-d1fa-4e80-8d69-c25e0fe92a76'||(env.G6_DYNAMIC_FRESH_ORDER==='1'&&/^[a-f0-9-]{36}$/i.test(env.G6_CANONICAL_ORDER_ID||'')&&/^[a-f0-9-]{36}$/i.test(ID||''))),
   'G6_FORWARDER_OWNER_GUARD');
  const target=await confirmTarget({db,env});check(target.confirmed&&target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_FORWARDER_DB_DRIFT');
  report.db_fingerprint=target.fingerprint;report.sha=await runtime();
  let prior,placement,before;
  if(M06){
   prior=JSON.parse(fs.readFileSync('test-results/g6-m06-shipment-handover/report.json','utf8'));
   const current=await readback();placement=current.effective.map(e=>e.placement_id);
   before=await snapshot('handed_over',placement);
   check(prior.shipment_id===ID&&prior.parcel_id===PARCEL&&prior.box_id===BOX&&
    prior.after?.shipment_stage==='handed_over'&&prior.after?.parcel_status==='shipped'&&
    !before.tracking.tracking_reference&&!before.tracking.bill_of_lading_ref,'G6_FORWARDER_M06_PRIOR_DRIFT');
  }else{
   prior=JSON.parse(fs.readFileSync((env.G6_DYNAMIC_FRESH_ORDER==='1'?'test-results/g6-hub-shipment/report.json':'test-results/g6-canonical-resume/g6-hub-shipment/report.json'),'utf8'));
   placement=prior.after.effective.map(e=>e.placement_id);
   before=await snapshot('handed_over',placement);
   check(isDeepStrictEqual(before.base,prior.after)&&!before.tracking.tracking_reference&&!before.tracking.bill_of_lading_ref,'G6_FORWARDER_PRIOR_DRIFT');
  }
  report.before=before;save();
  let boxAlias=null;
  if(M06){
   const custody=await custodyReadback();
   check(custody.length===1&&custody[0].event_type==='HUB_HANDOVER'&&
    custody[0].box_unit_id===BOX&&custody[0].target_type==='COMBOX'&&
    /^[A-HJ-NP-Z2-9]{8}$/.test(custody[0].short_alias||'')&&custody[0].actor_id,
    'G6_M06_CARRIER_HUB_SCAN_MISSING');
   boxAlias=custody[0].short_alias;
  }
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);actor=await login(browser);
  const steps=[
   ['forwarder_received','Confirmer : Réceptionné par le transitaire','transition',{proof_ref:proof('RECEPTION-TRANSITAIRE')},{proof_ref:proof('RECEPTION-TRANSITAIRE'),to_stage:'forwarder_received'},'forwarder_received','stage_changed'],
   ['tracking','Suivi conteneur / connaissement et ETA','tracking',
     M06?{tracking_reference:TRACK,container_reference:CONTAINER,proof_ref:proof('SUIVI')}:{tracking_reference:TRACK,proof_ref:proof('SUIVI')},
     M06?{tracking_reference:TRACK,container_reference:CONTAINER,proof_ref:proof('SUIVI')}:{tracking_reference:TRACK,proof_ref:proof('SUIVI')},
     'forwarder_received','tracking_updated'],
   ['in_transit','Confirmer : Expédié / en transit','transition',
     M06?{proof_ref:proof('DEPART'),container_sealed:'yes'}:{proof_ref:proof('DEPART')},
     M06?{proof_ref:proof('DEPART'),container_sealed:true,to_stage:'in_transit'}:{proof_ref:proof('DEPART'),to_stage:'in_transit'},
     'in_transit','stage_changed'],
   ['arrived','Confirmer : Arrivé','transition',{proof_ref:proof('ARRIVEE')},{proof_ref:proof('ARRIVEE'),to_stage:'arrived'},'arrived','stage_changed']
  ];
  let last=before;
  for(const [key,title,tail,fields,expected,stage,type] of steps){
   if(M06&&key==='forwarder_received')await scanCarrierBox(actor,'CARRIER_ACCEPTED',boxAlias);
   if(M06&&key==='in_transit')await scanCarrierBox(actor,'CARRIER_LOADED',boxAlias);
   await gesture(actor,key,title,tail,fields,expected);
   const state=await snapshot(stage,placement),events=state.base.shipmentEvents;
   check(events.length===last.base.shipmentEvents.length+1&&isDeepStrictEqual(events.slice(0,-1),last.base.shipmentEvents)&&
     events.at(-1).event_type===type&&events.at(-1).proof_ref===fields.proof_ref&&!!events.at(-1).actor_id&&events.at(-1).to_stage===stage,
     'G6_FORWARDER_PG_EVENT_'+key);
   // Valeurs attendues = valeurs saisies (TRACK, proof_ref) : tracking absent avant la saisie, exact après.
   if(key==='forwarder_received')check(!state.tracking.tracking_reference,'G6_FORWARDER_TRACKING_BEFORE_ENTRY');
   if(key!=='forwarder_received')check(state.tracking.tracking_reference===TRACK,'G6_FORWARDER_TRACKING_MISSING');
   if(M06&&key!=='forwarder_received')check(state.tracking.container_reference===CONTAINER,'G6_M06_CONTAINER_REFERENCE_MISSING');
   if(key==='tracking'||key==='forwarder_received')check(!state.tracking.departed_at&&!state.tracking.arrived_at,'G6_FORWARDER_DATES_TOO_EARLY');
   if(key==='in_transit')check(!state.tracking.arrived_at,'G6_FORWARDER_ARRIVAL_TOO_EARLY');
   if(key==='in_transit'||key==='arrived')check(!!state.tracking.departed_at,'G6_FORWARDER_DEPARTURE_MISSING');
   if(key==='arrived')check(!!state.tracking.arrived_at,'G6_FORWARDER_ARRIVAL_MISSING');
   last=state;report.after=state;save();await runtime();
  }
  report.verdict='G6_FORWARDER_SIMULATED_CHROMIUM_PG_PASS_ARRIVED';report.next_stage='CUSTOMS';save();
 }catch(e){report.error=fullError(e);try{if(report.db_fingerprint)report.failure_readback=await readback()}catch(_){};save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close();await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={fillTask,login,task,snapshot,proof};
