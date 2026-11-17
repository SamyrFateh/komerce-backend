#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-canonical-vendor-simulation-chromium
 * @domain purchasing
 * @layer test
 * @owner backend-core
 * @purpose Continue exact M01/KM PO with simulated vendor send + simulated vendor confirmation by human UI clicks, never external transport.
 * @impact-areas purchasing, hub, staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {login,openPo,stableSha}=require('./g6-hub-commitment-chromium');
const env=process.env;
const OUT=path.resolve('test-results/g6-hub-vendor-simulation');
const REF=env.G6_CANONICAL_ORDER_REFERENCE||'';
const PO=env.G6_CANONICAL_PO_ID||'';
const ORDER=env.G6_CANONICAL_ORDER_ID||'';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{40}$/i;
const report={schema:'komerce-g6-vendor-simulation/1',scenario_id:'M01',market:'KM',
 reference:REF,po_id:PO,order_id:ORDER,verdict:'BLOCKED',
 supplier_send_certified:false,supplier_confirmation_certified:false,physical_receipt_certified:false,
 external_supplier_calls:0,external_payment_executed:false,provenance:'SIMULATED / STAGING ONLY'};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');};
function check(ok,code){if(!ok)throw Error(code);}
async function state(){
 const {rows}=await db.query(`
   SELECT po.id AS po_id,po.status::text AS po_status,po.sent_at,po.sent_channel,
          po.sent_by,po.sent_note,po.supplier_order_id,po.trigger_mode,
          o.id AS order_id,o.reference,o.simulation_scope,o.payment_status::text AS payment_status,
          pl.id AS line_id,pl.quantity,pl.confirmed_quantity,
          (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='purchase_commitment') AS commitments,
          (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=po.id AND a.authorization_type='supplier_payment') AS payment_authorizations,
          (SELECT count(*)::int FROM manual_purchase_executions e WHERE e.purchase_order_id=po.id) AS manual_executions,
          (SELECT max(e.seller_label) FROM manual_purchase_executions e WHERE e.purchase_order_id=po.id) AS seller_label,
          (SELECT max(e.proof_ref) FROM manual_purchase_executions e WHERE e.purchase_order_id=po.id) AS proof_ref
     FROM purchase_orders po JOIN purchase_lines pl ON pl.purchase_order_id=po.id AND pl.cancelled_at IS NULL
     JOIN order_items oi ON oi.id=pl.order_item_id JOIN orders o ON o.id=oi.order_id
    WHERE po.id=$1 AND o.id=$2 AND o.reference=$3
    ORDER BY pl.id`,[PO,ORDER,REF]);
 check(rows.length===1,'G6_SIM_NOT_EXACTLY_ONE_LINE_PO');
 return rows[0];
}
function verifyBase(s){
 check(s.po_id===PO&&s.order_id===ORDER&&s.reference===REF&&s.simulation_scope==='G6-BUYER'&&
   s.payment_status==='paid'&&s.trigger_mode!=='auto'&&Number(s.commitments)===1&&
   Number(s.payment_authorizations)===0,'G6_SIM_ORDER_PO_COMMITMENT_DRIFT');
}
async function main(){
 let browser;
 try{
  save();
  check(env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&
    env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.NODE_ENV==='test'&&
    env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&
    env.G6_CANONICAL_PHASE==='HUB_VENDOR_SIMULATION'&&env.G6_CANONICAL_SCENARIO==='M01'&&env.G6_TARGET_MARKET==='KM'&&
    env.G6_CANONICAL_DB_FINGERPRINT&&env.G6_CANONICAL_ORDER_REFERENCE==='KL1WGP6'&&
    UUID.test(PO)&&UUID.test(ORDER)&&SHA.test(env.E2E_EXPECTED_DEPLOY_SHA||'')&&!!env.DATABASE_URL,
    'G6_VENDOR_SIMULATION_STAGING_OWNER_GUARD');
  const t=await confirmTarget({db,env});
  check(t.confirmed&&t.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_SIM_DB_TARGET_MISMATCH');
  report.sha=await stableSha();report.db_fingerprint=t.fingerprint;
  const before=await state();verifyBase(before);
  check(before.po_status==='notified'&&!before.sent_at&&!before.sent_channel&&!before.sent_note&&
    !before.supplier_order_id&&before.confirmed_quantity===null&&Number(before.manual_executions)===0,
    'G6_SIM_EXPECT_PRIOR_READONLY_CHECKPOINT');
  report.before={po_status:before.po_status,sent_at:null,confirmed_quantity:null,manual_executions:0};save();
  browser=await chromium.launch({headless:true});
  const actor=await login(browser,'E2E_AGENT_HUB_',{allowedWrites:['sent','confirm']});
  try{
   await openPo(actor.page);
   const send=actor.page.locator('[data-hlc-action="record-sent"]');
   await send.waitFor({state:'visible',timeout:18000});
   check(await send.isEnabled(),'G6_SIM_SEND_ACTION_DISABLED');
   await send.click();
   const form=actor.page.locator('form[data-hlc-form="sent"]');
   await form.waitFor({state:'visible'});
   check((await form.locator('select option').evaluateAll(x=>x.map(i=>i.value))).join(',')==='other',
     'G6_SIM_EXTERNAL_CHANNEL_PRESENT');
   check(await form.locator('[name="supplier_order_id"]').inputValue()==='SIM-STAGING-'+REF,
     'G6_SIM_REFERENCE_INCORRECT');
   const sentResp=actor.page.waitForResponse(x=>new URL(x.url()).pathname==='/api/purchasing/po/'+PO+'/sent'&&x.request().method()==='POST');
   await form.locator('[data-hlc-action="submit-sent"]').click();
   const sent=await sentResp;
   check(sent.status()===200,'G6_SIM_SEND_HTTP_'+sent.status());
   const sentJson=await sent.json();
   check(sentJson.simulated===true,'G6_SIM_SEND_RESPONSE_UNLABELLED');
   report.send={http:sent.status(),channel:'other',reference:'SIM-STAGING-'+REF};
   const afterSend=await state();verifyBase(afterSend);
   check(afterSend.po_status==='notified'&&!!afterSend.sent_at&&afterSend.sent_channel==='other'&&
     afterSend.sent_note?.startsWith('[SIMULATED / STAGING ONLY]')&&
     afterSend.supplier_order_id==='SIM-STAGING-'+REF&&
     afterSend.confirmed_quantity===null&&Number(afterSend.manual_executions)===0,
     'G6_SIM_SEND_PG_ORACLE_FAILED');
   await actor.page.screenshot({path:path.join(OUT,'sent-simulated.png')});
   await openPo(actor.page);
   const confirm=actor.page.locator('[data-hlc-action="confirm-po"]');
   await confirm.waitFor({state:'visible',timeout:18000});
   check(await confirm.isEnabled(),'G6_SIM_CONFIRM_ACTION_DISABLED');
   await confirm.click();
   const cf=actor.page.locator('form[data-hlc-form="confirm"]');
   await cf.waitFor({state:'visible'});
   check(await cf.locator('[name="supplier_order_id"]').inputValue()==='SIM-STAGING-'+REF&&
     await cf.locator('[name="purchase_proof_ref"]').inputValue()==='SIM-STAGING-ACHAT-'+REF&&
     await cf.locator('[name="seller_label"]').inputValue()==='SIMULATED-STAGING-FOURNISSEUR-'+REF,
     'G6_SIM_CONFIRM_FORM_PROVENANCE_MISSING');
   const confirmResp=actor.page.waitForResponse(x=>new URL(x.url()).pathname==='/api/purchasing/po/'+PO+'/confirm'&&x.request().method()==='POST');
   await cf.locator('[data-hlc-action="submit-confirm"]').click();
   const confirmed=await confirmResp;
   check(confirmed.status()===200,'G6_SIM_CONFIRM_HTTP_'+confirmed.status());
   report.confirmation={http:confirmed.status(),proof:'SIM-STAGING-ACHAT-'+REF,
     seller:'SIMULATED-STAGING-FOURNISSEUR-'+REF};
   check(actor.blocked.length===0,'G6_SIM_UNEXPECTED_BROWSER_WRITE');
   await actor.page.screenshot({path:path.join(OUT,'confirmed-simulated.png')});
  }finally{await actor.ctx.close();}
  const after=await state();verifyBase(after);
  check(after.po_status==='confirmed'&&after.sent_channel==='other'&&
    after.sent_note?.startsWith('[SIMULATED / STAGING ONLY]')&&
    after.supplier_order_id==='SIM-STAGING-'+REF&&
    Number(after.confirmed_quantity)===Number(after.quantity)&&
    Number(after.manual_executions)===1&&
    after.seller_label==='SIMULATED-STAGING-FOURNISSEUR-'+REF&&
    after.proof_ref==='SIM-STAGING-ACHAT-'+REF,
    'G6_SIM_CONFIRM_PG_ORACLE_FAILED');
  await stableSha();
  report.after={po_status:after.po_status,sent_channel:after.sent_channel,
    simulation_marker:true,confirmed_quantity:Number(after.confirmed_quantity),
    manual_executions:after.manual_executions,payment_authorizations:after.payment_authorizations};
  report.supplier_send_certified=true;report.supplier_confirmation_certified=true;
  report.next_stage='HUB_RECEIVING';
  report.verdict='G6_VENDOR_SIMULATED_SEND_AND_CONFIRM_CHROMIUM_PASS_NOT_RECEIPT_GO';
  save();
 }catch(e){report.verdict='BLOCKED';report.error=String(e.message||e).slice(0,350);save();process.exitCode=2;}
 finally{if(browser)await browser.close().catch(()=>{});await db.pool.end().catch(()=>{});console.log(JSON.stringify(report));}
}
if(require.main===module)main();
module.exports={verifyBase};
