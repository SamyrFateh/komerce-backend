#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-canonical-hub-director-commitment-chromium-adapter
 * @domain purchasing
 * @layer test
 * @owner backend-core
 * @purpose Continue SAME G6 order from draft PO through director commitment and internal submit by real Chromium UI.
 * @impact-areas hub, purchasing, staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db'),{confirmTarget}=require('./target-guard');
const ORIGIN='https://komerce-backend-production.up.railway.app';
const OUT=path.resolve('test-results/g6-hub-commitment');
const {observe,fullError}=require("./canonical/observability");let OBS=null;
const {humanClick,humanFill,humanSelect,humanCheck,humanPress}=require('./canonical/actors/human-gestures');
const env=process.env;
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{40}$/i;
const report={schema:'komerce-g6-hub-commitment/1',scenario_id:'M01',market:'KM',
 reference:env.G6_CANONICAL_ORDER_REFERENCE||null,po_id:env.G6_CANONICAL_PO_ID||null,
 verdict:'BLOCKED',external_supplier_calls:0,external_payment_executed:false,events:[],stage:'PREFLIGHT'};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');};
function check(ok,code){if(!ok)throw Error(code);}
async function getState(){
 const {rows}=await db.query([
  'SELECT po.id AS po_id, po.status::text AS po_status, o.id AS order_id,',
  'o.reference AS order_reference, o.payment_status::text AS payment_status,',
  'o.simulation_scope, po.trigger_mode, COUNT(DISTINCT pl.id)::int AS purchase_lines',
  'FROM purchase_orders po',
  'JOIN purchase_lines pl ON pl.purchase_order_id=po.id AND pl.cancelled_at IS NULL',
  'JOIN order_items oi ON oi.id=pl.order_item_id',
  'JOIN orders o ON o.id=oi.order_id',
  'WHERE po.id=$1 AND o.id=$2 AND o.reference=$3',
  'GROUP BY po.id,po.status,o.id,o.reference,o.payment_status,o.simulation_scope,po.trigger_mode'
 ].join(' '),[env.G6_CANONICAL_PO_ID,env.G6_CANONICAL_ORDER_ID,env.G6_CANONICAL_ORDER_REFERENCE]);
 const decisions=(await db.query([
  'SELECT authorization_type,decided_by,proof_ref,amount::text AS amount,currency,',
  'COALESCE(octet_length(commitment_pdf),0) AS pdf_bytes',
  'FROM purchase_order_authorizations WHERE purchase_order_id=$1 ORDER BY authorization_type'
 ].join(' '),[env.G6_CANONICAL_PO_ID])).rows;
 return {order:rows[0]||null,decisions};
}
async function stableSha(){
 const r=await fetch(ORIGIN+'/health/version');
 check(r.status===200,'G6_COMMITMENT_HEALTH_HTTP_'+r.status);
 const v=await r.json();
 check(v.commit===env.E2E_EXPECTED_DEPLOY_SHA,'G6_COMMITMENT_SHA_CHANGED');
 return v.commit;
}
async function login(browser,prefix,{readOnly=false,allowedWrites=['authorize-commitment','submit']}={}){
 const email=env[prefix+'EMAIL'],password=env[prefix+'PASSWORD'];
 check(email&&password,'G6_COMMITMENT_IDENTITY_MISSING_'+prefix);
 const ctx=await browser.newContext({viewport:{width:1440,height:900},baseURL:ORIGIN});
 const page=await ctx.newPage(),blocked=[];
 page.on('dialog',dialog=>dialog.accept());
 await page.route('**/*',route=>{
  const req=route.request(),url=new URL(req.url());
  if(['GET','HEAD','OPTIONS'].includes(req.method()))return route.continue();
  const allowed=url.origin===ORIGIN&&req.method()==='POST'&&(
   url.pathname==='/api/auth/login'||
   (!readOnly&&allowedWrites.some(action=>url.pathname==='/api/purchasing/po/'+env.G6_CANONICAL_PO_ID+'/'+action)));
  if(allowed)return route.continue();
  blocked.push({method:req.method(),path:url.pathname});
  return route.abort('blockedbyclient');
 });
 await page.goto('/login.html?next='+encodeURIComponent('/admin/hub-live?view=execute&market=KM'));
 await humanFill(null,page.locator('#email'),email);
 await humanFill(null,page.locator('#password'),password);
 const promise=page.waitForResponse(x=>new URL(x.url()).pathname==='/api/auth/login'&&x.request().method()==='POST');
 await humanClick(null,page.locator('#btn-submit'));
 const auth=await promise;
 check(auth.status()===200,'G6_COMMITMENT_LOGIN_'+prefix+'_'+auth.status());
 await page.waitForURL(x=>x.pathname!=='/login.html',{timeout:15000});
 const me=await page.request.get('/api/auth/me');
 check(me.status()===200&&(await me.json()).role==='agent_hub','G6_COMMITMENT_ROLE_'+prefix);
 return {ctx,page,blocked};
}
async function openPo(page){
 await page.goto('/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});
 const sel=page.locator('select').first();
 await sel.waitFor({timeout:20000});
 await humanSelect(null,sel,{label:'KM · Comores'}).catch(()=>{});
 const po=page.locator('[data-hlc-po="'+env.G6_CANONICAL_PO_ID+'"]');
 await po.waitFor({state:'visible',timeout:25000});
 check(await po.locator('[data-hlc-po-line]').count()===1,'G6_COMMITMENT_PO_MULTILINE');
 check(await po.locator('[data-hlc-line-order="'+env.G6_CANONICAL_ORDER_ID+'"]').count()===1,
  'G6_COMMITMENT_UI_ORDER_MISMATCH');
 await humanClick(null,po);
}
async function main(){
 let browser;
 try{
  save();
  check(env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&
   env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.NODE_ENV==='test'&&
   env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&
   env.STAGING_BASE_URL===ORIGIN&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&
   env.G6_CANONICAL_SCENARIO==='M01'&&env.G6_TARGET_MARKET==='KM'&&
   env.G6_CANONICAL_PHASE==='HUB_COMMITMENT'&&SHA.test(env.E2E_EXPECTED_DEPLOY_SHA||'')&&
   UUID.test(env.G6_CANONICAL_PO_ID||'')&&UUID.test(env.G6_CANONICAL_ORDER_ID||'')&&
   /^[A-Z0-9-]{6,64}$/.test(env.G6_CANONICAL_ORDER_REFERENCE||'')&&
   !!env.DATABASE_URL,'G6_COMMITMENT_OWNER_STAGING_GUARD');
  const target=await confirmTarget({db,env});
  check(target.confirmed&&target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,
   'G6_COMMITMENT_DATABASE_NOT_SAME_AS_PO');
  report.db_fingerprint=target.fingerprint;report.sha=await stableSha();
  const before=await getState();
  report.before={po_status:before.order?.po_status,order_reference:before.order?.order_reference,
   payment_status:before.order?.payment_status,scope:before.order?.simulation_scope,
   purchase_lines:before.order?.purchase_lines,authorization_types:before.decisions.map(x=>x.authorization_type)};
  save();
  check(before.order&&before.order.payment_status==='paid'&&
   before.order.simulation_scope==='G6-BUYER'&&before.order.po_status==='draft'&&
   before.order.purchase_lines===1&&before.decisions.length===0,
   'G6_COMMITMENT_EXISTING_DRAFT_PRECONDITION_FAILED');
  check(before.order.trigger_mode!=='auto','G6_COMMITMENT_AUTO_PROVIDER_FORBIDDEN');
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const agent=await login(browser,'E2E_AGENT_HUB_');
  try{
   await openPo(agent.page);
   check(await agent.page.locator('[data-hlc-action="authorize-commitment"]').isDisabled(),
    'G6_COMMITMENT_ORDINARY_AGENT_UNEXPECTEDLY_ENABLED');
   check(agent.blocked.length===0,'G6_COMMITMENT_UNEXPECTED_ORDINARY_BROWSER_WRITE');
   report.events.push({name:'ORDINARY_AGENT_COMMITMENT_DISABLED',verdict:'PASS'});
  }finally{await agent.ctx.close();}
  report.stage='DIRECTOR';save();
  const director=await login(browser,'E2E_HUB_DIRECTOR_');
  try{
   const grants=await director.page.request.get('/api/hub/administration');
   check(grants.status()===200,'G6_COMMITMENT_DIRECTOR_RIGHTS_HTTP_'+grants.status());
   const data=await grants.json();
   check(data.viewer_grants?.purchase_commitment===true,'G6_COMMITMENT_DIRECTOR_GRANT_MISSING');
   await openPo(director.page);
   const button=director.page.locator('[data-hlc-action="authorize-commitment"]');
   check(await button.isEnabled(),'G6_COMMITMENT_DIRECTOR_ACTION_DISABLED');
   await humanClick(null,button);
   const form=director.page.locator('form[data-hlc-form="commitment"]');
   await form.waitFor({state:'visible',timeout:14000});
   check(await form.locator('input[name="amount"]').count()===0,
    'G6_COMMITMENT_SUPPLIER_PRICE_MISSING_NO_FICTITIOUS_AMOUNT');
   const proof='E2E-STAGING-ENGAGEMENT-'+env.G6_CANONICAL_ORDER_REFERENCE;
   const proofField=form.locator('input[name="proof_ref"]');
   check(await proofField.isVisible()&&await proofField.isEnabled()&&
     await proofField.isEditable(),'G6_COMMITMENT_PROOF_FIELD_NOT_EDITABLE');
   let inputGesture='playwright-fill';
   try{
     // The live Hub cockpit may repaint the form during Playwright fill.
     // Make a bounded attempt before an actual pointer+keyboard gesture.
     await humanFill(null,proofField,proof,{timeout:6500});
   }catch(fillError){
     if(fillError&&fillError.verdict==='BLOCKED')throw fillError;
     inputGesture='pointer-keyboard';
     try{
       await humanClick(null,proofField,{timeout:6500});
       await director.page.keyboard.press('ControlOrMeta+A');
       await director.page.keyboard.type(proof,{delay:0});
     }catch(keyboardError){
       report.proof_input_diagnostic={gesture:inputGesture,
         visible:await proofField.isVisible().catch(()=>false),
         enabled:await proofField.isEnabled().catch(()=>false),
         editable:await proofField.isEditable().catch(()=>false),
         fill_error:fullError(fillError),
         keyboard_error:fullError(keyboardError)};
       save();
       await director.page.screenshot({path:path.join(OUT,'director-proof-input-blocked.png')}).catch(()=>{});
       throw Error('G6_COMMITMENT_REAL_CHROMIUM_PROOF_INPUT_BLOCKED');
     }
   }
   check(await proofField.inputValue()===proof,
     'G6_COMMITMENT_PROOF_INPUT_VALUE_NOT_STABLE');
   report.proof_input_diagnostic={gesture:inputGesture,stable:true};
   save();
   const response=director.page.waitForResponse(x=>new URL(x.url()).pathname===
    '/api/purchasing/po/'+env.G6_CANONICAL_PO_ID+'/authorize-commitment'&&
    x.request().method()==='POST',{timeout:30000});
   await humanClick(null,form.locator('[data-hlc-action="submit-commitment"]'));
   const actual=await response;
   report.events.push({name:'DIRECTOR_COMMITMENT_UI',http:actual.status()});
   check(actual.status()===201,'G6_COMMITMENT_DIRECTOR_HTTP_'+actual.status());
   const after=await getState();
   const entry=after.decisions.find(x=>x.authorization_type==='purchase_commitment');
   const me=await director.page.request.get('/api/auth/me'),identity=await me.json();
   check(after.decisions.length===1&&entry&&entry.decided_by===identity.id&&
    entry.proof_ref===proof&&Number(entry.amount)>0&&/^[A-Z]{3}$/.test(entry.currency)&&
    Number(entry.pdf_bytes)>500&&after.order.po_status==='draft',
    'G6_COMMITMENT_PG_AUTHORIZATION_OR_PDF_MISMATCH');
   report.commitment={http:actual.status(),authorization_count:1,pdf_generated:true,proof_ref:proof};
   check(director.blocked.length===0,'G6_COMMITMENT_UNEXPECTED_DIRECTOR_BROWSER_WRITE');
  }finally{await director.ctx.close();}
  report.stage='SUBMIT';save();
  const hub=await login(browser,'E2E_AGENT_HUB_');
  try{
   await openPo(hub.page);
   const button=hub.page.locator('[data-hlc-action="submit-po"]');
   check(await button.isEnabled(),'G6_COMMITMENT_SUBMIT_BUTTON_DISABLED');
   const response=hub.page.waitForResponse(x=>new URL(x.url()).pathname===
    '/api/purchasing/po/'+env.G6_CANONICAL_PO_ID+'/submit'&&
    x.request().method()==='POST',{timeout:30000});
   await humanClick(null,button);
   const actual=await response;
   report.events.push({name:'HUB_SUBMIT_UI',http:actual.status()});
   check(actual.status()===200,'G6_COMMITMENT_SUBMIT_HTTP_'+actual.status());
   check(hub.blocked.length===0,'G6_COMMITMENT_UNEXPECTED_SUBMIT_BROWSER_WRITE');
  }finally{await hub.ctx.close();}
  const final=await getState();
  check(final.order?.po_status==='notified'&&final.order?.purchase_lines===1&&
   final.decisions.length===1&&final.decisions[0].authorization_type==='purchase_commitment',
   'G6_COMMITMENT_FINAL_PO_STATE_UNEXPECTED');
  report.after={po_status:final.order.po_status,commitment_count:1,payment_authorization_count:0};
  await stableSha();
  report.stage='VENDOR_PROOF_PENDING';
  report.verdict='G6_HUB_COMMITMENT_AND_INTERNAL_SUBMIT_CHROMIUM_PASS_NOT_VENDOR_OR_RECEIPT_GO';
  save();
 }catch(e){report.error=fullError(e);report.verdict='BLOCKED';save();process.exitCode=2;}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end().catch(()=>{});console.log(JSON.stringify(report));}
}
if(require.main===module)main();
module.exports={login,openPo,stableSha};