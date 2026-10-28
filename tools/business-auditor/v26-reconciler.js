'use strict';
/**
 * Research-only V2.6 reconciler. No provider CREATE/refund calls, no HTTP route,
 * no production migrations. All writes are restricted to kba_* local clones.
 * Provider read is a SEPARATE, read-only evidence function; it is NOT a real
 * PayPal capability for looking up refund by idempotency key.
 */
const {isolated}=require('./v24-durable-intent-counterfactual');
const validKey=/^kmr-ref-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function reject(code){return {decision:code,repaired:false,providerWrites:0}}
function strictProvider(e,order,intent){
 if(!e||typeof e!=='object'||!/^PP-V25-REF-[0-9]+$/.test(String(e.id))||
  e.status!=='COMPLETED'||e.currency!=='EUR'||
  e.captureId!==order.paypal_capture_id||
  e.providerRequestKey!==intent.provider_request_key||
  !Number.isFinite(Number(e.amountEur))||
  Math.round(Number(e.amountEur)*100)!==Math.round(Number(intent.amount_eur)*100))
  return false;
 return true;
}
async function reconcile({db,orderId,readProvider,crashBeforeCommit=false}){
 isolated();
 if(typeof db?.getClient!=='function'||typeof orderId!=='string'||
   !/^[a-f0-9-]{36}$/i.test(orderId)||typeof readProvider!=='function')
  throw Error('V26_TOOL_ERROR: invalid dependencies');
 // App dependencies are intentionally loaded only after clone validation;
 // static contract tests run before npm dependencies are installed in CI.
 const {recordExternalRefund}=require('../../services/refund-service');
 const {markRefunded}=require('../../services/payment-service');
 const {transitionOrderStatus}=require('../../services/order-status-machine');
 // This transaction uses the REAL order/payment/refund owners, but only for
 // a test-clone repair. It must never be promoted without domain review.
 const c=await db.getClient();
 let began=false,committed=false;
 try{
  await c.query('BEGIN');began=true;
  await c.query("SET LOCAL statement_timeout = '5000ms'");
  const {rows:[order]}=await c.query(
   'SELECT id,status,payment_status,payment_mode,total_eur,total_kmf,paypal_capture_id FROM orders WHERE id=$1 FOR UPDATE',
   [orderId]);
  const {rows:[intent]}=await c.query(
   'SELECT order_id,owner,state,amount_eur,amount_kmf,provider_request_key,provider_refund_id FROM kba_refund_intents WHERE order_id=$1 FOR UPDATE',
   [orderId]);
  if(!order||!intent||intent.owner!=='paypal'||
    !['reserved','completed','reconciliation_required'].includes(intent.state)||
    !validKey.test(intent.provider_request_key||'')||
    order.payment_mode!=='paypal_eur'||
    !['paid','refunded'].includes(order.payment_status)||
    Math.round(Number(order.total_eur)*100)!==Math.round(Number(intent.amount_eur)*100)||
    Number(order.total_kmf)!==Number(intent.amount_kmf)||
    Number(order.total_kmf)<=0||
    !order.paypal_capture_id)
   return reject('MANUAL_INCONSISTENT_LOCAL_STATE');
  const evidence=await readProvider({key:intent.provider_request_key,
    captureId:order.paypal_capture_id});
  // No positive provider evidence is NOT evidence of absence; never auto-release.
  if(evidence?.status!=='AVAILABLE'||!Array.isArray(evidence.events))
   return reject('MANUAL_PROVIDER_UNAVAILABLE_OR_UNKNOWN');
  if(evidence.events.length===0)return reject('MANUAL_NO_POSITIVE_PROVIDER_PROOF');
  if(evidence.events.length!==1||
    !strictProvider(evidence.events[0],order,intent))
   return reject('MANUAL_PROVIDER_PROOF_MISMATCH');
  const event=evidence.events[0];
  const {rows:records}=await c.query(
   'SELECT id,refund_method,refund_type,status,amount_eur,amount_kmf,stripe_refund_id FROM refunds WHERE order_id=$1 FOR UPDATE',
   [orderId]);
  if(records.length>1||records.some(r=>
    r.refund_method!=='paypal'||r.refund_type!=='full'||
    r.status!=='completed'||r.stripe_refund_id!==event.id||
    Math.round(Number(r.amount_eur)*100)!==Math.round(Number(intent.amount_eur)*100)||
    Number(r.amount_kmf)!==Number(intent.amount_kmf)))
   return reject('MANUAL_CANONICAL_LEDGER_CONFLICT');
  if(intent.state==='completed'){
   if(records.length!==1||intent.provider_refund_id!==event.id||
      order.status!=='refunded'||order.payment_status!=='refunded')
    return reject('MANUAL_COMPLETED_INTENT_INCONSISTENT');
   await c.query('COMMIT');committed=true;
   return {decision:'ALREADY_RECONCILED',repaired:false,providerWrites:0};
  }
  if(intent.provider_refund_id&&intent.provider_refund_id!==event.id)
   return reject('MANUAL_PROVIDER_ID_CONFLICT');
  if(records.length===0){
   // Canonical owner, NOT a direct SQL INSERT. It must return a real row;
   // ON CONFLICT DO NOTHING without a matching row is a hard failure.
   const id=await recordExternalRefund(c,{
    orderId,amountKmf:Number(intent.amount_kmf),
    amountEur:Number(intent.amount_eur),refundType:'full',
    method:'paypal',externalRefundId:event.id,
    reason:'R&D V2.6 provider-reconciliation',
    initiatedBy:null,conflictOn:'order_refund_type'});
   if(!id)throw Error('V26_TOOL_ERROR: canonical refund insert conflict');
  }
  const payment=await markRefunded(orderId,{client:c});
  if(!payment.changed&&order.payment_status!=='refunded')
   throw Error('V26_TOOL_ERROR: payment status transition rejected');
  const transition=await transitionOrderStatus({orderId,
   newStatus:'refunded',actor:{id:null,role:'admin'},
   source:'refund_external',note:'V2.6 verified provider reconciliation',
   dbClient:c});
  if(!transition.success||(!transition.noop&&transition.newStatus!=='refunded'))
   throw Error('V26_TOOL_ERROR: canonical order status rejected');
  const update=await c.query(
   "UPDATE kba_refund_intents SET state='completed',provider_refund_id=$2 WHERE order_id=$1 AND owner='paypal' AND state IN ('reserved','reconciliation_required')",
   [orderId,event.id]);
  if(update.rowCount!==1)throw Error('V26_TOOL_ERROR: intent completion raced');
  if(crashBeforeCommit){
   // Transaction deliberately rolls back on process death.
   if(process.env.KBA_V26_CRASH_ALLOWED!=='true')
    throw Error('V26_TOOL_ERROR: crash not allowed');
   process.exit(86);
  }
  await c.query('COMMIT');committed=true;
  return {decision:'RECONCILED_WITH_PROVIDER_PROOF',
    repaired:true,providerWrites:0};
 }finally{
  if(began&&!committed)await c.query('ROLLBACK').catch(()=>{});
  c.release();
 }
}
module.exports={reconcile,strictProvider};
