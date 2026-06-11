'use strict';

/**
 * KOMERCE — Shared Cart Financial Guard
 *
 * Défense serveur autour du webhook Stripe contribution.
 *
 * Objectif : garantir les invariants financiers du panier partagé même si
 * plusieurs contributeurs ouvrent des sessions Stripe en parallèle sur le même
 * remaining_kmf.
 *
 * Règles fortes :
 * - seul un paiement Stripe paid peut confirmer une contribution ;
 * - une contribution déjà paid est idempotente ;
 * - le panier est verrouillé au moment du webhook ;
 * - si le panier est déjà fully_funded / converti / expiré / annulé, le paiement
 *   tardif n'est pas comptabilisé dans contributed_kmf ;
 * - si la contribution dépasse le remaining_kmf réel au moment du webhook, elle
 *   n'est pas comptabilisée et elle est marquée failed avec metadata
 *   requires_manual_refund=true ;
 * - jamais de contributed_kmf supérieur au total snapshot.
 */

const db = require('../db');
const log = require('../utils/logger').child({ module: 'shared-cart-financial-guard' });

function r(n) {
  return Math.round(Number(n) || 0);
}

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

async function addEvent(client, sharedCartId, eventType, actor, payload) {
  await client.query(
    `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, actor_id, payload)
       VALUES ($1, $2, $3, $4, $5)`,
    [sharedCartId, eventType, actor?.type || null, actor?.id || null, payload || {}]
  );
}

async function markPaidButNotCounted(client, contribution, cart, session, reason, extraPayload = {}) {
  const paymentIntentId = session.payment_intent || null;
  const payload = {
    reason,
    requires_manual_refund: true,
    stripe_session_id: session.id,
    stripe_payment_intent_id: paymentIntentId,
    amount_kmf: r(contribution.amount_kmf),
    cart_status: cart.status,
    cart_remaining_kmf: r(cart.remaining_kmf),
    cart_total_kmf: r(cart.total_kmf_snapshot),
    ...extraPayload,
  };

  await client.query(
    `UPDATE shared_cart_contributions
        SET status = 'failed',
            failed_at = NOW(),
            stripe_payment_intent_id = $1,
            metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
            updated_at = NOW()
      WHERE id = $3 AND status = 'pending'`,
    [paymentIntentId, JSON.stringify(payload), contribution.id]
  );

  await addEvent(client, cart.id, 'contribution_paid_not_counted',
    { type: 'stripe' },
    {
      contribution_id: contribution.id,
      ...payload,
    }
  );

  log.warn('[shared-cart] paid contribution not counted', payload);
  return null;
}

async function confirmContributionFromStripeSafely(session) {
  return withTransaction(async (client) => {
    const sessionId = session.id;
    const paymentIntentId = session.payment_intent || null;

    const { rows: contribRows } = await client.query(
      `SELECT * FROM shared_cart_contributions
        WHERE stripe_session_id = $1
        FOR UPDATE`,
      [sessionId]
    );

    if (!contribRows.length) return null;
    const contribution = contribRows[0];

    if (contribution.status === 'paid') return null;

    if (contribution.status !== 'pending') {
      await addEvent(client, contribution.shared_cart_id, 'contribution_stripe_unexpected_status',
        { type: 'stripe' },
        {
          contribution_id: contribution.id,
          stripe_session_id: sessionId,
          contribution_status: contribution.status,
          payment_status: session.payment_status,
        }
      );
      return null;
    }

    if (session.payment_status !== 'paid') {
      await addEvent(client, contribution.shared_cart_id, 'contribution_stripe_pending',
        { type: 'stripe' },
        { session_id: sessionId, payment_status: session.payment_status }
      );
      return null;
    }

    const { rows: cartRows } = await client.query(
      `SELECT * FROM shared_carts WHERE id = $1 FOR UPDATE`,
      [contribution.shared_cart_id]
    );
    if (!cartRows.length) throw new Error('Panier introuvable lors de la confirmation');
    const cart = cartRows[0];

    const amount = r(contribution.amount_kmf);
    const total = r(cart.total_kmf_snapshot);
    const contributed = r(cart.contributed_kmf);
    const remaining = Math.max(0, r(cart.remaining_kmf));

    if (!['active', 'partially_funded',
          'closed_for_settlement', 'settlement_in_progress', 'ready_to_finalize'].includes(cart.status)) {
      return markPaidButNotCounted(client, contribution, cart, session, 'cart_not_open_for_contribution');
    }

    if (new Date(cart.expires_at) < new Date()) {
      return markPaidButNotCounted(client, contribution, cart, session, 'cart_expired_at_webhook');
    }

    if (total <= 0) {
      return markPaidButNotCounted(client, contribution, cart, session, 'invalid_cart_total');
    }

    if (remaining <= 0 || amount > remaining) {
      return markPaidButNotCounted(client, contribution, cart, session, 'amount_exceeds_remaining_at_webhook', {
        attempted_amount_kmf: amount,
        allowed_remaining_kmf: remaining,
      });
    }

    const newContributed = Math.min(total, contributed + amount);
    const newRemaining = Math.max(0, total - newContributed);

    // LOT 1.4 — statuts v4 pour les paniers en règlement
    let newStatus;
    if (['closed_for_settlement', 'settlement_in_progress', 'ready_to_finalize'].includes(cart.status)) {
      // Flux v4 : utiliser les statuts settlement
      newStatus = newRemaining === 0 ? 'ready_to_finalize' : 'settlement_in_progress';
    } else {
      // Flux legacy (active / partially_funded)
      newStatus = newRemaining === 0 ? 'fully_funded' : 'partially_funded';
    }

    const { rows: [updatedContribution] } = await client.query(
      `UPDATE shared_cart_contributions
          SET status = 'paid',
              paid_at = NOW(),
              stripe_payment_intent_id = $1,
              updated_at = NOW()
        WHERE id = $2 AND status = 'pending'
        RETURNING *`,
      [paymentIntentId, contribution.id]
    );

    const { rows: [updatedCart] } = await client.query(
      `UPDATE shared_carts
          SET contributed_kmf = $1,
              remaining_kmf = $2,
              status = $3,
              updated_at = NOW()
        WHERE id = $4
        RETURNING *`,
      [newContributed, newRemaining, newStatus, cart.id]
    );

    if (!updatedContribution || !updatedCart) {
      throw new Error('Confirmation contribution incohérente : update non appliqué');
    }

    // GAP 4 — Marquer l'engagement lié comme paid
    // Un commitment reste locked_for_settlement indéfiniment si on ne le met pas à jour ici.
    if (updatedContribution.commitment_id) {
      await client.query(
        `UPDATE shared_cart_commitments
            SET status = 'paid',
                paid_at = NOW(),
                updated_at = NOW()
          WHERE id = $1
            AND status = 'locked_for_settlement'`,
        [updatedContribution.commitment_id]
      );
    }

    await addEvent(client, cart.id, 'contribution_paid',
      { type: 'stripe' },
      {
        contribution_id: updatedContribution.id,
        amount_kmf: updatedContribution.amount_kmf,
        amount_paid: updatedContribution.amount_paid,
        currency: updatedContribution.currency_paid,
        stripe_session_id: sessionId,
        new_status: newStatus,
      }
    );

    if (newStatus === 'fully_funded') {
      await addEvent(client, cart.id, 'cart_fully_funded',
        { type: 'system' },
        { contributed_kmf: newContributed }
      );
    } else if (cart.status !== 'partially_funded') {
      await addEvent(client, cart.id, 'cart_partially_funded',
        { type: 'system' },
        { contributed_kmf: newContributed, remaining_kmf: newRemaining }
      );
    }

    return { cart: updatedCart, contribution: updatedContribution };
  });
}

module.exports = {
  confirmContributionFromStripeSafely,
};
