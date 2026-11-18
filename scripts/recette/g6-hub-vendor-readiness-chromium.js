#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-canonical-vendor-boundary-readonly-chromium
 * @domain purchasing
 * @layer test
 * @owner backend-core
 * @purpose Reuse same canonical PO and verify the real supplier-send UI without claiming or writing an external event.
 * @impact-areas purchasing, hub, staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {login,openPo,stableSha}=require('./g6-hub-commitment-chromium');
const env=process.env;
const OUT=path.resolve('test-results/g6-hub-vendor-readiness');
const {observe,fullError}=require("./canonical/observability");let OBS=null;
const {humanClick,humanFill,humanSelect,humanCheck,humanPress}=require('./canonical/actors/human-gestures');
const REPORT=path.join(OUT,'report.json');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{40}$/i;
const report={schema:'komerce-g6-vendor-boundary/1',scenario_id:'M01',market:'KM',
 reference:env.G6_CANONICAL_ORDER_REFERENCE||null,po_id:env.G6_CANONICAL_PO_ID||null,
 verdict:'BLOCKED',supplier_send_certified:false,supplier_confirmation_certified:false,
 physical_receipt_certified:false,external_supplier_calls:0,external_payment_executed:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(REPORT,JSON.stringify(report,null,2)+'\n');};
function check(ok,code){if(!ok)throw Error(code);}
async function state(){
 const {rows}=await db.query([
  'SELECT po.id AS po_id,po.status::text AS po_status,po.sent_at,po.sent_channel,',
  'po.sent_by,po.supplier_order_id,po.trigger_mode,',
  'o.id AS order_id,o.reference AS reference,o.simulation_scope,',
  'o.payment_status::text AS payment_status,',
  'pl.id AS purchase_line_id,pl.confirmed_quantity,',
  '(SELECT count(*)::int FROM purchase_order_authorizations a',
  'WHERE a.purchase_order_id=po.id AND a.authorization_type=',
  "'purchase_commitment') AS commitment_count,",
  '(SELECT count(*)::int FROM purchase_order_authorizations a',
  'WHERE a.purchase_order_id=po.id AND a.authorization_type=',
  "'supplier_payment') AS payment_authorization_count",
  'FROM purchase_orders po',
  'JOIN purchase_lines pl ON pl.purchase_order_id=po.id AND pl.cancelled_at IS NULL',
  'JOIN order_items oi ON oi.id=pl.order_item_id',
  'JOIN orders o ON o.id=oi.order_id',
  'WHERE po.id=$1 AND o.id=$2 AND o.reference=$3',
  'ORDER BY pl.id'
 ].join(' '),[env.G6_CANONICAL_PO_ID,env.G6_CANONICAL_ORDER_ID,env.G6_CANONICAL_ORDER_REFERENCE]);
 check(rows.length===1,'G6_VENDOR_NOT_SINGLE_ORDER_PO_LINE');
 const r=rows[0];
 return {po_id:r.po_id,po_status:r.po_status,order_id:r.order_id,reference:r.reference,
  payment_status:r.payment_status,simulation_scope:r.simulation_scope,trigger_mode:r.trigger_mode,
  sent_at:r.sent_at,sent_channel:r.sent_channel,sent_by:r.sent_by,supplier_order_id:r.supplier_order_id,
  confirmed_quantity:r.confirmed_quantity,commitment_count:r.commitment_count,
  payment_authorization_count:r.payment_authorization_count};
}
function verifyBoundary(s){
 check(s.po_id===env.G6_CANONICAL_PO_ID&&s.order_id===env.G6_CANONICAL_ORDER_ID&&
  s.reference===env.G6_CANONICAL_ORDER_REFERENCE&&s.simulation_scope==='G6-BUYER'&&
  s.payment_status==='paid'&&s.po_status==='notified'&&s.trigger_mode!=='auto'&&
  Number(s.commitment_count)===1&&Number(s.payment_authorization_count)===0,
  'G6_VENDOR_ORDER_COMMITMENT_PROVENANCE_DRIFT');
 // Sent at is a declaration of an actual external action. Never silently fabricate it.
 check(!s.sent_at&&!s.sent_channel&&!s.sent_by&&!s.supplier_order_id&&
  s.confirmed_quantity===null,'G6_VENDOR_EXTERNAL_PROOF_ALREADY_PRESENT_REVIEW_REQUIRED');
}
async function main(){
 let browser;
 try{
  save();
  check(env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&
   env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.NODE_ENV==='test'&&
   env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&
   env.G6_CANONICAL_SCENARIO==='M01'&&env.G6_TARGET_MARKET==='KM'&&
   env.G6_CANONICAL_PHASE==='HUB_VENDOR_READINESS'&&
   SHA.test(env.E2E_EXPECTED_DEPLOY_SHA||'')&&UUID.test(env.G6_CANONICAL_PO_ID||'')&&
   UUID.test(env.G6_CANONICAL_ORDER_ID||'')&&(env.G6_CANONICAL_ORDER_REFERENCE==='KL1WGP6'||
    (env.G6_DYNAMIC_FRESH_ORDER==='1'&&
     /^[A-Z0-9][A-Z0-9-]{5,63}$/.test(env.G6_CANONICAL_ORDER_REFERENCE||'')&&
     env.STAGING_BASE_URL==='https://komerce-backend-production.up.railway.app'))&&
   !!env.DATABASE_URL,'G6_VENDOR_OWNER_STAGING_GUARD');
  const target=await confirmTarget({db,env});
  check(target.confirmed&&target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,
   'G6_VENDOR_DATABASE_IDENTITY_DRIFT');
  report.sha=await stableSha();report.db_fingerprint=target.fingerprint;
  const before=await state();verifyBoundary(before);
  report.before={...before,sent_at:null};save();
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const actor=await login(browser,'E2E_AGENT_HUB_',{readOnly:true});
  try{
   await openPo(actor.page);
   const send=actor.page.locator('[data-hlc-action="record-sent"]');
   await send.waitFor({state:'visible',timeout:18000});
   check(await send.isEnabled(),'G6_VENDOR_SEND_SCREEN_ACTION_UNAVAILABLE');
   // Clicking only opens the existing form. Never submit, contact, or mark a vendor as sent.
   const form=actor.page.locator('form[data-hlc-form="sent"]');
   // The Hub cockpit repaints this action frequently. First attempt an actual
   // pointer click, then a real keyboard Enter on the same visible control.
   // Never force-click, mutate the DOM, or POST directly in a read-only stage.
   let gesture='pointer';
   try{await humanClick(null,send,{timeout:7000});}
   catch(e){
    if(e&&e.verdict==='BLOCKED')throw e;
    if(!(await form.isVisible().catch(()=>false))){
     await send.waitFor({state:'visible',timeout:10000});
     check(await send.isEnabled(),'G6_VENDOR_SEND_ACTION_DISABLED_ON_RETRY');
     await humanPress(null,send,'Enter',{timeout:7000});
     gesture='keyboard-enter';
    }
   }
   await form.waitFor({state:'visible',timeout:10000});
   report.screen_gesture=gesture;save();
   const choices=await form.locator('select option').evaluateAll(items=>items.map(x=>x.value));
   // Staging must expose the safe simulated/manual channel. Production
   // delivery channels may be hidden or disabled under the staging fixture:
   // do not require them here and never submit the supplier-send form.
   check(choices.filter(x=>x==='other').length===1,
    'G6_VENDOR_STAGING_SIMULATION_CHANNEL_NOT_UNIQUE');
   check(await form.locator('[name="supplier_order_id"]').count()===1,
    'G6_VENDOR_SUPPLIER_ORDER_REFERENCE_FIELD_MISSING');
   check(await form.locator('[data-hlc-action="submit-sent"]').count()===1,
    'G6_VENDOR_REAL_SEND_SUBMIT_MISSING');
   check(actor.blocked.length===0,'G6_VENDOR_UNEXPECTED_BROWSER_WRITE');
   report.screen={record_sent_action_visible:true,form_visible:true,
    channels:choices,external_send_form_not_submitted:true,blocked_requests:actor.blocked.length};
  }finally{await actor.ctx.close();}
  const after=await state();
  verifyBoundary(after);
  check(JSON.stringify(before)===JSON.stringify(after),'G6_VENDOR_READONLY_STATE_MUTATED');
  await stableSha();
  report.after={po_status:after.po_status,sent_at:null,confirmed_quantity:null,
   payment_authorization_count:after.payment_authorization_count};
  report.verdict='G6_VENDOR_SEND_UI_READY_BUT_EXTERNAL_EVENT_NOT_PROVEN';
  report.next_stage='REAL_SUPPLIER_SEND_EVIDENCE_REQUIRED';
  save();
 }catch(e){report.error=fullError(e);report.verdict='BLOCKED';save();process.exitCode=2;}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end().catch(()=>{});console.log(JSON.stringify(report));}
}
if(require.main===module)main();
module.exports={verifyBoundary};
