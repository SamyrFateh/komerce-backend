/** @komerce-arch-lite
 * @role g6-negative-n28-n32-chromium
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose N28 (staging only) : remise au comptoir Remises avec réponse 500 puis réponse perdue après commit, puis réessai par l'écran ; N32 : lectures et écritures croisées marché et rôle (table R). Aucune écriture SQL.
 * @db-read orders, users, scans, parcel_items, parcels, product_sku_physical_codes, v_purchase_line_market, markets
 * @db-write users, e2e_test_accounts, assignment_memberships, membership_capabilities (N32: canonical E2E identity writers only)
 * @impact-areas staging-only, security
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const bcrypt=require('bcryptjs');
const {createAdminUser}=require('../../services/user-mutation-service');
const {markE2eTestAccount}=require('./staging-e2e-provision');
const delegation=require('../../services/market-delegation-service');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {verifyMarkedG6Buyer}=require('../../services/g6-staging-buyer-identity-guard');
const {listAuthorizedMarketsForCapability}=require('../../services/market-delegation-service');
const {runtime}=require('./g6-hub-shipment-chromium');
const {login}=require('./g6-canonical-forwarder-chromium');
const {customer}=require('./g6-canonical-client-pickup-chromium');
const {observe,fullError}=require('./canonical/observability');
const {humanClick,humanFill,humanGoto}=require('./canonical/actors/human-gestures');
const {counter,openCounter,check,URL_COLLECT,bindAgent,norm}=require('./g6-negative-n23-n24-chromium');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE,SCEN=env.G6_CANONICAL_SCENARIO;
const PHASE={N28:'N28_NETWORK_FAILURE_RETRY',N32:'N32_CROSS_MARKET_ROLES'}[SCEN];
const OUT=path.resolve('test-results/g6-negative-n28-n32');
const URL_CONFIRM=BASE+'/api/hub/physical-codes/confirm';
const SUCCESS=/succ[eè]s|remise (confirm|enregistr|effectu)|remis au client|colis remis/i;
let OBS=null;
const report={schema:'komerce-g6-negative-n28-n32/1',scenario_id:SCEN,market:MK.code,reference:REF,order_id:ID,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],attempts:[],probes:[],gaps:[],page_events:[],
 external_supplier_calls:0,external_payment_executed:false,plaintext_pickup_code_logged:false,production_permitted:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const reach=k=>{report.steps_reached.push(k);save()};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function pgState(){
 const {rows:[s]}=await db.query(`SELECT o.status::text AS status,
  (SELECT count(*)::int FROM scans x WHERE x.order_id=o.id AND x.step='collected') AS collected_scans
  FROM orders o WHERE o.id=$1`,[ID]);
 return s;
}
// N28 : une tentative par l'écran. 'http500' = réponse 500 fabriquée, rien n'atteint le serveur ;
// 'lose' = la requête atteint le serveur (commit possible) mais la réponse est perdue côté navigateur ; 'pass' = réessai réel.
async function attempt(page,mode,kind,code){
 const row={kind,request_seen:false,server_http:null,client_saw_failure:false,screen_claims_success:false,message_visible:false,counter_absent:false};
 if(!(await counter(page).count()))await openCounter(page).catch(()=>{});
 const box=counter(page);
 if(!(await box.count())){row.counter_absent=true;report.attempts.push(row);save();return row}
 const button=box.locator('[data-pickup-code-confirm]');
 await humanFill(null,box.locator('[data-pickup-code-input]'),code);
 if(!(await button.isVisible().catch(()=>false))||!(await button.isEnabled().catch(()=>false))){row.counter_absent=true;report.attempts.push(row);save();return row}
 const before=await page.locator('body').innerText().catch(()=>'');
 mode.kind=kind;mode.armed=true;mode.row=row;
 const failed=page.waitForEvent('requestfailed',{timeout:6000}).catch(()=>null);
 const resp=page.waitForResponse(r=>r.url()===URL_COLLECT&&r.request().method()==='POST',{timeout:6000}).catch(()=>null);
 await humanClick(null,button);
 const [f,r]=await Promise.all([failed,resp]);
 row.request_seen=!mode.armed;
 if(r&&kind==='pass'){row.server_http=r.status();const b=await r.json().catch(()=>({}));row.message=String(b.error||b.message||'').slice(0,160)||null}
 row.client_saw_failure=kind==='lose'?!!f:kind==='http500'?!!r&&r.status()===500:false;
 await page.waitForTimeout(1200);
 const after=await page.locator('body').innerText().catch(()=>'');
 const added=after.split('\n').filter(l=>!before.includes(l)).join(' ');
 row.screen_claims_success=SUCCESS.test(added);
 row.message_visible=after!==before;
 report.attempts.push(row);save();return row;
}
async function runN28(o,buyer,browser){
 const c=await customer(browser,buyer);
 try{
  reach('CLIENT_CODE_FROM_CLIENT_SCREEN');
  const code=c.code;
  const {actor}=await bindAgent(browser,o.relais_id);
  try{
   const mode={kind:null,armed:false,row:null};
   await actor.page.route(URL_COLLECT,async route=>{
    const req=route.request();let body;try{body=req.postDataJSON()}catch(_){}
    const exact=req.method()==='POST'&&mode.armed&&Object.keys(body||{}).length===1&&norm(body.pickup_code)===norm(code);
    if(!exact){actor.blocked.push({method:req.method(),path:'/api/scans/collect'});return route.abort('blockedbyclient')}
    mode.armed=false;
    if(mode.kind==='http500')return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Erreur serveur'})});
    if(mode.kind==='lose'){const res=await route.fetch();mode.row.server_http=res.status();return route.abort('connectionreset')}
    return route.continue();
   });
   await openCounter(actor.page);reach('REMISES_COUNTER_OPEN');
   const a1=await attempt(actor.page,mode,'http500',code);reach('ATTEMPT_HTTP500');
   const s1=await pgState();report.after_http500=s1;
   if(a1.screen_claims_success&&s1.collected_scans===0)report.gaps.push('FALSE_SUCCESS_SHOWN_ON_HTTP500');
   if(s1.collected_scans!==0)report.gaps.push('MUTATION_ON_HTTP500_NOT_SENT');
   const a2=await attempt(actor.page,mode,'lose',code);reach('ATTEMPT_RESPONSE_LOST');
   await sleep(1500);
   const s2=await pgState();report.after_lost_response=s2;
   if(a2.screen_claims_success&&a2.client_saw_failure)report.gaps.push('FALSE_SUCCESS_SHOWN_ON_LOST_RESPONSE');
   report.committed_before_retry=s2.collected_scans===1;
   const a3=await attempt(actor.page,mode,'pass',code);reach('RETRY_BY_SCREEN');
   if(a3.counter_absent&&!report.committed_before_retry)throw Error('G6_N28_SCREEN_MISSING_RETRY_NOT_POSSIBLE');
   if(a3.counter_absent)a3.ux_signal='COMPTOIR_ABSENT_APRES_REPONSE_PERDUE_COMMIT_FAIT';
   check(actor.blocked.length===0,'G6_N28_UNEXPECTED_RELAY_WRITE');
   report.ux_signal=(!a1.message_visible&&!a2.message_visible)?'ECHEC_RESEAU_SANS_MESSAGE_A_L_ECRAN':null;
  }finally{await actor.ctx.close()}
 }finally{c.code=null;await c.ctx.close().catch(()=>{})}
}
// N32: never reuse the global Hub actor to "prove" a restricted market.
// Own an isolated E2E agent with exactly one operations.read membership.
async function provisionRestrictedHub(marketId,foreignMarketId){
 check(SCEN==='N32'&&env.GITHUB_EVENT_NAME==='issues'&&
  env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&
  env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&
  env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
  env.KOMERCE_TARGET_ENV==='staging','G6_N32_STAGING_IDENTITY_GUARD');
 const {rows:admins}=await db.query("SELECT id FROM users WHERE lower(email)=lower($1) AND role::text='admin'",[env.E2E_ADMIN_EMAIL]);
 check(admins.length===1,'G6_N32_PREREQ_MISSING_CANONICAL_ADMIN');
 const salt=crypto.randomBytes(6).toString('hex');
 const email='g6-n32-hub-'+salt+'@komerce.test';
 const password=crypto.randomBytes(24).toString('base64url')+'Aa1!';
 const c=await db.getClient();let tx=false,agent;
 try{
  await c.query('BEGIN');tx=true;
  const created=await createAdminUser(c,{
   fullName:'G6 N32 Hub '+salt,email,role:'agent_hub',
   currencyPref:MK.code==='KM'?'KMF':'XAF',passwordHash:await bcrypt.hash(password,10)
  });
  agent=created.rows[0];
  check(!!agent?.id,'G6_N32_PREREQ_HUB_ACTOR_NOT_CREATED');
  await markE2eTestAccount(c,{userId:agent.id,actorId:admins[0].id});
  const assignment=await delegation.resolveActiveAssignmentByMarketCode(c,MK.code);
  check(assignment.market_id===marketId,'G6_N32_PREREQ_CURRENT_MARKET_DRIFT');
  await delegation.addMembership(c,{
   assignmentId:assignment.assignment_id,userId:agent.id,
   actorUserId:admins[0].id,capabilities:['operations.read'],actorIsCentral:true
  });
  await c.query('COMMIT');tx=false;
 }catch(e){if(tx)await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}
 const grants=await listAuthorizedMarketsForCapability(db,{
  userId:agent.id,requiredCapability:'operations.read'
 });
 check(grants.length===1&&grants[0].market_id===marketId&&
  !grants.some(g=>g.market_id===foreignMarketId),
  'G6_N32_PREREQ_RESTRICTED_HUB_DELEGATION_INVALID');
 env.G6_N32_RESTRICTED_HUB_EMAIL=email;
 env.G6_N32_RESTRICTED_HUB_PASSWORD=password;
 report.hub_actor={role:'agent_hub',e2e_marked:true,distinct_profile:true,
  authorized_market:MK.code,grant_count:grants.length,foreign_market_denied:true};
 save();
 return agent.id;
}
async function runN32(o,buyer,browser){
 // Choose a real foreign order with a non-draft foreign PO and SKU.
 // A random historic order and a made-up PO UUID cannot certify this boundary.
 const {rows:[f]}=await db.query(`SELECT DISTINCT o.id,o.reference,o.market_id,
   po.id AS po_id,pl.product_sku_id AS sku_id,m.code AS market_code
   FROM orders o JOIN markets m ON m.id=o.market_id
   JOIN order_items oi ON oi.order_id=o.id
   JOIN purchase_lines pl ON pl.order_item_id=oi.id AND pl.cancelled_at IS NULL
   JOIN purchase_orders po ON po.id=pl.purchase_order_id
     AND po.status NOT IN ('draft','cancelled')
   WHERE o.market_id<>(SELECT market_id FROM orders WHERE id=$1)
     AND o.user_id<>(SELECT user_id FROM orders WHERE id=$1)
     AND o.reference IS NOT NULL AND pl.product_sku_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM v_purchase_line_market v
       WHERE v.purchase_order_id=po.id AND v.market_id=o.market_id AND NOT v.cancelled)
   ORDER BY o.id,o.reference,o.market_id,po.id,pl.product_sku_id LIMIT 1`,[ID]);
 if(!f)throw Error('G6_N32_PREREQ_MISSING_FOREIGN_MARKET_ORDER_WITH_PO');
 report.foreign_market_order=true;
 report.foreign_scope={market:f.market_code,po_provenance:'REAL_PURCHASE_ORDER',po_market_verified:true};
 const snap=async()=>{
  const {rows:[x]}=await db.query(`SELECT (SELECT count(*)::int FROM product_sku_physical_codes) AS codes,
   (SELECT md5(status::text||payment_status::text||COALESCE(display_total_amount::text,'')) FROM orders WHERE id=$1) AS own,
   (SELECT md5(status::text||payment_status::text||COALESCE(display_total_amount::text,'')) FROM orders WHERE id=$2) AS foreign_order,
   (SELECT count(*)::int FROM scans WHERE order_id IN ($1,$2)) AS scans,
   (SELECT count(*)::int FROM purchase_lines WHERE purchase_order_id=$3 AND cancelled_at IS NULL) AS po_lines,
   (SELECT status::text FROM purchase_orders WHERE id=$3) AS po_status,
   (SELECT md5(COALESCE(string_agg(
     concat_ws('|',id::text,trust::text,printed_on_pack::text,
       confirmed_by::text,confirmed_at::text,confirmation_proof_ref),',' ORDER BY id),''))
     FROM product_sku_physical_codes WHERE product_sku_id=$4) AS foreign_sku_codes_hash`,[ID,f.id,f.po_id,f.sku_id]);
  return x;
 };
 const before=await snap();
 const reads=[['order_by_id','/api/orders/'+f.id],['order_by_ref','/api/orders/'+f.reference],['parcels','/api/orders/'+f.id+'/parcels'],
  ['history','/api/orders/'+f.id+'/history'],['order_360','/api/admin/entities/orders/'+f.reference]];
 const confirmBody={purchase_order_id:'00000000-0000-4000-8000-000000000000',product_sku_id:'00000000-0000-4000-8000-000000000000',code:'N32PROBE',code_type:'EAN_GTIN',proof_ref:'N32'};
 const roles=[];
 const c=await customer(browser,buyer);roles.push({role:'client',page:c.page,ctx:c.ctx});
 let relay=null,hub=null;
 try{
  const {actor}=await bindAgent(browser,o.relais_id);relay=actor;roles.push({role:'agent_relais',page:actor.page});
  reach('ACTORS_READY');
  // Positive controls prevent a broken or non-existent detail route from
  // being mistaken for a proper cross-market 404 denial.
  for(const r of roles){
   const own=await r.page.request.get('/api/orders/'+REF).catch(()=>null);
   const body=own?await own.text().catch(()=>''):'';
   report.probes.push({role:r.role,gesture:'GET own_order_by_ref',
    via:'AUTHENTICATED_CHROMIUM_HTTP_READ',expected_http:[200],
    http:own?own.status():null,owner_order_visible:body.includes(REF)});
   check(own?.status()===200&&body.includes(REF),
    'G6_N32_PRODUCT_GAP_OWNER_READ_CONTROL_'+r.role);
  }
  for(const r of roles){
   for(const [label,url] of reads){
    const res=await r.page.request.get(url).catch(()=>null);
    const text=res?await res.text().catch(()=>''):'';
    report.probes.push({role:r.role,gesture:'GET '+label,
     via:'AUTHENTICATED_CHROMIUM_HTTP_READ',http:res?res.status():null,
     expected_http:label==='order_360'?[403,404]:[404],
     discloses_foreign_order:!!res&&res.status()===200&&(text.includes(f.reference)||text.includes(f.id))});
   }
   const w=await r.page.request.post(URL_CONFIRM,{headers:{origin:BASE},data:confirmBody}).catch(()=>null);
   const wj=w?await w.json().catch(()=>({})):{};
   report.probes.push({role:r.role,gesture:'POST hub/physical-codes/confirm',
    via:'AUTHENTICATED_CHROMIUM_API_PROBE_NO_SCREEN_GESTURE',
    expected_http:[403],http:w?w.status():null,error_code:wj.code||null});
  }
  reach('ROLE_PROBES_DONE');
  // The isolated Hub actor owns operations.read on exactly this market.
  const {rows:[ownMarket]}=await db.query('SELECT market_id FROM orders WHERE id=$1',[ID]);
  check(!!ownMarket?.market_id,'G6_N32_PREREQ_CURRENT_ORDER_MARKET_MISSING');
  const hubId=await provisionRestrictedHub(ownMarket.market_id,f.market_id);
  hub=await login(browser,'G6_N32_RESTRICTED_HUB_','agent_hub');
  const me=await (await hub.page.request.get('/api/auth/me')).json();
  check(me.id===hubId&&me.role==='agent_hub',
   'G6_N32_PRODUCT_GAP_HUB_SESSION_NOT_RESTRICTED_ACTOR');
  // Chromium navigation of the permitted Hub workspace, then an authenticated
  // API probe of the hidden foreign PO; no forged UI success nor SQL state write.
  const doc=await humanGoto(hub.page,
   BASE+'/admin/workspaces/operations?market='+MK.code,{waitUntil:'domcontentloaded'});
  check(doc?.status()===200,'G6_N32_SCREEN_MISSING_HUB_WORKSPACE');
  const hubWorkspace=hub.page.locator('[data-workspace-mode="execution"]');
  await hubWorkspace.waitFor({state:'visible',timeout:25000}).catch(()=>{
   throw Error('G6_N32_SCREEN_MISSING_RESTRICTED_HUB_EXECUTION');
  });
  report.hub_actor.workspace_http=doc.status();
  report.hub_actor.browser_session=true;
  report.hub_actor.workspace_visible=true;
  const w=await hub.page.request.post(URL_CONFIRM,{
   headers:{origin:BASE},
   data:{purchase_order_id:f.po_id,product_sku_id:f.sku_id,
    code:'N32PROBE',code_type:'EAN_GTIN',proof_ref:'N32'}
  }).catch(()=>null);
  const wj=w?await w.json().catch(()=>({})):{};
  report.probes.push({role:'agent_hub_delegated',
   gesture:'POST hub/physical-codes/confirm foreign PO',
   via:'AUTHENTICATED_CHROMIUM_API_PROBE_NO_SCREEN_GESTURE',
   expected_http:[403],http:w?w.status():null,error_code:wj.code||null,
   expected_error_code:'HUB_PHYSICAL_MARKET_SCOPE_MISMATCH'});
  report.hub_market_leg=w?.status()===403&&wj.code==='HUB_PHYSICAL_MARKET_SCOPE_MISMATCH'
   ?'DENIED_PROVEN':'PRODUCT_GAP';
  reach('HUB_MARKET_LEG');
  const after=await snap();
  report.snapshot={before,after,unchanged:JSON.stringify(before)===JSON.stringify(after)};
  if(report.hub_market_leg!=='DENIED_PROVEN')report.gaps.push('HUB_FOREIGN_PO_DENIAL_NOT_PROVEN');
  if(!report.snapshot.unchanged)report.gaps.push('MUTATION_DURING_REFUSED_PROBES');
  for(const p of report.probes){
   if(p.discloses_foreign_order)report.gaps.push('DISCLOSURE_'+p.role+'_'+p.gesture.replace(/\W+/g,'_'));
   else if(/^csrf_/.test(p.error_code||''))throw Error('G6_N32_SCREEN_MISSING_PROBE_'+p.error_code);
   else if(p.http===null)throw Error('G6_N32_SCREEN_MISSING_NO_RESPONSE_'+p.gesture.replace(/\W+/g,'_'));
   else if(!p.expected_http.includes(p.http))
    report.gaps.push('WRONG_REFUSAL_HTTP_'+p.role+'_'+p.gesture.replace(/\W+/g,'_')+'_'+p.http);
   else if(p.expected_error_code&&p.error_code!==p.expected_error_code)
    report.gaps.push('WRONG_AUTHORITY_REASON_'+p.role+'_'+String(p.error_code||'none'));
  }
 }finally{if(relay)await relay.ctx.close().catch(()=>{});if(hub)await hub.ctx.close().catch(()=>{});await c.ctx.close().catch(()=>{})}
}
async function main(){
 let browser;
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
  const {rows:[o]}=await db.query(`SELECT o.reference,o.status::text AS status,o.payment_status::text AS payment_status,o.relais_id,o.user_id,
    (o.pickup_secret_hash IS NOT NULL) AS has_secret,u.phone,u.email,u.role::text AS role FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=$1`,[ID]);
  check(o&&o.reference===REF&&o.status==='available'&&o.payment_status==='paid'&&o.has_secret,'G6_'+SCEN+'_PRECONDITION_NOT_PAID_AVAILABLE');
  const buyer={id:o.user_id,email:o.email,phone:o.phone,role:o.role};
  check(await verifyMarkedG6Buyer(db,buyer,env),'G6_'+SCEN+'_EXISTING_MARKED_BUYER_REQUIRED');
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  if(SCEN==='N28')await runN28(o,buyer,browser);else await runN32(o,buyer,browser);
  await runtime();
  if(report.gaps.length){report.verdict='PRODUCT_GAP';throw Error('G6_'+SCEN+'_PRODUCT_GAP_'+report.gaps.join('_'))}
  report.verdict=SCEN==='N28'?'G6_N28_NETWORK_FAILURE_RETRY_SINGLE_EFFECT_CHROMIUM_PASS':'G6_N32_CROSS_MARKET_ROLES_REFUSED_CHROMIUM_PASS';save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
