/**
 * @komerce-arch
 * @role          shared-cart-reads
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        token, shared_cart_id, user_id
 * @outputs       shared_cart, items
 * @depends       db.js
 * @used-by       routes/shared-cart.js
 * @db-read       order_items, shared_cart_items, shared_carts, users
 * @db-write      none
 * @db-txn        none
 * @doctrine      domaine_minimal_boutique_first, lecture_derivee
 * @impact-areas  participant-flow, creator-flow
 * @version       2026-08
 */

'use strict';

/**
 * KOMERCE — Shared cart reads (Boutique First, domaine minimal)
 *
 * La liste n'est jamais une source de vérité transactionnelle : son état
 * d'achat se déduit des lignes de commande rattachées.
 *
 * Le snapshot SQL de CI peut être chargé avant l'application de la migration
 * 125 qui renomme beneficiary_user_id en organizer_user_id. L'expression
 * ci-dessous lit la clé métier canonique depuis la ligne sérialisée, sans
 * référencer directement une colonne potentiellement absente.
 *
 * Amendement V2 §B (PROMPT_FINAL_IMPLEMENTATION_LISTE_PARTAGEABLE_SIDE_
 * CART_V2) : product_id est désormais exposé par ligne dans le payload
 * public — nécessaire pour ouvrir la fiche produit catalogue depuis un
 * clic sur l'image/le nom d'une ligne de liste (bus.emit('modal:open', {
 * id: item.product_id, source: 'shared-list', sharedCartItemId: item.id })).
 * Le reste du contrat public (is_creator, identifiants organisateur) reste
 * inchangé.
 */

const db = require('../db');

const ORGANIZER_ID_SQL = `COALESCE(
  NULLIF(to_jsonb(sc)->>'organizer_user_id', '')::uuid,
  NULLIF(to_jsonb(sc)->>'beneficiary_user_id', '')::uuid
)`;

async function getSharedCartForPublic(token, viewerUserId) {
  const { rows: cartRows } = await db.query(
    `SELECT sc.id, sc.token, sc.title, sc.message, sc.status, sc.delivery_relay_id,
            sc.created_at,
            ${ORGANIZER_ID_SQL} AS organizer_user_id,
            u.full_name AS organizer_full_name
       FROM shared_carts sc
       LEFT JOIN users u ON u.id = ${ORGANIZER_ID_SQL}
      WHERE sc.token = $1`,
    [token]
  );
  if (!cartRows.length) return null;
  const cart = cartRows[0];

  const { rows: items } = await db.query(
    `SELECT sci.id,
            sci.product_id,
            sci.product_name_snapshot AS name,
            sci.product_image_snapshot AS image,
            sci.quantity,
            sci.unit_price_kmf_snapshot AS unit_price_kmf,
            sci.line_total_kmf_snapshot AS line_total_kmf,
            (oi.id IS NOT NULL) AS claimed
       FROM shared_cart_items sci
       LEFT JOIN order_items oi ON oi.shared_cart_item_id = sci.id
      WHERE sci.shared_cart_id = $1
      ORDER BY sci.created_at`,
    [cart.id]
  );

  const claimedCount = items.filter((item) => item.claimed).length;
  const isCreator = Boolean(viewerUserId)
    && String(viewerUserId) === String(cart.organizer_user_id);
  const creatorFirstName = (cart.organizer_full_name || '')
    .trim()
    .split(/\s+/)[0] || null;

  return {
    cart: {
      // L'identifiant interne n'est nécessaire qu'aux commandes du créateur.
      id: isCreator ? cart.id : undefined,
      token: cart.token,
      title: cart.title,
      message: cart.message,
      status: cart.status,
      created_at: cart.created_at,
      creator_first_name: creatorFirstName,
    },
    items: items.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      name: item.name,
      image: item.image,
      quantity: item.quantity,
      unit_price_kmf: item.unit_price_kmf,
      line_total_kmf: item.line_total_kmf,
      claimed: item.claimed,
    })),
    items_count: items.length,
    claimed_count: claimedCount,
    is_creator: isCreator,
  };
}

async function getSharedCartForOwner(sharedCartId, userId) {
  const { rows } = await db.query(
    `SELECT sc.*
       FROM shared_carts sc
      WHERE sc.id = $1
        AND ${ORGANIZER_ID_SQL} = $2`,
    [sharedCartId, userId]
  );
  if (!rows.length) return null;
  const cart = rows[0];

  const { rows: items } = await db.query(
    `SELECT sci.*,
            (oi.id IS NOT NULL) AS claimed,
            oi.order_id AS claimed_by_order_id
       FROM shared_cart_items sci
       LEFT JOIN order_items oi ON oi.shared_cart_item_id = sci.id
      WHERE sci.shared_cart_id = $1
      ORDER BY sci.created_at`,
    [cart.id]
  );

  const totalKmf = items.reduce(
    (sum, item) => sum + Number(item.line_total_kmf_snapshot || 0),
    0
  );

  return {
    cart: { ...cart, total_kmf: totalKmf },
    items,
    claimed_count: items.filter((item) => item.claimed).length,
  };
}

async function listMySharedCarts(userId) {
  const { rows } = await db.query(
    `SELECT sc.id, sc.token, sc.title, sc.status, sc.created_at,
            sc.closed_at, sc.cancelled_at,
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
      WHERE ${ORGANIZER_ID_SQL} = $1
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
