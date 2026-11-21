/** @komerce-arch-lite
 * @role g6-negative-n11-n12-chromium
 * @domain purchasing
 * @layer script
 * @owner backend-core
 * @purpose N11 (PO sans validation d'engagement) et N12 (paiement fournisseur sans deuxième autorisation), staging only : gestes Hub par l'écran, sondes API signalées, aucune écriture SQL.
 * @db-read purchase_orders, purchase_lines, purchase_order_authorizations, orders, order_items
 * @db-write none
 * @impact-areas staging-only, purchasing
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
const {humanClick}=require('./canonical/actors/human-gestures');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const SCEN=env.G6_CANONICAL_SCENARIO,ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE,PO=env.G6_CANONICAL_PO_ID;
const PHASES={N11:'N11_PO_NO_COMMITMENT_ATTEMPT',N12:'N12_PAYMENT_SINGLE_VALIDATOR'};
const OUT=path.resolve('test-results/g6-negative-n11-n12');
let OBS=null;
const report={schema:'komerce-g6-negative-n11-n12/1',scenario_id:SCEN,market:MK.code,reference:REF,order_id:ID,po_id:PO,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],screen:[],probes:[],attempts:[],gaps:[],ux_signal:null,
 external_supplier_calls:0,external_payment_executed:false,production_permitted:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const reach=k=>{report.steps_reached.push(k);save()};
const check=(ok,code)=>{if(!ok)throw Error(code)};
async function state(){
 const {rows}=await db.query(`SELECT po.status::text AS po_status,po.sent_at,po.trigger_mode,o.payment_status::text AS payment_status,o.simulation_scope,
   (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='purchase_commitment') AS commitments,
   (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='supplier_payment') AS payments
   FROM purchase_orders po JOIN purchase_lines pl ON pl.purchase_order_id=po.id AND pl.cancelled_at IS NULL
   JOIN order_items oi ON oi.id=pl.order_item_id JOIN orders o ON o.id=oi.order_id
   WHERE po.id=$1 AND o.id=$2 AND o.reference=$3 GROUP BY po.id,po.status,po.sent_at,po.trigger_mode,o.payment_status,o.simulation_scope`,[PO,ID,REF]);
 check(rows.length===1,'G6_'+SCEN+'_PRECONDITION_PO_NOT_UNIQUE');
 return rows[0];
}
// Etat d'une action du cockpit : présente, activée, motif affiché (title). Aucun clic.
async function surveyAction(page,action){
 const l=page.locator('[data-hlc-action="'+action+'"]');
 const n=await l.count();
 const row={action,present:n>0,enabled:false,reason:null};
 if(n>0){row.enabled=await l.first().isEnabled();row.reason=(await l.first().getAttribute('title'))||null}
 return row;
}
// Aucun écran n'offre ce geste au rôle testé : sonde API authentifiée même origine, signalée comme telle (précédent N29).
async function probe(page,kind,tail,data){
 const res=await page.request.post(BASE+'/api/purchasing/po/'+PO+'/'+tail,{headers:{origin:BASE},data}).catch(()=>null);
 const j=res?await res.json().catch(()=>({})):{};
 const code=j.code||j.error?.code||null;
 const row={kind,via:'API_PROBE_NO_SCREEN_GESTURE',http:res?res.status():null,code:code&&String(code).slice(0,80)};
 report.probes.push(row);save();
 check(!/^csrf_/.test(row.code||''),'G6_'+SCEN+'_SCREEN_MISSING_PROBE_'+row.code);
 check(row.http!==null,'G6_'+SCEN+'_SCREEN_MISSING_NO_RESPONSE_'+kind);
 if(row.http>=200&&row.http<300)report.gaps.push('ACCEPTED_'+kind.toUpperCase());
 return row;
}
async function runN11(browser){
 const before=await state();
 check(before.po_status==='draft'&&before.commitments===0&&before.payments===0&&!before.sent_at&&before.payment_status==='paid'&&
  before.simulation_scope==='G6-BUYER'&&before.trigger_mode!=='auto','G6_N11_PRECONDITION_PO_NOT_DRAFT_WITHOUT_COMMITMENT');
 const actor=await login(browser,'E2E_AGENT_HUB_',{allowedWrites:['submit']});
 try{
  await openPo(actor.page);reach('PO_OPEN_ON_HUB_SCREEN');
  for(const a of ['submit-po','authorize-commitment','record-sent','confirm-po','receive'])report.screen.push(await surveyAction(actor.page,a));
  const submit=report.screen.find(x=>x.action==='submit-po'),commit=report.screen.find(x=>x.action==='authorize-commitment');
  if(submit.present&&submit.enabled){
   // L'écran offre la soumission sans engagement : on la tente, le serveur doit refuser.
   const resp=actor.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/purchasing/po/'+PO+'/submit'&&r.request().method()==='POST',{timeout:30000});
   await humanClick(null,actor.page.locator('[data-hlc-action="submit-po"]'));
   const res=await resp;report.attempts.push({kind:'SCREEN_SUBMIT',http:res.status()});
   if(res.status()<400)report.gaps.push('SCREEN_SUBMIT_ACCEPTED');
  }else{
   report.attempts.push({kind:'SCREEN_SUBMIT',http:null,ui_blocked:true,button_present:submit.present});
   // Refus muet par l'écran : signal d'ergonomie quand aucun motif n'est affiché sur l'action d'engagement.
   if(!(commit.present&&!commit.enabled&&commit.reason))report.ux_signal='SOUMISSION_ABSENTE_SANS_MOTIF_AFFICHE';
  }
  reach('SCREEN_SUBMIT_TRIED');
  await probe(actor.page,'submit','submit');
  await probe(actor.page,'sent','sent',{channel:'other'});
  const {rows:[l]}=await db.query('SELECT id FROM purchase_lines WHERE purchase_order_id=$1 AND cancelled_at IS NULL',[PO]);
  await probe(actor.page,'confirm','confirm',{lines:[{purchase_line_id:l.id,confirmed_quantity:1}]});
  reach('API_PROBES_DONE');
  check(actor.blocked.length===0,'G6_N11_UNEXPECTED_BROWSER_WRITE');
 }finally{await actor.ctx.close()}
}
async function runN12(browser){
 const before=await state();
 check(before.po_status==='confirmed'&&before.commitments===1&&before.payments===0&&before.payment_status==='paid'&&
  before.simulation_scope==='G6-BUYER','G6_N12_PRECONDITION_PO_NOT_CONFIRMED_WITH_SINGLE_COMMITMENT');
 const {rows:[c]}=await db.query("SELECT proof_ref,amount::text AS amount,currency FROM purchase_order_authorizations WHERE purchase_order_id=$1 AND authorization_type='purchase_commitment'",[PO]);
 report.commitment_proof=c.proof_ref;
 const body={proof_ref:'G6-N12-SINGLE-VALIDATOR-'+REF,amount:Number(c.amount),currency:c.currency};
 // Agent Hub sans la délégation de paiement : écran puis sonde.
 const actor=await login(browser,'E2E_AGENT_HUB_',{allowedWrites:['authorize-payment']});
 try{
  await openPo(actor.page);reach('PO_OPEN_AS_ORDINARY_AGENT');
  const pay=await surveyAction(actor.page,'authorize-payment');report.screen.push(pay);
  check(!(pay.present&&pay.enabled),'PREREQ_N12_AGENT_HOLDS_PAYMENT_GRANT');
  report.attempts.push({kind:'AGENT_SCREEN_PAYMENT',http:null,ui_blocked:true,button_present:pay.present});
  if(!(pay.present&&pay.reason))report.ux_signal='PAIEMENT_BLOQUE_SANS_MOTIF_AFFICHE';
  const p=await probe(actor.page,'agent_payment','authorize-payment',body);
  if(![401,403,409].includes(p.http)&&!report.gaps.includes('ACCEPTED_AGENT_PAYMENT'))report.gaps.push('AGENT_PAYMENT_HTTP_'+p.http);
  reach('AGENT_PAYMENT_REFUSED');
  check(actor.blocked.length===0,'G6_N12_UNEXPECTED_BROWSER_WRITE');
 }finally{await actor.ctx.close()}
 // Directrice porteuse de l'engagement : si elle ne détient pas aussi la délégation de paiement, elle ne peut pas être le second validateur.
 const director=await login(browser,'E2E_HUB_DIRECTOR_',{readOnly:true});
 try{
  const g=await director.page.request.get('/api/hub/administration');
  check(g.status()===200,'G6_N12_SCREEN_MISSING_DIRECTOR_GRANTS_HTTP_'+g.status());
  const grants=(await g.json()).viewer_grants||{};
  report.director={has_commitment_grant:grants.purchase_commitment===true,has_payment_grant:grants.supplier_payment===true};
  await openPo(director.page);
  const pay=await surveyAction(director.page,'authorize-payment');report.director.payment_action=pay;
  if(report.director.has_payment_grant){
   // Détenir les deux délégations rend le paiement légitime : on ne le tente pas, on le signale.
   report.director.not_tested='DIRECTOR_HOLDS_BOTH_GRANTS';
  }else{
   check(!(pay.present&&pay.enabled),'G6_N12_PRODUCT_GAP_PAYMENT_ENABLED_WITHOUT_GRANT');
   const p=await probe(director.page,'director_payment','authorize-payment',{...body,proof_ref:body.proof_ref+'-D'});
   if(![401,403,409].includes(p.http)&&!report.gaps.includes('ACCEPTED_DIRECTOR_PAYMENT'))report.gaps.push('DIRECTOR_PAYMENT_HTTP_'+p.http);
  }
  reach('DIRECTOR_SECOND_VALIDATION_CHECKED');
  check(director.blocked.length===0,'G6_N12_UNEXPECTED_DIRECTOR_BROWSER_WRITE');
 }finally{await director.ctx.close()}
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
  if(SCEN==='N11')await runN11(browser);else await runN12(browser);
  await runtime();
  const after=await state();
  report.after={po_status:after.po_status,commitments:after.commitments,payment_authorizations:after.payments};
  if(report.gaps.length)throw Error('G6_'+SCEN+'_PRODUCT_GAP_'+report.gaps.join('_'));
  report.verdict=SCEN==='N11'?'G6_N11_PO_NO_COMMITMENT_REFUSED_CHROMIUM_PASS':'G6_N12_PAYMENT_SINGLE_VALIDATOR_REFUSED_CHROMIUM_PASS';save();
 }catch(e){report.error=fullError(e);if(report.gaps.length)report.verdict='PRODUCT_GAP';save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end().catch(()=>{});console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main,surveyAction};
