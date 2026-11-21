/** @komerce-arch-lite
 * @role g6-negative-n13-n14-chromium
 * @domain purchasing
 * @layer script
 * @owner backend-core
 * @purpose N13 (rupture fournisseur simulée, reliquat) et N14 (réception Hub en excès, négative ou nulle, puis exacte), staging only : gestes Hub par l'écran, sondes API signalées, aucune écriture SQL.
 * @db-read purchase_orders, purchase_lines, purchase_order_authorizations, orders, order_items, hub_physical_units
 * @db-write none
 * @impact-areas staging-only, purchasing, hub
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {runtime}=require('./g6-hub-shipment-chromium');
const {login,openPo}=require('./g6-hub-commitment-chromium');
const {observe,fullError}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill,humanCheck,humanPress}=require('./canonical/actors/human-gestures');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const SCEN=env.G6_CANONICAL_SCENARIO,ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE,PO=env.G6_CANONICAL_PO_ID;
const PHASES={N13:'N13_SUPPLIER_BACKORDER',N14:'N14_RECEIVING_QTY_ATTEMPTS'};
const OUT=path.resolve('test-results/g6-negative-n13-n14');
let OBS=null;
const report={schema:'komerce-g6-negative-n13-n14/1',scenario_id:SCEN,market:MK.code,reference:REF,order_id:ID,po_id:PO,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],screen:[],probes:[],attempts:[],gaps:[],ux_signal:null,
 external_supplier_calls:0,external_payment_executed:false,production_permitted:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const reach=k=>{report.steps_reached.push(k);save()};
const check=(ok,code)=>{if(!ok)throw Error(code)};
async function line(){
 const {rows}=await db.query(`SELECT po.status::text AS po_status,po.sent_at,po.trigger_mode,pl.id AS line_id,pl.quantity,pl.confirmed_quantity,pl.product_sku_id,purchase_line_received_quantity(pl.id)::int AS received,
   o.payment_status::text AS payment_status,o.simulation_scope,
   (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='purchase_commitment') AS commitments,
   (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='supplier_payment') AS payments,
   (SELECT count(*)::int FROM manual_purchase_executions e WHERE e.purchase_order_id=po.id AND e.purchase_line_id=pl.id) AS manual_executions,
   (SELECT COALESCE(sum(COALESCE(x.confirmed_quantity,x.quantity)),0)::int FROM purchase_lines x WHERE x.purchase_order_id=po.id AND x.cancelled_at IS NULL AND x.product_sku_id=pl.product_sku_id) AS po_sku_quantity,
   (SELECT count(*)::int FROM hub_physical_units u WHERE u.order_id=o.id) AS hub_units
   FROM purchase_orders po JOIN purchase_lines pl ON pl.purchase_order_id=po.id AND pl.cancelled_at IS NULL
   JOIN order_items oi ON oi.id=pl.order_item_id JOIN orders o ON o.id=oi.order_id
   WHERE po.id=$1 AND o.id=$2 AND o.reference=$3`,[PO,ID,REF]);
 check(rows.length===1,'G6_'+SCEN+'_PRECONDITION_PO_NOT_SINGLE_LINE');
 return rows[0];
}
// Le cockpit se repeint souvent : clic pointeur, sinon Entrée sur le même bouton visible et actif (jamais de force).
async function openForm(page,action,kind){
 const btn=page.locator('[data-hlc-action="'+action+'"]'),form=page.locator('form[data-hlc-form="'+kind+'"]');
 await btn.waitFor({state:'visible',timeout:18000});
 check(await btn.isEnabled(),'G6_N13_SCREEN_MISSING_'+action+'_DISABLED');
 try{await humanClick(null,btn,{timeout:7000})}
 catch(e){
  if(e&&e.verdict==='BLOCKED')throw e;
  if(!(await form.isVisible().catch(()=>false)))await humanPress(null,btn,'Enter',{timeout:7000});
 }
 await form.waitFor({state:'visible',timeout:14000});
 return form;
}
async function probe(page,kind,url,data){
 const res=await page.request.post(BASE+url,{headers:{origin:BASE},data}).catch(()=>null);
 const j=res?await res.json().catch(()=>({})):{};
 const code=j.code||j.error?.code||null;
 const quarantined=!!(res&&res.status()===202&&j.quarantined===true);
 const row={kind,via:'API_PROBE_NO_SCREEN_GESTURE',http:res?res.status():null,code:code&&String(code).slice(0,80),outcome:quarantined?'QUARANTINED_NOT_RECEIVED':null};
 report.probes.push(row);save();
 check(!/^csrf_/.test(row.code||''),'G6_'+SCEN+'_SCREEN_MISSING_PROBE_'+row.code);
 check(row.http!==null,'G6_'+SCEN+'_SCREEN_MISSING_NO_RESPONSE_'+kind);
 // 202 + quarantined:true = refus de réception (mise en quarantaine, aucune quantité reçue) ; la preuve 'received===0' reste vérifiée ensuite.
 if(row.http>=200&&row.http<300&&!quarantined)report.gaps.push('ACCEPTED_'+kind.toUpperCase());
 return row;
}
async function runN13(browser){
 const b=await line();
 check(b.po_status==='notified'&&!b.sent_at&&b.commitments===1&&b.payments===0&&b.manual_executions===0&&b.confirmed_quantity===null&&
  b.payment_status==='paid'&&b.simulation_scope==='G6-BUYER'&&b.trigger_mode!=='auto','G6_N13_PRECONDITION_PO_NOT_NOTIFIED_UNSENT');
 const ordered=Number(b.quantity);
 // Rupture : partielle si possible (au moins une unité confirmée), totale sinon (commande d'une unité).
 const typed=ordered>=2?ordered-1:0;
 report.ordered=ordered;report.typed=typed;report.rupture=typed===0?'TOTAL':'PARTIAL';save();
 const actor=await login(browser,'E2E_AGENT_HUB_',{allowedWrites:['sent','confirm']});
 try{
  await openPo(actor.page);
  const sent=await openForm(actor.page,'record-sent','sent');
  const sentResp=actor.page.waitForResponse(x=>new URL(x.url()).pathname==='/api/purchasing/po/'+PO+'/sent'&&x.request().method()==='POST',{timeout:30000});
  await humanClick(null,sent.locator('[data-hlc-action="submit-sent"]'));
  const s=await sentResp;
  check(s.status()===200&&(await s.json().catch(()=>({}))).simulated===true,'G6_N13_PRODUCT_GAP_SIMULATED_SEND_HTTP_'+s.status());
  reach('SIMULATED_SEND_RECORDED');
  await openPo(actor.page);
  const cf=await openForm(actor.page,'confirm-po','confirm');
  const qty=cf.locator('input[type="number"]');
  check(await qty.count()===1,'G6_N13_SCREEN_MISSING_CONFIRMED_QUANTITY_FIELD');
  check(Number(await qty.first().getAttribute('max'))===ordered,'G6_N13_SCREEN_MISSING_QUANTITY_MAX_'+ordered);
  await humanFill(null,qty.first(),String(typed));
  const confirmResp=actor.page.waitForResponse(x=>new URL(x.url()).pathname==='/api/purchasing/po/'+PO+'/confirm'&&x.request().method()==='POST',{timeout:30000});
  await humanClick(null,cf.locator('[data-hlc-action="submit-confirm"]'));
  const c=await confirmResp;const cj=await c.json().catch(()=>({}));
  report.attempts.push({kind:'PARTIAL_CONFIRMATION_'+report.rupture,http:c.status(),remnants_in_response:(cj.remnants||[]).length});
  reach('SUPPLIER_BACKORDER_CONFIRMED');
  check(c.status()===200,'G6_N13_PRODUCT_GAP_BACKORDER_CONFIRM_HTTP_'+c.status());
  await actor.page.waitForTimeout(800);
  const text=await actor.page.locator('body').innerText().catch(()=>'');
  report.remnant_message_visible=/reliquat|besoin ouvert|confirmation et achat fictifs/i.test(text);
  if(!report.remnant_message_visible)report.ux_signal='RELIQUAT_NON_VISIBLE_APRES_CONFIRMATION';
  check(actor.blocked.length===0,'G6_N13_UNEXPECTED_BROWSER_WRITE');
 }finally{await actor.ctx.close()}
}
async function runN14(browser){
 const b=await line();
 check(b.po_status==='confirmed'&&Number(b.confirmed_quantity)===Number(b.quantity)&&b.received===0&&b.payments===0&&b.manual_executions===1&&
  b.payment_status==='paid'&&b.simulation_scope==='G6-BUYER'&&!!b.product_sku_id,'G6_N14_PRECONDITION_PO_NOT_CONFIRMED_UNRECEIVED');
 const ordered=Number(b.quantity);report.ordered=ordered;
 // Excès = au-delà de TOUT ce que la PO peut recevoir pour ce SKU (une PO regroupée peut porter le reliquat d'un autre scénario).
 const excess=Math.max(ordered,Number(b.po_sku_quantity)||0)+1;report.excess_typed=excess;save();
 const PROOF='[SIMULATED / STAGING ONLY] G6-N14-RECEPTION-'+REF;
 const actor=await login(browser,'E2E_AGENT_HUB_',{readOnly:true});
 try{
  // Aucune requête de réception hors tentative explicitement autorisée.
  let permit=null,sent=0;
  await actor.page.route('**/api/scans/hub/receive',route=>{
   const req=route.request();
   let body;try{body=req.postDataJSON()}catch(_){}
   if(req.method()==='POST'&&permit&&sent===0&&Number(body?.contents?.[0]?.quantity)===permit){sent++;return route.continue()}
   actor.blocked.push({method:req.method(),path:'/api/scans/hub/receive'});return route.abort('blockedbyclient');
  });
  await humanGoto(actor.page,'/admin/hub-live?view=execute&market='+MK.code+'',{waitUntil:'domcontentloaded'});
  await humanClick(null,actor.page.getByRole('tab',{name:'Réceptions'}));
  const card=actor.page.locator('[data-receive-po="'+PO+'"]');
  await card.waitFor({state:'visible',timeout:25000});
  reach('RECEIVING_CARD_VISIBLE');
  await humanCheck(null,card.locator('[data-receive-manual-toggle]'));
  await humanFill(null,card.locator('[data-receive-manual-proof]'),PROOF);
  const input=card.locator('[data-receive-line="0"]'),button=card.locator('[data-workspace-action="receive-supplier"]');
  const hint=card.locator('.kmc-workspace-receive-hint');
  check(await input.count()===1,'G6_N14_SCREEN_MISSING_RECEIVED_QUANTITY_FIELD');
  const tries=[{kind:'EXCESS',typed:String(excess)},{kind:'NEGATIVE',typed:'-1'},{kind:'ZERO',typed:'0'}];
  for(const t of tries){
   await humanFill(null,input,t.typed);
   const row={kind:t.kind,typed:t.typed,ui_blocked:await button.isDisabled(),message:null,message_visible:false,http:null};
   row.message=((await hint.first().textContent().catch(()=>''))||'').trim().slice(0,160)||null;
   row.message_visible=!!row.message&&await hint.first().isVisible().catch(()=>false);
   if(!row.ui_blocked&&t.kind!=='ZERO'){
    // Le bouton est actif malgré une quantité invalide : on tente, le serveur doit refuser (une seule requête permise).
    permit=Number(t.typed);
    const pending=actor.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/scans/hub/receive'&&r.request().method()==='POST',{timeout:30000});
    await humanClick(null,button);
    const res=await pending;row.http=res.status();permit=null;
    const rj=await res.json().catch(()=>({}));
    row.outcome=res.status()===202&&rj.quarantined===true?'QUARANTINED_NOT_RECEIVED':null;
    if(res.status()<400&&!row.outcome)report.gaps.push('SCREEN_'+t.kind+'_ACCEPTED');
   }else if(!row.message_visible)report.ux_signal='QUANTITE_INVALIDE_SANS_MESSAGE';
   report.attempts.push(row);save();
  }
  reach('INVALID_QUANTITIES_TRIED');
  // Sondes serveur (aucun écran n'envoie ces quantités) : excès, négatif, nul.
  for(const t of tries){
   await probe(actor.page,'receive_'+t.kind.toLowerCase(),'/api/scans/hub/receive',{contents:[{purchase_order_id:PO,product_sku_id:b.product_sku_id,
    evidence_method:'MANUAL',evidence_ref:PROOF,quantity:Number(t.typed)}],tracking_ref:'SIM-STAGING-N14-'+REF});
  }
  reach('API_PROBES_DONE');
  // Rien d'accepté avant la réception exacte : sinon défaut produit, sans poursuivre.
  if(report.gaps.length)throw Error('G6_N14_PRODUCT_GAP_'+report.gaps.join('_'));
  const mid=await line();
  check(mid.received===0&&mid.po_status==='confirmed','G6_N14_PRODUCT_GAP_UNIT_CREATED_BY_INVALID_QUANTITY');
  // Clôture par l'écran : réception exacte (quantité commandée) puis PO soldée.
  permit=ordered;
  await humanFill(null,input,String(ordered));
  check(await button.isEnabled(),'G6_N14_SCREEN_MISSING_EXACT_RECEIPT_DISABLED');
  const pending=actor.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/scans/hub/receive'&&r.request().method()==='POST',{timeout:30000});
  await humanClick(null,button);
  const res=await pending;
  report.attempts.push({kind:'EXACT',typed:String(ordered),http:res.status()});
  check(res.status()===200||res.status()===201,'G6_N14_PRODUCT_GAP_EXACT_RECEIPT_HTTP_'+res.status());
  reach('EXACT_RECEIPT_RECORDED');
  check(actor.blocked.length===0,'G6_N14_UNEXPECTED_RECEIVE_REQUEST_BLOCKED');
 }finally{await actor.ctx.close()}
}
async function main(){
 let browser;
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
   Object.hasOwn(PHASES,SCEN)&&env.G6_CANONICAL_PHASE===PHASES[SCEN]&&env.G6_DYNAMIC_FRESH_ORDER==='1'&&
   env.G6_TARGET_MARKET===MK.code&&/^[a-f0-9-]{36}$/i.test(ID||'')&&/^[a-f0-9-]{36}$/i.test(PO||''),'G6_'+SCEN+'_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_'+SCEN+'_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  if(SCEN==='N13')await runN13(browser);else await runN14(browser);
  await runtime();
  if(report.gaps.length)throw Error('G6_'+SCEN+'_PRODUCT_GAP_'+report.gaps.join('_'));
  report.verdict=SCEN==='N13'?'G6_N13_SUPPLIER_BACKORDER_REMNANT_RECORDED_CHROMIUM_PASS':'G6_N14_RECEIVING_QTY_REFUSED_EXACT_RECEIPT_CHROMIUM_PASS';save();
 }catch(e){report.error=fullError(e);if(report.gaps.length)report.verdict='PRODUCT_GAP';save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end().catch(()=>{});console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
