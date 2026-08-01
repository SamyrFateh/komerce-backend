/**
 * @komerce-arch
 * @role          shared-cart-items-update-service
 * @domain        shared-cart
 * @layer         service
 * @criticality   high
 * @inputs        shared_cart_id, cart_items, actor_identity
 * @outputs       updated_cart_items
 * @depends       db.js, services/shared-cart-internals.js
 * @used-by       routes/shared-cart.js, public/boutique/js/b-cart.js
 * @db-read       products, shared_cart_items, shared_carts
 * @db-write      shared_cart_events, shared_cart_items, shared_carts
 * @db-txn        open_cart_only
 * @doctrine      panier_ouvert_modifiable, domaine_minimal_boutique_first
 * @impact-areas  shared-cart-editing, creator-flow
 * @version       2026-08
 */

'use strict';

/**
 * KOMERCE — Shared cart v4 item update service (Boutique First, domaine minimal)
 *
 * Panier ouvert / concertation :
 *   - le créateur peut modifier la liste tant qu'elle est 'open' ;
 *   - aucun paiement n'est jamais compté sur la liste elle-même (migration
 *     124 — plus de contributed_kmf) : le seul guard est le statut.
 *
 * SUPPRIMÉ (Boutique First) : adjustAwaitingCartItems — le statut
 * 'awaiting_choice' n'existe plus (shared_cart_status réduit à
 * open/closed/cancelled par la migration 124). Un article déjà réclamé
 * par une commande (order_items.shared_cart_item_id) n'est PAS protégé
 * ici contre une modification de liste par le créateur — c'est un choix
 * assumé : DELETE+INSERT recrée les lignes shared_cart_items avec de
 * nouveaux id, ce qui détacherait un item déjà réclamé de sa commande.
 * ASSUMPTION (à confirmer) : à valider côté produit avant d'exposer PUT
 * /:id/items sur un panier ayant déjà des réclamations actives — un
 * guard "aucun item réclamé" est probablement nécessaire avant merge en
 * prod, je ne l'ai pas ajouté sans confirmation explicite du comportement
 * voulu (bloquer entièrement, ou seulement empêcher de retirer les items
 * déjà réclamés).
 */

const db = require('../db');
const { r, withTransaction, addEvent } = require('./shared-cart-internals');

function httpError(message, status = 400, code = null) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

function normalizeItems(cartItems) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    throw httpError('cart_items requis (panier vide)', 400, 'cart_items_required');
  }

  const qtyByProduct = new Map();
  for (const raw of cartItems) {
    const productId = raw?.product_id;
    if (!productId) continue;
    const qty = r(raw.quantity ?? 1);
    if (qty <= 0) continue;
    qtyByProduct.set(productId, (qtyByProduct.get(productId) || 0) + qty);
  }

  const normalized = Array.from(qtyByProduct.entries()).map(([product_id, quantity]) => ({
    product_id,
    quantity,
  }));

  if (!normalized.length) {
    throw httpError('Aucun produit valide dans le panier', 400, 'no_valid_items');
  }
  return normalized;
}

async function updateOpenSharedCartItems(sharedCartId, userId, cartItems = []) {
  const normalized = normalizeItems(cartItems);

  return withTransaction(async (client) => {
    const { rows: cartRows } = await client.query(
      `SELECT * FROM shared_carts
        WHERE id = $1 AND organizer_user_id = $2
        FOR UPDATE`,
      [sharedCartId, userId]
    );
    if (!cartRows.length) throw httpError('Panier partagé introuvable ou non autorisé', 404, 'shared_cart_not_found');
    const cart = cartRows[0];

    if (cart.status !== 'open') {
      throw httpError(`Ce panier n'est plus modifiable (statut : ${cart.status})`, 409, 'cart_not_editable');
    }

    const productIds = normalized.map(i => i.product_id);
    const { rows: products } = await client.query(
      `SELECT id, name, image_url, category, price_kmf,
              promo_pct, is_promo, promo_until, is_active
         FROM products
        WHERE id = ANY($1)`,
      [productIds]
    );
    const productsById = new Map(products.map(p => [p.id, p]));

    const now = new Date();
    const enrichedItems = [];
    for (const item of normalized) {
      const p = productsById.get(item.product_id);
      if (!p || !p.is_active) continue;
      const promoActive = p.is_promo &&
        p.promo_pct > 0 &&
        (!p.promo_until || new Date(p.promo_until) >= now);
      const unitPrice = promoActive
        ? r(p.price_kmf * (1 - p.promo_pct / 100))
        : r(p.price_kmf || 0);
      if (unitPrice <= 0) continue;
      enrichedItems.push({
        product_id: p.id,
        name: p.name,
        image_url: p.image_url,
        category: p.category,
        quantity: r(item.quantity),
        unit_price_kmf: unitPrice,
        line_total_kmf: unitPrice * r(item.quantity),
      });
    }

    if (!enrichedItems.length) {
      throw httpError('Aucun produit actif valide après vérification serveur', 400, 'no_active_items');
    }

    const totalKmf = enrichedItems.reduce((sum, item) => sum + r(item.line_total_kmf), 0);
    if (totalKmf <= 0) throw httpError('Total panier invalide', 400, 'invalid_total');

    await client.query(`DELETE FROM shared_cart_items WHERE shared_cart_id = $1`, [sharedCartId]);

    const insertedItems = [];
    for (const it of enrichedItems) {
      const { rows } = await client.query(
        `INSERT INTO shared_cart_items (
           shared_cart_id, product_id,
           product_name_snapshot, product_image_snapshot, product_category_snapshot,
           quantity, unit_price_kmf_snapshot, line_total_kmf_snapshot
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          sharedCartId, it.product_id,
          it.name, it.image_url, it.category,
          it.quantity, it.unit_price_kmf, it.line_total_kmf,
        ]
      );
      insertedItems.push(rows[0]);
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE shared_carts
          SET updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [sharedCartId]
    );

    await addEvent(client, sharedCartId, 'shared_cart_items_updated', { type: 'user', id: userId }, {
      new_total_kmf: totalKmf,
      items_count: insertedItems.length,
    });

    return { cart: { ...updatedRows[0], total_kmf: totalKmf }, items: insertedItems };
  });
}

module.exports = {
  updateOpenSharedCartItems,
};
