/** @komerce-arch-lite
 * @role g6-negative-n25-sav-chromium
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose N25 (SAV retour et double reprise) et N26b (compensation après retrait), staging only : après la remise M02, l'agent relais ouvre un dossier SAV puis atteste la reprise physique par l'écran Retours et SAV ; la double reprise est refusée ; N26b cherche ensuite l'écran admin de décision de compensation. Aucune écriture SQL, aucun PSP.
 * @db-read orders, order_items, users, disputes, relay_product_return_receipts, local_stock
 * @db-write none
 * @impact-areas staging-only, orders, refunds
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {runtime}=require('./g6-hub-shipment-chromium');
const {login}=require('./g6-canonical-forwarder-chromium');
const {observe,fullError}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill,humanSelect}=require('./canonical/actors/human-gestures');
const {bindAgent,check}=require('./g6-negative-n23-n24-chromium');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const SCEN=env.G6_CANONICAL_SCENARIO,ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const PHASES={N25:'N25_SAV_DOUBLE_INTAKE',N26b:'N26B_SAV_COMPENSATION_DECISION'};
const OUT=path.resolve('test-results/g6-negative-n25');
const OBS_TEXT='[SIMULATED / STAGING ONLY] G6-'+SCEN+' reprise constatee '+REF;
let OBS=null;
const report={schema:'komerce-g6-negative-n25/1',scenario_id:SCEN,market:MK.code,reference:REF,order_id:ID,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],screen:[],probes:[],attempts:[],gaps:[],ux_signal:null,page_events:[],stock_before:null,
 external_supplier_calls:0,external_payment_executed:false,plaintext_pickup_code_logged:false,production_permitted:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const reach=k=>{report.steps_reached.push(k);save()};
const is2xx=h=>h>=200&&h<300;
const norm=b=>b&&typeof b==='object'?JSON.stringify(Object.fromEntries(Object.keys(b).sort().map(k=>[k,b[k]]))):String(b);
// Un geste d'écran = une requête POST permise (charge utile vérifiée), jamais de nouvel essai. Un écran muet pendant 6 s = refus d'écran.
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
   const out=await Promise.race([done,new Promise(r=>setTimeout(()=>r({quiet:true}),6000))]);
   if(out.res){const j=await out.res.json().catch(()=>({}));return {present:true,enabled:true,http:out.res.status(),code:j.code||null,replayed:j.replayed===true};}
   if(out.failed||guard.length)return {present:true,enabled:true,http:null,code:null,guard_blocked:guard.slice(0,3)};
   return {present:true,enabled:true,http:null,code:null,no_request:true};
  }finally{actor.page.off('response',onResp);actor.page.off('requestfailed',onFail)}
 }finally{await actor.page.unroute(url,handler)}
}
async function probe(page,kind,endpoint,data){
 const res=await page.request.post(BASE+endpoint,{headers:{origin:BASE},data}).catch(()=>null);
 const j=res?await res.json().catch(()=>({})):{};
 const code=j.code||j.error?.code||null;
 const row={kind,via:'API_PROBE_NO_SCREEN_GESTURE',http:res?res.status():null,code:code&&String(code).slice(0,80),replayed:j.replayed===true};
 report.probes.push(row);save();
 check(!/^csrf_/.test(row.code||''),'G6_'+SCEN+'_SCREEN_MISSING_PROBE_'+row.code);
 check(row.http!==null,'G6_'+SCEN+'_SCREEN_MISSING_NO_RESPONSE_'+kind);
 return row;
}
async function openReturns(page){
 await humanGoto(page,'/admin/relais-live?view=execute&market='+MK.code+'&focus=returns',{waitUntil:'domcontentloaded'});
 const section=page.locator('[data-relay-return-requests]');
 const ok=await section.waitFor({state:'visible',timeout:30000}).then(()=>true,()=>false);
 check(ok,'G6_'+SCEN+'_SCREEN_MISSING_RELAY_RETURNS_SCREEN');
 return section;
}
const stockOf=async()=>(await db.query(`SELECT COALESCE(SUM(ls.qty_physical),0)::int AS n FROM local_stock ls
  JOIN orders o ON o.market_id=ls.market_id JOIN order_items oi ON oi.order_id=o.id AND oi.product_id=ls.product_id WHERE o.id=$1`,[ID])).rows[0].n;
// N26b : suivre le parcours admin depuis les opérations financières, proposer
// le mouvement en lecture seule puis exécuter une seule décision wallet motivée.
async function executeCompensationDecision(browser,requestId){
 const admin=await login(browser,'E2E_ADMIN_','admin');
 try{
  await humanGoto(admin.page,'/g8-remboursements.html',{waitUntil:'domcontentloaded'});
  await admin.page.waitForLoadState('networkidle',{timeout:15000}).catch(()=>{});
  const entry=admin.page.locator('[data-g6-sav-compensation-entry]');
  await entry.waitFor({state:'visible',timeout:20000}).catch(()=>{});
  check(await entry.isVisible(),'G6_N26B_ADMIN_COMPENSATION_NOT_DISCOVERABLE_FROM_FINANCE');
  await humanClick(null,entry);
  await admin.page.locator('#sav-lookup').waitFor({state:'visible',timeout:15000});
  await humanFill(null,admin.page.locator('#sav-id'),requestId);
  const proposalResponse=admin.page.waitForResponse(r=>r.url().includes('/api/relay/returns/'+requestId+'/compensation-proposal')&&r.request().method()==='GET',{timeout:15000});
  await humanClick(null,admin.page.locator('#sav-lookup button[type="submit"]'));
  const proposalHttp=await proposalResponse;
  check(proposalHttp.ok(),'G6_N26B_COMPENSATION_PROPOSAL_HTTP_'+proposalHttp.status());
  const proposalBody=await proposalHttp.json();
  check(proposalBody.request_id===requestId&&proposalBody.currency&&
   Number.isSafeInteger(Number(proposalBody.suggested_amount)),'G6_N26B_COMPENSATION_PROPOSAL_INVALID');
  const proposal=admin.page.locator('#sav-proposal');
  await proposal.waitFor({state:'visible',timeout:20000}).catch(()=>{});
  check(await proposal.isVisible(),'G6_N26B_COMPENSATION_PROPOSAL_NOT_SHOWN');
  const details=await admin.page.locator('#sav-details').innerText();
  const amount=Number(await admin.page.locator('#sav-amount').inputValue());
  check(amount===Number(proposalBody.suggested_amount),'G6_N26B_COMPENSATION_AMOUNT_NOT_PROPOSED');
  const reason='Défaut constaté après reprise physique G6';
  await humanFill(null,admin.page.locator('#sav-reason'),reason);
  await admin.page.once('dialog',dialog=>dialog.accept());
  const actor={...admin,blocked:[]};
  const decision=await act(actor,'/api/relay/returns/'+encodeURIComponent(requestId)+'/compensation',
   admin.page.locator('#sav-submit'),b=>b&&b.movement==='wallet_credit'&&b.amount===amount&&
    b.reason===reason&&typeof b.scale_code==='string');
  report.screen.push({role:'admin',page:'finance-to-sav-compensation',entry_visible:true,
   proposal_visible:true,proposal_details:details.slice(0,240),amount,decision});
  check(decision.http!==null&&is2xx(decision.http)&&decision.http!==202,
   'G6_N26B_COMPENSATION_DECISION_NOT_CONFIRMED_'+(decision.http??'NO_RESPONSE'));
  check(actor.blocked.length===0,'G6_N26B_UNEXPECTED_ADMIN_WRITE');
  return {amount,currency:proposalBody.currency,proposal:details,decision};
 }finally{await admin.ctx.close()}
}
async function main(){
 let browser;
 try{
  save();
  check(Object.hasOwn(PHASES,SCEN),'G6_N25_SCENARIO_UNKNOWN');
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
   env.G6_CANONICAL_PHASE===PHASES[SCEN]&&env.G6_DYNAMIC_FRESH_ORDER==='1'&&
   env.G6_TARGET_MARKET===MK.code&&/^[a-f0-9-]{36}$/i.test(ID||''),'G6_'+SCEN+'_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_'+SCEN+'_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  const {rows:[o]}=await db.query('SELECT reference,status::text AS status,payment_status::text AS payment_status,relais_id FROM orders WHERE id=$1',[ID]);
  check(o&&o.reference===REF&&o.status==='collected'&&o.payment_status==='paid','G6_'+SCEN+'_PRECONDITION_ORDER_COLLECTED_PAID');
  report.stock_before=await stockOf();save();
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const {actor}=await bindAgent(browser,o.relais_id);
  try{
   actor.page.on('pageerror',e=>report.page_events.push({kind:'pageerror',msg:String(e.message).slice(0,160)}));
   let section=await openReturns(actor.page);reach('RETURNS_SCREEN_OPEN');
   // 1. Dossier SAV sur l'article réellement remis.
   const lookup=section.locator('form[data-relay-return-lookup]');
   await humanFill(null,lookup.locator('[data-relay-return-reference]'),REF);
   await humanClick(null,lookup.locator('button[type="submit"]'));
   const sel=section.locator('form[data-relay-return-create]');
   const eligible=await sel.waitFor({state:'visible',timeout:20000}).then(()=>true,()=>false);
   if(!eligible){
    const msg=await section.locator('[data-relay-return-feedback]').innerText().catch(()=>'');
    report.screen.push({step:'lookup',eligible:false,message:msg.slice(0,160)});
    throw Error('G6_'+SCEN+'_PRODUCT_GAP_SAV_NOT_OFFERED_AFTER_HANDOVER');
   }
   const itemId=await sel.locator('[data-relay-return-product]').inputValue();
   const create=await act(actor,'/api/relay/returns',sel.locator('[data-relay-return-submit]'),
    b=>b&&b.order_reference===REF&&b.order_item_id===itemId&&b.quantity===1&&b.reason==='defective');
   report.screen.push({step:'create_dossier',...create});
   check(create.http!==null&&is2xx(create.http),'G6_'+SCEN+'_SCREEN_MISSING_SAV_DOSSIER_'+(create.http??'NO_REQUEST'));
   reach('SAV_DOSSIER_CREATED');
   // 2. Reprise physique attestée une fois (zone A, état ouvert).
   const intake=section.locator('form[data-relay-return-intake]');
   await intake.waitFor({state:'visible',timeout:20000}).catch(()=>{});
   check(await intake.isVisible(),'G6_'+SCEN+'_SCREEN_MISSING_INTAKE_FORM');
   await humanSelect(null,intake.locator('select[aria-label="État physique constaté"]'),'opened');
   await humanFill(null,intake.locator('input[aria-label="Lettre de zone facultative"]'),'A');
   await humanFill(null,intake.locator('textarea[aria-label="Constat physique de reprise"]'),OBS_TEXT);
   const requestId=await intake.locator('[data-relay-intake-request]').inputValue();
   const want={request_id:requestId,condition_code:'opened',storage_zone:'A',observation:OBS_TEXT};
   const rec=await act(actor,'/api/relay/returns/intake',intake.locator('[data-relay-intake-submit]'),b=>norm(b)===norm(want));
   report.screen.push({step:'intake',...rec});
   check(rec.http!==null&&is2xx(rec.http),'G6_'+SCEN+'_SCREEN_MISSING_INTAKE_'+(rec.http??'NO_REQUEST'));
   if(rec.http!==201)report.gaps.push('FIRST_INTAKE_HTTP_'+rec.http);
   reach('PHYSICAL_INTAKE_ATTESTED');
   report.stock_after_intake=await stockOf();
   // 3. Double reprise : l'écran ne la propose plus ; second dossier sur la même unité et rejeu refusés (sondes signalées).
   section=await openReturns(actor.page);
   const stillOffered=await section.locator('form[data-relay-return-intake]').isVisible().catch(()=>false);
   report.screen.push({step:'second_intake_offered',offered:stillOffered});
   if(stillOffered)report.gaps.push('SECOND_INTAKE_OFFERED_BY_SCREEN');
   await humanFill(null,section.locator('[data-relay-return-reference]'),REF);
   await humanClick(null,section.locator('form[data-relay-return-lookup] button[type="submit"]'));
   await actor.page.waitForTimeout(1500);
   const secondOffered=await section.locator('form[data-relay-return-create]').isVisible().catch(()=>false);
   const feedback=await section.locator('[data-relay-return-feedback]').innerText().catch(()=>'');
   report.screen.push({step:'second_dossier_offered',offered:secondOffered,message_visible:!!feedback.trim()});
   if(secondOffered)report.gaps.push('SECOND_DOSSIER_OFFERED_BY_SCREEN');
   if(!feedback.trim())report.ux_signal='SECOND_DOSSIER_REFUSE_SANS_MESSAGE_AFFICHE';
   const second=await probe(actor.page,'second_dossier_same_unit','/api/relay/returns',{order_reference:REF,order_item_id:itemId,quantity:1,reason:'defective',note:''});
   if(is2xx(second.http))report.gaps.push('SECOND_DOSSIER_ACCEPTED');
   const replay=await probe(actor.page,'intake_replay_identical','/api/relay/returns/intake',want);
   if(replay.http!==200||!replay.replayed)report.gaps.push('INTAKE_REPLAY_NOT_IDEMPOTENT_'+replay.http);
   const altered=await probe(actor.page,'intake_second_attestation','/api/relay/returns/intake',{...want,observation:OBS_TEXT+' seconde reprise'});
   if(is2xx(altered.http))report.gaps.push('SECOND_PHYSICAL_INTAKE_ACCEPTED');
   reach('DOUBLE_INTAKE_TRIED');
   check(actor.blocked.length===0,'G6_'+SCEN+'_UNEXPECTED_RELAY_WRITE');
  }finally{await actor.ctx.close()}
  if(report.gaps.length){report.verdict='PRODUCT_GAP';throw Error('G6_'+SCEN+'_PRODUCT_GAP_'+report.gaps.join('_'))}
  if(SCEN==='N26b'){
   const decision=await executeCompensationDecision(browser,requestId);
   reach('ADMIN_COMPENSATION_SCREEN_SEARCHED');
   const {rows:[c]}=await db.query(`SELECT rc.request_id,rc.order_id,rc.payer_user_id,rc.movement,
      rc.amount,rc.currency,rc.reason,rc.wallet_transaction_id,o.user_id AS order_payer,
      wt.type AS wallet_type,wt.amount_kmf,wt.reason AS wallet_reason,wt.reference_id,
      wt.idempotency_key,wt.created_by
     FROM relay_return_compensations rc
     JOIN orders o ON o.id=rc.order_id
     LEFT JOIN wallet_transactions wt ON wt.id=rc.wallet_transaction_id
    WHERE rc.request_id=$1`,[requestId]);
   check(c&&c.order_id===ID&&c.payer_user_id===c.order_payer&&c.movement==='wallet_credit'&&
    Number(c.amount)===decision.amount&&c.currency===decision.currency&&c.reason==='Défaut constaté après reprise physique G6'&&
    c.wallet_transaction_id&&c.wallet_type==='credit'&&Number(c.amount_kmf)===decision.amount&&
    c.wallet_reason==='sav_compensation'&&c.reference_id===ID&&
    c.idempotency_key==='sav_comp_'+requestId&&c.created_by,
    'G6_N26B_COMPENSATION_WALLET_OR_PAYER_ORACLE_MISMATCH');
   const {rows:[sideEffects]}=await db.query(`SELECT
      (SELECT count(*)::int FROM refunds WHERE order_id=$1) AS refunds,
      (SELECT count(*)::int FROM refund_execution_intents WHERE order_id=$1) AS psp_intents,
      (SELECT count(*)::int FROM relay_return_compensations WHERE request_id=$2) AS decisions`,[ID,requestId]);
   check(sideEffects.refunds===0&&sideEffects.psp_intents===0&&sideEffects.decisions===1,
    'G6_N26B_DUPLICATE_OR_EXTERNAL_REFUND_ORACLE');
   let documents={rows:[]};
   for(let attempt=0;attempt<6&&!documents.rows.length;attempt++){
    documents=await db.query(`SELECT document_type,status FROM transaction_documents
      WHERE document_type='wallet_receipt' AND subject_type='wallet_tx' AND subject_id=$1`,[c.wallet_transaction_id]);
    if(!documents.rows.length)await new Promise(resolve=>setTimeout(resolve,500));
   }
   check(documents.rows.length===1&&['generated','delivered'].includes(documents.rows[0].status),
    'G6_N26B_WALLET_RECEIPT_MISSING');
   report.pg_oracle={compensation:{movement:c.movement,amount:c.amount,currency:c.currency,
     payer_matches_order:c.payer_user_id===c.order_payer,wallet_transaction_id:c.wallet_transaction_id},
     effects:sideEffects,wallet_receipt:documents.rows[0],external_payment_executed:false};
   reach('COMPENSATION_WALLET_PAYER_IDEMPOTENCE_PG_VERIFIED');
   report.verdict='G6_N26B_SAV_COMPENSATION_DECISION_CHROMIUM_PG_PASS';save();
   await runtime();
   return;
  }
  await runtime();
  report.verdict='G6_N25_SAV_SINGLE_PHYSICAL_INTAKE_DOUBLE_REFUSED_CHROMIUM_PASS';save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
