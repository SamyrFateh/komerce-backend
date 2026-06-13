'use strict';

/**
 * KOMERCE — cancelSharedCartWithRefunds
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Annule un panier partagé ET rembourse automatiquement toutes les
 * contributions `paid` via Stripe (ou PayPal — stub préparatoire).
 *
 * DOCTRINE V4.1 :
 *   - Annulation = remboursement 100% automatique, sans action manuelle.
 *   - La transaction DB (cancelled + audit) et les appels Stripe sont
 *     découplés : si un remboursement Stripe échoue, le panier est quand
 *     même annulé et la contribution est marquée `refund_failed` dans
 *     son metadata — traçabilité pour la file admin.
 *   - Idempotence : chaque appel Stripe utilise une idempotency key
 *     stable `shared_cart_refund_{cartId}_{contributionId}`. Un retry
 *     ne crée jamais de double remboursement.
 *
 * Statuts annulables : OPEN / CLOSED / AWAITING_CHOICE.
 * Statuts bloquants : ORDERED, CANCELLED, EXPIRED, ARCHIVED.
 *
 * @param {string} sharedCartId
 * @param {string} userId — doit être le créateur (beneficiary_user_id)
 * @param {string} [reason] — raison libre (audit)
 * @returns {{ cart, refunds }} cart = ligne DB après annulation ;
 *   refunds = { total, stripe_ok, stripe_failed, paypal_ok, paypal_failed }
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db     = require('../db');
const log    = require('../utils/logger').child({ module: 'cancel-shared-cart-with-refunds' });

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function withTransaction(callback) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Stripe refund (A-01) ────────────────────────────────────────────────────

/**
 * Rembourse une contribution Stripe.
 * Idempotency key stable → retry = no-op côté Stripe.
 *
 * @param {Object} contribution — ligne shared_cart_contributions
 * @param {string} cartId — pour la clé d'idempotence
 * @returns {{ ok: boolean, refundId?: string, error?: string }}
 */
async function _refundStripeContribution(contribution, cartId) {
  const paymentIntentId = contribution.stripe_payment_intent_id;
  if (!paymentIntentId) {
    return { ok: false, error: 'no_payment_intent_id' };
  }

  const idempotencyKey = `shared_cart_refund_${cartId}_${contribution.id}`;

  try {
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey }
    );
    return { ok: true, refundId: refund.id };
  } catch (err) {
    const code = err?.code || err?.type || 'stripe_error';
    log.warn({ err, contribution_id: contribution.id, code }, '[cancel-refund] Stripe refund failed');
    return { ok: false, error: code, message: err.message };
  }
}

// ─── PayPal refund stub (A-02) ───────────────────────────────────────────────
//
// PayPal n'est pas encore câblé aux contributions de panier partagé (juin 2026).
// Les contributions `payment_method = 'paypal'` sont actuellement impossibles
// dans le flux V4.1, donc ce stub ne sera jamais appelé en prod.
//
// Quand le câblage PayPal sera ajouté, implémenter :
//   - récupérer le capture_id depuis contribution.metadata.paypal_capture_id
//   - appeler services/paypal-client.js → refundCapture(captureId)
//   - retourner { ok, refundId, error }

async function _refundPaypalContribution(contribution, cartId) {
  log.warn(
    { contribution_id: contribution.id, cart_id: cartId },
    '[cancel-refund] PayPal refund not yet implemented — queued for manual refund'
  );
  return { ok: false, error: 'paypal_refund_not_implemented' };
}

// ─── Core ────────────────────────────────────────────────────────────────────

async function cancelSharedCartWithRefunds(sharedCartId, userId, reason) {
  // ── Étape 1 : annuler dans la DB (transaction) ───────────────────────────
  let cancelledCart;
  let paidContributions;

  await withTransaction(async (client) => {
    // Verrou exclusif sur le panier
    const { rows } = await client.query(
      `SELECT sc.*,
              u.phone AS beneficiary_phone,
              u.full_name AS beneficiary_name
         FROM shared_carts sc
         LEFT JOIN users u ON u.id = sc.beneficiary_user_id
        WHERE sc.id = $1
          AND sc.beneficiary_user_id = $2
        FOR UPDATE`,
      [sharedCartId, userId]
    );

    if (!rows.length) {
      const err = new Error('Panier introuvable ou non autorisé');
      err.status = 404;
      err.code   = 'shared_cart_not_found';
      throw err;
    }

    const cart = rows[0];

    if (!['open', 'closed', 'awaiting_choice'].includes(cart.status)) {
      const msgMap = {
        ordered:   'Ce panier a déjà été converti en commande.',
        cancelled: 'Ce panier est déjà annulé.',
        expired:   'Ce panier a expiré.',
        archived:  'Ce panier est archivé.',
      };
      const err = new Error(msgMap[cart.status] || `Impossible d'annuler un panier au statut ${cart.status}`);
      err.status = 409;
      err.code   = 'invalid_status_for_cancel';
      throw err;
    }

    // Passer en cancelled
    const { rows: [updated] } = await client.query(
      `UPDATE shared_carts
          SET status = 'cancelled',
              cancelled_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
       RETURNING *`,
      [sharedCartId]
    );

    cancelledCart = { ...updated, beneficiary_phone: cart.beneficiary_phone, beneficiary_name: cart.beneficiary_name };

    // Audit event
    await client.query(
      `INSERT INTO shared_cart_events
         (shared_cart_id, event_type, actor_type, actor_id, payload)
       VALUES ($1, 'cart_cancelled', 'user', $2, $3)`,
      [sharedCartId, userId, {
        reason:          reason || null,
        contributed_kmf: cart.contributed_kmf,
        auto_refund:     true,
      }]
    );

    // Charger toutes les contributions `paid` (Stripe ou PayPal) dans la transaction
    const { rows: contribs } = await client.query(
      `SELECT id, stripe_payment_intent_id, payment_method, metadata, amount_kmf
         FROM shared_cart_contributions
        WHERE shared_cart_id = $1
          AND status = 'paid'`,
      [sharedCartId]
    );
    paidContributions = contribs;
  });

  // ── Étape 2 : rembourser hors transaction (appels Stripe/PayPal) ──────────
  //
  // Intentionnellement hors transaction DB : un échec Stripe ne doit pas
  // annuler l'annulation du panier. Chaque résultat est tracé dans metadata.

  const refundStats = {
    total:         paidContributions.length,
    stripe_ok:     0,
    stripe_failed: 0,
    paypal_ok:     0,
    paypal_failed: 0,
  };

  for (const contrib of paidContributions) {
    const method = contrib.payment_method || 'stripe';
    let result;

    if (method === 'paypal') {
      result = await _refundPaypalContribution(contrib, sharedCartId);
      if (result.ok) refundStats.paypal_ok++;
      else           refundStats.paypal_failed++;
    } else {
      // Stripe (méthode par défaut)
      result = await _refundStripeContribution(contrib, sharedCartId);
      if (result.ok) refundStats.stripe_ok++;
      else           refundStats.stripe_failed++;
    }

    // Mettre à jour la contribution selon le résultat
    if (result.ok) {
      await db.query(
        `UPDATE shared_cart_contributions
            SET status = 'refunded',
                refunded_at = NOW(),
                metadata = COALESCE(metadata, '{}'::jsonb) ||
                           jsonb_build_object(
                             'auto_refund', true,
                             'refund_id', $1,
                             'refunded_at', NOW()::text
                           ),
                updated_at = NOW()
          WHERE id = $2`,
        [result.refundId || null, contrib.id]
      );

      await db.query(
        `INSERT INTO shared_cart_events
           (shared_cart_id, event_type, actor_type, payload)
         VALUES ($1, 'contribution_refunded', 'system', $2)`,
        [sharedCartId, {
          contribution_id: contrib.id,
          amount_kmf:      contrib.amount_kmf,
          refund_id:       result.refundId,
          method,
        }]
      );

      log.info({ contribution_id: contrib.id, refund_id: result.refundId, method },
        '[cancel-refund] contribution refunded');
    } else {
      // Marquer pour la file admin manuelle
      await db.query(
        `UPDATE shared_cart_contributions
            SET metadata = COALESCE(metadata, '{}'::jsonb) ||
                           jsonb_build_object(
                             'refund_failed', true,
                             'refund_error', $1,
                             'requires_manual_refund', true
                           ),
                updated_at = NOW()
          WHERE id = $2`,
        [result.error || 'unknown', contrib.id]
      );

      await db.query(
        `INSERT INTO shared_cart_events
           (shared_cart_id, event_type, actor_type, payload)
         VALUES ($1, 'contribution_refund_failed', 'system', $2)`,
        [sharedCartId, {
          contribution_id: contrib.id,
          amount_kmf:      contrib.amount_kmf,
          error:           result.error,
          method,
        }]
      );

      log.error({ contribution_id: contrib.id, error: result.error, method },
        '[cancel-refund] contribution refund failed — queued for manual refund');
    }
  }

  log.info({ cart_id: sharedCartId, ...refundStats }, '[cancel-refund] cancellation complete');

  return { cart: cancelledCart, refunds: refundStats };
}

module.exports = { cancelSharedCartWithRefunds };
