#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-canonical-customs-and-local-transport-chromium
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Continue the exact arrived M01 shipment through customs and local transport, UI only.
 * @impact-areas logistics, staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {isDeepStrictEqual}=require('node:util');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {readback,runtime}=require('./g6-hub-shipment-chromium');
const {login,task,snapshot,proof}=require('./g6-canonical-forwarder-chromium');
const env=process.env, BASE='https://komerce-backend-production.up.railway.app';
const REF=env.G6_DYNAMIC_FRESH_ORDER==='1'?env.G6_CANONICAL_SHIPMENT_REF:'SIM-STAGING-EXP-KL1WGP6', ID=env.G6_DYNAMIC_FRESH_ORDER==='1'?env.G6_CANONICAL_SHIPMENT_ID:'ff8591fc-78bb-49a4-b154-247508368d16', CUSTOMS='SIM-STAGING-DOU-'+(env.G6_CANONICAL_ORDER_REFERENCE||'KL1WGP6');
const API='/api/admin/workspaces/shipping-customs/market/KM';
const OUT=path.resolve('test-results/g6-canonical-customs');
const {observe,fullError}=require("./canonical/observability");let OBS=null;
const {humanClick,humanFill,humanSelect,humanCheck,humanPress}=require('./canonical/actors/human-gestures');
const report={schema:'komerce-g6-customs/1',shipment_id:ID,shipment_ref:REF,order_id:env.G6_CANONICAL_ORDER_ID,
 reference:env.G6_CANONICAL_ORDER_REFERENCE||'KL1WGP6',scenario_id:'M01',market:'KM',events:[],verdict:'BLOCKED',
 provenance:'SIMULATED / STAGING ONLY',external_payment_executed:false,external_supplier_calls:0};
const check=(ok,code)=>{if(!ok)throw Error(code)};
function save(){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')}
async function readState(stage,placement){
 const physical=await snapshot(stage,placement);
 const {rows:shipment}=await db.query('SELECT customs_shipment_id FROM international_shipments WHERE id=$1',[ID]);
 const {rows:customs}=await db.query('SELECT id,reference,market_id,status,customs_paid_kmf,cif_value_kmf FROM customs_shipments WHERE reference=$1 OR id=$2',[CUSTOMS,shipment[0].customs_shipment_id]);
 const {rows:legacy}=await db.query('SELECT COUNT(*)::int AS n FROM customs_shipment_parcels WHERE shipment_id IN (SELECT id FROM customs_shipments WHERE reference=$1)',[CUSTOMS]);
 check(shipment.length===1&&customs.length<=1&&legacy[0].n===0,'G6_CUSTOMS_SCOPE_INVALID');
 if(customs.length)check(customs[0].market_id===physical.base.shipments[0].market_id,'G6_CUSTOMS_MARKET_DRIFT');
 return {...physical,customs,linked:shipment[0].customs_shipment_id};
}
async function click(actor,key,endpoint,button,validate,role){
 await runtime();
 const url=BASE+endpoint;let count=0;
 const handler=async route=>{
  const req=route.request();if(req.method()!=='POST')return route.fallback();
  let body;try{body=req.postDataJSON()}catch(_){}
  if(count===0&&validate(body)){count++;return route.continue()}
  actor.blocked.push({method:req.method(),path:new URL(req.url()).pathname});return route.abort('blockedbyclient');
 };
 await actor.page.route(url,handler);
 try{
  await button.waitFor({state:'visible',timeout:25000});
  check(await button.isEnabled(),'G6_CUSTOMS_DISABLED_'+key);
  const pending=actor.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:30000});
  await humanClick(null,button);
  const response=await pending;report.events.push({key,role,http:response.status()});save();
  check(count===1&&response.ok()&&actor.blocked.length===0,'G6_CUSTOMS_HTTP_'+key+'_'+response.status());
 }finally{await actor.page.unroute(url,handler)}
}
async function journey(actor,key,title,tab,tail,fields,expected,role){
 const item=await task(actor.page,title,tab);
 for(const [name,val] of Object.entries(fields))await humanFill(null,item.locator('[name="'+name+'"]'),val);
 await click(actor,key,API+'/international/'+REF+'/'+tail,item.locator('button[type="submit"]'),b=>isDeepStrictEqual(b,expected),role);
}
function eventProof(prev,next,type,ref,stage){
 const a=prev.base.shipmentEvents,b=next.base.shipmentEvents;
 check(b.length===a.length+1&&isDeepStrictEqual(b.slice(0,-1),a)&&b.at(-1).event_type===type&&
 b.at(-1).proof_ref===ref&&b.at(-1).to_stage===stage&&!!b.at(-1).actor_id,'G6_CUSTOMS_EVENT_INVALID_'+type);
}
async function main(){
 let browser;
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&
   env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&
   env.STAGING_BASE_URL===BASE&&env.G6_CANONICAL_PHASE==='CUSTOMS'&&(env.G6_CANONICAL_RESUME_RUN_ID==='44257485638'||env.G6_DYNAMIC_FRESH_ORDER==='1')&&
   env.G6_CANONICAL_SCENARIO==='M01'&&env.G6_TARGET_MARKET==='KM'&&(env.G6_CANONICAL_ORDER_ID==='56adad65-d1fa-4e80-8d69-c25e0fe92a76'||(env.G6_DYNAMIC_FRESH_ORDER==='1'&&/^[a-f0-9-]{36}$/i.test(env.G6_CANONICAL_ORDER_ID||'')&&/^[a-f0-9-]{36}$/i.test(ID||''))),
   'G6_CUSTOMS_OWNER_GUARD');
  const target=await confirmTarget({db,env});check(target.confirmed&&target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_CUSTOMS_DB_DRIFT');
  report.db_fingerprint=target.fingerprint;report.sha=await runtime();
  const prior=JSON.parse(fs.readFileSync((env.G6_DYNAMIC_FRESH_ORDER==='1'?'test-results/g6-canonical-forwarder/report.json':'test-results/g6-canonical-resume/g6-canonical-forwarder/report.json'),'utf8'));
  const placement=prior.after.base.effective[0].placement_id;
  let last=await readState('arrived',placement);report.before=last;save();
  check(isDeepStrictEqual(last.base,prior.after.base)&&isDeepStrictEqual(JSON.parse(JSON.stringify(last.tracking)),prior.after.tracking)&&last.customs.length===0&&last.linked===null,
   'G6_CUSTOMS_PRIOR_DRIFT');
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const admin=await login(browser,'E2E_ADMIN_','admin');
  try{
   await admin.page.goto('/admin/workspaces/shipping-customs?market=KM',{waitUntil:'domcontentloaded'});
   await admin.page.locator('[data-international-journey]').first().waitFor({state:'visible',timeout:25000});
   await humanClick(null,admin.page.locator('.kmc-journey-tab').filter({hasText:'Arrivée & douane'}));
   const date=new Date().toISOString().slice(0,10), answers=[CUSTOMS,date,'1000',''];
   admin.page.on('dialog',async d=>{
    if(d.type()==='prompt'&&answers.length)return d.accept(answers.shift());
    if(d.type()==='confirm'&&d.message().includes(CUSTOMS)&&answers.length===0)return d.accept();
    return d.dismiss();
   });
   await click(admin,'customs_create',API+'/customs/shipments',admin.page.locator('[data-workspace-action="create-customs"]'),
    b=>isDeepStrictEqual(b,{reference:CUSTOMS,shipment_date:date,cif_value_kmf:1000,parcel_refs:[]}),'admin');
   let now=await readState('arrived',placement);
   check(answers.length===0&&now.customs.length===1&&now.customs[0].reference===CUSTOMS&&Number(now.customs[0].cif_value_kmf)===1000&&
    now.linked===null&&isDeepStrictEqual(last.base,now.base),'G6_CUSTOMS_CREATE_PG_INVALID');
   const cid=now.customs[0].id;last=now;report.after=now;save();
   const steps=[
    ['customs_link','Lier le dossier douane','link-customs',{customs_reference:CUSTOMS,proof_ref:proof('LIEN-DOUANE')},{customs_reference:CUSTOMS,proof_ref:proof('LIEN-DOUANE')},'arrived','customs_linked'],
    ['customs_amount','Constater les droits et taxes','customs-amount',{amount_kmf:'0',proof_ref:proof('DROITS-DOUANE')},{amount_kmf:'0',proof_ref:proof('DROITS-DOUANE')},'arrived','customs_amount_confirmed'],
    ['customs_released','Confirmer : Mainlevée confirmée','transition',{proof_ref:proof('MAINLEVEE')},{proof_ref:proof('MAINLEVEE'),to_stage:'customs_released'},'customs_released','stage_changed']
   ];
   for(const [key,title,tail,fields,expected,stage,type] of steps){
    await journey(admin,key,title,'Arrivée & douane',tail,fields,expected,'admin');
    now=await readState(stage,placement);eventProof(last,now,type,fields.proof_ref,stage);
    check(now.linked===cid&&now.customs[0].id===cid,'G6_CUSTOMS_LINK_INVALID');
    if(key!=='customs_link')check(now.customs[0].customs_paid_kmf!==null&&Number(now.customs[0].customs_paid_kmf)===0&&
     ['declared','confirmed'].includes(now.customs[0].status),'G6_CUSTOMS_AMOUNT_INVALID');
    last=now;report.after=now;save();await runtime();
   }
  }finally{await admin.ctx.close()}
  const hub=await login(browser,'E2E_AGENT_HUB_','agent_hub');
  try{
   await journey(hub,'local_delivery','Confirmer : Transport local','Vers les relais','transition',
    {proof_ref:proof('TRANSPORT-LOCAL')},{proof_ref:proof('TRANSPORT-LOCAL'),to_stage:'local_delivery'},'agent_hub');
   const now=await readState('local_delivery',placement);
   eventProof(last,now,'stage_changed',proof('TRANSPORT-LOCAL'),'local_delivery');
   check(now.linked===last.linked&&isDeepStrictEqual(now.customs,last.customs),'G6_CUSTOMS_LOCAL_DRIFT');
   report.after=now;save();await runtime();
  }finally{await hub.ctx.close()}
  report.verdict='G6_CUSTOMS_LOCAL_SIMULATED_CHROMIUM_PG_PASS';report.next_stage='RELAY_RECEIPT';save();
 }catch(e){report.error=fullError(e);try{if(report.db_fingerprint)report.failure_readback=await readback()}catch(_){};save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close();await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
