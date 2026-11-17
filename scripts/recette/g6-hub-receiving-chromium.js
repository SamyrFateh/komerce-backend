#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-canonical-hub-receiving-chromium
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Continue same M01 simulated vendor PO to a single human-UI Hub receipt.
 * @impact-areas hub, purchasing, staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {login}=require('./g6-hub-commitment-chromium');
const env=process.env;
const ROOT=path.resolve(__dirname,'../..');
const OUT=path.join(ROOT,'test-results/g6-hub-receiving');
const ORDER=env.G6_CANONICAL_ORDER_ID||'';
const PO=env.G6_CANONICAL_PO_ID||'';
const REF=env.G6_CANONICAL_ORDER_REFERENCE||'';
const SHA=/^[a-f0-9]{40}$/i;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const report={schema:'komerce-g6-hub-receiving/1',scenario_id:'M01',market:'KM',
  reference:REF,order_id:ORDER,po_id:PO,verdict:'BLOCKED',
  provenance:'SIMULATED / STAGING ONLY',physical_receipt_certified:false,
  external_supplier_calls:0,external_payment_executed:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');};
function check(ok,code){if(!ok)throw Error(code);}
async function runtimeSha(initial){
 const r=await fetch(env.STAGING_BASE_URL.replace(/\/$/,'')+'/health/version');
 check(r.status===200,'G6_RECEIPT_HEALTH_'+r.status);
 const sha=String((await r.json()).commit||'');
 check(SHA.test(sha),'G6_RECEIPT_RUNTIME_SHA_INVALID');
 // Runtime equivalence is established ONLY by the workflow's authenticated
 // preflight / ancestry proof; do not assume any changed application files.
 const p=JSON.parse(fs.readFileSync(path.join(ROOT,'test-results/staging-chromium/deployment-preflight.json'),'utf8'));
 check((p.status==='DEPLOY_SHA_MATCHED'&&sha===env.E2E_EXPECTED_DEPLOY_SHA)||
   (p.status==='DEPLOY_RUNTIME_EQUIVALENT'&&p.observed_sha===sha&&
    p.expected_sha===env.E2E_EXPECTED_DEPLOY_SHA&&Array.isArray(p.tooling_diff)&&
    p.tooling_diff.length>0&&p.tooling_diff.every(x=>[
      '.github/workflows/staging-g6-canonical-buyer-cash.yml',
      'scripts/recette/g6-canonical-replay.js',
      'scripts/recette/g6-hub-receiving-chromium.js',
      'tests/unit/g6-canonical-journey-replay.test.js',
      'docs/chantier/STATUS.md'
    ].includes(x))), 'G6_RECEIPT_RUNTIME_DRIFT');
 if(initial)check(sha===initial,'G6_RECEIPT_SHA_CHANGED_DURING_RUN');
 return sha;
}
async function state(){
 const {rows}=await db.query([
  'SELECT po.id po_id,po.status::text po_status,o.id order_id,o.reference,',
  'o.simulation_scope,o.payment_status::text payment_status,',
  'pl.id line_id,pl.quantity,pl.confirmed_quantity,pl.product_sku_id,',
  '(SELECT COUNT(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type=',"'supplier_payment') AS payment_authorizations,",
  '(SELECT COUNT(*)::int FROM manual_purchase_executions e WHERE e.purchase_order_id=po.id) AS manual_executions',
  'FROM purchase_orders po JOIN purchase_lines pl ON pl.purchase_order_id=po.id AND pl.cancelled_at IS NULL',
  'JOIN order_items oi ON oi.id=pl.order_item_id JOIN orders o ON o.id=oi.order_id',
  'WHERE po.id=$1 AND o.id=$2 AND o.reference=$3'
 ].join(' '),[PO,ORDER,REF]);
 check(rows.length===1,'G6_RECEIPT_PO_LINE_COUNT_NOT_ONE');
 return rows[0];
}
function base(s){
 check(s.po_id===PO&&s.order_id===ORDER&&s.reference===REF&&
   s.simulation_scope==='G6-BUYER'&&s.payment_status==='paid'&&
   s.po_status==='confirmed'&&Number(s.confirmed_quantity)===Number(s.quantity)&&
   Number(s.quantity)===1&&Number(s.manual_executions)===1&&
   Number(s.payment_authorizations)===0&&!!s.product_sku_id,
   'G6_RECEIPT_SIMULATED_VENDOR_PROVENANCE_INVALID');
}
async function physical(reference){
 const r=await db.query('SELECT id,reference,unit_type::text unit_type,state::text state FROM hub_physical_units WHERE reference=$1',[reference]);
 return r.rows;
}
async function main(){
 let browser;
 try {
  save();
  check(env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&
    env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.NODE_ENV==='test'&&
    env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&
    env.G6_CANONICAL_PHASE==='HUB_RECEIVING'&&env.G6_CANONICAL_SCENARIO==='M01'&&
    env.G6_TARGET_MARKET==='KM'&&REF==='KL1WGP6'&&UUID.test(PO)&&UUID.test(ORDER)&&
    SHA.test(env.E2E_EXPECTED_DEPLOY_SHA||'')&&!!env.DATABASE_URL&&
    env.STAGING_BASE_URL==='https://komerce-backend-production.up.railway.app',
    'G6_RECEIPT_OWNER_STAGING_GUARD');
  const t=await confirmTarget({db,env});
  check(t.confirmed&&t.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,
    'G6_RECEIPT_DATABASE_MISMATCH');
  report.db_fingerprint=t.fingerprint;
  report.sha=await runtimeSha();
  const before=await state();base(before);
  const progress=await db.query(
    'SELECT COALESCE(SUM(GREATEST(v.effective_quantity-v.received_quantity,0)),0)::int remaining FROM v_purchase_line_progress v JOIN purchase_lines pl ON pl.id=v.line_id WHERE pl.purchase_order_id=$1 AND NOT v.cancelled',[PO]);
  check(progress.rows[0]?.remaining===1,'G6_RECEIPT_ALREADY_RECEIVED_OR_WRONG_REMAINING');
  report.before={po_status:before.po_status,expected:1,remaining:1,physical_received:false};
  save();
  browser=await chromium.launch({headless:true});
  // Allow precisely one real UI receipt write, never a direct test request or external transport.
  const actor=await login(browser,'E2E_AGENT_HUB_',{readOnly:true});
  try {
   await actor.page.route('**/api/scans/hub/receive',route=>{
     if(route.request().method()==='POST'&&new URL(route.request().url()).origin===env.STAGING_BASE_URL)
       return route.continue();
     return route.abort('blockedbyclient');
   });
   await actor.page.goto('/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});
   await actor.page.getByRole('tab',{name:'Réceptions'}).click();
   const card=actor.page.locator('[data-receive-po="'+PO+'"]');
   await card.waitFor({state:'visible',timeout:25000});
   const proof='[SIMULATED / STAGING ONLY] G6-M01-RECEPTION-'+REF;
   const toggle=card.locator('[data-receive-manual-toggle]');
   await toggle.check();
   await card.locator('[data-receive-manual-proof]').fill(proof);
   await card.locator('[data-receive-line="0"]').fill('1');
   await card.locator('.kmc-workspace-receive-tracking').fill('SIM-STAGING-RECEPTION-'+REF);
   const button=card.locator('[data-workspace-action="receive-supplier"]');
   check(await button.isEnabled(),'G6_RECEIPT_UI_ACTION_DISABLED');
   const responsePromise=actor.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/scans/hub/receive'&&r.request().method()==='POST',{timeout:30000});
   await button.click();
   const response=await responsePromise;
   const json=await response.json().catch(()=>({}));
   check(response.status()===200||response.status()===201,'G6_RECEIPT_UI_HTTP_'+response.status()+'_'+(json.code||''));
   check(json.unit?.reference?.startsWith('SUPPLIER_PACKAGE-'),'G6_RECEIPT_PHYSICAL_REFERENCE_ABSENT');
   report.receipt={http:response.status(),reference:json.unit.reference,
    unit_type:json.unit.unit_type,quarantined:json.quarantined||false,
    gesture:'Chromium button click',evidence_method:'MANUAL',evidence_ref:proof};
   await actor.page.screenshot({path:path.join(OUT,'hub-receipt-simulated.png'),fullPage:true});
   check(actor.blocked.length===0,'G6_RECEIPT_UNEXPECTED_UI_WRITES');
  }finally{await actor.ctx.close();}
  const after=await state();base(after);
  const physicalUnits=await physical(report.receipt.reference);
  check(physicalUnits.length===1&&physicalUnits[0].unit_type==='SUPPLIER_PACKAGE',
    'G6_RECEIPT_PHYSICAL_UNIT_NOT_UNIQUE');
  const endProgress=await db.query(
    'SELECT COALESCE(SUM(GREATEST(v.effective_quantity-v.received_quantity,0)),0)::int remaining FROM v_purchase_line_progress v JOIN purchase_lines pl ON pl.id=v.line_id WHERE pl.purchase_order_id=$1 AND NOT v.cancelled',[PO]);
  check(endProgress.rows[0]?.remaining===0,'G6_RECEIPT_PO_NOT_SOLD_OUT');
  await runtimeSha(report.sha);
  report.after={remaining:0,physical_units:1,unit_state:physicalUnits[0].state,
    external_payment_authorizations:after.payment_authorizations};
  report.physical_receipt_certified=true;
  report.next_stage='KOM_BOX';
  report.verdict='G6_HUB_RECEIPT_SIMULATED_CHROMIUM_PASS_NOT_KOM_BOX_GO';
  save();
 } catch(e){
  report.verdict='BLOCKED';report.error=String(e.message||e).slice(0,1500);
  if(browser){try{const pages=browser.contexts().flatMap(c=>c.pages());if(pages.length)await pages[0].screenshot({path:path.join(OUT,'blocked.png')});}catch(_){}}
  save();process.exitCode=2;
 }finally{if(browser)await browser.close().catch(()=>{});await db.pool.end().catch(()=>{});console.log(JSON.stringify(report));}
}
if(require.main===module)main();
module.exports={base};
