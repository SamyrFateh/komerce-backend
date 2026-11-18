#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-canonical-hub-receipt-independent-readback
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Verify committed M01 simulated Hub receipt after a post-write oracle failure; absolutely no business writes.
 * @impact-areas hub, staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const env=process.env;
const ROOT=path.resolve(__dirname,'../..');
const OUT=path.join(ROOT,'test-results/g6-hub-receiving-readback');
const report={schema:'komerce-g6-hub-receiving-readback/1',verdict:'BLOCKED',
  reference:env.G6_CANONICAL_ORDER_REFERENCE,order_id:env.G6_CANONICAL_ORDER_ID,
  po_id:env.G6_CANONICAL_PO_ID,physical_ref:env.G6_CANONICAL_RECEIPT_REFERENCE,
  read_only:true,external_supplier_calls:0,external_payment_executed:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');};
function check(ok,code){if(!ok)throw Error(code);}
async function main(){
 try{
  save();
  check(env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&
   env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&
   env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&
   env.G6_CANONICAL_PHASE==='HUB_RECEIVING_READBACK'&&
   ((env.G6_CANONICAL_ORDER_REFERENCE==='KL1WGP6'&&
     env.G6_CANONICAL_PO_ID==='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3'&&
     env.G6_CANONICAL_ORDER_ID==='56adad65-d1fa-4e80-8d69-c25e0fe92a76')||
    (env.G6_DYNAMIC_FRESH_ORDER==='1'&&
     /^[A-Z0-9][A-Z0-9-]{5,63}$/.test(env.G6_CANONICAL_ORDER_REFERENCE||'')&&
     /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.G6_CANONICAL_PO_ID||'')&&
     /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.G6_CANONICAL_ORDER_ID||'')))&&
   /^SUPPLIER_PACKAGE-[a-f0-9-]{36}$/i.test(env.G6_CANONICAL_RECEIPT_REFERENCE||'')&&
   !!env.DATABASE_URL,'G6_RECEIPT_READBACK_SCOPE_INVALID');
  const target=await confirmTarget({db,env});
  check(target.confirmed&&target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_RECEIPT_READBACK_DB_MISMATCH');
  report.db_fingerprint=target.fingerprint;
  const r=await fetch(env.STAGING_BASE_URL+'/health/version');
  check(r.status===200,'G6_RECEIPT_READBACK_HEALTH_'+r.status);
  report.sha=(await r.json()).commit;
  check(report.sha===env.E2E_EXPECTED_DEPLOY_SHA,'G6_RECEIPT_READBACK_SHA_DRIFT');
  // Read all authority tables. This is a reconciliation, not a second operator step.
  const po=(await db.query(
   'SELECT po.id,po.status::text status,po.sent_channel,po.sent_note,po.supplier_order_id,'
   +'o.reference,o.simulation_scope,o.status::text order_status,o.payment_status::text payment_status,'
   +'pl.id line_id,pl.quantity,pl.confirmed_quantity,pl.product_sku_id,'
   +"(SELECT COUNT(*)::int FROM purchase_order_authorizations x WHERE x.purchase_order_id=po.id AND x.authorization_type='supplier_payment') payment_authorizations,"
   +'(SELECT COUNT(*)::int FROM manual_purchase_executions e WHERE e.purchase_order_id=po.id) manual_executions '
   +'FROM purchase_orders po JOIN purchase_lines pl ON pl.purchase_order_id=po.id AND pl.cancelled_at IS NULL '
   +'JOIN order_items oi ON oi.id=pl.order_item_id JOIN orders o ON o.id=oi.order_id '
   +'WHERE po.id=$1 AND o.id=$2',[env.G6_CANONICAL_PO_ID,env.G6_CANONICAL_ORDER_ID])).rows;
  const unit=(await db.query(
   'SELECT u.id,u.reference,u.unit_type::text unit_type,u.state::text state,'
   +'p.quantity,p.operation_type::text operation_type,p.evidence_method::text evidence_method,p.evidence_ref,'
   +'a.purchase_order_id,a.purchase_line_id '
   +'FROM hub_physical_units u JOIN hub_physical_unit_placements p ON p.physical_unit_id=u.id '
   +'JOIN hub_purchase_allocations a ON a.id=p.allocation_id '
   +'WHERE u.reference=$1 AND a.purchase_order_id=$2',
   [env.G6_CANONICAL_RECEIPT_REFERENCE,env.G6_CANONICAL_PO_ID])).rows;
  const remaining=(await db.query(
    'SELECT COALESCE(SUM(GREATEST(v.effective_quantity-v.received_quantity,0)),0)::int remaining '
    +'FROM v_purchase_line_progress v JOIN purchase_lines pl ON pl.id=v.line_id '
    +'WHERE pl.purchase_order_id=$1 AND NOT v.cancelled',[env.G6_CANONICAL_PO_ID])).rows[0]?.remaining;
  report.readback={po:po[0]||null,placements:unit,remaining};
  save();
  check(po.length===1&&po[0].reference===env.G6_CANONICAL_ORDER_REFERENCE&&
   po[0].simulation_scope==='G6-BUYER'&&po[0].payment_status==='paid'&&
   po[0].sent_note?.startsWith('[SIMULATED / STAGING ONLY]')&&
   po[0].supplier_order_id==='SIM-STAGING-'+po[0].id&&
   Number(po[0].manual_executions)===1&&Number(po[0].payment_authorizations)===0,
   'G6_RECEIPT_READBACK_ORDER_NOT_SAME_SIMULATION');
  check(unit.length===1&&unit[0].unit_type==='SUPPLIER_PACKAGE'&&
   unit[0].operation_type==='RECEIVE'&&unit[0].evidence_method==='MANUAL'&&
   unit[0].evidence_ref==='[SIMULATED / STAGING ONLY] G6-M01-RECEPTION-'+env.G6_CANONICAL_ORDER_REFERENCE&&
   Number(unit[0].quantity)===1&&unit[0].purchase_line_id===po[0].line_id&&
   remaining===0,'G6_RECEIPT_READBACK_PHYSICAL_ALLOCATION_INCOMPLETE');
  report.verdict='G6_HUB_RECEIPT_SIMULATED_CHROMIUM_HISTORICAL_UI_PG_READBACK_PASS';
  report.next_stage='KOM_BOX';save();
 }catch(e){report.error=String(e.message||e).slice(0,1100);report.verdict='BLOCKED';save();process.exitCode=2;}
 finally{await db.pool.end().catch(()=>{});console.log(JSON.stringify(report));}
}
if(require.main===module)main();
