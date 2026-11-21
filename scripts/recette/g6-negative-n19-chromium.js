/** @komerce-arch-lite
 * @role g6-negative-n19-chromium
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose N19 (retard puis perte du transport local, staging only) : l'expédition est au transport local, rien n'est attesté (retard : aucune disponibilité fictive), puis l'agent relais atteste à l'écran une quantité reçue nulle (perte) ; incident attendu, aucun retrait possible, aucune écriture SQL.
 * @db-read orders, users, parcels, parcel_items, order_items, international_shipments, international_shipment_relay_receipts, incidents, scans
 * @db-write none
 * @impact-areas staging-only, logistics
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
const {isDeepStrictEqual}=require('node:util');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {runtime}=require('./g6-hub-shipment-chromium');
const {openRelayLive}=require('./canonical/relay-live-navigation');
const {shipmentForOrder,snapLocalTransport}=require('./canonical/negative-scenarios');
const {observe,fullError}=require('./canonical/observability');
const {humanClick,humanFill}=require('./canonical/actors/human-gestures');
const {bindAgent,check}=require('./g6-negative-n23-n24-chromium');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const OUT=path.resolve('test-results/g6-negative-n19');
let OBS=null;
const report={schema:'komerce-g6-negative-n19/1',scenario_id:'N19',market:MK.code,reference:REF,order_id:ID,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],lines:[],delay:null,gaps:[],ux_signal:null,page_events:[],
 external_supplier_calls:0,external_payment_executed:false,plaintext_pickup_code_logged:false,production_permitted:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const reach=k=>{report.steps_reached.push(k);save()};
async function main(){
 let browser;
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
   env.G6_CANONICAL_PHASE==='N19_LOCAL_TRANSPORT_DELAY_LOSS'&&env.G6_CANONICAL_SCENARIO==='N19'&&env.G6_DYNAMIC_FRESH_ORDER==='1'&&
   env.G6_TARGET_MARKET===MK.code&&/^[a-f0-9-]{36}$/i.test(ID||''),'G6_N19_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_N19_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  const {rows:[o]}=await db.query('SELECT reference,status::text AS status,relais_id FROM orders WHERE id=$1',[ID]);
  check(o&&o.reference===REF&&o.status!=='collected','G6_N19_PRECONDITION_ORDER');
  const sh=await shipmentForOrder(db,ID);
  check(sh&&sh.reference,'G6_N19_SCREEN_MISSING_NO_SHIPMENT_FOR_ORDER');
  // Retard : expédition au transport local, rien d'attesté. Aucune disponibilité ni code de retrait ne doit exister (relu en PG).
  const delay=await snapLocalTransport(db,{orderId:ID,shipmentId:sh.id});
  report.delay=delay;reach('DELAY_STATE_READ');
  if(delay.stage!=='local_delivery')throw Error('G6_N19_PRECONDITION_STAGE_'+delay.stage);
  if(delay.receipts!==0)throw Error('G6_N19_PRECONDITION_ALREADY_RECEIVED');
  if(['available','collected'].includes(delay.order_status)||delay.collected_scans>0)report.gaps.push('AVAILABLE_OR_CODE_DURING_DELAY');
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const {actor}=await bindAgent(browser,o.relais_id);
  try{
   const url=BASE+'/api/admin/workspaces/operations/market/'+MK.code+'/relay-shipments/'+sh.reference+'/receive';
   const PROOF='[SIMULATED / STAGING ONLY] G6-N19-PERTE-TRANSPORT-LOCAL-'+REF;
   const card=await openRelayLive(actor.page,{selector:'[data-relay-shipment="'+sh.reference+'"]',timeout:30000,execute:true});
   reach('RECEPTION_CARD_VISIBLE');
   if(!await card.evaluate(el=>el.open))await humanClick(null,card.locator('summary').first());
   const fields=card.locator('input[data-relay-received]');
   const n=await fields.count();
   if(n<1)throw Error('G6_N19_SCREEN_MISSING_RELAY_LOSS_ENTRY');
   const expected=[];
   for(let i=0;i<n;i++){
    const id=await fields.nth(i).getAttribute('data-relay-received');
    const max=Number(await fields.nth(i).getAttribute('max'));
    if(!Number.isInteger(max)||max<1)throw Error('G6_N19_SCREEN_MISSING_RELAY_LOSS_ENTRY');
    await humanFill(null,fields.nth(i),'0');
    expected.push({order_item_id:id,received_qty:0});report.lines.push({expected:max,typed:0});
   }
   await humanFill(null,card.locator('input[data-relay-proof]'),PROOF);
   const sort=l=>[...l].sort((a,b)=>String(a.order_item_id).localeCompare(String(b.order_item_id)));
   let calls=0;
   await actor.page.route(url,route=>{
    const req=route.request();let body;try{body=req.postDataJSON()}catch(_){}
    if(req.method()==='POST'&&calls++===0&&body&&isDeepStrictEqual({...body,lines:sort(body.lines||[])},{proof_ref:PROOF,lines:sort(expected)}))return route.continue();
    actor.blocked.push({method:req.method(),path:'/relay-shipments/receive'});return route.abort('blockedbyclient');
   });
   const button=card.locator('[data-workspace-action="relay-shipment-receive"]');
   await button.waitFor({state:'visible',timeout:20000});
   if(!await button.isEnabled())throw Error('G6_N19_SCREEN_MISSING_RECEIVE_BUTTON_DISABLED');
   const pending=actor.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:30000});
   await humanClick(null,button);
   const res=await pending;const body=await res.json().catch(()=>({}));
   report.receive_http=res.status();
   report.incident_in_response=(body.result?.receipts||[]).every(r=>r.incident_id);
   await actor.page.waitForTimeout(800);
   const text=await actor.page.locator('body').innerText().catch(()=>'');
   report.incident_message_visible=/écart enregistré en incident|incident ouvert/i.test(text);
   if(!report.incident_message_visible)report.ux_signal='PERTE_ATTESTEE_SANS_MESSAGE_INCIDENT';
   reach('LOSS_ATTESTED');
   if(!(res.status()>=200&&res.status()<300&&calls===1&&actor.blocked.length===0))throw Error('G6_N19_PRODUCT_GAP_RECEIPT_HTTP_'+res.status());
  }finally{await actor.ctx.close()}
  await runtime();
  if(report.gaps.length){report.verdict='PRODUCT_GAP';throw Error('G6_N19_PRODUCT_GAP_'+report.gaps.join('_'))}
  report.verdict='G6_N19_LOCAL_TRANSPORT_DELAY_LOSS_INCIDENT_NO_WITHDRAWAL_CHROMIUM_PASS';save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
