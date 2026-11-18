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
  browser=await chromium.launch({headless:true});
  const actor=await login(browser,'E2E_AGENT_HUB_',{readOnly:true});
  try{
   await openPo(actor.page);
   const send=actor.page.locator('[data-hlc-action="record-sent"]');
   await send.waitFor({state:'visible',timeout:18000});
   check(await send.isEnabled(),'G6_VENDOR_SEND_SCREEN_ACTION_UNAVAILABLE');
   // Clicking only opens the existing form. Never submit, contact, or mark a vendor as sent.
   await send.click();
   const form=actor.page.locator('form[data-hlc-form="sent"]');
   await form.waitFor({state:'visible',timeout:10000});
   const choices=await form.locator('select option').evaluateAll(items=>items.map(x=>x.value));
   check(['email','whatsapp','phone','api','other'].every(x=>choices.includes(x)),
    'G6_VENDOR_CHANNELS_UI_INCOMPLETE');
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
 }catch(e){report.error=String(e.message||e).slice(0,330);report.verdict='BLOCKED';save();process.exitCode=2;}
 finally{if(browser)await browser.close().catch(()=>{});await db.pool.end().catch(()=>{});console.log(JSON.stringify(report));}
}
if(require.main===module)main();
module.exports={verifyBoundary};
