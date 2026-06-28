/**
 * @komerce-arch
 * @role          shared-cart-contributions
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        token, contributor_info, contribution_id, stripe_session_id
 * @outputs       contribution, stripe_session
 * @depends       db.js, services/shared-cart-internals.js
 * @used-by       routes/shared-cart.js
 * @db-read       shared_cart_contributions, shared_cart_items, shared_carts
 * @db-write      shared_cart_contributions, shared_cart_events, shared_carts
 * @db-txn        idempotent_payment_events
 * @doctrine      paiement_seul_acte_engageant, idempotence_financiere
 * @impact-areas  participant-flow
 * @version       2026-06
 */

'use strict';

const db = require('../db');
const { CONFIG, r, withTransaction, addEvent } = require('./shared-cart-internals');

async function startContribution(token, contributorInfo, options = {}) {
  return withTransaction(async (client) => {
    // 1. Charger le panier avec verrou
    const { rows: cartRows } = await client.query(
      `SELECT * FROM shared_carts WHERE token = $1 FOR UPDATE`,
      [token]
    );
    if (!cartRows.length) throw new Error('Panier partagé introuvable');
    const cart = cartRows[0];

    // 2. Guard V4.1 : status CLOSED dans la fenêtre de paiement.
    //    Exception explicite : AWAITING_CHOICE si options.allowAwaitingChoice
    //    (cas « le créateur complète le gap » — la route a déjà vérifié que
    //    l'appelant est le créateur ; un participant ne passe jamais par là).
    const isAwaitingCreatorTopUp =
      cart.status === 'awaiting_choice' && options.allowAwaitingChoice === true;

    if (cart.status !== 'closed' && !isAwaitingCreatorTopUp) {
      throw new Error(`Ce panier n'accepte pas de contributions (statut : ${cart.status})`);
    }
    if (cart.status === 'closed' &&
        cart.payment_window_ends_at && new Date(cart.payment_window_ends_at) < new Date()) {
      throw new Error('La fenêtre de paiement de ce panier est expirée');
    }

    // 3. Validation contributeur
    const { name, email, phone, amountKmf, amountPaid, currency, message, fxRate } = contributorInfo;
    if (!name || !email) throw new Error('Nom et email du contributeur requis');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email invalide');

    const amount = r(amountKmf);
    if (amount < CONFIG.MIN_CONTRIBUTION_KMF) {
      throw new Error(`Contribution minimum : ${CONFIG.MIN_CONTRIBUTION_KMF} KMF`);
    }
    if (amount > CONFIG.MAX_CONTRIBUTION_KMF) {
      throw new Error(`Contribution maximum : ${CONFIG.MAX_CONTRIBUTION_KMF} KMF (KYC requis au-delà)`);
    }
    if (amount > cart.remaining_kmf) {
      throw new Error(`Le panier ne nécessite plus que ${cart.remaining_kmf} KMF (votre contribution : ${amount} KMF)`);
    }

    // 4. Créer la contribution (sans commitment_id — table supprimée en V4.1)
    const { rows: contribRows } = await client.query(
      `INSERT INTO shared_cart_contributions (
         shared_cart_id, contributor_name, contributor_email, contributor_phone,
         amount_kmf, amount_paid, currency_paid, fx_rate_used,
         status, message
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
       RETURNING *`,
      [
        cart.id, name.trim(), email.trim().toLowerCase(), phone || null,
        amount, amountPaid, currency || 'EUR', fxRate || null,
        message || null,
      ]
    );
    const contribution = contribRows[0];

    await addEvent(client, cart.id, 'contribution_started',
      { type: 'contributor' },
      { contribution_id: contribution.id, amount_kmf: amount, amount_paid: amountPaid, currency }
    );

    return { contribution, cart };
  });
}

/**
 * Lie une contribution pending à une session Stripe.
 * Appelée APRÈS création de la session par la route.
 */
async function attachStripeSession(contributionId, stripeSessionId) {
  await db.query(
    `UPDATE shared_cart_contributions
        SET stripe_session_id = $1, updated_at = NOW()
      WHERE id = $2 AND status = 'pending'`,
    [stripeSessionId, contributionId]
  );
}

/**
 * Marque une contribution comme failed (suite à webhook Stripe expiration).
 */
async function markContributionFailed(stripeSessionId, reason) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE shared_cart_contributions
          SET status = 'failed',
              failed_at = NOW(),
              metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE stripe_session_id = $1 AND status = 'pending'
        RETURNING *`,
      [stripeSessionId, JSON.stringify({ failure_reason: reason || 'stripe_expired' })]
    );
    if (rows.length) {
      await addEvent(client, rows[0].shared_cart_id, 'contribution_failed',
        { type: 'stripe' },
        { contribution_id: rows[0].id, reason }
      );
    }
    return rows[0] || null;
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 5. FINALISATION → COMMANDE (CLOSED/AWAITING_CHOICE → ORDERED)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Le créateur finalise son panier partagé et crée une commande Komerce.
 *
 * V4.1 — Cas A (100% financé) uniquement : remaining_kmf doit être 0.
 * Cas B (AWAITING_CHOICE + gap) : le créateur complète via le flux
 * startContribution normal, puis appelle finalize quand remaining === 0.
 *
 * @returns { sharedCart, order, prepaidKmf }
 */

module.exports = {
  startContribution,
  attachStripeSession,
  markContributionFailed,
};
