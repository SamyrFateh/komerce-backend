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
const fs=require('node:fs'),path=require('node:path');
const {isDeepStrictEqual}=require('node:util');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {readback,checkShipment,runtime}=require('./g6-hub-shipment-chromium');
const env=process.env, BASE='https://komerce-backend-production.up.railway.app';
const REF=env.G6_DYNAMIC_FRESH_ORDER==='1'?env.G6_CANONICAL_SHIPMENT_REF:'SIM-STAGING-EXP-KL1WGP6', ID=env.G6_DYNAMIC_FRESH_ORDER==='1'?env.G6_CANONICAL_SHIPMENT_ID:'ff8591fc-78bb-49a4-b154-247508368d16';
const BOX=env.G6_DYNAMIC_FRESH_ORDER==='1'?env.G6_CANONICAL_BOX_ID:'6ca614e5-869c-40ab-80d7-3684974092fe', TRACK='SIM-STAGING-TRK-'+(env.G6_CANONICAL_ORDER_REFERENCE||'KL1WGP6');
const OUT=path.resolve('test-results/g6-canonical-forwarder');
const API='/api/admin/workspaces/shipping-customs/market/KM/international/'+REF;
const report={schema:'komerce-g6-forwarder/1',shipment_id:ID,shipment_ref:REF,order_id:env.G6_CANONICAL_ORDER_ID,
 reference:env.G6_CANONICAL_ORDER_REFERENCE||'KL1WGP6',scenario_id:'M01',market:'KM',role:'agent_transitaire',events:[],verdict:'BLOCKED',
 provenance:'SIMULATED / STAGING ONLY',external_payment_executed:false,external_supplier_calls:0};
const check=(ok,code)=>{if(!ok)throw Error(code)};
function save(){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')}
function proof(key){return '[SIMULATED / STAGING ONLY] G6-M01-'+key+'-'+(env.G6_CANONICAL_ORDER_REFERENCE||'KL1WGP6')}
async function snapshot(stage,placement){
 const base=await readback();checkShipment(base,ID,stage);
 check(base.box[0].id===BOX&&base.box[0].state==='DISPATCHED'&&base.parcels[0].status==='shipped'&&
 base.effective[0].placement_id===placement&&base.parcelItems.length===1&&Number(base.parcelItems[0].qty_shipped)===1&&
 base.parcelEvents.length===1,'G6_FORWARDER_PHYSICAL_DRIFT');
 const {rows}=await db.query('SELECT tracking_reference,bill_of_lading_ref,departed_at,arrived_at FROM international_shipments WHERE id=$1',[ID]);
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
 await page.goto('/login.html?next='+encodeURIComponent('/admin/workspaces/shipping-customs?market=KM'));
 await page.locator('#email').fill(email);await page.locator('#password').fill(password);
 const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
 await page.locator('#btn-submit').click();
 check((await pending).status()===200,'G6_FORWARDER_LOGIN_FAILED');
 await page.waitForURL(u=>u.pathname!=='/login.html',{timeout:20000});
 const me=await page.request.get('/api/auth/me');
 const user=await me.json();check(me.ok()&&user.role===role,'G6_FORWARDER_ROLE_INVALID');
 return {ctx,page,blocked};
}
async function task(page,title,tabName='Transport & fret'){
 await page.goto('/admin/workspaces/shipping-customs?market=KM',{waitUntil:'domcontentloaded'});
 await page.locator('[data-international-journey]').first().waitFor({state:'visible',timeout:25000});
 const tab=page.locator('.kmc-journey-tab').filter({hasText:tabName});
 if(!await tab.evaluate(e=>e.classList.contains('is-active')))await tab.click();
 const row=page.locator('tr').filter({has:page.getByText(REF,{exact:true})});
 await row.waitFor({state:'visible',timeout:25000});
 const open=row.getByRole('button',{name:'Consulter',exact:true});
 if(await open.count())await open.click();
 const item=page.locator('details.kmc-journey-task').filter({has:page.locator('summary').filter({hasText:title})});
 await item.waitFor({state:'visible',timeout:25000});
 if(!await item.evaluate(e=>e.open))await item.locator('summary').click();
 await item.locator('button[type="submit"]').waitFor({state:'visible',timeout:20000});
 return item;
}
async function gesture(actor,key,title,tail,fields,expected){
 await runtime();
 const item=await task(actor.page,title);
 for(const [name,value] of Object.entries(fields))await item.locator('[name="'+name+'"]').fill(value);
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
  await item.locator('button[type="submit"]').click();
  const response=await pending;report.events.push({key,http:response.status()});save();
  check(count===1&&response.ok()&&actor.blocked.length===0,'G6_FORWARDER_HTTP_'+key+'_'+response.status());
 }finally{await actor.page.unroute(url,handler)}
}
async function main(){
 let browser,actor;
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&
   env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&
   env.STAGING_BASE_URL===BASE&&env.G6_CANONICAL_PHASE==='FORWARDER'&&(env.G6_CANONICAL_RESUME_RUN_ID==='44210239102'||env.G6_DYNAMIC_FRESH_ORDER==='1')&&
   env.G6_CANONICAL_SCENARIO==='M01'&&env.G6_TARGET_MARKET==='KM'&&(env.G6_CANONICAL_ORDER_ID==='56adad65-d1fa-4e80-8d69-c25e0fe92a76'||(env.G6_DYNAMIC_FRESH_ORDER==='1'&&/^[a-f0-9-]{36}$/i.test(env.G6_CANONICAL_ORDER_ID||'')&&/^[a-f0-9-]{36}$/i.test(ID||''))),
   'G6_FORWARDER_OWNER_GUARD');
  const target=await confirmTarget({db,env});check(target.confirmed&&target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_FORWARDER_DB_DRIFT');
  report.db_fingerprint=target.fingerprint;report.sha=await runtime();
  const prior=JSON.parse(fs.readFileSync((env.G6_DYNAMIC_FRESH_ORDER==='1'?'test-results/g6-hub-shipment/report.json':'test-results/g6-canonical-resume/g6-hub-shipment/report.json'),'utf8'));
  const placement=prior.after.effective[0].placement_id;
  const before=await snapshot('handed_over',placement);report.before=before;save();
  check(isDeepStrictEqual(before.base,prior.after)&&!before.tracking.tracking_reference&&!before.tracking.bill_of_lading_ref,'G6_FORWARDER_PRIOR_DRIFT');
  browser=await chromium.launch({headless:true});actor=await login(browser);
  const steps=[
   ['forwarder_received','Confirmer : Réceptionné par le transitaire','transition',{proof_ref:proof('RECEPTION-TRANSITAIRE')},{proof_ref:proof('RECEPTION-TRANSITAIRE'),to_stage:'forwarder_received'},'forwarder_received','stage_changed'],
   ['tracking','Suivi conteneur','tracking',{tracking_reference:TRACK,proof_ref:proof('SUIVI')},{tracking_reference:TRACK,proof_ref:proof('SUIVI')},'forwarder_received','tracking_updated'],
   ['in_transit','Confirmer : Expédié / en transit','transition',{proof_ref:proof('DEPART')},{proof_ref:proof('DEPART'),to_stage:'in_transit'},'in_transit','stage_changed'],
   ['arrived','Confirmer : Arrivé','transition',{proof_ref:proof('ARRIVEE')},{proof_ref:proof('ARRIVEE'),to_stage:'arrived'},'arrived','stage_changed']
  ];
  let last=before;
  for(const [key,title,tail,fields,expected,stage,type] of steps){
   await gesture(actor,key,title,tail,fields,expected);
   const state=await snapshot(stage,placement),events=state.base.shipmentEvents;
   check(events.length===last.base.shipmentEvents.length+1&&isDeepStrictEqual(events.slice(0,-1),last.base.shipmentEvents)&&
     events.at(-1).event_type===type&&events.at(-1).proof_ref===fields.proof_ref&&!!events.at(-1).actor_id&&events.at(-1).to_stage===stage,
     'G6_FORWARDER_PG_EVENT_'+key);
   if(key!=='forwarder_received')check(state.tracking.tracking_reference===TRACK,'G6_FORWARDER_TRACKING_MISSING');
   if(key==='in_transit'||key==='arrived')check(!!state.tracking.departed_at,'G6_FORWARDER_DEPARTURE_MISSING');
   if(key==='arrived')check(!!state.tracking.arrived_at,'G6_FORWARDER_ARRIVAL_MISSING');
   last=state;report.after=state;save();await runtime();
  }
  report.verdict='G6_FORWARDER_SIMULATED_CHROMIUM_PG_PASS_ARRIVED';report.next_stage='CUSTOMS';save();
 }catch(e){report.error=String(e.message||e).slice(0,700);try{if(report.db_fingerprint)report.failure_readback=await readback()}catch(_){};save();process.exitCode=2}
 finally{if(browser)await browser.close();await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={login,task,snapshot,proof};
