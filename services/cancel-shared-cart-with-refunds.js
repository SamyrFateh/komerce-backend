/**
 * @komerce-arch
 * @role          shared-cart-cancel-shared-cart-with-refunds
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, services/refund-service.js, services/shared-cart-refund-queue.js
 * @used-by       routes/shared-cart.js, routes/shared-cart-refund-admin.js
 * @db-read       shared_cart_contributions, shared_carts
 * @db-write      shared_cart_contributions, shared_cart_events, shared_carts
 * @db-write-via:refund-service refunds
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  shared-cart
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Annulation panier partagé V4.1 avec remboursement automatique
 *
 * GAP-A (Doctrine V4.1 Intégrée) :
 *   annulation = remboursement 100% automatique de tous les participants
 *   ayant une contribution `paid`, sans action manuelle admin.
 *
 * Comportement :
 *   1. Verrouille le panier, valide le statut (open / closed / awaiting_choice).
 *   2. Récupère toutes les contributions `paid` (verrouillées).
 *   3. Passe le panier en `cancelled` + audit event `cart_cancelled`.
 *   4. Hors de la transaction principale (appel API externe Stripe) :
 *      pour chaque contribution `paid` avec `payment_method = 'stripe'`,
 *      appelle `stripe.refunds.create` avec une idempotency key stable
 *      `shared_cart_refund_{cartId}_{contributionId}`, puis marque la
 *      contribution `refunded`.
 *   5. Les contributions `cash` (`payment_method = 'cash'`) ne peuvent pas
 *      être remboursées automatiquement par API — elles sont basculées
 *      vers la file de remboursement manuel existante
 *      (`shared-cart-refund-queue.js`) via `metadata.requires_manual_refund`.
 *   6. Idem si l'appel Stripe échoue (ex : refund déjà existant côté Stripe
 *      avec un statut inattendu, payment_intent manquant, etc.) — on ne
 *      bloque jamais l'annulation pour un incident de remboursement, on
 *      bascule la contribution en file manuelle.
 *
 * PayPal (A-02) : aucune contribution panier partagé n'est aujourd'hui créée
 * avec `payment_method = 'paypal'` (seuls 'stripe' et 'cash' existent,
 * cf. migration 073b). Si ce mode est ajouté plus tard, il suffira d'ajouter
 * une branche dédiée dans `refundOneContribution` appelant l'API PayPal
 * Refunds — la structure (idempotence, fallback file manuelle, notification)
 * reste identique.
 */

const db = require('../db');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const log = require('../utils/logger').child({ module: 'cancel-shared-cart-with-refunds' });
const { sendTemplateWhatsApp } = require('./whatsapp-meta');
const refundReceiptService = require('./documents/refund-receipt');
const { recordExternalRefund } = require('./refund-service');

function r(n) {
  return Math.round(Number(n) || 0);
}

async function addEvent(client, sharedCartId, eventType, actor, payload) {
  await client.query(
    `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, actor_id, payload)
       VALUES ($1, $2, $3, $4, $5)`,
    [sharedCartId, eventType, actor?.type || null, actor?.id || null, payload || {}]
  );
}

/**
 * Marque une contribution comme nécessitant un remboursement manuel
 * (réutilise le même contrat que `shared-cart-financial-guard.js` /
 * `shared-cart-refund-queue.js` : status='failed' + requires_manual_refund).
 *
 * NOTE : une contribution `paid` annulée n'est pas "failed" au sens paiement —
 * mais c'est le contrat existant de la file manuelle admin, qu'on réutilise
 * pour ne pas dupliquer l'écran d'admin. `metadata.cancellation_refund = true`
 * permet de distinguer cette origine dans la file.
 */
async function markRequiresManualRefund(contribution, cart, reason, extra = {}) {
  const payload = {
    requires_manual_refund: true,
    cancellation_refund: true,
    reason,
    cart_id: cart.id,
    amount_kmf: r(contribution.amount_kmf),
    payment_method: contribution.payment_method,
    ...extra,
  };

  await db.query(
    `UPDATE shared_cart_contributions
        SET status = 'failed',
            failed_at = NOW(),
            metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [contribution.id, JSON.stringify(payload)]
  );

  await db.query(
    `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, payload)
       VALUES ($1, 'contribution_requires_manual_refund', 'system', $2)`,
    [cart.id, { contribution_id: contribution.id, ...payload }]
  );

  log.warn({ contribution_id: contribution.id, cart_id: cart.id, reason },
    '[cancel-with-refunds] contribution routed to manual refund queue');

  return { contribution_id: contribution.id, status: 'manual_refund_queue', reason };
}

/**
 * Rembourse une contribution `paid` après annulation du panier.
 * Effectue son propre appel Stripe + sa propre mise à jour DB (hors de la
 * transaction principale d'annulation) afin de ne pas tenir de verrous DB
 * pendant un appel réseau externe. L'idempotency key garantit qu'un retry
 * (ex : tick cron de rattrapage) ne déclenche jamais un double remboursement.
 */
async function refundOneContribution(cart, contribution) {
  if (contribution.payment_method === 'cash') {
    return markRequiresManualRefund(contribution, cart, 'cash_contribution_requires_manual_refund');
  }

  // Mode par défaut / 'stripe'
  if (!contribution.stripe_payment_intent_id) {
    return markRequiresManualRefund(contribution, cart, 'missing_stripe_payment_intent');
  }

  const idempotencyKey = `shared_cart_refund_${cart.id}_${contribution.id}`;

  let refund;
  try {
    refund = await stripe.refunds.create(
      { payment_intent: contribution.stripe_payment_intent_id },
      { idempotencyKey }
    );
  } catch (err) {
    log.error({ err, contribution_id: contribution.id, cart_id: cart.id },
      '[cancel-with-refunds] stripe.refunds.create failed');
    return markRequiresManualRefund(contribution, cart, 'stripe_refund_api_error', {
      stripe_error: err?.message || String(err),
    });
  }

  const { rows: [updated] } = await db.query(
    `UPDATE shared_cart_contributions
        SET status = 'refunded',
            refunded_at = NOW(),
            metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
            updated_at = NOW()
      WHERE id = $1 AND status = 'paid'
      RETURNING *`,
    [contribution.id, JSON.stringify({
      cancellation_refund: true,
      stripe_refund_id: refund.id,
      stripe_refund_status: refund.status,
      idempotency_key: idempotencyKey,
    })]
  );

  // ── INSERT dans refunds (trace comptable) ────────────────────────────────
  // Doctrine : contribution_refunded → ligne refunds 'completed'
  // ON CONFLICT sur stripe_refund_id (contrainte migration 014) pour idempotence.
  let refundRowId = null;
  try {
    const amountKmf = r(contribution.amount_kmf);
    const amountEur = contribution.amount_eur ? Number(contribution.amount_eur) : null;

    // Résoudre l'orderId avant l'appel (évite la subquery SQL dans le service)
    const { rows: [cartRow] } = await db.query(
      `SELECT order_id FROM shared_carts WHERE id = $1`,
      [cart.id]
    );
    const orderId = cartRow?.order_id || null;

    if (orderId) {
      refundRowId = await recordExternalRefund(db, {
        orderId,
        amountKmf,
        amountEur,
        refundType:       'partial',
        method:           'stripe',
        externalRefundId: refund.id,
        reason:           'shared_cart_cancellation',
        initiatedBy:      null,
        conflictOn:       'stripe_refund_id',
      });
    }
  } catch (err) {
    log.warn({ err, contribution_id: contribution.id, cart_id: cart.id },
      '[cancel-with-refunds] INSERT refunds échoué (non-fatal)');
  }

  await db.query(
    `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, payload)\n       VALUES ($1, 'contribution_refunded', 'system', $2)`,
    [cart.id, {
      contribution_id: contribution.id,
      amount_kmf: r(contribution.amount_kmf),
      stripe_refund_id: refund.id,
      stripe_refund_status: refund.status,
    }]
  );

  // ── Reçu de remboursement (post-opération, non bloquant) ─────────────────
  // Doctrine : refund_confirmed → reçu émis.
  if (refundRowId) {
    refundReceiptService.issue(refundRowId).catch(err => {
      log.warn({ err, contribution_id: contribution.id, cart_id: cart.id },
        '[cancel-with-refunds] émission reçu contribution échouée (non-fatal)');
    });
  }

  return {
    contribution_id: contribution.id,
    status: 'refunded',
    stripe_refund_id: refund.id,
    stripe_refund_status: refund.status,
    refunded: updated || null,
  };
}

/**
 * A-04 — Notification WhatsApp annulation → tous les participants ayant payé.
 * Template : shared_cart_cancelled_refunded —
 *   {{1}} prénom  {{2}} titre panier  {{3}} montant remboursé (KMF)
 */
async function notifyRefundedParticipants(cart, contributions) {
  for (const contribution of contributions) {
    if (!contribution.contributor_phone) continue;
    try {
      const result = await sendTemplateWhatsApp({
        to: contribution.contributor_phone,
        templateName: 'shared_cart_cancelled_refunded',
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: (contribution.contributor_name || 'Participant').split(' ')[0] },
            { type: 'text', text: cart.title || 'Panier groupe' },
            { type: 'text', text: String(r(contribution.amount_kmf)) },
          ],
        }],
      });
      if (!result.success && !result.skipped) {
        log.warn({ phone: contribution.contributor_phone, error: result.error, cart_id: cart.id },
          '[cancel-with-refunds] cancellation_notification_failed');
        await db.query(
          `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, payload)
             VALUES ($1, 'cancellation_notification_failed', 'system', $2)`,
          [cart.id, { phone: contribution.contributor_phone, error: result.error }]
        ).catch(() => {});
      }
    } catch (err) {
      log.error({ err, contribution_id: contribution.id, cart_id: cart.id },
        '[cancel-with-refunds] cancellation notification failed');
    }
  }
}

/**
 * Annule un panier partagé et rembourse automatiquement tous les
 * participants ayant une contribution `paid`.
 *
 * @returns { cart, refunds: [...] }
 */
async function cancelSharedCartWithRefunds(sharedCartId, userId, reason) {
  const { cart, contributions } = await db.withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM shared_carts WHERE id = $1 AND beneficiary_user_id = $2 FOR UPDATE`,
      [sharedCartId, userId]
    );
    if (!rows.length) throw new Error('Panier introuvable ou non autorisé');
    const cart = rows[0];

    if (!['open', 'closed', 'awaiting_choice'].includes(cart.status)) {
      throw new Error(`Impossible d'annuler un panier au statut ${cart.status}`);
    }

    const { rows: contributions } = await client.query(
      `SELECT * FROM shared_cart_contributions
        WHERE shared_cart_id = $1 AND status = 'paid'
        FOR UPDATE`,
      [sharedCartId]
    );

    await client.query(
      `UPDATE shared_carts
          SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [sharedCartId]
    );

    await addEvent(client, sharedCartId, 'cart_cancelled',
      { type: 'user', id: userId },
      {
        reason: reason || null,
        contributed_kmf: cart.contributed_kmf,
        paid_contributions_count: contributions.length,
        auto_refund: true,
      }
    );

    return { cart, contributions };
  });

  // Remboursements + notifications hors transaction principale (appels
  // réseau externes Stripe + WhatsApp). Idempotency key Stripe garantit
  // qu'un retry ne rembourse jamais deux fois.
  const refunds = [];
  for (const contribution of contributions) {
    refunds.push(await refundOneContribution(cart, contribution));
  }

  if (contributions.length) {
    notifyRefundedParticipants(cart, contributions).catch(err =>
      log.error({ err, cart_id: cart.id }, '[cancel-with-refunds] notification batch failed'));
  }

  return {
    cart: { ...cart, status: 'cancelled' },
    refunds,
  };
}

module.exports = {
  cancelSharedCartWithRefunds,
  // exporté pour tests unitaires ciblés
  refundOneContribution,
};
