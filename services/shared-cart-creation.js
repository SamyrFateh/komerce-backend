/**
 * @komerce-arch
 * @role          shared-cart-creation
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        user_id, basket_id, cart_items, options
 * @outputs       shared_cart, items, token
 * @depends       db.js, services/shared-cart-internals.js
 * @used-by       routes/shared-cart.js
 * @db-read       basket_items, baskets, products, shared_carts, users
 * @db-write      basket_items, baskets, shared_cart_events, shared_cart_items, shared_carts
 * @db-txn        required_for_state_transition, snapshot_consistency
 * @doctrine      domaine_minimal_boutique_first, snapshot_fige
 * @impact-areas  creator-flow
 * @version       2026-08
 */

'use strict';

/**
 * KOMERCE — Shared cart creation (Boutique First, domaine minimal)
 *
 * Migration 124 : shared_carts n'a plus de colonnes financières
 * (contributed_kmf, remaining_kmf, total_kmf_snapshot), plus de snapshot
 * identité (beneficiary_name_snapshot, beneficiary_phone_snapshot,
 * currency_snapshot) et plus de fenêtre temporelle propre (target_date,
 * expires_at, payment_window_ends_at). La colonne bénéficiaire est
 * renommée organizer_user_id.
 *
 * Le total du panier n'est plus stocké : il se calcule par SUM() sur
 * shared_cart_items (voir shared-cart-reads.js). Le nom/téléphone du
 * créateur, si besoin d'affichage, se lit par jointure sur users via
 * organizer_user_id — plus de snapshot figé à la création.
 *
 * ASSUMPTION (à confirmer) : share_mode='ready_to_pay' de l'ancienne
 * V4.1 (créer un panier déjà 'closed') n'a plus de sens sans fenêtre de
 * paiement propre — un panier créé est toujours 'open'. Le créateur
 * ferme lui-même via POST /:id/close s'il ne veut plus l'éditer.
 */

const db = require('../db');
const { CONFIG, generateToken, r, withTransaction, addEvent } = require('./shared-cart-internals');

async function createSharedCartFromBasket(userId, basketId, options = {}) {
  return withTransaction(async (client) => {
    const { rows: activeCount } = await client.query(
      `SELECT COUNT(*)::int AS n FROM shared_carts
        WHERE organizer_user_id = $1
          AND status IN ('open', 'closed')`,
      [userId]
    );
    if (activeCount[0].n >= CONFIG.MAX_ACTIVE_CARTS_PER_USER) {
      throw new Error(`Limite atteinte : ${CONFIG.MAX_ACTIVE_CARTS_PER_USER} paniers partagés actifs maximum`);
    }

    const { rows: userRows } = await client.query(
      `SELECT id FROM users WHERE id = $1`, [userId]
    );
    if (!userRows.length) throw new Error('Utilisateur introuvable');

    const { rows: basketRows } = await client.query(
      `SELECT id, user_id FROM baskets WHERE id = $1 AND user_id = $2`,
      [basketId, userId]
    );
    if (!basketRows.length) throw new Error('Panier introuvable ou non autorisé');

    const { rows: items } = await client.query(
      `SELECT bi.product_id, bi.quantity,
              p.name, p.image_url, p.category, p.price_kmf
         FROM basket_items bi
         JOIN products p ON p.id = bi.product_id
        WHERE bi.basket_id = $1`,
      [basketId]
    );
    if (!items.length) throw new Error('Le panier est vide, impossible de partager');

    let token;
    for (let attempt = 0; attempt < 5; attempt++) {
      token = generateToken();
      const { rows } = await client.query(
        `SELECT 1 FROM shared_carts WHERE token = $1 LIMIT 1`, [token]
      );
      if (!rows.length) break;
      if (attempt === 4) throw new Error('Impossible de générer un token unique');
    }

    const { rows: cartRows } = await client.query(
      `INSERT INTO shared_carts (
         token, organizer_user_id, source_basket_id, title, message,
         delivery_relay_id, status
       ) VALUES ($1, $2, $3, $4, $5, $6, 'open')
       RETURNING *`,
      [
        token, userId, basketId,
        options.title || null, options.message || null,
        options.deliveryRelayId || null,
      ]
    );
    const sharedCart = cartRows[0];

    const insertedItems = [];
    let totalKmf = 0;
    for (const it of items) {
      const lineTotal = r(it.price_kmf) * r(it.quantity);
      totalKmf += lineTotal;
      const { rows: itemRows } = await client.query(
        `INSERT INTO shared_cart_items (
           shared_cart_id, product_id,
           product_name_snapshot, product_image_snapshot, product_category_snapshot,
           quantity, unit_price_kmf_snapshot, line_total_kmf_snapshot
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          sharedCart.id, it.product_id,
          it.name, it.image_url, it.category,
          r(it.quantity), r(it.price_kmf), lineTotal,
        ]
      );
      insertedItems.push(itemRows[0]);
    }
    if (totalKmf <= 0) throw new Error('Total panier invalide');

    await addEvent(client, sharedCart.id, 'shared_cart_created',
      { type: 'user', id: userId },
      { total_kmf: totalKmf, items_count: items.length, source: 'basket' }
    );

    return { sharedCart, items: insertedItems, token };
  });
}

/**
 * Doctrine v4.2 — N4-CLEAR (inchangé, sans lien avec les colonnes
 * financières retirées par la migration 124).
 */
async function clearCreatorBasketInTx(client, userId) {
  const { rows: baskets } = await client.query(
    `SELECT id FROM baskets
      WHERE owner_id = $1
        AND is_locked = FALSE
        AND type != 'gift'
        AND expires_at > NOW()`,
    [userId]
  );
  if (!baskets.length) return 0;

  const basketIds = baskets.map(b => b.id);

  const { rowCount } = await client.query(
    `DELETE FROM basket_items WHERE basket_id = ANY($1)`,
    [basketIds]
  );
  await client.query(
    `UPDATE baskets SET updated_at = NOW() WHERE id = ANY($1)`,
    [basketIds]
  );

  return rowCount || 0;
}

/**
 * Crée un panier partagé directement depuis une liste d'items
 * (sans passer par baskets DB). Statut initial : toujours OPEN
 * (voir ASSUMPTION en tête de fichier — plus de share_mode ready_to_pay).
 *
 * @param {string} userId — créateur (peut être un guest fraichement créé)
 * @param {Array} cartItems — [{ product_id, quantity }]
 * @param {Object} options — { title, message, deliveryRelayId }
 * @returns {Object} { sharedCart, items, token, clearLocalCart }
 */
async function createSharedCartFromCartItems(userId, cartItems, options = {}) {
  return withTransaction(async (client) => {
    if (!userId) throw new Error('user_id requis');

    const { rows: activeCount } = await client.query(
      `SELECT COUNT(*)::int AS n FROM shared_carts
        WHERE organizer_user_id = $1
          AND status IN ('open', 'closed')`,
      [userId]
    );
    if (activeCount[0].n >= CONFIG.MAX_ACTIVE_CARTS_PER_USER) {
      throw new Error(`Limite atteinte : ${CONFIG.MAX_ACTIVE_CARTS_PER_USER} paniers partagés actifs maximum`);
    }

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      throw new Error('Le panier est vide, impossible de partager');
    }

    const productIds = [...new Set(cartItems.map(i => i.product_id).filter(Boolean))];
    if (productIds.length === 0) throw new Error('Aucun produit valide dans le panier');

    const { rows: products } = await client.query(
      `SELECT id, name, image_url, category, price_kmf,
              promo_pct, is_promo, promo_until, is_active
         FROM products
        WHERE id = ANY($1)`,
      [productIds]
    );
    const productsById = {};
    products.forEach(p => { productsById[p.id] = p; });

    const enrichedItems = [];
    const now = new Date();
    for (const item of cartItems) {
      const p = productsById[item.product_id];
      if (!p || !p.is_active) continue;
      const qty = r(item.quantity || 1);
      if (qty <= 0) continue;
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
        quantity: qty,
        unit_price_kmf: unitPrice,
        line_total_kmf: unitPrice * qty,
      });
    }

    if (enrichedItems.length === 0) {
      throw new Error('Aucun produit valide après vérification serveur');
    }

    const totalKmf = enrichedItems.reduce((s, it) => s + it.line_total_kmf, 0);
    if (totalKmf <= 0) throw new Error('Total panier invalide');

    const { rows: userRows } = await client.query(
      `SELECT id FROM users WHERE id = $1`, [userId]
    );
    if (!userRows.length) throw new Error('Utilisateur introuvable');

    let token;
    for (let attempt = 0; attempt < 5; attempt++) {
      token = generateToken();
      const { rows } = await client.query(
        `SELECT 1 FROM shared_carts WHERE token = $1 LIMIT 1`, [token]
      );
      if (!rows.length) break;
      if (attempt === 4) throw new Error('Impossible de générer un token unique');
    }

    const { rows: cartRows } = await client.query(
      `INSERT INTO shared_carts (
         token, organizer_user_id, source_basket_id, title, message,
         delivery_relay_id, status
       ) VALUES ($1, $2, NULL, $3, $4, $5, 'open')
       RETURNING *`,
      [
        token, userId,
        options.title || null, options.message || null,
        options.deliveryRelayId || null,
      ]
    );
    const sharedCart = cartRows[0];

    const insertedItems = [];
    for (const it of enrichedItems) {
      const { rows: itemRows } = await client.query(
        `INSERT INTO shared_cart_items (
           shared_cart_id, product_id,
           product_name_snapshot, product_image_snapshot, product_category_snapshot,
           quantity, unit_price_kmf_snapshot, line_total_kmf_snapshot
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          sharedCart.id, it.product_id,
          it.name, it.image_url, it.category,
          it.quantity, it.unit_price_kmf, it.line_total_kmf,
        ]
      );
      insertedItems.push(itemRows[0]);
    }

    await addEvent(client, sharedCart.id, 'shared_cart_created',
      { type: 'user', id: userId },
      { total_kmf: totalKmf, items_count: enrichedItems.length, source: 'cart_items' }
    );

    return { sharedCart, items: insertedItems, token, clearLocalCart: true };
  });
}

module.exports = {
  createSharedCartFromBasket,
  createSharedCartFromCartItems,
  clearCreatorBasketInTx,
};
