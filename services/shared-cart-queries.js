/**
 * @komerce-arch
 * @role          shared-cart-db-query-service
 * @domain        shared-cart
 * @layer         data-service
 * @criticality   high
 * @inputs        shared_cart_id, token, user_id, status_filters
 * @outputs       shared_cart_records
 * @depends       db.js
 * @used-by       routes/shared-cart.js
 * @db-read       order_items, shared_cart_events, shared_cart_items, shared_carts, users
 * @db-write      shared_cart_events, shared_carts
 * @db-txn        centralized_lookup_no_mutation
 * @doctrine      domaine_minimal_boutique_first, backend_source_verite
 * @impact-areas  shared-cart, participant-flow, creator-flow, admin-debug
 * @version       2026-08
 */

'use strict';

/**
 * shared-cart-queries.js (Boutique First, domaine minimal)
 * ══════════════════════════════════════════════════════════
 *
 * SUPPRIMÉ vs V4.1 :
 *   getFxKmfToEur, isStripeEventProcessed, markStripeEventProcessed,
 *   invalidatePendingContributions, getParticipantsWithEstimation,
 *   getEstimants, getPaidContributors, getCartForAwaitingChoice,
 *   extendPaymentWindow, adminExtendCartDate
 *     → toutes liées à des mécanismes supprimés (contributions,
 *       estimations, Stripe checkout groupé, fenêtre de paiement,
 *       target_date — colonnes/tables toutes retirées par la
 *       migration 124).
 *
 * adminExpireCart cible désormais 'cancelled', pas 'expired' — le statut
 * 'expired' n'existe plus dans shared_cart_status (réduit à
 * open/closed/cancelled par la migration 124). Le nom de la fonction est
 * conservé pour compat routeur/tests ; le comportement devient un
 * force-cancel admin.
 */

const db = require('../db');

async function getSharedCartByToken(token) {
  const { rows } = await db.query(
    `SELECT * FROM shared_carts WHERE token = $1`,
    [token]
  );
  return rows[0] || null;
}

async function getCartByOwner(cartId, userId) {
  const { rows } = await db.query(
    `SELECT * FROM shared_carts WHERE id = $1 AND organizer_user_id = $2`,
    [cartId, userId]
  );
  return rows[0] || null;
}

async function logEvent(cartId, eventType, actorType, actorId, payload) {
  await db.query(
    `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, actor_id, payload)
       VALUES ($1, $2, $3, $4, $5)`,
    [cartId, eventType, actorType, actorId ?? null, payload]
  );
}

// ─── Admin ───────────────────────────────────────────────────────────────

async function adminListCarts(filters = {}) {
  const conditions = [];
  const params = [];
  let i = 1;

  if (filters.status) {
    conditions.push(`sc.status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.user_id) {
    conditions.push(`sc.organizer_user_id = $${i++}`);
    params.push(filters.user_id);
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const { rows } = await db.query(
    `SELECT sc.*,
            u.full_name AS organizer_full_name,
            u.email AS organizer_email,
            (SELECT COUNT(*) FROM shared_cart_items WHERE shared_cart_id = sc.id)::int AS items_count,
            (SELECT COUNT(*) FROM shared_cart_items sci
               JOIN order_items oi ON oi.shared_cart_item_id = sci.id
              WHERE sci.shared_cart_id = sc.id)::int AS claimed_count
       FROM shared_carts sc
       LEFT JOIN users u ON u.id = sc.organizer_user_id
       ${where}
      ORDER BY sc.created_at DESC
      LIMIT 200`,
    params
  );
  return rows;
}

async function adminGetCartDetail(cartId) {
  const { rows: cartRows } = await db.query(
    `SELECT * FROM shared_carts WHERE id = $1`,
    [cartId]
  );
  if (!cartRows.length) return null;

  const [items, events] = await Promise.all([
    db.query(
      `SELECT sci.*, (oi.id IS NOT NULL) AS claimed, oi.order_id AS claimed_by_order_id
         FROM shared_cart_items sci
         LEFT JOIN order_items oi ON oi.shared_cart_item_id = sci.id
        WHERE sci.shared_cart_id = $1
        ORDER BY sci.created_at`,
      [cartId]
    ),
    db.query(`SELECT * FROM shared_cart_events WHERE shared_cart_id = $1 ORDER BY created_at DESC LIMIT 100`, [cartId]),
  ]);

  return {
    cart:   cartRows[0],
    items:  items.rows,
    events: events.rows,
  };
}

/**
 * Force-annule un panier (statuts open/closed → cancelled). Renommé en
 * substance depuis l'ancien adminExpireCart V4.1 — voir note en tête
 * de fichier.
 */
async function adminExpireCart(cartId) {
  const { rows } = await db.query(
    `UPDATE shared_carts SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
      WHERE id = $1
        AND status IN ('open', 'closed')
     RETURNING *`,
    [cartId]
  );
  return rows[0] || null;
}

module.exports = {
  getSharedCartByToken,
  getCartByOwner,
  logEvent,
  adminListCarts,
  adminGetCartDetail,
  adminExpireCart,
};
