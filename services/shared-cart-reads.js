/**
 * @komerce-arch
 * @role          shared-cart-reads
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        token, shared_cart_id, user_id
 * @outputs       shared_cart, items
 * @depends       db.js, services/shared-cart-internals.js
 * @used-by       routes/shared-cart.js
 * @db-read       order_items, shared_cart_items, shared_carts, users
 * @db-write      none
 * @db-txn        none
 * @doctrine      domaine_minimal_boutique_first
 * @impact-areas  participant-flow, creator-flow
 * @version       2026-08
 */

'use strict';

/**
 * KOMERCE — Shared cart reads (Boutique First, domaine minimal)
 *
 * Migration 124 : total_kmf_snapshot n'existe plus sur shared_carts — il
 * se calcule ici par SUM() sur shared_cart_items.line_total_kmf_snapshot.
 *
 * Migration 123 : le statut "réclamé" d'un article de liste n'est jamais
 * stocké — il se déduit par LEFT JOIN sur order_items.shared_cart_item_id
 * (non-NULL = réclamé par une commande active ; la libération à
 * l'annulation, services/order-status-machine.js bloc 5b, repasse la
 * colonne à NULL, donc "non-NULL" est toujours la vérité courante, pas
 * besoin de vérifier le statut de la commande ici).
 *
 * ASSUMPTION (à confirmer) : plus de snapshot identité créateur
 * (beneficiary_name_snapshot / phone_snapshot supprimés). La vue
 * publique n'expose donc plus aucun nom/téléphone — seulement titre,
 * message, items et compteurs. Si le produit veut réafficher un prénom
 * créateur en public, il faudra JOIN users et décider explicitement de
 * ré-exposer une identité (arbitrage produit, pas technique).
 */

const db = require('../db');

async function getSharedCartForPublic(token, viewerUserId) {
  const { rows: cartRows } = await db.query(
    `SELECT sc.id, sc.token, sc.title, sc.message, sc.status, sc.delivery_relay_id,
            sc.created_at, sc.organizer_user_id, u.full_name AS organizer_full_name
       FROM shared_carts sc
       LEFT JOIN users u ON u.id = sc.organizer_user_id
      WHERE sc.token = $1`,
    [token]
  );
  if (!cartRows.length) return null;
  const cart = cartRows[0];

  const { rows: items } = await db.query(
    `SELECT sci.id,
            sci.product_name_snapshot AS name,
            sci.product_image_snapshot AS image,
            sci.quantity, sci.unit_price_kmf_snapshot AS unit_price_kmf,
            sci.line_total_kmf_snapshot AS line_total_kmf,
            (oi.id IS NOT NULL) AS claimed
       FROM shared_cart_items sci
       LEFT JOIN order_items oi ON oi.shared_cart_item_id = sci.id
      WHERE sci.shared_cart_id = $1
      ORDER BY sci.created_at`,
    [cart.id]
  );

  const claimedCount = items.filter(it => it.claimed).length;

  // Contrat API §5 point 2 : organizer_user_id sert uniquement à la
  // comparaison ci-dessous, jamais renvoyé tel quel dans la réponse.
  // Le front ne reçoit que le booléen dérivé is_creator.
  const isCreator = Boolean(viewerUserId) && viewerUserId === cart.organizer_user_id;

  // Storyboard §8 : identité affichable du créateur dérivée par jointure
  // à la lecture (jamais un snapshot stocké sur shared_carts). Seul le
  // prénom est exposé — premier mot de users.full_name — jamais le nom
  // complet, jamais l'identifiant.
  const creatorFirstName = (cart.organizer_full_name || '').trim().split(/\s+/)[0] || null;

  return {
    cart: {
      // Contrat API — les endpoints créateur (POST/DELETE .../items,
      // POST .../close) exigent l'id interne dans leur URL. Sans lui, la
      // capacité créateur documentée en Contrat API §2 est inappelable —
      // omission bloquante, pas une nouvelle donnée : exposée uniquement
      // quand is_creator est vrai, jamais pour un visiteur ordinaire.
      id: isCreator ? cart.id : undefined,
      token: cart.token,
      title: cart.title,
      message: cart.message,
      status: cart.status,
      created_at: cart.created_at,
      creator_first_name: creatorFirstName,
    },
    items: items.map(it => ({
      id: it.id, name: it.name, image: it.image,
      quantity: it.quantity, unit_price_kmf: it.unit_price_kmf,
      line_total_kmf: it.line_total_kmf, claimed: it.claimed,
    })),
    items_count: items.length,
    claimed_count: claimedCount,
    is_creator: isCreator,
  };
}

/**
 * Lecture privée par le créateur (cockpit — items avec id complet pour
 * pouvoir cibler une réclamation précise, contrairement à la vue publique).
 */
async function getSharedCartForOwner(sharedCartId, userId) {
  const { rows } = await db.query(
    `SELECT * FROM shared_carts WHERE id = $1 AND organizer_user_id = $2`,
    [sharedCartId, userId]
  );
  if (!rows.length) return null;
  const cart = rows[0];

  const { rows: items } = await db.query(
    `SELECT sci.*, (oi.id IS NOT NULL) AS claimed, oi.order_id AS claimed_by_order_id
       FROM shared_cart_items sci
       LEFT JOIN order_items oi ON oi.shared_cart_item_id = sci.id
      WHERE sci.shared_cart_id = $1
      ORDER BY sci.created_at`,
    [cart.id]
  );

  const totalKmf = items.reduce((s, it) => s + Number(it.line_total_kmf_snapshot || 0), 0);

  return {
    cart: { ...cart, total_kmf: totalKmf },
    items,
    claimed_count: items.filter(it => it.claimed).length,
  };
}

/**
 * Liste des paniers partagés du créateur.
 */
async function listMySharedCarts(userId) {
  const { rows } = await db.query(
    `SELECT sc.id, sc.token, sc.title, sc.status, sc.created_at, sc.closed_at, sc.cancelled_at,
            COALESCE(agg.total_kmf, 0)::int AS total_kmf,
            COALESCE(agg.items_count, 0)::int AS items_count,
            COALESCE(agg.claimed_count, 0)::int AS claimed_count
       FROM shared_carts sc
       LEFT JOIN LATERAL (
         SELECT SUM(sci.line_total_kmf_snapshot) AS total_kmf,
                COUNT(*) AS items_count,
                COUNT(oi.id) AS claimed_count
           FROM shared_cart_items sci
           LEFT JOIN order_items oi ON oi.shared_cart_item_id = sci.id
          WHERE sci.shared_cart_id = sc.id
       ) agg ON TRUE
      WHERE sc.organizer_user_id = $1
      ORDER BY sc.created_at DESC`,
    [userId]
  );
  return rows;
}

module.exports = {
  getSharedCartForPublic,
  getSharedCartForOwner,
  listMySharedCarts,
};
