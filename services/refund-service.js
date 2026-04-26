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
    console.log(`[CANCEL] Stripe refund OK: ${stripeRefundId} — ${amountEur}€ pour ${order.reference}`);
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

  await dbClient.query(
    `INSERT INTO refunds
       (order_id, amount_kmf, amount_eur, refund_type, refund_method,
        stripe_refund_id, store_credit_id, reason, initiated_by, status, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'completed',NOW())`,
    [
      order.id, amountKmf, amountEur,
      refundType, refundMethod,
      stripeRefundId, walletTxId,
      reason || 'Annulation client', initiatedBy,
    ]
  );

  return { method: refundMethod, stripeRefundId, walletTxId, amountEur, amountKmf };
}

/**
 * Variante avec fallback : si Stripe échoue, bascule sur wallet.
 *
 * P0 FIX : idempotency key stable partout (Stripe ET wallet fallback).
 * Avant le fix, le fallback utilisait Date.now() => jamais idempotent.
 */
async function processRefundWithFallback(dbClient, order, amountKmf, amountEur, refundType, reason, initiatedBy, parcelId) {
  let refundMethod, stripeRefundId = null, walletTxId = null;
  const idempotencyKey = _buildIdempotencyKey(order.id, refundType, parcelId);

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
      console.error('[refund-service] Stripe failed, using wallet:', stripeErr.message);
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

  await dbClient.query(
    `INSERT INTO refunds
       (order_id, amount_kmf, amount_eur, refund_type, refund_method,
        stripe_refund_id, store_credit_id, reason, initiated_by, status, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'completed',NOW())`,
    [
      order.id, amountKmf, amountEur,
      refundType, refundMethod,
      stripeRefundId, walletTxId,
      reason || 'Annulation', initiatedBy,
    ]
  );

  return { method: refundMethod, stripeRefundId, walletTxId, amountEur, amountKmf };
}

module.exports = { processRefund, processRefundWithFallback, _buildIdempotencyKey };
