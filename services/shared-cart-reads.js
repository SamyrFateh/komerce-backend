/**
 * @komerce-arch
 * @role          shared-cart-reads
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        token, shared_cart_id, user_id
 * @outputs       shared_cart, items, contributions
 * @depends       db.js, services/shared-cart-internals.js
 * @used-by       routes/shared-cart.js
 * @db-read       shared_cart_contributions, shared_cart_estimations, shared_cart_items, shared_carts, users
 * @db-write      shared_carts
 * @db-txn        none
 * @doctrine      snapshot_fige
 * @impact-areas  participant-flow, creator-flow
 * @version       2026-06
 */

'use strict';

const db = require('../db');
const { r } = require('./shared-cart-internals');

async function getSharedCartForPublic(token) {
  const { rows: cartRows } = await db.query(
    `SELECT id, token, beneficiary_name_snapshot, title, message,
            currency_snapshot, total_kmf_snapshot, contributed_kmf, remaining_kmf,
            status, target_date, closed_at, payment_window_ends_at,
            awaiting_choice_deadline, finalized_at, view_count,
            created_at
       FROM shared_carts
      WHERE token = $1`,
    [token]
  );
  if (!cartRows.length) return null;
  const cart = cartRows[0];

  // Items (snapshot uniquement, pas product_id complet pour éviter scraping)
  const { rows: items } = await db.query(
    `SELECT product_name_snapshot AS name,
            product_image_snapshot AS image,
            product_category_snapshot AS category,
            quantity, unit_price_kmf_snapshot AS unit_price_kmf,
            line_total_kmf_snapshot AS line_total_kmf
       FROM shared_cart_items
      WHERE shared_cart_id = $1
      ORDER BY created_at`,
    [cart.id]
  );

  // Contributions paid (anonymisées : prénom + montant + message)
  const { rows: contribs } = await db.query(
    `SELECT
       SPLIT_PART(contributor_name, ' ', 1) AS first_name,
       amount_kmf, message, paid_at
       FROM shared_cart_contributions
      WHERE shared_cart_id = $1 AND status = 'paid'
      ORDER BY paid_at DESC`,
    [cart.id]
  );

  // Agrégat estimations (indicatif, vue publique uniquement)
  const { rows: estimRows } = await db.query(
    `SELECT COUNT(*)::int AS count,
            COALESCE(SUM(amount_kmf), 0)::int AS total_estimated_kmf
       FROM shared_cart_estimations
      WHERE shared_cart_id = $1`,
    [cart.id]
  );
  const estimations_summary = estimRows[0];

  return {
    cart: {
      ...cart,
      id: undefined,   // Ne pas exposer l'UUID interne
    },
    items,
    contributions: contribs,
    estimations_summary,
  };
}

/**
 * Lecture privée par le bénéficiaire (cockpit créateur — toutes infos).
 * Inclut la liste détaillée des estimations.
 */
async function getSharedCartForOwner(sharedCartId, userId) {
  const { rows } = await db.query(
    `SELECT * FROM shared_carts WHERE id = $1 AND beneficiary_user_id = $2`,
    [sharedCartId, userId]
  );
  if (!rows.length) return null;
  const cart = rows[0];

  const { rows: items } = await db.query(
    `SELECT * FROM shared_cart_items WHERE shared_cart_id = $1 ORDER BY created_at`,
    [cart.id]
  );

  const { rows: contributions } = await db.query(
    `SELECT id, contributor_name, contributor_email,
            amount_kmf, amount_paid, currency_paid,
            status, message, paid_at, created_at
       FROM shared_cart_contributions
      WHERE shared_cart_id = $1
      ORDER BY created_at DESC`,
    [cart.id]
  );

  // V4.1 — estimations remplacent les commitments
  const { rows: estimations } = await db.query(
    `SELECT id, participant_name, participant_phone, amount_kmf, created_at, updated_at
       FROM shared_cart_estimations
      WHERE shared_cart_id = $1
      ORDER BY created_at DESC`,
    [cart.id]
  );

  return { cart, items, contributions, estimations };
}

/**
 * Liste des paniers partagés du bénéficiaire.
 */
async function listMySharedCarts(userId) {
  const { rows } = await db.query(
    `SELECT id, token, title, status,
            total_kmf_snapshot, contributed_kmf, remaining_kmf,
            target_date, closed_at, payment_window_ends_at, awaiting_choice_deadline,
            finalized_at, finalized_order_id, created_at,
            (SELECT COUNT(*) FROM shared_cart_contributions
              WHERE shared_cart_id = sc.id AND status = 'paid')::int AS contributors_count
       FROM shared_carts sc
      WHERE beneficiary_user_id = $1
      ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

async function incrementViewCount(token) {
  await db.query(
    `UPDATE shared_carts SET view_count = view_count + 1 WHERE token = $1`,
    [token]
  );
}

module.exports = {
  getSharedCartForPublic,
  getSharedCartForOwner,
  listMySharedCarts,
  incrementViewCount,
};
