/**
 * @komerce-arch
 * @role          shared-cart-lifecycle
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        shared_cart_id, user_id, reason
 * @outputs       shared_cart
 * @depends       db.js, services/shared-cart-internals.js
 * @used-by       routes/shared-cart.js
 * @db-read       shared_carts
 * @db-write      shared_cart_events, shared_carts
 * @db-txn        required_for_state_transition
 * @doctrine      domaine_minimal_boutique_first, panier_ouvert_ferme
 * @impact-areas  creator-flow
 * @version       2026-08
 */

'use strict';

/**
 * KOMERCE — Shared cart lifecycle (Boutique First, domaine minimal)
 *
 * Migration 124 : plus de fenêtre de paiement, plus de conversion en
 * commande unique (convertSharedCartToOrder), plus de machine à états
 * automatique (runSharedCartStateMachineTick / T1-T5, déjà démontée côté
 * cron au Lot 3). Chaque participant réclame un article en achetant
 * individuellement via POST /api/orders (migration 123) — la liste
 * partagée elle-même n'orchestre plus aucun paiement.
 *
 * Il ne reste que 2 transitions, toutes deux déclenchées par le créateur :
 *   OPEN            → CLOSED     (close)
 *   OPEN ou CLOSED  → CANCELLED  (cancel)
 *
 * cancelSharedCart n'effectue aucun remboursement : aucune contribution
 * n'est jamais stockée sur la liste elle-même (le seul argent qui bouge
 * passe par des commandes individuelles, remboursables via le mécanisme
 * standard des commandes — hors périmètre de ce fichier).
 */

const { withTransaction, addEvent } = require('./shared-cart-internals');

async function closeCart(sharedCartId, userId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM shared_carts WHERE id = $1 AND organizer_user_id = $2 FOR UPDATE`,
      [sharedCartId, userId]
    );
    if (!rows.length) throw new Error('Panier introuvable ou non autorisé');
    const cart = rows[0];

    if (cart.status !== 'open') {
      throw new Error(`Impossible de fermer un panier au statut ${cart.status}`);
    }

    const { rows: [updated] } = await client.query(
      `UPDATE shared_carts
          SET status = 'closed', closed_at = NOW(), updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [sharedCartId]
    );

    await addEvent(client, sharedCartId, 'cart_closed',
      { type: 'user', id: userId },
      { closed_at: updated.closed_at }
    );

    return updated;
  });
}

async function cancelSharedCart(sharedCartId, userId, reason) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM shared_carts WHERE id = $1 AND organizer_user_id = $2 FOR UPDATE`,
      [sharedCartId, userId]
    );
    if (!rows.length) throw new Error('Panier introuvable ou non autorisé');
    const cart = rows[0];

    if (!['open', 'closed'].includes(cart.status)) {
      throw new Error(`Impossible d'annuler un panier au statut ${cart.status}`);
    }

    const { rows: [updated] } = await client.query(
      `UPDATE shared_carts
          SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [sharedCartId]
    );

    await addEvent(client, sharedCartId, 'cart_cancelled',
      { type: 'user', id: userId },
      { reason: reason || null }
    );

    return updated;
  });
}

module.exports = {
  closeCart,
  cancelSharedCart,
};
