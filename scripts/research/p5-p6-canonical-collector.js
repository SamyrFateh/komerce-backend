'use strict';
/**
 * P5 -> P6: money-custody / economic-payment-fee seam (READ ONLY).
 *
 * Two distinct values: a customer collection is funds RECEIVED; a payment
 * allocation is a processing FEE, not funds settled. Never compare amounts
 * directly or treat a PSP intent reference as a signed PSP settlement.
 *
 * Cash custody: canonical collection/deposit writer schemas; FINAL needs
 * explicit custody RECEIVED + CONTROL and attributable collection allocation.
 * Reconstructed deposit allocation is NOT proof of discharge.
 * P6: existing real-margin-shadow owner; estimated payment fees not actual.
 */
const {record,statusOfGate}=require('./p1-p7-canonical-collector');
const n=x=>x==null||x===''||!Number.isFinite(Number(x))?null:Number(x);
const ids=x=>x==null?null:String(x);
function assessP5P6({order,collections=[],allocations=[],paymentCosts=[],shadow=null,
 paymentGate=null,provenance=null,depositEvidence=[]}={}){
 if(!order?.id)throw Error('Exact persisted order required for P5-P6');
 const gaps=new Set(),faults=new Set();
 const synthetic=provenance==='SYNTHETIC_GOLDEN_CREATE'||
   /^K-GOLDEN-/i.test(String(order.reference||''));
 const cash=order.payment_mode==='cash_relais',stripe=order.payment_mode==='stripe_eur';
 const collected=collections.reduce((a,x)=>a+(n(x.amount_kmf)||0),0);
 const payment=shadow?.costs?.by_type?.payment;
 const actual=paymentCosts.filter(x=>x.is_actual===true);
 const realFees=actual.reduce((a,x)=>a+(n(x.amount_kmf)||0),0);
 const evidence=allocations.filter(x=>x.allocation_basis==='CONFIRMED');
 const reconstructed=allocations.filter(x=>x.allocation_basis!=='CONFIRMED');
 const cashUnallocated=collections.filter(x=>
   !evidence.some(a=>ids(a.collection_id)===ids(x.id)));
 if(!payment)gaps.add('P6_PAYMENT_SHADOW_NOT_READ');
 if(payment?.state!=='real')gaps.add('PAYMENT_FEE_NOT_ACTUALLY_VALUED');
 if(synthetic)gaps.add('SYNTHETIC_GOLDEN_PAYMENT_NOT_EXTERNAL_PROOF');
 if(stripe){
  if(!order.stripe_payment_id)gaps.add('STRIPE_REFERENCE_MISSING');
  else gaps.add('PSP_REFERENCE_NOT_SIGNED_SETTLEMENT');
  if(collections.length)faults.add('STRIPE_ORDER_HAS_CASH_COLLECTION');
 }else if(cash) {
  if(!collections.length)gaps.add('CASH_COLLECTION_MISSING');
  if(order.payment_status==='paid'&&n(order.total_kmf)!==null&&
     Math.abs(collected-n(order.total_kmf))>.01)
    faults.add('CASH_PAID_ORDER_COLLECTION_AMOUNT_MISMATCH');
  if(reconstructed.length)gaps.add('RECONSTRUCTED_CASH_ALLOCATIONS_NOT_DISCHARGE');
  if(cashUnallocated.length)gaps.add('CASH_COLLECTION_NOT_CONFIRMED_BY_DEPOSIT');
  // Attribution of a deposit != final receipt and independent CONTROL of
  // the custody chain, which belongs to the P5 custody owner.
  gaps.add('FINAL_CUSTODY_CONTROL_NOT_ORDER_ATTESTED');
 }else gaps.add('PAYMENT_RAIL_NOT_CERTIFIED');
 if(statusOfGate(paymentGate)!=='PROVED')gaps.add('CUSTOMER_PAYMENT_GATE_NOT_PROVED');
 for(const x of collections){
  if(ids(x.order_id)!==ids(order.id))faults.add('COLLECTION_FOREIGN_ORDER');
  if(x.relais_id&&order.relais_id&&ids(x.relais_id)!==ids(order.relais_id))
   faults.add('COLLECTION_WRONG_RELAY');
 }
 for(const x of allocations){
  if(x.collection_order_id&&ids(x.collection_order_id)!==ids(order.id))
   faults.add('DEPOSIT_ALLOCATION_FOREIGN_COLLECTION_ORDER');
  if(x.market_id&&order.market_id&&ids(x.market_id)!==ids(order.market_id))
   faults.add('DEPOSIT_ALLOCATION_FOREIGN_MARKET');
  if(x.deposit_market_id&&order.market_id&&ids(x.deposit_market_id)!==ids(order.market_id))
   faults.add('CASH_DEPOSIT_FOREIGN_MARKET');
  if(x.deposit_status==='verified'&&x.deposit_movement_kind==='FINAL'&&!x.final_control_proved)
   gaps.add('FINAL_DEPOSIT_VERIFIED_WITHOUT_CONTROL_PROOF');
 }
 for(const x of paymentCosts){
  if(ids(x.order_id)!==ids(order.id))faults.add('PAYMENT_COST_FOREIGN_ORDER');
  if(x.item_order_id&&ids(x.item_order_id)!==ids(order.id))
   faults.add('PAYMENT_COST_FOREIGN_ITEM_ORDER');
  if(n(x.amount_kmf)===null||n(x.amount_kmf)<0)faults.add('PAYMENT_COST_INVALID_KMF');
  if(!x.provenance)gaps.add('PAYMENT_COST_PROVENANCE_NOT_DECLARED');
 }
 if(payment?.state==='real'&&n(payment.real_kmf)!==null&&
  Math.abs(realFees-n(payment.real_kmf))>1.01)
  faults.add('P6_PAYMENT_FEE_SHADOW_NOT_ALLOCATION_CONSISTENT');
 // A payment fee may be real without settled client funds; do NOT silently
 // characterize that as a financial mismatch unless an independent owner
 // rules that posting a fee before collection is forbidden.
 if(actual.length&&!collections.length&&cash)
  gaps.add('ACTUAL_PAYMENT_FEE_WITHOUT_CASH_COLLECTION');
 const sourceStatus='UNKNOWN'; // signed PSP or order-attributed FINAL custody is absent
 const targetStatus=payment?.state==='real'?'PROVED':'UNKNOWN';
 const proof=record('P5_P6_CASH_REALITY',sourceStatus,targetStatus,
  {order_id:order.id},{order_id:shadow?.order_id||null},
  {payment_mode:order.payment_mode,payment_status:order.payment_status,
   customer_collection_kmf:collected,payment_fee_real_kmf:realFees,
   payment_fee_shadow_state:payment?.state||'MISSING',
   confirmed_deposit_allocations:evidence.length,reconstructed_deposit_allocations:reconstructed.length,
   number_of_collections:collections.length,
   synthetic,order_total_kmf:n(order.total_kmf)});
 proof.crossContradictions=[...faults];
 return {proofs:{P5_P6_CASH_REALITY:proof},
  diagnostics:{gaps:[...gaps],contradictions:[...faults],evidence_level:'NOT_PSP_OR_CASH_FINAL_CERTIFICATION'},
  facts:{order_id:order.id,synthetic,mode:order.payment_mode,
    collections:collections.length,collection_kmf:collected,
    actual_fee_allocations:actual.length,actual_fee_kmf:realFees,
    shadow_fee_state:payment?.state||null,
    confirmed_cash_allocations:evidence.length,reconstructed_cash_allocations:reconstructed.length},
  owner_provenance:{
    cash_collection:'cash_collections by exact order_id; writer services/cash-operations.collectCash',
    deposit_attribution:'cash_deposit_allocations and cash_deposits; custodial source services/cash-deposit-service',
    economic:'services/cost-allocation/real-margin-shadow.computeOrderRealMarginShadow',
    customer_signed_psp:false,
    final_cash_control_attributed_to_order:false,
  }};
}
async function collectP5P6Canonical(db,{item,upstream,readers={}}={}){
 if(!db||typeof db.query!=='function'||!item?.order_id)
  throw Error('P5-P6 exact order id and executor required');
 const {rows}=await db.query(
  'SELECT id,reference,market_id,relais_id,payment_mode::text AS payment_mode,'+
  'payment_status::text AS payment_status,stripe_payment_id,total_kmf '+
  'FROM orders WHERE id=$1',[item.order_id]);
 if(rows.length!==1)throw Error('P5_P6_EXACT_ORDER_MISSING_OR_AMBIGUOUS');
 const order=rows[0];
 const {rows:collections}=await db.query(
  'SELECT id,order_id,relais_id,amount_kmf FROM cash_collections WHERE order_id=$1',
  [order.id]);
 const {rows:allocations}=collections.length?await db.query(
  'SELECT da.collection_id,da.market_id,da.amount_kmf,da.allocation_basis,'+
  'd.market_id AS deposit_market_id,d.status AS deposit_status,'+
  'd.movement_kind AS deposit_movement_kind,cc.order_id AS collection_order_id '+
  'FROM cash_deposit_allocations da JOIN cash_deposits d ON d.id=da.deposit_id '+
  'JOIN cash_collections cc ON cc.id=da.collection_id '+
  'WHERE da.collection_id=ANY($1::uuid[])',
  [collections.map(c=>c.id)]):{rows:[]};
 const {rows:paymentCosts}=await db.query(
  "SELECT ca.id,ca.order_id,ca.order_item_id,oi.order_id AS item_order_id,"+
  "ca.amount_kmf,ca.is_actual,ca.provenance,ca.source "+
  "FROM order_item_real_cost_allocations ca "+
  "LEFT JOIN order_items oi ON oi.id=ca.order_item_id "+
  "WHERE ca.order_id=$1 AND ca.cost_type='payment'",[order.id]);
 const margin=readers.realMargin||
  require('../../services/cost-allocation/real-margin-shadow').computeOrderRealMarginShadow;
 const shadow=await margin(order.id,{client:db});
 const paymentGate=upstream?.gates?.find(g=>g.key==='PAYMENT_FINAL_PROVED')||null;
 return assessP5P6({order,collections,allocations,paymentCosts,shadow,paymentGate,
  provenance:upstream?.dossier?.provenance||null});
}
module.exports={assessP5P6,collectP5P6Canonical};
