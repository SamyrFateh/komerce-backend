/** 
 * @komerce-arch-lite
 * @role          g6-order-readonly-readback
 * @domain        orders
 * @layer         test
 * @owner         backend-core
 * @purpose       Read-only PostgreSQL verification of the existing G6 order; never creates orders.
 * @db-read       orders, order_items, products, markets, suppliers, product_suppliers
 * @db-write      none
 * @impact-areas  orders, checkout
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const db=require('../../db');
const {confirmTarget}=require('../../scripts/recette/target-guard');

const ORIGIN='https://komerce-backend-production.up.railway.app';
const REFERENCE='KUYIYUK';
const EXPECTED_BUYER='aedfc0cb-db52-4f58-be1b-f709374151ad';
const PRODUCT='KPR-000099';
const OUT=path.resolve('test-results/g6-order-readonly');
fs.mkdirSync(OUT,{recursive:true});
const report={run_id:process.env.GITHUB_RUN_ID||null,reference:REFERENCE,
  verdict:'NOT_PROVEN',order_created:false,db_write:false,external_effects:false};
const save=()=>fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');
const check=(ok,code)=>{if(!ok)throw Error(code)};
(async()=>{
 try{
  check(process.env.NODE_ENV==='test'&&process.env.KOMERCE_ENV==='staging'&&
    process.env.GITHUB_EVENT_NAME==='issues'&&
    process.env.GITHUB_ACTOR===process.env.GITHUB_REPOSITORY_OWNER&&
    process.env.STAGING_BASE_URL===ORIGIN&&
    String(process.env.PGOPTIONS||'').includes('default_transaction_read_only=on')&&
    /^\d{5,20}$/.test(String(process.env.GITHUB_RUN_ID||'')),
    'OWNER_STAGING_READONLY_GUARD');
  const target=await confirmTarget({db,env:process.env});
  check(target.confirmed,'STAGING_DB_TARGET_NOT_CONFIRMED');
  report.db_fingerprint=target.fingerprint;
  const {rows}=await db.query(
   'SELECT o.id,o.reference,o.user_id,o.total_kmf,o.transport_price_kmf,o.transport_pricing_snapshot,o.payment_mode::text AS payment_mode,'+
   'o.payment_status::text AS payment_status,o.status::text AS status,o.simulation_scope,'+
   'm.code AS market,'+
   '(SELECT COUNT(*)::int FROM order_items i WHERE i.order_id=o.id) AS lines,'+
   '(SELECT COALESCE(SUM(i.quantity),0)::int FROM order_items i WHERE i.order_id=o.id) AS qty,'+
   "(SELECT ARRAY_AGG(DISTINCT p.product_ref) FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=o.id) AS products,(SELECT COALESCE(SUM(i.price_kmf*i.quantity),0)::numeric FROM order_items i WHERE i.order_id=o.id) AS product_total_kmf,(SELECT jsonb_agg(jsonb_build_object('product_ref',p.product_ref,'quantity',i.quantity,'unit_price_kmf',i.price_kmf,'requested_transport_rail',i.requested_transport_rail,'weight_kg',p.weight_kg,'volume_cm3',p.volume_cm3)) FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=o.id) AS item_details,"+
   "(SELECT COUNT(*)::int FROM purchase_lines pl JOIN order_items oi2 ON oi2.id=pl.order_item_id WHERE oi2.order_id=o.id AND pl.cancelled_at IS NULL) AS purchase_line_count,"+
   "(SELECT COUNT(DISTINCT pl.purchase_order_id)::int FROM purchase_lines pl JOIN order_items oi2 ON oi2.id=pl.order_item_id WHERE oi2.order_id=o.id AND pl.cancelled_at IS NULL AND pl.purchase_order_id IS NOT NULL) AS purchase_order_count,"+
   "(SELECT jsonb_agg(jsonb_build_object('po_id',po.id,'status',po.status,'trigger_mode',po.trigger_mode)) FROM purchase_orders po WHERE EXISTS (SELECT 1 FROM purchase_lines pl JOIN order_items oi2 ON oi2.id=pl.order_item_id WHERE pl.purchase_order_id=po.id AND oi2.order_id=o.id AND pl.cancelled_at IS NULL)) AS purchase_orders,"+
   "(SELECT jsonb_agg(jsonb_build_object('supplier_id',s.id,'supplier_name',s.name,'platform',s.platform,'auto_order',s.auto_order,'owner_scope',s.owner_scope,'mapping_id',ps.id,'supplier_sku',ps.supplier_sku,'supplier_price_aed',ps.supplier_price_aed)) FROM product_suppliers ps JOIN suppliers s ON s.id=ps.supplier_id JOIN products p ON p.id=ps.product_id WHERE p.product_ref='KPR-000099' AND s.is_active=TRUE AND s.deleted_at IS NULL AND ps.is_active=TRUE AND ps.deleted_at IS NULL) AS supplier_mappings "+
   'FROM orders o LEFT JOIN markets m ON m.id=o.market_id WHERE o.reference=$1',
   [REFERENCE]);
  check(rows.length===1,'G6_REFERENCE_NOT_UNIQUE_OR_MISSING');
  const o=rows[0];
  const observed={
    order_id:o.id,buyer_match:o.user_id===EXPECTED_BUYER,
    scope:o.simulation_scope,market:o.market,total_kmf:Number(o.total_kmf),
    product_total_kmf:Number(o.product_total_kmf),
    transport_price_kmf:Number(o.transport_price_kmf),
    transport_sum_matches:Number(o.total_kmf)===Number(o.product_total_kmf)+Number(o.transport_price_kmf),
    item_details:o.item_details,
    payment_mode:o.payment_mode,status:o.status,payment_status:o.payment_status,
    lines:Number(o.lines),quantity:Number(o.qty),products:o.products,
    purchase_line_count:Number(o.purchase_line_count),
    purchase_order_count:Number(o.purchase_order_count),
    purchase_orders:o.purchase_orders,
    supplier_mappings:o.supplier_mappings
  };
  const expected={scope:'G6-BUYER',market:'KM',total_kmf:17990,
    payment_mode:'cash_relais',status:'pending',lines:1,quantity:1,product:PRODUCT};
  report.observed=observed;
  report.invariant_failures=[
    ...(!observed.buyer_match?['buyer_match']:[]),
    ...(observed.scope!==expected.scope?['scope']:[]),
    ...(observed.market!==expected.market?['market']:[]),
    ...(observed.total_kmf!==expected.total_kmf?['total_kmf']:[]),
    ...(observed.payment_mode!==expected.payment_mode?['payment_mode']:[]),
    ...(observed.status!==expected.status?['status']:[]),
    ...(observed.payment_status==='paid'?['payment_status']:[]),
    ...(observed.lines!==expected.lines?['lines']:[]),
    ...(observed.quantity!==expected.quantity?['quantity']:[]),
    ...(!Array.isArray(observed.products)||!observed.products.includes(expected.product)?['products']:[])
  ];
  save();
  check(report.invariant_failures.length===0,'G6_POSTGRES_CANONICAL_ORDER_MISMATCH');
  report.order={reference:o.reference,...observed};
  report.verdict='G6_EXISTING_ORDER_POSTGRES_READBACK_PASS';
 }catch(e){
  report.verdict='BLOCKED';report.error=String(e.message||e).slice(0,350);process.exitCode=2;
 }finally{
  save();await db.pool.end();
  console.log(JSON.stringify(report));
 }
})();
