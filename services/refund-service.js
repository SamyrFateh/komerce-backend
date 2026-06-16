/**
 * @komerce-arch
 * @role          refund-service
 * @domain        unknown
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       @unknown
 * @db-write      refunds
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

/**
 * KOMERCE — Refund Service v2.1
 *
 * Wrapper Stripe + Wallet pour les remboursements/annulations.
 * v2.0 : remplace store_credits par wallet-service.
 * v2.1 (P0) :
 *   - Idempotency key stable sur stripe.refunds.create (BUG critique fixé)
 *   - Idempotency key stable sur fallback wallet (plus de Date.now())
 *   - Format clé stable : refund_${order.id}_${refundType}_${parcelId || 'full'}
 *
 * IMPORTANT : la clé d'idempotence DOIT être stable d'un retry à l'autre.
 * Date.now() change à chaque appel = jamais idempotent = double remboursement possible.
 */

'use strict';

const stripe        = require('stripe')(process.env.STRIPE_SECRET_KEY);
const walletService = require('./wallet-service');
const log = require('../utils/logger').child({ module: 'refund-service' });

/**
 * Construit une clé d'idempotence stable.
 * Format : refund_<orderId>_<refundType>_<parcelId|'full'>
 */
function _buildIdempotencyKey(orderId, refundType, parcelId) {
  return `refund_${orderId}_${refundType}_${parcelId || 'full'}`;
}

/**
 * Traite un remboursement (Stripe ou wallet).
 * Doit être appelé dans une transaction DB existante.
 */
async function processRefund(dbClient, order, amountKmf, amountEur, refundType, reason, initiatedBy, parcelId = null) {
  let refundMethod, stripeRefundId = null, walletTxId = null;
  const idempotencyKey = _buildIdempotencyKey(order.id, refundType, parcelId);

  // PATCH P2-2 : INSERT refund en 'pending' AVANT l'appel Stripe.
  // Avant : INSERT après Stripe → si crash DB post-refund, argent remboursé sans trace.
  // Maintenant : INSERT pending → Stripe → UPDATE completed. Idempotence garantie.
  const { rows: [pendingRefund] } = await dbClient.query(
    `INSERT INTO refunds
       (order_id, amount_kmf, amount_eur, refund_type, refund_method,
        stripe_refund_id, store_credit_id, reason, initiated_by, status)
     VALUES ($1,$2,$3,$4,'pending_stripe',NULL,NULL,$5,$6,'pending')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [order.id, amountKmf, amountEur, refundType, reason || 'Annulation client', initiatedBy]
  );
  const refundRowId = pendingRefund?.id;

  if (order.payment_mode === 'stripe_eur' && order.stripe_payment_id) {
    refundMethod    = 'stripe';
    const amountCents  = Math.round(amountEur * 100);
    const stripeRefund = await stripe.refunds.create({
      payment_intent: order.stripe_payment_id,
      amount:         amountCents,
      reason:         'requested_by_customer',
      metadata: {
        order_reference: order.reference,
        refund_type:     refundType,
        ...(parcelId ? { parcel_id: parcelId } : {}),
        komerce:         'true',
      },
    }, {
      idempotencyKey,  // ← P0 FIX : empêche double remboursement Stripe sur retry
    });
    stripeRefundId = stripeRefund.id;
    log.info(`[CANCEL] Stripe refund OK: ${stripeRefundId} — ${amountEur}€ pour ${order.reference}`);
  } else {
    refundMethod = 'wallet_credit';
    const result = await walletService.credit(dbClient, {
      userId:         order.user_id,
      amountKmf,
      reason:         'order_cancel',
      referenceId:    order.id,
      idempotencyKey,
      note:           `Remboursement ${refundType} — commande ${order.reference}`,
      createdBy:      initiatedBy,
    });
    walletTxId = result.transaction.id;
  }

  // Mettre à jour l'enregistrement refund avec les IDs réels + statut 'completed'
  if (refundRowId) {
    await dbClient.query(
      `UPDATE refunds
          SET refund_method = $1, stripe_refund_id = $2, store_credit_id = $3,
              status = 'completed', completed_at = NOW()
        WHERE id = $4`,
      [refundMethod, stripeRefundId, walletTxId, refundRowId]
    );
  }

  return { method: refundMethod, stripeRefundId, walletTxId, amountEur, amountKmf };
}

/**
 * Variante avec fallback : si Stripe échoue, bascule sur wallet.
 *
 * P0 FIX : idempotency key stable partout (Stripe ET wallet fallback).
 * Avant le fix, le fallback utilisait Date.now() => jamais idempotent.
 *
 * A-BE-06 (2026-05-26) : INSERT pending AVANT l'appel Stripe, comme processRefund().
 * Avant : INSERT seulement à la fin → si Stripe rembourse et que l'INSERT crash,
 * argent remboursé sans trace DB.
 * Maintenant : INSERT pending → Stripe/wallet → UPDATE completed.
 */
async function processRefundWithFallback(dbClient, order, amountKmf, amountEur, refundType, reason, initiatedBy, parcelId) {
  let refundMethod, stripeRefundId = null, walletTxId = null;
  const idempotencyKey = _buildIdempotencyKey(order.id, refundType, parcelId);

  // A-BE-06 : INSERT refund en 'pending' AVANT tout appel Stripe ou wallet.
  // ON CONFLICT DO NOTHING garantit l'idempotence sur retry.
  const { rows: [pendingRefund] } = await dbClient.query(
    `INSERT INTO refunds
       (order_id, amount_kmf, amount_eur, refund_type, refund_method,
        stripe_refund_id, store_credit_id, reason, initiated_by, status)
     VALUES ($1,$2,$3,$4,'pending_stripe',NULL,NULL,$5,$6,'pending')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [order.id, amountKmf, amountEur, refundType, reason || 'Annulation', initiatedBy]
  );
  const refundRowId = pendingRefund?.id;

  if (order.payment_mode === 'stripe_eur' && order.stripe_payment_id) {
    const amountCents = Math.round(amountEur * 100);
    try {
      const stripeRefund = await stripe.refunds.create({
        payment_intent: order.stripe_payment_id,
        amount: amountCents,
        reason: 'requested_by_customer',
        metadata: {
          order_reference: order.reference,
          refund_type:     refundType,
          ...(parcelId ? { parcel_id: parcelId } : {}),
          komerce:         'true',
        },
      }, {
        idempotencyKey,  // ← P0 FIX
      });
      stripeRefundId = stripeRefund.id;
      refundMethod   = 'stripe';
    } catch (stripeErr) {
      log.error({ err: stripeErr }, '[refund-service] Stripe failed, using wallet fallback');
      refundMethod = 'wallet_credit';
    }
  }

  if (!refundMethod || refundMethod === 'wallet_credit') {
    refundMethod = 'wallet_credit';
    const result = await walletService.credit(dbClient, {
      userId:         order.user_id,
      amountKmf,
      reason:         'order_cancel',
      referenceId:    order.id,
      // ← P0 FIX : clé stable (avant : Date.now() = jamais idempotent !)
      idempotencyKey: `refund_fb_${order.id}_${refundType}_${parcelId || 'full'}`,
      note:           `Remboursement fallback — ${order.reference}`,
      createdBy:      initiatedBy,
    });
    walletTxId = result.transaction.id;
  }

  // Mettre à jour l'enregistrement refund avec les IDs réels + statut 'completed'
  if (refundRowId) {
    await dbClient.query(
      `UPDATE refunds
          SET refund_method = $1, stripe_refund_id = $2, store_credit_id = $3,
              status = 'completed', completed_at = NOW()
        WHERE id = $4`,
      [refundMethod, stripeRefundId, walletTxId, refundRowId]
    );
  } else {
    // Ligne déjà créée par un retry précédent (ON CONFLICT DO NOTHING) —
    // mettre à jour si elle est encore en 'pending'
    await dbClient.query(
      `UPDATE refunds
          SET refund_method = $1, stripe_refund_id = COALESCE($2, stripe_refund_id),
              store_credit_id = COALESCE($3, store_credit_id),
              status = 'completed', completed_at = COALESCE(completed_at, NOW())
        WHERE order_id = $4 AND refund_type = $5 AND status = 'pending'`,
      [refundMethod, stripeRefundId, walletTxId, order.id, refundType]
    );
  }

  return { method: refundMethod, stripeRefundId, walletTxId, amountEur, amountKmf };
}

module.exports = { processRefund, processRefundWithFallback, _buildIdempotencyKey };
