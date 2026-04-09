/**
 * KOMERCE — Refund Service v2.0
 *
 * Wrapper Stripe + Wallet pour les remboursements/annulations.
 * v2.0 : remplace store_credits par wallet-service.
 */

'use strict';

const stripe        = require('stripe')(process.env.STRIPE_SECRET_KEY);
const walletService = require('./wallet-service');

/**
 * Traite un remboursement (Stripe ou wallet).
 * Doit être appelé dans une transaction DB existante.
 */
async function processRefund(dbClient, order, amountKmf, amountEur, refundType, reason, initiatedBy) {
  let refundMethod, stripeRefundId = null, walletTxId = null;

  if (order.payment_mode === 'stripe_eur' && order.stripe_payment_id) {
    // ── Remboursement Stripe ──────────────────────────────────────────────
    refundMethod    = 'stripe';
    const amountCents  = Math.round(amountEur * 100);
    const stripeRefund = await stripe.refunds.create({
      payment_intent: order.stripe_payment_id,
      amount:         amountCents,
      reason:         'requested_by_customer',
      metadata: {
        order_reference: order.reference,
        refund_type:     refundType,
        komerce:         'true',
      },
    });
    stripeRefundId = stripeRefund.id;
    console.log(`[CANCEL] Stripe refund OK: ${stripeRefundId} — ${amountEur}€ pour ${order.reference}`);
  } else {
    // ── Cash relais → crédit wallet ───────────────────────────────────────
    refundMethod = 'wallet_credit';
    const result = await walletService.credit(dbClient, {
      userId:         order.user_id,
      amountKmf,
      reason:         'order_cancel',
      referenceId:    order.id,
      idempotencyKey: `refund_${order.id}_${refundType}`,
      note:           `Remboursement ${refundType} — commande ${order.reference}`,
      createdBy:      initiatedBy,
    });
    walletTxId = result.transaction.id;
  }

  // Enregistrer dans la table refunds
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
 */
async function processRefundWithFallback(dbClient, order, amountKmf, amountEur, refundType, reason, initiatedBy, parcelId) {
  let refundMethod, stripeRefundId = null, walletTxId = null;

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
      idempotencyKey: `refund_fb_${order.id}_${Date.now()}`,
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

module.exports = { processRefund, processRefundWithFallback };
