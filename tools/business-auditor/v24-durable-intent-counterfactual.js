'use strict';
/**
 * R&D V2.4 COUNTERFACTUAL, NOT a production fix.
 * Both refund owners cooperate on an order-scoped durable claim persisted in
 * the disposable PostgreSQL clone. A committed PayPal reservation precedes
 * any PSP side-effect, with a provider idempotency key fixed at reservation.
 *
 * Real processRefund, cancel handler and refundPaypalOrder execute behind these
 * test-only wrappers. The same V2.2 financial oracle remains unchanged.
 *
 * Deliberate limitations: only full refunds supported; legacy other writers
 * do not participate; crashed/ambiguous PSP result requires reconciliation;
 * no HTTP middleware or distributed recovery proven.
 */
const crypto=require('node:crypto');
const SQL_CREATE=[
 'CREATE TABLE IF NOT EXISTS kba_refund_intents (',
 'order_id uuid PRIMARY KEY REFERENCES orders(id),',
 "owner text NOT NULL CHECK(owner IN ('paypal','wallet_credit')),",
 "state text NOT NULL CHECK(state IN ('reserved','completed','reconciliation_required')),",
 'amount_eur numeric(14,2) NOT NULL, amount_kmf bigint NOT NULL,',
 'provider_request_key text UNIQUE, provider_refund_id text,',
 'created_at timestamptz NOT NULL DEFAULT now(),',
 "CHECK ((owner='paypal' AND provider_request_key IS NOT NULL) OR",
 "       (owner='wallet_credit' AND provider_request_key IS NULL)))"
].join(' ');
function isolated() {
 const u=new URL(process.env.DATABASE_URL||'');
 if(process.env.NODE_ENV!=='test'||process.env.KOMERCE_DISABLE_CRONS!=='true'||
   process.env.KBA_V24_MUTANT!=='DURABLE_INTENT_COUNTERFACTUAL'||
   !['localhost','127.0.0.1','::1'].includes(u.hostname)||
   !/^\/kba_[a-f0-9]{18}$/.test(u.pathname))
  throw Error('TOOL_ERROR: V2.4 only authorized for isolated local clone');
}
function blocked(message) {
 return {status:409,body:{success:false,code:'KBA_V24_CLAIM_CONFLICT',error:message}};
}
async function bootstrap(db) {
 isolated();
 await db.query(SQL_CREATE);
}
function wrapCancellation(original) {
 isolated();
 if(typeof original!=='function')throw Error('TOOL_ERROR: cancellation owner missing');
 return async function claimBeforeWallet(dbClient,order,amountKmf,amountEur,refundType,reason,initiatedBy,parcelId) {
  isolated();
  if(!order?.id||typeof dbClient?.query!=='function')
   throw Error('TOOL_ERROR: cancellation claim cannot use untrusted DB');
  // This INSERT is in the REAL cancel handler's existing transaction,
  // before processRefund performs a wallet credit. The unique order_id
  // serializes a simultaneous PayPal claim. Rollback undoes the claim.
  const {rows}=await dbClient.query(
    "INSERT INTO kba_refund_intents(order_id,owner,state,amount_eur,amount_kmf) VALUES($1,'wallet_credit','reserved',$2,$3) ON CONFLICT(order_id) DO NOTHING RETURNING order_id",
    [order.id,amountEur,amountKmf]);
  if(rows.length!==1) {
   const e=Error('Refund already reserved by another financial owner');
   e.code='REFUND_INTENT_CONFLICT';e.status=409;e.statusCode=409;
   throw e;
  }
  const result=await original(dbClient,order,amountKmf,amountEur,refundType,reason,initiatedBy,parcelId);
  await dbClient.query(
    "UPDATE kba_refund_intents SET state='completed' WHERE order_id=$1 AND owner='wallet_credit' AND state='reserved'",
    [order.id]);
  return result;
 };
}
function wrapPaypal(original) {
 isolated();
 if(typeof original!=='function')throw Error('TOOL_ERROR: PayPal owner missing');
 return async function reserveBeforePaypal(input) {
  isolated();
  const db=input?.db;
  if(!input?.orderId||typeof db?.getClient!=='function'||typeof input.paypal?.refundCapture!=='function')
   throw Error('TOOL_ERROR: missing PayPal owner dependencies');
  const client=await db.getClient();
  let key=null,committed=false;
  try {
   await client.query('BEGIN');
   const {rows:[order]}=await client.query(
    'SELECT * FROM orders WHERE id=$1 FOR UPDATE',[input.orderId]);
   if(!order||order.payment_status!=='paid'||
     ['cancelled','refunded'].includes(order.status))return blocked('Order not financially eligible');
   const requested=input.amountEur==null?Number(order.total_eur):Number(input.amountEur);
   // Full capture only: unsafe partial-refund semantics are never guessed.
   if(!Number.isFinite(requested)||Math.abs(requested-Number(order.total_eur))>0.001||
     !Number.isFinite(Number(order.total_kmf))||Number(order.total_kmf)<=0)
    return blocked('V2.4 counterfactual only supports full captured refund');
   const {rows:existing}=await client.query(
    'SELECT id FROM refunds WHERE order_id=$1 LIMIT 1',[input.orderId]);
   if(existing.length)return blocked('A refund already exists in the canonical ledger');
   key='kmr-ref-'+crypto.randomUUID();
   const {rows:claim}=await client.query(
    "INSERT INTO kba_refund_intents(order_id,owner,state,amount_eur,amount_kmf,provider_request_key) VALUES($1,'paypal','reserved',$2,$3,$4) ON CONFLICT(order_id) DO NOTHING RETURNING order_id",
    [input.orderId,requested,Number(order.total_kmf),key]);
   if(claim.length!==1)return blocked('Refund already reserved by another financial owner');
   await client.query('COMMIT');committed=true;
  }finally {
   if(!committed)await client.query('ROLLBACK').catch(()=>{});
   client.release();
  }
  // The provider key comes from the COMMITTED intent, not Date.now().
  const paypal={...input.paypal,refundCapture:(captureId,options)=>
   input.paypal.refundCapture(captureId,{...options,providerRequestKey:key})};
  let response;
  try {
   response=await original({...input,paypal});
  } catch(err) {
   await db.query(
    "UPDATE kba_refund_intents SET state='reconciliation_required' WHERE order_id=$1 AND state='reserved'",
    [input.orderId]);
   throw err;
  }
  if(response?.status!==200) {
   await db.query(
    "UPDATE kba_refund_intents SET state='reconciliation_required' WHERE order_id=$1 AND state='reserved'",
    [input.orderId]);
   return response;
  }
  // An HTTP 200 must not hide a PSP payment with a missing canonical refund.
  const extId=response.body?.refund_id;
  const {rows:ledger}=await db.query(
    "SELECT id,amount_eur,status FROM refunds WHERE order_id=$1 AND refund_method='paypal' AND stripe_refund_id=$2",
    [input.orderId,extId||'']);
  if(!extId||ledger.length!==1||ledger[0].status!=='completed'||
    Math.abs(Number(ledger[0].amount_eur)-Number(input.amountEur||20))>0.001) {
   await db.query(
    "UPDATE kba_refund_intents SET state='reconciliation_required' WHERE order_id=$1 AND state='reserved'",
    [input.orderId]);
   throw Error('REFUND_V24_PSP_LEDGER_RECONCILIATION_REQUIRED');
  }
  await db.query(
    "UPDATE kba_refund_intents SET state='completed',provider_refund_id=$2 WHERE order_id=$1 AND state='reserved' AND owner='paypal'",
    [input.orderId,extId]);
  return response;
 };
}
module.exports={bootstrap,wrapCancellation,wrapPaypal,isolated};
