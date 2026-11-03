/**
 * @komerce-arch
 * @role          e7-sandbox-item-refund-orchestrator
 * @domain        refunds
 * @layer         service
 * @criticality   critical
 * @inputs        reserved item refund, committed intent, sandbox PSP adapters
 * @outputs       provider reconciliation and single financial refund row only after proof
 * @depends       db, refund-intent-ledger, refund-intent-reconciliation, paypal-client, order-item-refund-settlement
 * @used-by       routes/admin/orders.js
 * @db-read       orders, order_item_refund_reservations, refund_execution_intents, refunds
 * @db-write      order_item_refund_reservations, refund_execution_intents, refunds
 * @db-txn        claim committed BEFORE provider network; reconciling provider GET BEFORE lock; finalize short txn
 * @doctrine      no_psp_inside_sql_transaction, durable_intent, no_blind_retry, refund_to_original_payer
 * @impact-areas  orders, refunds, finance
 * @version       2026-11
 */
'use strict';
const defaultDb = require('../db');
const { euroCents, claimRefundIntent } = require('./refund-intent-ledger');
const { reconcileRefundIntent } = require('./refund-intent-reconciliation');
const { applyVerifiedItemRefundToOrderItem } = require('./order-item-refund-settlement');

class ItemRefundExecutionError extends Error {
  constructor(code, message, status=409) { super(message); this.code=code; this.status=status; }
}
const fail=(code,message,status)=>{throw new ItemRefundExecutionError(code,message,status);};

function assertSandbox(env=process.env) {
  if (env.KOMERCE_ENV!=='staging' || env.E7_ITEM_RESERVATIONS_ENABLED!=='1' ||
      env.E7_SANDBOX_REFUND_EXECUTION_ENABLED!=='1') {
    fail('E7_SANDBOX_PSP_DISABLED','Décaissement E7 non certifié ou hors staging',403);
  }
}
async function markUncertain({reservationId,intentId,providerRef=null,db}) {
  // Après appel PSP ambigu, interdiction de rejouer. 'unknown' exige GET PSP vérifié.
  await db.query(
    "UPDATE refund_execution_intents SET status='unknown', provider_ref=COALESCE(provider_ref,$2), updated_at=NOW() WHERE id=$1 AND status='processing'",
    [intentId,providerRef]
  );
  await db.query(
    "UPDATE order_item_refund_reservations SET status='unknown', provider_ref=COALESCE(provider_ref,$2) WHERE id=$1 AND status IN ('reserved','processing')",
    [reservationId,providerRef]
  );
}
async function finalizeVerifiedRefund({reservationId,providerRef,db=defaultDb}) {
  const client=await db.getClient();let tx=false;
  try {
    await client.query('BEGIN');tx=true;
    const {rows:[ref]}=await client.query(
      `SELECT r.id,r.order_id,r.order_item_id,r.quantity,r.amount_kmf,r.amount_eur,r.status,r.provider_ref,
              i.id AS intent_id,i.status AS intent_status,i.provider,i.provider_ref AS intent_provider_ref
       FROM order_item_refund_reservations r
       JOIN refund_execution_intents i ON i.id=r.refund_intent_id
       JOIN orders o ON o.id=r.order_id
       WHERE r.id=$1 FOR UPDATE OF o,r,i`,[reservationId]
    );
    if(!ref)fail('ITEM_REFUND_RESERVATION_NOT_FOUND','Réservation introuvable',404);
    if(ref.status==='confirmed'){
      if(ref.provider_ref!==providerRef)fail('ITEM_REFUND_PROVIDER_REF_CONFLICT','Preuve PSP contradictoire');
      await client.query('COMMIT');tx=false;
      return {reservationId,status:'confirmed',replayed:true,paid:true};
    }
    if(ref.intent_status!=='confirmed'||ref.intent_provider_ref!==providerRef) {
      fail('ITEM_REFUND_NOT_PROVIDER_VERIFIED','Remboursement PSP non rapproché et vérifié');
    }
    const kind='item:'+reservationId;
    const {rows:[created]}=await client.query(
      `INSERT INTO refunds(order_id,amount_kmf,amount_eur,refund_type,refund_method,
         stripe_refund_id,reason,status,completed_at)
       VALUES($1,$2,$3,$4,$5,$6,'Indemnisation article manquant attesté','completed',NOW())
       ON CONFLICT(order_id,refund_type) DO NOTHING RETURNING id`,
      [ref.order_id,ref.amount_kmf,ref.amount_eur,kind,ref.provider,
       ref.provider==='stripe'?providerRef:null]
    );
    if(!created){
      const {rows:[existing]}=await client.query(
        'SELECT id,amount_kmf,amount_eur,refund_method,stripe_refund_id,status FROM refunds WHERE order_id=$1 AND refund_type=$2',
        [ref.order_id,kind]
      );
      if(!existing||String(existing.amount_kmf)!==String(ref.amount_kmf)||
        String(existing.amount_eur)!==String(ref.amount_eur)||
        existing.refund_method!==ref.provider||
        (ref.provider==='stripe'&&existing.stripe_refund_id!==providerRef)||
        existing.status!=='completed') {
        fail('ITEM_REFUND_FINANCIAL_REPLAY_CONFLICT','Remboursement financier antérieur incohérent');
      }
    }
    // Transaction commune: passer la réservation en confirmed AVANT d'incrémenter
    // qty_refunded. Le garde PostgreSQL bloque les remises concurrentes tant
    // qu'une réservation est active, sans compter deux fois la même quantité.
    const state = await client.query(
      "UPDATE order_item_refund_reservations SET status='confirmed',provider_ref=$2,resolved_at=NOW() WHERE id=$1 AND status IN('reserved','processing','unknown') RETURNING id",
      [reservationId,providerRef]
    );
    if(state.rows.length!==1)fail('ITEM_REFUND_FINALIZATION_CONFLICT',
      'Réservation modifiée avant confirmation');
    await applyVerifiedItemRefundToOrderItem(client,{
      orderId:ref.order_id,orderItemId:ref.order_item_id,quantity:Number(ref.quantity)
    });
    await client.query('COMMIT');tx=false;
    return {reservationId,status:'confirmed',replayed:false,paid:true};
  } catch(err){if(tx)await client.query('ROLLBACK').catch(()=>{});throw err}
  finally{client.release()}
}

/** Only staging PSP sandbox. No hidden retry after an unknown provider response. */
async function executeReservedItemRefund({reservationId,orderId,orderItemId,actor,db=defaultDb,env=process.env,stripe,paypal}) {
  assertSandbox(env);
  if(!actor||actor.role!=='admin')fail('ITEM_REFUND_ADMIN_REQUIRED','Action financière réservée admin',403);
  const {rows:[reservation]}=await db.query(
    `SELECT r.id,r.status,r.refund_intent_id,r.reason,i.provider,i.capture_ref,i.amount_eur,i.status AS intent_status
       FROM order_item_refund_reservations r
       JOIN refund_execution_intents i ON i.id=r.refund_intent_id
      WHERE r.id=$1 AND r.order_id=$2 AND r.order_item_id=$3`,[reservationId,orderId,orderItemId]
  );
  if(!reservation)fail('ITEM_REFUND_RESERVATION_NOT_FOUND','Réservation introuvable',404);
  if(reservation.status!=='reserved'||reservation.intent_status!=='reserved') {
    fail('ITEM_REFUND_NOT_RETRYABLE','Déjà traité ou état incertain : rapprochement PSP obligatoire');
  }
  if(reservation.provider==='stripe' && !String(env.STRIPE_SECRET_KEY||'').startsWith('sk_test_')) {
    fail('ITEM_REFUND_NOT_STRIPE_TEST_KEY','Clé Stripe test obligatoire',403);
  }
  if(reservation.provider==='paypal' && env.PAYPAL_ENV!=='sandbox') {
    fail('ITEM_REFUND_PAYPAL_NOT_SANDBOX','PayPal sandbox explicite obligatoire pour cette certification',403);
  }
  const stripeAdapter=reservation.provider==='stripe'
    ? stripe||require('stripe')(env.STRIPE_SECRET_KEY):stripe;
  const paypalAdapter=reservation.provider==='paypal'
    ? paypal||require('./paypal-client'):paypal;

  // claimRefundIntent a committé le passage processing avant la sortie PSP.
  const claimed=await claimRefundIntent({intentId:reservation.refund_intent_id,db});
  await db.query(
    "UPDATE order_item_refund_reservations SET status='processing' WHERE id=$1 AND status='reserved'",
    [reservationId]
  );
  let providerRef=null;
  try {
    if(reservation.provider==='stripe') {
      const outcome=await stripeAdapter.refunds.create({
        payment_intent:reservation.capture_ref,
        amount:Number(euroCents(reservation.amount_eur)),
        reason:'requested_by_customer',
        metadata:{komerce:'true',item_refund_reservation_id:reservationId}
      },{idempotencyKey:claimed.providerRequestKey});
      providerRef=outcome?.id||null;
    } else {
      const outcome=await paypalAdapter.refundCapture(reservation.capture_ref,{
        amountEur:Number(reservation.amount_eur),
        reason:reservation.reason,
        providerRequestKey:claimed.providerRequestKey
      });
      providerRef=outcome?.id||null;
    }
    if(!providerRef)fail('ITEM_REFUND_PROVIDER_REF_MISSING','Aucune référence PSP certaine');
    await db.query(
      "UPDATE order_item_refund_reservations SET provider_ref=COALESCE(provider_ref,$2) WHERE id=$1 AND status='processing'",
      [reservationId,providerRef]
    );
    const verdict=await reconcileRefundIntent({
      intentId:reservation.refund_intent_id,providerRefundId:providerRef,
      db,stripe:stripeAdapter,paypal:paypalAdapter
    });
    if(verdict.status==='failed'){
      // Échec PSP définitivement vérifié : libère uniquement la réserve de
      // quantité, sans inventer une ligne refunds ni toucher qty_refunded.
      await db.query(
        "UPDATE order_item_refund_reservations SET status='failed',provider_ref=$2,resolved_at=NOW() WHERE id=$1 AND status='processing'",
        [reservationId,providerRef]
      );
      return {reservationId,status:'failed',paid:false,verified:true};
    }
    if(!verdict.complete){
      await markUncertain({reservationId,intentId:reservation.refund_intent_id,providerRef,db});
      return {reservationId,status:'unknown',paid:null,requiresReconciliation:true};
    }
    return await finalizeVerifiedRefund({reservationId,providerRef,db});
  }catch(err){
    // Unknown NEVER means failed and NEVER authorizes another external POST.
    await markUncertain({reservationId,intentId:reservation.refund_intent_id,providerRef,db});
    return {reservationId,status:'unknown',paid:null,requiresReconciliation:true,
      errorCode:err.code||'PROVIDER_OR_RECONCILIATION_UNCERTAIN'};
  }
}

/** Aucun POST PSP : rapprochement par GET de la référence externe déjà connue. */
async function reconcileUncertainItemRefund({
  reservationId,orderId,orderItemId,providerRefundId,actor,
  db=defaultDb,env=process.env,stripe,paypal
}) {
  assertSandbox(env);
  if(!actor||actor.role!=='admin')fail('ITEM_REFUND_ADMIN_REQUIRED','Rapprochement réservé admin',403);
  if(typeof providerRefundId!=='string'||providerRefundId.length<3||providerRefundId.length>160)
    fail('ITEM_REFUND_REF_INVALID','Référence PSP invalide',400);
  const {rows:[r]}=await db.query(
    `SELECT r.id,r.refund_intent_id,r.status,r.provider_ref,i.provider,i.status AS intent_status
       FROM order_item_refund_reservations r
       JOIN refund_execution_intents i ON i.id=r.refund_intent_id
      WHERE r.id=$1 AND r.order_id=$2 AND r.order_item_id=$3`,
    [reservationId,orderId,orderItemId]
  );
  if(!r)fail('ITEM_REFUND_RESERVATION_NOT_FOUND','Réservation introuvable',404);
  if(r.provider_ref && r.provider_ref!==providerRefundId)
    fail('ITEM_REFUND_PROVIDER_REF_CONFLICT','Référence PSP contraire au journal');
  if(!['processing','unknown','confirmed'].includes(r.intent_status))
    fail('ITEM_REFUND_NOT_RECONCILABLE','Intention jamais passée chez le PSP ou définitivement refusée');
  if(r.provider==='stripe'&&!String(env.STRIPE_SECRET_KEY||'').startsWith('sk_test_'))
    fail('ITEM_REFUND_NOT_STRIPE_TEST_KEY','Clé Stripe test obligatoire',403);
  if(r.provider==='paypal'&&env.PAYPAL_ENV!=='sandbox')
    fail('ITEM_REFUND_PAYPAL_NOT_SANDBOX','Lecture PayPal sandbox explicite obligatoire',403);
  const stripeAdapter=r.provider==='stripe'?stripe||require('stripe')(env.STRIPE_SECRET_KEY):stripe;
  const paypalAdapter=r.provider==='paypal'?paypal||require('./paypal-client'):paypal;
  const result=await reconcileRefundIntent({
    intentId:r.refund_intent_id,providerRefundId,db,stripe:stripeAdapter,paypal:paypalAdapter
  });
  if(result.complete)return finalizeVerifiedRefund({reservationId,providerRef:providerRefundId,db});
  if(result.status==='failed'){
    await db.query(
      "UPDATE order_item_refund_reservations SET status='failed',provider_ref=$2,resolved_at=NOW() WHERE id=$1 AND status<>'confirmed'",
      [reservationId,providerRefundId]
    );
    return {reservationId,status:'failed',paid:false,verified:true};
  }
  await markUncertain({reservationId,intentId:r.refund_intent_id,providerRef:providerRefundId,db});
  return {reservationId,status:'unknown',paid:null,requiresReconciliation:true};
}

module.exports={ItemRefundExecutionError,assertSandbox,executeReservedItemRefund,reconcileUncertainItemRefund,finalizeVerifiedRefund};
