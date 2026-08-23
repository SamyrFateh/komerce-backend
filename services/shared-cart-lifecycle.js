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
 *   OPEN            → CLOSED     (close — UNIQUEMENT si tous les articles
 *                                  sont réclamés, demande produit 22-08-2026 :
 *                                  jamais de clôture prématurée abandonnant
 *                                  des articles encore disponibles)
 *   OPEN ou CLOSED  → CANCELLED  (cancel)
 *
 * cancelSharedCart n'effectue aucun remboursement : aucune contribution
 * n'est jamais stockée sur la liste elle-même (le seul argent qui bouge
 * passe par des commandes individuelles, remboursables via le mécanisme
 * standard des commandes — hors périmètre de ce fichier).
 */

const { withTransaction, addEvent } = require('./shared-cart-internals');

function httpError(message, status = 400, code = null) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

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

    // Demande produit 22-08-2026 : la clôture n'est possible QUE lorsque
    // tous les articles ont été réclamés — jamais une clôture prématurée
    // qui abandonnerait des articles encore disponibles. Même formule que
    // services/shared-cart-reads.js (Mandat §11 — unités réclamées, pas
    // lignes : une ligne quantity>1 sous-représenterait sinon le compte).
    // Vérifié dans la MÊME transaction (FOR UPDATE ci-dessus verrouille
    // déjà la liste) pour éviter toute fenêtre entre lecture et clôture.
    const { rows: [progress] } = await client.query(
      `SELECT
         COALESCE(SUM(sci.quantity), 0)::int AS items_count,
         COALESCE(SUM(sci.quantity) FILTER (WHERE oi.id IS NOT NULL), 0)::int AS claimed_count
       FROM shared_cart_items sci
       LEFT JOIN order_items oi ON oi.shared_cart_item_id = sci.id
       WHERE sci.shared_cart_id = $1`,
      [sharedCartId]
    );
    if (progress.items_count === 0) {
      throw httpError('Cette liste ne contient aucun article.', 400, 'shared_cart_empty');
    }
    if (progress.claimed_count < progress.items_count) {
      throw httpError(
        `Impossible de clôturer : ${progress.items_count - progress.claimed_count} article(s) encore disponible(s).`,
        409,
        'shared_cart_not_fully_claimed'
      );
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
