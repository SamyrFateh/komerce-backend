/**
 * KOMERCE — Refund Engine v1.0 (Point 6 Phase 3)
 *
 * Logique de remboursement centralisée :
 *   - Stripe refund (commandes stripe_eur)
 *   - Crédit boutique (commandes cash_relais)
 *
 * Tables : refunds, store_credits (migration 007)
 *
 * Usage :
 *   const { processRefund } = require('../utils/refunds');
 *   const result = await processRefund(client, { order, refundType, refundPct, reason, initiatedBy });
 */

'use strict';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createStoreCredit } = require('./store-credits');

/**
 * Traite un remboursement (Stripe ou crédit boutique).
 * Doit être appelé dans une transaction DB existante.
 *
 * @param {Object} client  - DB transaction client (BEGIN déjà appelé)
 * @param {Object} params
 * @param {Object} params.order        - Commande complète (avec payment_mode, stripe_payment_id, total_kmf, total_eur)
 * @param {string} params.refundType   - 'full' | 'partial' | 'partial_ship'
 * @param {number} params.refundPct    - Pourcentage à rembourser (0-100)
 * @param {string} [params.reason]     - Raison du remboursement
 * @param {string} [params.initiatedBy] - UUID de l'utilisateur qui initie
 * @returns {{ refund: Object, error: string|null }}
 */
async function processRefund(client, {
  order,
  refundType,
  refundPct,
  reason,
  initiatedBy,
}) {
  const amountKmf = Math.round(order.total_kmf * refundPct / 100);
  const amountEur = order.total_eur
    ? parseFloat((parseFloat(order.total_eur) * refundPct / 100).toFixed(2))
    : null;

  let refundMethod, stripeRefundId = null, storeCreditId = null;

  // ── Stripe refund pour les commandes payées par carte ───────────────────
  if (order.payment_mode === 'stripe_eur' && order.stripe_payment_id) {
    refundMethod = 'stripe';
    try {
      const stripeRefund = await stripe.refunds.create({
        payment_intent: order.stripe_payment_id,
        amount: Math.round(amountEur * 100), // Stripe travaille en centimes EUR
        reason: 'requested_by_customer',
        metadata: {
          order_reference: order.reference,
          refund_type: refundType,
          komerce: 'true',
        },
      });
      stripeRefundId = stripeRefund.id;
    } catch (stripeErr) {
      console.error(`❌ Stripe refund failed for ${order.reference}:`, stripeErr.message);

      // Enregistrer le refund en échec
      const { rows: [failedRefund] } = await client.query(
        `INSERT INTO refunds (order_id, amount_kmf, amount_eur, refund_type, refund_method, reason, initiated_by, status)
         VALUES ($1, $2, $3, $4, 'stripe', $5, $6, 'failed')
         RETURNING *`,
        [order.id, amountKmf, amountEur, refundType, reason || 'Annulation client', initiatedBy]
      );
      return { refund: failedRefund, error: stripeErr.message };
    }
  } else {
    // ── Cash relais → crédit boutique ──────────────────────────────────────
    refundMethod = 'store_credit';
    const credit = await createStoreCredit(client, {
      userId: order.user_id,
      amountKmf,
      reason: `cancellation_refund`,
      sourceOrderId: order.id,
    });
    storeCreditId = credit.id;
  }

  // ── Enregistrer le remboursement ────────────────────────────────────────
  const { rows: [refund] } = await client.query(
    `INSERT INTO refunds (
       order_id, amount_kmf, amount_eur, refund_type, refund_method,
       stripe_refund_id, store_credit_id, reason, initiated_by, status, completed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', NOW())
     RETURNING *`,
    [
      order.id, amountKmf, amountEur, refundType, refundMethod,
      stripeRefundId, storeCreditId,
      reason || 'Annulation client',
      initiatedBy,
    ]
  );

  console.log(`✅ Refund ${refund.id} — ${refundType} ${refundPct}% — ${refundMethod} — ${order.reference}`);
  return { refund, error: null };
}

module.exports = { processRefund };
