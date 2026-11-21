/** @komerce-arch-lite
 * @role g6-negative-n37-n38-chromium
 * @domain documents
 * @layer script
 * @owner backend-core
 * @purpose N37 (staging only) : accès aux documents de la commande refusé hors propriétaire (O-SEC-DOC) ; N38 : reprise documentaire en dry run par l'admin (aucune émission). Aucune écriture SQL.
 * @db-read orders, users, invoices, transaction_documents, scans
 * @db-write none
 * @impact-areas staging-only, documents, security
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {verifyMarkedG6Buyer}=require('../../services/g6-staging-buyer-identity-guard');
const {runtime}=require('./g6-hub-shipment-chromium');
const {login}=require('./g6-canonical-forwarder-chromium');
const {customer}=require('./g6-canonical-client-pickup-chromium');
const {observe,fullError}=require('./canonical/observability');
const {check}=require('./g6-negative-n23-n24-chromium');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE,SCEN=env.G6_CANONICAL_SCENARIO;
const PHASE={N37:'N37_DOCUMENT_ACCESS',N38:'N38_RESUME_DRY_RUN'}[SCEN];
const OUT=path.resolve('test-results/g6-negative-n37-n38');
let OBS=null;
const report={schema:'komerce-g6-negative-n37-n38/1',scenario_id:SCEN,market:MK.code,reference:REF,order_id:ID,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],access:null,dry_run:null,gaps:[],page_events:[],
 external_supplier_calls:0,external_payment_executed:false,plaintext_pickup_code_logged:false,production_permitted:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const reach=k=>{report.steps_reached.push(k);save()};
const LIST='/api/auth/me/documents?order_reference='+encodeURIComponent(REF||''),DL=id=>'/api/auth/me/documents/'+id+'/download';
async function download(page,id){
 const r=await page.request.get(DL(id)).catch(()=>null);
 if(!r)return {http:null,pdf:false};
 const b=r.status()===200?await r.body().catch(()=>Buffer.alloc(0)):Buffer.alloc(0);
 return {http:r.status(),pdf:b.subarray(0,4).toString()==='%PDF'};
}
async function runN37(o,buyer,browser){
 const c=await customer(browser,buyer);
 let other=null;
 try{
  reach('OWNER_SESSION');
  const l=await c.page.request.get(LIST).catch(()=>null);
  const docs=l&&l.status()===200?(await l.json().catch(()=>({}))).documents||[]:[];
  const byType=t=>docs.filter(d=>d.document_type===t);
  report.access={owner:{list_http:l?l.status():null,documents:docs.map(d=>({type:d.document_type,status:d.status})),downloads:[]},foreign:[],anonymous:[]};
  if(!l||l.status()!==200)throw Error('G6_N37_SCREEN_MISSING_OWNER_DOCUMENT_LIST');
  if(byType('invoice').length!==1)report.gaps.push('OWNER_INVOICE_COUNT_'+byType('invoice').length);
  if(byType('pickup_proof').length!==1)report.gaps.push('OWNER_PICKUP_PROOF_COUNT_'+byType('pickup_proof').length);
  for(const d of docs){
   const r=await download(c.page,d.id);report.access.owner.downloads.push({type:d.document_type,...r});
   if(r.http!==200||!r.pdf)report.gaps.push('OWNER_DOWNLOAD_'+d.document_type+'_HTTP_'+r.http);
  }
  reach('OWNER_DOWNLOADS');
  // Hors propriétaire : agent relais authentifié (autre compte, autre rôle) puis requête anonyme (O-SEC-DOC).
  other=await login(browser,'E2E_AGENT_RELAIS_','agent_relais');
  const ol=await other.page.request.get(LIST).catch(()=>null);
  const oj=ol&&ol.status()===200?await ol.json().catch(()=>({})):{};
  report.access.foreign.push({gesture:'list',http:ol?ol.status():null,count:(oj.documents||[]).length});
  if((oj.documents||[]).length)report.gaps.push('FOREIGN_LIST_DISCLOSES_DOCUMENTS');
  for(const d of docs){
   const r=await download(other.page,d.id);report.access.foreign.push({gesture:'download',type:d.document_type,...r});
   if(r.http===200||r.pdf)report.gaps.push('FOREIGN_DOWNLOAD_ACCEPTED_'+d.document_type);
   else if(r.http===null||r.http>=500)report.gaps.push('FOREIGN_DOWNLOAD_HTTP_'+r.http);
   const a=await fetch(BASE+DL(d.id)).catch(()=>null);
   report.access.anonymous.push({type:d.document_type,http:a?a.status:null});
   if(!a||![401,403].includes(a.status))report.gaps.push('ANONYMOUS_DOWNLOAD_HTTP_'+(a?a.status:null)+'_'+d.document_type);
  }
  reach('FOREIGN_AND_ANONYMOUS_REFUSED');
 }finally{if(other)await other.ctx.close().catch(()=>{});c.code=null;await c.ctx.close().catch(()=>{})}
}
async function runN38(){
 const admin=await login(browser0,'E2E_ADMIN_','admin');
 try{
  reach('ADMIN_SESSION');
  const r=await admin.page.request.post(BASE+'/api/admin/documents/reconcile',{headers:{origin:BASE},data:{dry_run:true,limit:200}}).catch(()=>null);
  const j=r?await r.json().catch(()=>({})):{};
  if(/^csrf_/.test(j.code||''))throw Error('G6_N38_SCREEN_MISSING_PROBE_'+j.code);
  if(!r||r.status()!==200)throw Error('G6_N38_SCREEN_MISSING_RESUME_HTTP_'+(r?r.status():null));
  report.dry_run={via:'API_PROBE_NO_SCREEN_GESTURE',http:200,dry_run:j.dry_run,issued:j.issued,failed:j.failed,families:j.families};
  reach('RESUME_DRY_RUN');
 }finally{await admin.ctx.close().catch(()=>{})}
}
let browser0=null;
async function main(){
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
   !!PHASE&&env.G6_CANONICAL_PHASE===PHASE&&env.G6_DYNAMIC_FRESH_ORDER==='1'&&
   env.G6_TARGET_MARKET===MK.code&&/^[a-f0-9-]{36}$/i.test(ID||''),'G6_'+SCEN+'_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_'+SCEN+'_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  const {rows:[o]}=await db.query(`SELECT o.reference,o.status::text AS status,o.payment_status::text AS payment_status,o.user_id,
    u.phone,u.email,u.role::text AS role FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=$1`,[ID]);
  check(o&&o.reference===REF&&o.status==='collected'&&o.payment_status==='paid','G6_'+SCEN+'_PRECONDITION_NOT_COLLECTED_PAID');
  const buyer={id:o.user_id,email:o.email,phone:o.phone,role:o.role};
  check(await verifyMarkedG6Buyer(db,buyer,env),'G6_'+SCEN+'_EXISTING_MARKED_BUYER_REQUIRED');
  browser0=await chromium.launch({headless:true});OBS=observe(browser0,OUT);
  if(SCEN==='N37')await runN37(o,buyer,browser0);else await runN38();
  await runtime();
  if(report.gaps.length){report.verdict='PRODUCT_GAP';throw Error('G6_'+SCEN+'_PRODUCT_GAP_'+report.gaps.join('_'))}
  report.verdict=SCEN==='N37'?'G6_N37_DOCUMENT_ACCESS_OWNER_ONLY_CHROMIUM_PASS':'G6_N38_RESUME_DRY_RUN_CHROMIUM_PASS';save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser0)await browser0.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
