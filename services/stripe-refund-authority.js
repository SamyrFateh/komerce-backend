/**
 * @komerce-arch
 * @role          durable-stripe-business-refund-orchestrator
 * @domain        refunds
 * @layer         service
 * @criticality   critical
 * @inputs        committed intent for cancellation or backorder, original Stripe capture, verified provider evidence
 * @outputs       confirmed refund ledger row, explicit unknown/held status
 * @depends       db.js, services/refund-intent-ledger.js, services/refund-intent-reconciliation.js, services/refund-service.js, services/payment-service.js, services/order-status-machine.js, services/documents/refund-receipt.js, utils/alerts.js, utils/logger.js
 * @used-by       routes/orders/cancel.js, services/parcel-operations.js
 * @db-read       orders, refunds, refund_execution_intents
 * @db-write      refunds, refund_execution_intents, orders, order_status_history
 * @db-txn        reserve_business_commit_then_claim_commit_then_provider_network_then_settlement_commit
 * @doctrine      stable_idempotency_key, external_post_after_commit_only, no_wallet_fallback, unknown_fail_closed, refund_original_payer
 * @impact-areas  payments, refunds, orders, logistics, finance
 * @version       2026-11
 */
'use strict';

const defaultDb = require('../db');
const { reserveRefundIntentInTransaction, claimRefundIntent, euroCents, euroString, RefundIntentError } = require('./refund-intent-ledger');
const { reconcileRefundIntent } = require('./refund-intent-reconciliation');
const { recordExternalRefund } = require('./refund-service');
const { markRefunded } = require('./payment-service');
const { transitionOrderStatus, appendOrderHistoryNote } = require('./order-status-machine');
const receiptService = require('./documents/refund-receipt');
const { createAlert } = require('../utils/alerts');
const log = require('../utils/logger').child({ module: 'stripe-refund-authority' });

function fail(code, message, status = 409) {
  throw new RefundIntentError(code, message, status);
}
function stripeSandboxAllowed(env = process.env) {
  return env.KOMERCE_ENV === 'staging' &&
    env.FINANCE_DURABLE_REFUNDS_ENABLED === '1' &&
    /^sk_test_/.test(env.STRIPE_SECRET_KEY || '');
}
function pending(intentId, status, extra = {}) {
  return { status: 202, body: { success: false, intent_id: intentId,
    refund_status: status, requires_reconciliation: true, ...extra } };
}
async function alertHold({ db, orderId, intentId, code, providerRef = null }) {
  try {
    await createAlert(db, {
      type: 'refund_provider_reconciliation_required', entityType: 'order', entityId: orderId,
      severity: 'high', title: 'Remboursement Stripe en attente de rapprochement',
      description: `intent=${intentId}, reference=${providerRef || 'unknown'}, reason=${code}; jamais de re-POST automatique`,
    });
  } catch (error) {
    log.error({ error, orderId, intentId, code }, '[FINANCE] alerte de remboursement non persistée');
  }
}

/** Called INSIDE business transaction, before order/parcel mutation COMMIT. No PSP call. */
async function reserveStripeBusinessRefund(client, {
  order, amountEur, operationKey, initiatedBy,
}) {
  if (order.payment_mode !== 'stripe_eur' || !order.stripe_payment_id) {
    fail('REFUND_STRIPE_CAPTURE_MISSING', 'Capture Stripe originale introuvable');
  }
  if (order.payment_status !== 'paid') {
    fail('REFUND_PAYMENT_NOT_CONFIRMED', 'Commande non payée');
  }
  return reserveRefundIntentInTransaction(client, {
    orderId: order.id, provider: 'stripe', captureRef: order.stripe_payment_id,
    amountEur: euroString(euroCents(amountEur)), operationKey,
    initiatedBy,
  });
}

async function markUnknown(db, intentId, providerRef) {
  const r = await db.query(
    "UPDATE refund_execution_intents SET status='unknown',provider_ref=COALESCE(provider_ref,$2),updated_at=NOW() WHERE id=$1 AND status='processing' RETURNING id",
    [intentId, providerRef || null]
  );
  if (r.rows.length !== 1) fail('REFUND_STRIPE_UNKNOWN_PERSIST_FAILED', 'État incertain non persisté');
}

/** Atomic financial settlement; the provider GET must already have confirmed
 * refund id + source payment intent + exact EUR amount and currency. */
async function settleStripeRefund({ orderId, intentId, actorId = null, db = defaultDb }) {
  const client = await db.connect();
  let tx = false;
  let refundId, providerRef, full = false, replayed = false;
  try {
    await client.query('BEGIN'); tx = true;
    const { rows: [row] } = await client.query(
      `SELECT o.id AS order_id,o.status AS order_status,o.payment_status,o.total_kmf,o.total_eur,
              o.stripe_payment_id,i.provider,i.status AS intent_status,i.provider_ref,
              i.capture_ref,i.amount_eur,i.operation_key
         FROM orders o JOIN refund_execution_intents i ON i.order_id=o.id
        WHERE o.id=$1 AND i.id=$2 FOR UPDATE OF o,i`,
      [orderId,intentId]
    );
    if (!row || row.provider !== 'stripe' || row.intent_status !== 'confirmed' ||
        !row.provider_ref || row.capture_ref !== row.stripe_payment_id ||
        !/^(?:cancel:order:|backorder:parcel:)/.test(row.operation_key)) {
      fail('REFUND_STRIPE_NOT_VERIFIED', 'Intention Stripe non rapprochée ou capture incorrecte');
    }
    providerRef = row.provider_ref;
    const totalCents = euroCents(row.total_eur);
    const cents = euroCents(row.amount_eur);
    const totalKmf = Number(row.total_kmf);
    if (!Number.isSafeInteger(totalKmf) || totalKmf < 0 || cents > totalCents) {
      fail('REFUND_STRIPE_AMOUNT_INVALID','Montant KMF/EUR figé invalide');
    }
    const amountKmf = Number((BigInt(totalKmf) * cents + totalCents / 2n) / totalCents);
    const refundType = 'stripe_intent:' + intentId;
    const { rows: [previous] } = await client.query(
      'SELECT id,amount_kmf,amount_eur,stripe_refund_id,refund_method,status FROM refunds WHERE order_id=$1 AND refund_type=$2 FOR UPDATE',
      [orderId,refundType]
    );
    if (previous) {
      if (previous.status !== 'completed' || previous.refund_method !== 'stripe' ||
          previous.stripe_refund_id !== providerRef ||
          euroCents(previous.amount_eur) !== cents || Number(previous.amount_kmf) !== amountKmf) {
        fail('REFUND_STRIPE_SETTLEMENT_CONFLICT','Écriture financière déjà présente mais contradictoire');
      }
      refundId = previous.id; replayed = true;
    } else {
      refundId = await recordExternalRefund(client,{
        orderId, amountKmf, amountEur: Number(row.amount_eur),
        refundType, method:'stripe', externalRefundId:providerRef,
        reason: row.operation_key.startsWith('backorder:') ? 'Backorder annulé — remboursement PSP vérifié'
          : 'Annulation commande — remboursement PSP vérifié',
        initiatedBy: actorId, conflictOn: 'order_refund_type',
      });
      if (!refundId) fail('REFUND_STRIPE_SETTLEMENT_MISSING','Journal de remboursement introuvable');
    }
    const { rows: [totals] } = await client.query(
      "SELECT COALESCE(SUM(amount_eur),0)::text AS eur FROM refunds WHERE order_id=$1 AND status='completed'",
      [orderId]
    );
    const refunded = euroCents(totals?.eur || '0', true);
    if (refunded > totalCents) fail('REFUND_STRIPE_EXCEEDS_CAPTURE','Remboursement supérieur au montant encaissé');
    full = refunded === totalCents;
    if (!replayed) {
      if (full) {
        const marked = await markRefunded(orderId,{client});
        if (!marked.changed) fail('REFUND_STRIPE_PAYMENT_STATUS_CONFLICT','Statut paiement incohérent');
        const changed = await transitionOrderStatus({
          orderId,newStatus:'refunded',source:'refund_external',
          actor:{id:actorId,role:'admin'},dbClient:client,
          note:'Remboursement Stripe intégral vérifié '+providerRef,
        });
        if (!changed.success) fail('REFUND_STRIPE_STATUS_CONFLICT',changed.error||'Transition impossible');
      } else {
        await appendOrderHistoryNote(client,orderId,row.order_status,
          'Remboursement Stripe partiel vérifié '+providerRef,actorId);
      }
    }
    await client.query('COMMIT');tx=false;
  } catch(error) {
    if(tx) await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally {client.release();}
  try {await receiptService.issue(refundId,{issuedBy:actorId});}
  catch(error){log.warn({error,refundId},'[FINANCE] reçu à reprendre après settlement');}
  return {status:200,body:{success:true,refund_status:'confirmed',
    intent_id:intentId,stripe_refund_id:providerRef,method:'stripe',
    partial:!full,replayed}};
}

async function readbackAndSettle({db, stripe, orderId,intentId,providerRefundId,actorId}) {
  let evidence;
  try {
    evidence = await reconcileRefundIntent({db,stripe,intentId,providerRefundId});
  } catch(error) {
    log.warn({error,intentId},'[FINANCE] preuve Stripe à vérifier');
    await alertHold({db,orderId,intentId,code:error.code||'REFUND_STRIPE_PROOF_UNKNOWN',providerRef:providerRefundId});
    return pending(intentId,'unknown');
  }
  if (evidence.status === 'failed') return {status:409,body:{
    success:false,intent_id:intentId,refund_status:'failed',verified:true}};
  if (!evidence.complete) {
    await alertHold({db,orderId,intentId,code:'REFUND_STRIPE_PENDING',providerRef:providerRefundId});
    return pending(intentId,'unknown');
  }
  try {return await settleStripeRefund({db,orderId,intentId,actorId});}
  catch(error) {
    log.error({error,orderId,intentId},'[FINANCE] remboursement PSP confirmé, settlement DB à reprendre');
    await alertHold({db,orderId,intentId,code:'REFUND_STRIPE_CONFIRMED_UNSETTLED',providerRef:providerRefundId});
    return pending(intentId,'confirmed_unsettled');
  }
}

async function executeReservedStripeRefund({
  db = defaultDb,orderId,intentId,actorId = null,env=process.env,stripe,
}) {
  // Never perform a production refund while F3 is not certified.
  if (!stripeSandboxAllowed(env)) {
    await alertHold({db,orderId,intentId,code:'REFUND_STRIPE_EXECUTION_DISABLED'});
    return pending(intentId,'reserved',{requires_activation:true});
  }
  const {rows:[intent]}=await db.query(
    'SELECT id,order_id,provider,status,provider_ref FROM refund_execution_intents WHERE id=$1',
    [intentId]
  );
  if (!intent || intent.order_id !== orderId || intent.provider !== 'stripe') {
    fail('REFUND_STRIPE_INTENT_MISMATCH','Intention Stripe non attribuable à la commande');
  }
  if (intent.status === 'confirmed') {
    try {return await settleStripeRefund({db,orderId,intentId,actorId});}
    catch(error){
      await alertHold({db,orderId,intentId,code:error.code||'REFUND_STRIPE_SETTLEMENT_REQUIRED'});
      return pending(intentId,'confirmed_unsettled');
    }
  }
  if (intent.status !== 'reserved') return pending(intentId,intent.status);
  let claim;
  try {claim=await claimRefundIntent({db,intentId});}
  catch(error) {
    if (error.code==='REFUND_INTENT_NOT_CLAIMABLE' || error.code==='REFUND_INTENT_CLAIM_CONFLICT') {
      return pending(intentId,'processing');
    }
    throw error;
  }
  const adapter=stripe||require('stripe')(env.STRIPE_SECRET_KEY);
  let providerRef=null;
  try {
    const result=await adapter.refunds.create({
      payment_intent:claim.capture_ref,
      amount:Number(euroCents(claim.amount_eur)),
      reason:'requested_by_customer',
      metadata:{komerce:'true',refund_intent_id:intentId},
    },{idempotencyKey:claim.providerRequestKey});
    providerRef=result?.id||null;
  } catch(error){
    log.warn({error,intentId},'[FINANCE] sortie Stripe inconnue, aucun second POST');
  }
  // Durable uncertainty first; provider GET never substitutes for missing proof.
  await markUnknown(db,intentId,providerRef);
  if (!providerRef) {
    await alertHold({db,orderId,intentId,code:'REFUND_STRIPE_POST_UNKNOWN'});
    return pending(intentId,'unknown');
  }
  return readbackAndSettle({db,stripe:adapter,orderId,intentId,providerRefundId:providerRef,actorId});
}

/** Administrative GET-only recovery. Never calls stripe.refunds.create. */
async function reconcileUncertainStripeRefund({
  db=defaultDb,orderId,intentId,providerRefundId,actor,env=process.env,stripe,
}) {
  if (!actor || actor.role!=='admin') fail('REFUND_STRIPE_ADMIN_REQUIRED','Admin requis',403);
  if (!stripeSandboxAllowed(env)) fail('REFUND_STRIPE_RECONCILE_DISABLED','Rapprochement sandbox non activé',403);
  if (typeof providerRefundId!=='string'||!/^[a-zA-Z0-9_-]{3,160}$/.test(providerRefundId))
    fail('REFUND_STRIPE_REF_INVALID','Référence prestataire requise',400);
  const {rows:[intent]}=await db.query(
    'SELECT id,order_id,provider,status,provider_ref FROM refund_execution_intents WHERE id=$1',
    [intentId]
  );
  if (!intent||intent.provider!=='stripe'||String(intent.order_id)!==String(orderId)||
      (intent.provider_ref && intent.provider_ref!==providerRefundId)||
      !['unknown','processing','confirmed'].includes(intent.status)) {
    fail('REFUND_STRIPE_RECONCILE_CONFLICT','Intention non rapprochable');
  }
  const adapter=stripe||require('stripe')(env.STRIPE_SECRET_KEY);
  return readbackAndSettle({db,stripe:adapter,orderId,intentId,providerRefundId,actorId:actor.id});
}

module.exports={reserveStripeBusinessRefund,executeReservedStripeRefund,
  reconcileUncertainStripeRefund,settleStripeRefund,stripeSandboxAllowed};
