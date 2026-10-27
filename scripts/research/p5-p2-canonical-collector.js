'use strict';
/**
 * P5->P2 read-only Finance / Order closure seam, research only.
 *
 * Payment ownership: Golden payment final gate is an existing projection,
 * NOT proof of a remote PSP webhook. Independently check the persistent
 * Stripe reference flagged by services/finance-metrics/payments.js.
 * Physical/economic closure ownership: reconcileOrderFinancialClose, which
 * is a read-only business projection, NOT a PSP verification service.
 *
 * A synthetic Golden has payment_status=paid but deliberately no PSP proof.
 * This MUST yield EVIDENCE_GAP, NOT a production payment violation.
 */
const {record,statusOfGate}=require('./p1-p7-canonical-collector');

function assessP5P2({order=null,paymentGate=null,checkoutProvenance=null,closure=null,cash=null}={}) {
 if(!order?.id)throw Error('Persisted exact financial order required');
 const gaps=[],contradictions=[];
 const synthetic=checkoutProvenance==='SYNTHETIC_GOLDEN_CREATE' ||
   /^K-GOLDEN-/i.test(String(order.reference||''));
 const mode=String(order.payment_mode||''),paid=order.payment_status==='paid';
 const stripe=mode==='stripe_eur',cashRelais=mode==='cash_relais';
 const pspRef=Boolean(String(order.stripe_payment_id||'').trim());
 const gate=statusOfGate(paymentGate);
 const closeStatus=closure?.verdict==='FINANCIAL_CLOSE_MATCHED'?'PROVED':
   closure?.verdict==='FINANCIAL_CLOSE_MISMATCH'?'BLOCKED':'UNKNOWN';
 const sourceStatus=synthetic?'UNKNOWN':
   stripe&&paid&&!pspRef?'BLOCKED':
   stripe&&paid&&pspRef&&gate==='PROVED'?'PROVED':
   stripe&&!paid&&order.status==='collected'?'BLOCKED':'UNKNOWN';
 if(synthetic)gaps.push('SYNTHETIC_PAYMENT_NOT_PSP_PROOF');
 if(stripe&&!pspRef)gaps.push('STRIPE_PAID_NO_PSP_REFERENCE');
 if(stripe&&pspRef)gaps.push('PSP_REFERENCE_NOT_EXTERNAL_SETTLEMENT_PROOF');
 if(cashRelais){
  if(!cash||!Number.isFinite(Number(cash.collected_kmf)))
   gaps.push('CASH_COLLECTION_NOT_INDEPENDENTLY_READ');
  else if(Number(cash.collected_kmf)<Number(order.total_kmf||0))
   gaps.push('CASH_COLLECTION_INSUFFICIENT_OR_UNRECONCILED');
  gaps.push('CASH_FINAL_REMITTANCE_NOT_ORDER_ATTRIBUTABLE');
 }
 if(!stripe&&!cashRelais)gaps.push('PAYMENT_MODE_NOT_WIRED:'+mode);
 if(gate!=='PROVED')gaps.push('CANONICAL_PAYMENT_GATE_NOT_PROVED');
 if(!closure)gaps.push('FINANCIAL_CLOSURE_OWNER_NOT_RUN');
 if(closure?.order_id && String(closure.order_id)!==String(order.id))
  contradictions.push('FINANCIAL_CLOSE_FOREIGN_ORDER');
 if(stripe&&!synthetic&&paid&&!pspRef&&closeStatus==='PROVED')
  contradictions.push('CLOSE_MATCHED_WITHOUT_STRIPE_REFERENCE');
 // The closure owner accepts refunded/cancelled terminal paths. Do not
 // mistake those for a proved, newly paid customer checkout.
 if(['refund','cancel'].includes(String(closure?.mode||''))) {
  gaps.push('REFUND_OR_CANCELLATION_NOT_POSITIVE_CUSTOMER_COLLECTION');
 }
 const proof=record('P5_P2_PAYMENT_CLOSURE',sourceStatus,closeStatus,
  {order_id:order.id},{order_id:closure?.order_id||null},
  {payment_mode:mode,payment_status:order.payment_status||null,
   payment_gate:paymentGate?.status||'MISSING',psp_reference_present:pspRef,
   synthetic,closure_verdict:closure?.verdict||'NOT_RUN',
   closure_mode:closure?.mode||null,closure_reason:closure?.reason||null,
   cash_collection_count:cash?.collection_count??null,
   cash_collected_kmf:cash?.collected_kmf??null});
 proof.crossContradictions=contradictions;
 // Classification carries independent evidence gaps separate from the
 // generic identity oracle. Missing PSP evidence MUST remain a gap even if
 // the two status identities agree (both order IDs equal).
 if(gaps.length && proof.source.status==='PROVED')
   proof.source.status='UNKNOWN';
 return {proofs:{P5_P2_PAYMENT_CLOSURE:proof},
  diagnostics:{contradictions,gaps,finance_outcome:'NOT_CERTIFICATION'},
  facts:{order_id:order.id,mode,paid,psp_reference_present:pspRef,
   closure_verdict:closure?.verdict||null,closure_mode:closure?.mode||null,
   synthetic,cash_collection_count:cash?.collection_count??null},
  owner_provenance:{
   payment:'services/golden-checkout-thread.loadPaymentFinalGate via upstream.gates',
   missing_psp_ref:'services/finance-metrics/payments.js GAP 3a',
   closure:'services/order-financial-closure-reconciliation.reconcileOrderFinancialClose',
   provider_confirmed:false,settlement_confirmed:false}};
}
async function collectP5P2Canonical(db,{item,upstream,readers={}}={}) {
 if(!db||typeof db.query!=='function'||!item?.order_id)
  throw Error('Exact order item with order_id required');
 const {rows}=await db.query(
  'SELECT id,reference,status::text AS status,payment_status::text AS payment_status,'+
  'payment_mode::text AS payment_mode,stripe_payment_id,total_kmf,total_eur '+
  'FROM orders WHERE id=$1 LIMIT 2',[item.order_id]);
 if(rows.length!==1)throw Error('FINANCE_ORDER_NOT_UNIQUE_OR_MISSING');
 const order=rows[0];
 let cash=null;
 if(order.payment_mode==='cash_relais'){
  const result=await db.query(
   'SELECT COUNT(*)::int AS collection_count,'+
   'COALESCE(SUM(amount_kmf),0)::numeric AS collected_kmf '+
   'FROM cash_collections WHERE order_id=$1',[order.id]);
  cash={collection_count:Number(result.rows[0]?.collection_count||0),
   collected_kmf:Number(result.rows[0]?.collected_kmf||0)};
 }
 const closureFn=readers.closure||
  require('../../services/order-financial-closure-reconciliation').reconcileOrderFinancialClose;
 const closure=await closureFn(db,{orderId:order.id});
 const paymentGate=upstream?.gates?.find(g=>g.key==='PAYMENT_FINAL_PROVED')||null;
 return assessP5P2({order,paymentGate,
  checkoutProvenance:upstream?.dossier?.provenance||null,closure,cash});
}
module.exports={assessP5P2,collectP5P2Canonical};
