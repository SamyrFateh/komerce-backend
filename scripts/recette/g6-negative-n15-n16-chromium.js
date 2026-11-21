/** @komerce-arch-lite
 * @role g6-negative-n15-n16-chromium
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose N15 (sac ou KOM-BOX incomplet) et N16 (remise d'un carton non DISPATCHED, composition figée après remise), staging only : gestes Hub par l'écran, sondes API signalées, aucune écriture SQL.
 * @db-read orders, hub_physical_units, hub_physical_unit_placements, hub_box_bags, hub_box_effective_placements, hub_custody_events, international_shipments, international_shipment_hub_units, parcels, parcel_items
 * @db-write none
 * @impact-areas staging-only, hub, logistics
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {runtime}=require('./g6-hub-shipment-chromium');
const {login}=require('./g6-hub-commitment-chromium');
const {snapN16}=require('./canonical/negative-scenarios');
const {observe,fullError}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill,humanSelect,humanCheck}=require('./canonical/actors/human-gestures');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const SCEN=env.G6_CANONICAL_SCENARIO,ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE;
const PHASES={N15:'N15_BAG_BOX_INCOMPLETE',N16:'N16_BOX_NOT_DISPATCHED_FROZEN'};
const API='/api/admin/workspaces/operations/market/'+MK.code;
const BOX15='KOM-BOX-SIM-STAGING-N15-'+REF,SHIP15='SIM-STAGING-EXP-N15-'+REF;
const BOX16='KOM-BOX-SIM-STAGING-'+REF,SHIP16='SIM-STAGING-EXP-'+REF;
const FORWARDER='SIMULATED-STAGING-TRANSITAIRE-'+REF,HANDOVER_PROOF='[SIMULATED / STAGING ONLY] G6-N16-REMISE-TRANSITAIRE-'+REF;
const OUT=path.resolve('test-results/g6-negative-n15-n16');
let OBS=null;
const report={schema:'komerce-g6-negative-n15-n16/1',scenario_id:SCEN,market:MK.code,reference:REF,order_id:ID,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],screen:[],probes:[],attempts:[],gaps:[],ux_signal:null,
 external_supplier_calls:0,external_payment_executed:false,production_permitted:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const reach=k=>{report.steps_reached.push(k);save()};
const check=(ok,code)=>{if(!ok)throw Error(code)};
const is2xx=h=>h>=200&&h<300;
async function openDetails(page,selector){
 await humanGoto(page,'/admin/hub-live?view=execute&market='+MK.code+'',{waitUntil:'domcontentloaded'});
 const tab=page.getByRole('tab',{name:'Dossiers'});
 await tab.waitFor({state:'visible',timeout:25000});
 await humanClick(null,tab);
 const details=page.locator('[data-hub-physical-details]');
 await details.waitFor({state:'attached',timeout:25000});
 if(!await details.evaluate(x=>x.open))await humanClick(null,details.locator('summary').first());
 const section=page.locator(selector);
 await section.waitFor({state:'visible',timeout:25000});
 return section;
}
const boxRow=(section,page,ref)=>section.locator('tr').filter({has:page.getByText(ref,{exact:true})});
// Un geste d'écran = une requête POST permise (charge utile vérifiée), jamais de nouvel essai. Bouton absent ou inactif : refus d'écran, rien d'envoyé.
async function act(actor,endpoint,button,validate){
 let permitted=0;const guard=[];
 const url=BASE+endpoint;
 const handler=async route=>{
  const req=route.request();
  if(req.method()!=='POST')return route.fallback();
  let b;try{b=req.postDataJSON()}catch(_){b=null}
  if(permitted===0&&validate(b,req)){permitted++;return route.continue()}
  actor.blocked.push({method:req.method(),path:new URL(req.url()).pathname});
  guard.push({path:new URL(req.url()).pathname,body_keys:b&&typeof b==='object'?Object.keys(b).slice(0,12):null});
  return route.abort('blockedbyclient');
 };
 await actor.page.route(url,handler);
 try{
  if(!await button.count())return {present:false,enabled:false,http:null};
  if(!await button.first().isEnabled())return {present:true,enabled:false,http:null};
  // Le verdict ne dépend jamais d'une réponse qui n'arrive pas : réponse, requête avortée par notre garde, ou silence (écran qui refuse en amont).
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
 if(is2xx(row.http))report.gaps.push('ACCEPTED_'+kind.toUpperCase());
 return row;
}
const unitByRef=async ref=>(await db.query('SELECT id,reference,state::text AS state FROM hub_physical_units WHERE reference=$1',[ref])).rows;
async function runN15(browser){
 report.box_ref=BOX15;report.shipment_ref=SHIP15;save();
 const {rows:[o]}=await db.query(`SELECT o.payment_status::text AS payment_status,o.simulation_scope,
   (SELECT count(*)::int FROM hub_physical_units u WHERE u.order_id=o.id AND u.unit_type='HANDLING_UNIT') AS bags,
   (SELECT COALESCE(SUM(p.quantity),0)::int FROM hub_physical_unit_placements p JOIN hub_purchase_allocations a ON a.id=p.allocation_id
     WHERE a.order_id=o.id AND p.operation_type='RECEIVE' AND p.removed_at IS NULL) AS received FROM orders o WHERE o.id=$1 AND o.reference=$2`,[ID,REF]);
 check(o&&o.simulation_scope==='G6-BUYER'&&o.payment_status==='paid'&&o.bags===0&&o.received>0,'G6_N15_PRECONDITION_RECEIVED_NOT_BAGGED');
 const actor=await login(browser,'E2E_AGENT_HUB_',{readOnly:true});
 try{
  // 1. Sac créé par l'écran (geste légitime) : plan complet, aucune unité déposée.
  let prep=await openDetails(actor.page,'[data-hub-bag-preparation]');
  const select=prep.getByRole('combobox',{name:'Commande dont préparer le sac'});
  await select.waitFor({state:'visible',timeout:20000});
  const choices=await select.locator('option').evaluateAll(xs=>xs.map(x=>({value:x.value,text:x.textContent})));
  const exact=choices.filter(c=>c.text.startsWith(REF+' · '));
  check(exact.length===1,'G6_N15_SCREEN_MISSING_ORDER_NOT_OFFERED_FOR_BAG');
  await humanSelect(null,select,exact[0].value);
  const created=await act(actor,API+'/bags',prep.locator('[data-workspace-action="create-customer-bag"]'),b=>b?.order_id===ID);
  check(created.enabled&&is2xx(created.http),'G6_N15_SCREEN_MISSING_BAG_CREATION_'+created.http);
  reach('BAG_CREATED');
  const {rows:[bag]}=await db.query("SELECT id,reference FROM hub_physical_units WHERE order_id=$1 AND unit_type='HANDLING_UNIT'",[ID]);
  check(!!bag,'G6_N15_PRODUCT_GAP_BAG_NOT_CREATED');
  // 2. Fermeture du sac incomplet : bouton attendu absent (0 / N déposée) ; sinon on le tente.
  prep=await openDetails(actor.page,'[data-hub-bag-preparation]');
  const holder=prep.locator('.kmc-hub-bag-open').filter({hasText:bag.reference+' · '+REF});
  await holder.waitFor({state:'visible',timeout:25000});
  const text=(await holder.innerText()).replace(/\s+/g,' ').slice(0,200);
  const close=holder.locator('[data-workspace-action="close-customer-bag"]');
  const r=await act(actor,API+'/bags/'+bag.id+'/close',close,b=>b&&Object.keys(b).length===0);
  report.attempts.push({kind:'BAG_CLOSE_SCREEN',http:r.http,ui_blocked:!r.present||!r.enabled,message:text,message_visible:/\b0 \/ \d+/.test(text)});
  if(is2xx(r.http))report.gaps.push('BAG_CLOSED_INCOMPLETE_BY_SCREEN');
  if((!r.present||r.no_request)&&!/\b0 \/ \d+/.test(text))report.ux_signal='FERMETURE_SAC_ABSENTE_SANS_MOTIF_AFFICHE';
  reach('BAG_CLOSE_TRIED');
  await probe(actor.page,'bag_close',API+'/bags/'+bag.id+'/close',{});
  // 3. KOM-BOX vide créée par l'écran ; le sac incomplet ne peut ni y entrer ni la remplir.
  let section=await openDetails(actor.page,'[data-supply-boxes]');
  await humanFill(null,section.getByRole('textbox',{name:'Référence de la nouvelle KOM-BOX'}),BOX15);
  const cb=await act(actor,API+'/boxes',section.locator('[data-workspace-action="create-box"]'),(b,req)=>b?.reference===BOX15&&Object.keys(b).length===1&&!!req.headers()['idempotency-key']);
  check(cb.enabled&&is2xx(cb.http),'G6_N15_SCREEN_MISSING_BOX_CREATION_'+cb.http);
  reach('EMPTY_BOX_CREATED');
  const box=(await unitByRef(BOX15))[0];
  check(!!box,'G6_N15_PRODUCT_GAP_BOX_NOT_CREATED');
  section=await openDetails(actor.page,'[data-supply-boxes]');
  const row=boxRow(section,actor.page,BOX15);
  await row.waitFor({state:'visible',timeout:25000});
  report.screen.push({kind:'BOX_ROW',bag_scan_field_present:await row.locator('[data-hub-bag-scan]').count()>0});
  await probe(actor.page,'bag_into_box',API+'/boxes/'+box.id+'/bags',{bag_unit_id:bag.id,bag_reference_scan:bag.reference,box_reference_scan:BOX15,
   evidence_method:'MANUAL',evidence_ref:'[SIMULATED / STAGING ONLY] G6-N15-ATTACH-'+REF});
  // 4. Départ non conforme : expédition créée avec ce carton incomplet.
  await humanFill(null,section.getByRole('textbox',{name:'Référence de la nouvelle expédition'}),SHIP15);
  const pick=row.getByRole('checkbox',{name:'Inclure '+BOX15});
  const pickable=await pick.count()>0&&await pick.isEnabled();
  if(pickable)await humanCheck(null,pick);
  const ship=await act(actor,API+'/boxes/shipment',section.locator('[data-workspace-action="create-shipment-from-boxes"]'),b=>b?.reference===SHIP15&&Array.isArray(b.hub_unit_ids)&&(pickable?b.hub_unit_ids.length===1&&b.hub_unit_ids[0]===box.id:b.hub_unit_ids.length===0));
  // Carton non sélectionnable : l'écran laisse quand même cliquer « Créer l'expédition » et envoie une sélection vide
  // (run 44881374826) ; c'est le geste humain réel, on le laisse partir et on juge la réponse du serveur.
  report.attempts.push({kind:'SHIPMENT_WITH_INCOMPLETE_BOX_SCREEN',http:ship.http,ui_blocked:!pickable||!ship.enabled,box_selectable:pickable,empty_selection_sent:!pickable&&ship.http!=null});
  if(!pickable&&ship.http!=null&&ship.enabled)report.ux_signal=(report.ux_signal?report.ux_signal+';':'')+'SHIPMENT_BUTTON_ENABLED_WITHOUT_SELECTION';
  if(is2xx(ship.http)){
   if(pickable)report.gaps.push('SHIPMENT_CREATED_WITH_INCOMPLETE_BOX');
   else{
    const {rows:[draft]}=await db.query(`SELECT s.stage::text AS stage,s.hub_draft,s.forwarder_name,s.transport_mode,
      (SELECT count(*)::int FROM international_shipment_hub_units h WHERE h.shipment_id=s.id) AS links
      FROM international_shipments s WHERE s.reference=$1`,[SHIP15]);
    report.attempts[report.attempts.length-1].empty_draft=draft||null;
    if(!draft||draft.stage!=='hub_ready'||draft.hub_draft!==true||draft.forwarder_name!==null||draft.transport_mode!==null||draft.links!==0)
     report.gaps.push('EMPTY_SELECTION_CREATED_NON_DRAFT_SHIPMENT');
    else report.ux_signal=(report.ux_signal?report.ux_signal+';':'')+'EMPTY_HUB_DRAFT_OPENED_WITHOUT_BOX';
   }
  }
  await probe(actor.page,'shipment_incomplete_box',API+'/boxes/shipment',{reference:SHIP15+'-P',hub_unit_ids:[box.id]});
  reach('DEPARTURE_TRIED');
  // 5. Fermeture de la KOM-BOX vide : on avance par l'écran tant que le serveur accepte (au plus 6 états).
  for(let i=0;i<6&&!report.gaps.length;i++){
   section=await openDetails(actor.page,'[data-supply-boxes]');
   const next=boxRow(section,actor.page,BOX15).locator('[data-workspace-action="advance-box"]');
   const label=await next.count()?((await next.first().textContent())||'').trim().slice(0,60):null;
   const a=await act(actor,API+'/boxes/'+box.id+'/advance',next,b=>!!b?.to_state&&Object.keys(b).length===1);
   report.attempts.push({kind:'BOX_ADVANCE_EMPTY',step:i,label,http:a.http,ui_blocked:!a.present||!a.enabled});
   if(!is2xx(a.http))break;
  }
  const after=(await unitByRef(BOX15))[0];
  if(after&&['PACKED','DISPATCHED'].includes(after.state))report.gaps.push('EMPTY_BOX_CLOSED_'+after.state);
  reach('BOX_CLOSE_TRIED');
  check(actor.blocked.length===0,'G6_N15_UNEXPECTED_BROWSER_WRITE');
 }finally{await actor.ctx.close()}
}
async function transportTask(page){
 await humanGoto(page,'/admin/workspaces/shipping-customs?market='+MK.code+'',{waitUntil:'domcontentloaded'});
 await page.locator('[data-international-journey]').first().waitFor({state:'visible',timeout:25000});
 await humanClick(null,page.locator('.kmc-journey-tab').filter({hasText:'Transport & fret'}));
 const row=page.locator('tr').filter({has:page.getByText(SHIP16,{exact:true})});
 await row.waitFor({state:'visible',timeout:25000});
 const open=row.getByRole('button',{name:'Consulter',exact:true});
 if(await open.count())await humanClick(null,open);
 const task=page.locator('details.kmc-journey-task').filter({has:page.locator('summary',{hasText:'Confirmer : Remis au transitaire'})});
 await task.waitFor({state:'visible',timeout:25000});
 await task.locator('button[type="submit"]').waitFor({state:'visible',timeout:25000});
 return task;
}
async function handover(actor){
 const task=await transportTask(actor.page);
 await humanFill(null,task.locator('[name="forwarder_name"]'),FORWARDER);
 await humanSelect(null,task.locator('[name="transport_mode"]'),'sea');
 await humanFill(null,task.locator('[name="proof_ref"]'),HANDOVER_PROOF);
 return act(actor,'/api/admin/workspaces/shipping-customs/market/'+MK.code+'/international/'+SHIP16+'/transition',task.locator('button[type="submit"]'),
  b=>b?.to_stage==='handed_over'&&b.forwarder_name===FORWARDER&&b.transport_mode==='sea'&&b.proof_ref===HANDOVER_PROOF&&Object.keys(b).length===4);
}
async function runN16(browser){
 report.box_ref=BOX16;report.shipment_ref=SHIP16;save();
 const box=(await unitByRef(BOX16))[0];
 check(box&&box.state==='PACKED','G6_N16_PRECONDITION_BOX_NOT_PACKED');
 const {rows:[l]}=await db.query(`SELECT l.bag_unit_id,l.parcel_id,u.reference AS bag_ref FROM hub_box_bags l JOIN hub_physical_units u ON u.id=l.bag_unit_id WHERE l.box_unit_id=$1`,[box.id]);
 check(!!l,'G6_N16_PRECONDITION_BOX_WITHOUT_BAG');
 const {rows:[pre]}=await db.query('SELECT count(*)::int AS n FROM international_shipments WHERE reference=$1',[SHIP16]);
 check(pre.n===0,'G6_N16_PRECONDITION_SHIPMENT_EXISTS');
 const S={orderId:ID,boxRef:BOX16,shipmentRef:SHIP16};
 const actor=await login(browser,'E2E_AGENT_HUB_',{readOnly:true});
 try{
  // 1. Dossier d'expédition ouvert par l'écran avec le carton PACKED (geste légitime).
  let section=await openDetails(actor.page,'[data-supply-boxes]');
  let row=boxRow(section,actor.page,BOX16);
  await row.waitFor({state:'visible',timeout:25000});
  await humanFill(null,section.getByRole('textbox',{name:'Référence de la nouvelle expédition'}),SHIP16);
  await humanCheck(null,row.getByRole('checkbox',{name:'Inclure '+BOX16}));
  const open=await act(actor,API+'/boxes/shipment',section.locator('[data-workspace-action="create-shipment-from-boxes"]'),b=>b?.reference===SHIP16&&b.hub_unit_ids?.length===1&&b.hub_unit_ids[0]===box.id);
  check(open.enabled&&is2xx(open.http),'G6_N16_SCREEN_MISSING_SHIPMENT_OPENING_'+open.http);
  reach('SHIPMENT_OPENED');
  // 2. Remise au transitaire tentée alors que le carton n'est que PACKED : refus attendu.
  const early=await handover(actor);
  report.attempts.push({kind:'HANDOVER_BOX_NOT_DISPATCHED',http:early.http,code:early.code||null,ui_blocked:!early.present||!early.enabled});
  if(is2xx(early.http))report.gaps.push('HANDOVER_ACCEPTED_BOX_NOT_DISPATCHED');
  const s1=await snapN16(db,S);
  check(s1.box_state==='PACKED'&&s1.shipment_stage==='hub_ready'&&!s1.forwarder&&s1.parcel_shipped===0,'G6_N16_PRODUCT_GAP_HANDOVER_EFFECT_WITH_NON_DISPATCHED_BOX');
  reach('EARLY_HANDOVER_REFUSED');
  if(report.gaps.length)return;
  // 3. Carton DISPATCHED puis remis au transitaire, par l'écran (gestes légitimes).
  section=await openDetails(actor.page,'[data-supply-boxes]');
  const adv=await act(actor,API+'/boxes/'+box.id+'/advance',boxRow(section,actor.page,BOX16).locator('[data-workspace-action="advance-box"]'),b=>b?.to_state==='DISPATCHED'&&Object.keys(b).length===1);
  check(adv.enabled&&is2xx(adv.http),'G6_N16_SCREEN_MISSING_DISPATCH_'+adv.http);
  reach('BOX_DISPATCHED');
  const done=await handover(actor);
  check(done.enabled&&is2xx(done.http),'G6_N16_SCREEN_MISSING_LEGIT_HANDOVER_'+done.http);
  reach('HANDED_OVER');
  const baseline=await snapN16(db,S);
  check(baseline.box_state==='DISPATCHED'&&baseline.shipment_stage==='handed_over'&&baseline.links===1&&baseline.effective>=1&&baseline.shipment_links===1,'G6_N16_PRODUCT_GAP_LEGIT_HANDOVER_STATE');
  report.baseline=baseline;save();
  // 4. Modifications après remise : l'écran n'offre plus le retrait ni le rattachement ; sondes serveur ensuite.
  section=await openDetails(actor.page,'[data-supply-boxes]');
  row=boxRow(section,actor.page,BOX16);
  await row.waitFor({state:'visible',timeout:25000});
  const surveyed={detach_present:await row.locator('[data-workspace-action="detach-box-shipment"]').count()>0,
   put_bag_present:await row.locator('[data-workspace-action="put-bag-in-box"]').count()>0,
   advance_present:await row.locator('[data-workspace-action="advance-box"]').count()>0};
  report.screen.push({kind:'BOX_AFTER_HANDOVER',...surveyed});
  if(surveyed.detach_present)report.gaps.push('DETACH_OFFERED_AFTER_HANDOVER');
  if(!Object.values(surveyed).some(Boolean))report.ux_signal='CARTON_REMIS_SANS_MOTIF_DE_VERROUILLAGE_AFFICHE';
  await probe(actor.page,'detach_after_handover',API+'/boxes/'+box.id+'/detach',{});
  await probe(actor.page,'bag_into_box_after_handover',API+'/boxes/'+box.id+'/bags',{bag_unit_id:l.bag_unit_id,parcel_id:l.parcel_id,bag_reference_scan:l.bag_ref,
   box_reference_scan:BOX16,evidence_method:'MANUAL',evidence_ref:'[SIMULATED / STAGING ONLY] G6-N16-MODIF-'+REF});
  await probe(actor.page,'box_state_back',API+'/boxes/'+box.id+'/advance',{to_state:'PACKED'});
  reach('MODIFICATIONS_TRIED');
  check(actor.blocked.length===0,'G6_N16_UNEXPECTED_BROWSER_WRITE');
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
   env.G6_TARGET_MARKET===MK.code&&/^[a-f0-9-]{36}$/i.test(ID||''),'G6_'+SCEN+'_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_'+SCEN+'_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  if(SCEN==='N15')await runN15(browser);else await runN16(browser);
  await runtime();
  if(report.gaps.length)throw Error('G6_'+SCEN+'_PRODUCT_GAP_'+report.gaps.join('_'));
  report.verdict=SCEN==='N15'?'G6_N15_BAG_BOX_INCOMPLETE_REFUSED_CHROMIUM_PASS':'G6_N16_BOX_NOT_DISPATCHED_FROZEN_REFUSED_CHROMIUM_PASS';save();
 }catch(e){report.error=fullError(e);if(report.gaps.length)report.verdict='PRODUCT_GAP';save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end().catch(()=>{});console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
