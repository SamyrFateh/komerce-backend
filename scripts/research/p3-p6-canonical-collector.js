'use strict';
/**
 * Research-only boundary P3 purchasing -> P6 real supplier cost.
 * Canonical P6 price/margin authority = real-margin-shadow, backed by the
 * append-only supplier_payment_settlements facts. A separately persisted
 * order_item_real_cost_allocations "actual" row is NOT itself a supplier debit.
 *
 * Never compare a grouped-PO aggregate against a single order item.
 * Only actual item/PO lineage identities may be compared at item grain.
 */
const {record}=require('./p1-p7-canonical-collector');
function money(v){if(v==null)return null;const n=Number(v);return Number.isFinite(n)?n:null}
function assessP3P6({item,lines=[],costs=[],shadow=null,orderItemCount=null}={}){
 if(!item?.order_id||!item?.order_item_id)throw Error('P3-P6 exact persisted order item required');
 const gaps=[],contradictions=[];
 const line=lines.length===1?lines[0]:null;
 if(lines.length!==1)gaps.push(lines.length?'MULTIPLE_PURCHASE_LINES_NEED_AGGREGATION':'PURCHASE_LINE_MISSING');
 const shadowPurchase=shadow?.purchase||null;
 if(!shadowPurchase)gaps.push('REAL_MARGIN_SHADOW_NOT_AVAILABLE');
 const purchaseReal=money(shadowPurchase?.real_kmf);
 const sourceState=(!line||line.cancelled_at)?'UNKNOWN':
   line.purchase_order_id&&line.po_status==='confirmed'?'PROVED':'UNKNOWN';
 const actual=costs.filter(x=>x.is_actual===true&&x.cost_type==='product_purchase');
 const valued=actual.filter(x=>x.source!=='catalog_estimate:products.cost_kmf'&&
    !String(x.source||'').startsWith('catalog_estimate'));
 const total=valued.reduce((v,x)=>v+(money(x.amount_kmf)||0),0);
 const targetStatus=shadowPurchase?.state==='real'&&purchaseReal!==null?'PROVED':'UNKNOWN';
 if(purchaseReal===null)gaps.push('SUPPLIER_SETTLEMENT_REAL_KMF_NOT_PROVED');
 if(valued.length&&purchaseReal===null)gaps.push('ACTUAL_ALLOCATION_WITHOUT_SETTLEMENT_PROOF');
 if(actual.length===0)gaps.push('NO_ACTUAL_PRODUCT_PURCHASE_ALLOCATION');
 for(const cost of costs){
  if(String(cost.order_id)!==String(item.order_id))contradictions.push('COST_ALLOCATION_FOREIGN_ORDER');
  if(String(cost.order_item_id)!==String(item.order_item_id))contradictions.push('COST_ALLOCATION_FOREIGN_ITEM');
  if(cost.cost_type==='product_purchase'&&(money(cost.amount_kmf)===null||money(cost.amount_kmf)<0))
   contradictions.push('PRODUCT_PURCHASE_COST_INVALID_AMOUNT');
 }
 if(shadow?.order_id&&String(shadow.order_id)!==String(item.order_id))
  contradictions.push('REAL_MARGIN_SHADOW_FOREIGN_ORDER');
 // Valid only if the entire order has one item and exactly one active PO line.
 // Otherwise a grouped PO + shared debit is proportionally allocated by P6
 // and MUST NOT be compared to a single cost row using whole-PO sums.
 const comparable=orderItemCount===1&&lines.length===1&&
   shadowPurchase?.state==='real'&&purchaseReal!==null&&valued.length>0;
 if(comparable&&Math.abs(total-purchaseReal)>0.02)
  contradictions.push('SINGLE_ITEM_REAL_SETTLEMENT_DIFFERS_FROM_ACTUAL_COST_ALLOCATION');
 if(orderItemCount!==1)gaps.push('MULTI_ITEM_COST_REQUIRES_OWNER_WEIGHTED_ALLOCATION');
 if(!comparable&&purchaseReal!==null)gaps.push('SUPPLIER_SETTLEMENT_NOT_ITEM_COMPARABLE');
 const proof=record('P3_P6_PURCHASE_COST',sourceState,targetStatus,
  {order_item_id:line?.order_item_id||null},
  {order_item_id:costs.length?costs[0].order_item_id:null},
  {order_id:item.order_id,
   purchase_line_count:lines.length,actual_product_purchase_allocations:valued.length,
   allocation_amount_kmf:total,settlement_real_kmf:purchaseReal,
   shadow_purchase_state:shadowPurchase?.state||'UNKNOWN',
   shadow_flags:shadowPurchase?.flags||[],
   settlement_count:shadowPurchase?.supplier_payments?.count??null,
   debit_verified_count:shadowPurchase?.supplier_payments?.debit_verified??null,
   comparable_single_item:comparable});
 proof.crossContradictions=[...new Set(contradictions)];
 // No actual proof can be inferred solely from a confirmation of purchase
 // nor from a historical product_purchase allocation.
 if(gaps.length&&proof.target.status==='PROVED')proof.target.status='UNKNOWN';
 return {
  proofs:{P3_P6_PURCHASE_COST:proof},
  diagnostics:{contradictions:[...new Set(contradictions)],gaps:[...new Set(gaps)],
   evidence_level:'RESEARCH_ONLY'},
  facts:{order_id:item.order_id,order_item_id:item.order_item_id,
   purchase_line_count:lines.length,product_purchase_actual_count:valued.length,
   allocation_amount_kmf:total,settlement_real_kmf:purchaseReal,
   shadow_purchase_state:shadowPurchase?.state||null,
   order_item_count:orderItemCount,comparable_single_item:comparable},
  owner_provenance:{
   purchasing:'purchase_lines by exact order_item_id',
   real_margin:'services/cost-allocation/real-margin-shadow.computeOrderRealMarginShadow',
   debit_truth:'supplier_payment_settlements via real-margin-shadow.computePurchaseReal',
   cost_allocations:'order_item_real_cost_allocations at exact order_item_id',
   remote_provider_certified:false,
  },
 };
}
async function collectP3P6Canonical(db,{item,readers={}}={}){
 if(!db||typeof db.query!=='function'||!item?.order_id||!item?.order_item_id)
  throw Error('P3-P6 exact order and executor required');
 const {rows:lines}=await db.query(
  'SELECT pl.id,pl.order_item_id,pl.purchase_order_id,pl.cancelled_at,'+
  'po.status AS po_status FROM purchase_lines pl '+
  'LEFT JOIN purchase_orders po ON po.id=pl.purchase_order_id '+
  'WHERE pl.order_item_id=$1 ORDER BY pl.id LIMIT 101',[item.order_item_id]);
 const {rows:costs}=await db.query(
  'SELECT id,order_id,order_item_id,cost_type,amount_kmf,is_actual,source,'+
  'allocation_method FROM order_item_real_cost_allocations '+
  'WHERE order_item_id=$1 ORDER BY id LIMIT 101',[item.order_item_id]);
 const {rows:counts}=await db.query(
  'SELECT COUNT(*)::int AS item_count FROM order_items WHERE order_id=$1',[item.order_id]);
 const shadowFn=readers.realMargin||
  require('../../services/cost-allocation/real-margin-shadow').computeOrderRealMarginShadow;
 const shadow=await shadowFn(item.order_id,{client:db});
 const assessed=assessP3P6({item,lines,costs,shadow,orderItemCount:counts[0]?.item_count??null});
 if(lines.length>100||costs.length>100)assessed.diagnostics.gaps.push('RESEARCH_PAGINATION_LIMIT_REACHED');
 return assessed;
}
module.exports={assessP3P6,collectP3P6Canonical};
