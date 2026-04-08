/**
 * KOMERCE — Refund Service
 *
 * Wrapper sur utils/refunds.js et utils/store-credits.js.
 * Centralise la logique Stripe + crédit boutique pour les annulations.
 */

'use strict';

const stripe             = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createStoreCredit } = require('../utils/store-credits');

/**
 * Traite un remboursement (Stripe ou crédit boutique).
 * Doit être appelé dans une transaction DB existante.
 *
 * Lève une erreur si Stripe échoue (le caller doit ROLLBACK).
 * Pour un fallback silencieux vers store_credit, utiliser processRefundWithFallback.
 *
 * @param {Object} dbClient    - DB transaction client (BEGIN déjà appelé)
 * @param {Object} order       - Commande (id, reference, user_id, payment_mode, stripe_payment_id, total_kmf, total_eur)
 * @param {number} amountKmf   - Montant à rembourser en KMF
 * @param {number} amountEur   - Montant à rembourser en EUR
 * @param {string} refundType  - 'full' | 'partial'
 * @param {string} reason      - Raison du remboursement
 * @param {string} initiatedBy - UUID de l'utilisateur qui initie
 * @returns {{ method, stripeRefundId, storeCreditId, amountEur, amountKmf }}
 */
async function processRefund(dbClient, order, amountKmf, amountEur, refundType, reason, initiatedBy) {
  let refundMethod, stripeRefundId = null, storeCreditId = null;

  if (order.payment_mode === 'stripe_eur' && order.stripe_payment_id) {
    // Remboursement Stripe
    refundMethod = 'stripe';
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
    // Cash relais → crédit boutique
    refundMethod = 'store_credit';
    const credit = await createStoreCredit(dbClient, {
      userId:        order.user_id,
      amountKmf,
      reason:        'cancellation_refund',
      sourceOrderId: order.id,
    });
    storeCreditId = credit.id;
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
      stripeRefundId, storeCreditId,
      reason || 'Annulation client', initiatedBy,
    ]
  );

  return { method: refundMethod, stripeRefundId, storeCreditId, amountEur, amountKmf };
}

/**
 * Variante avec fallback : si Stripe échoue, bascule automatiquement sur crédit boutique.
 * Utilisée pour cancel-backorder (ne bloque pas la transaction en cas d'erreur Stripe).
 *
 * @param {Object} dbClient    - DB transaction client
 * @param {Object} order       - Commande complète
 * @param {number} amountKmf   - Montant en KMF
 * @param {number} amountEur   - Montant en EUR
 * @param {string} refundType  - 'full' | 'partial'
 * @param {string} reason      - Raison
 * @param {string} initiatedBy - UUID utilisateur
 * @param {string} [parcelId]  - UUID colis (pour métadonnées Stripe)
 * @returns {{ method, stripeRefundId, storeCreditId, amountEur, amountKmf }}
 */
async function processRefundWithFallback(dbClient, order, amountKmf, amountEur, refundType, reason, initiatedBy, parcelId) {
  let refundMethod, stripeRefundId = null, storeCreditId = null;

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
      // Fallback vers crédit boutique si Stripe échoue
      console.error('[refund-service] Stripe refund failed, using store credit:', stripeErr.message);
      refundMethod = 'store_credit';
    }
  }

  if (!refundMethod || refundMethod === 'store_credit') {
    refundMethod = 'store_credit';
    const credit = await createStoreCredit(dbClient, {
      userId:        order.user_id,
      amountKmf,
      reason:        'cancellation_refund',
      sourceOrderId: order.id,
    });
    storeCreditId = credit.id;
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
      stripeRefundId, storeCreditId,
      reason || 'Annulation', initiatedBy,
    ]
  );

  return { method: refundMethod, stripeRefundId, storeCreditId, amountEur, amountKmf };
}

module.exports = { processRefund, processRefundWithFallback };
