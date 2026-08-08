/**
 * @komerce-arch
 * @role          shared-cart-creation
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        user_id, basket_id, cart_items, options
 * @outputs       shared_cart, items, token
 * @depends       db.js, services/shared-cart-internals.js, services/product-admin-service.js
 * @used-by       routes/shared-cart.js
 * @db-read       basket_items, baskets, product_skus, products, shared_carts, users
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
const productAdminService = require('./product-admin-service');

function httpError(message, status = 400, code = null) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

/**
 * Pont de compatibilité `/from-basket` (GAP-07 §9.4).
 *
 * Le domaine `baskets` est tombstoné — ce endpoint n'est qu'un pont de
 * compatibilité descendante, jamais une invitation à réintroduire ce
 * moteur dans le modèle canonique. basket_items ne porte AUCUNE colonne
 * de variante (audité : schéma basket_items = id, basket_id, product_id,
 * added_by, quantity, price_kmf, note, created_at) — impossible d'y
 * conserver un variant_combo qui n'y a jamais existé.
 *
 * Comportement : produit simple sans identité ambiguë → compatibilité
 * possible. Produit SKU (inventory_model = 'SKU') → refus explicite,
 * jamais de fallback vers un SKU deviné (premier SKU, SKU par défaut,
 * variante devinée).
 */
async function createSharedCartFromBasket(userId, basketId, options = {}) {
  return withTransaction(async (client) => {
    // P0/§9 — une liste CLOSED n'est plus "active" : elle ne doit plus
    // consommer le quota de paniers partagés actifs. Seul 'open' compte
    // (avant correction, ce check comptait encore ('open','closed') — bug
    // confirmé : un utilisateur avec MAX_ACTIVE_CARTS_PER_USER listes
    // toutes fermées ne pouvait plus jamais en recréer une seule).
    // Règle V1 — 1 liste OPEN par organisateur (garde applicative ;
    // le filet DB est shared_carts_one_open_per_organizer, migration 129).
    const { rows: openRows } = await client.query(
      `SELECT id, token FROM shared_carts
        WHERE organizer_user_id = $1 AND status = 'open'
        LIMIT 1`,
      [userId]
    );
    if (openRows.length >= CONFIG.MAX_OPEN_PER_ORGANIZER) {
      const err = new Error('Vous avez déjà une liste ouverte. Fermez-la avant d\'en publier une nouvelle.');
      err.code = 'open_list_exists';
      err.existing_token = openRows[0].token;
      throw err;
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
              p.name, p.image_url, p.category, p.price_kmf, p.inventory_model
         FROM basket_items bi
         JOIN products p ON p.id = bi.product_id
        WHERE bi.basket_id = $1`,
      [basketId]
    );
    if (!items.length) throw new Error('Le panier est vide, impossible de partager');

    // GAP-07 §9.4 — refus explicite plutôt qu'une ligne SKU-incomplète
    // silencieuse (variante perdue, prix générique potentiellement faux).
    const skuItem = items.find((it) => it.inventory_model === 'SKU');
    if (skuItem) {
      throw httpError(
        'Ce panier ancien ne conserve pas la variante choisie. ' +
        'Ajoutez de nouveau ce produit depuis la Boutique avant de partager la liste.',
        409,
        'sellable_unit_identity_missing'
      );
    }

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

    // Règle V1 — 1 liste OPEN par organisateur (garde applicative ;
    // le filet DB est shared_carts_one_open_per_organizer, migration 129).
    const { rows: openRows } = await client.query(
      `SELECT id, token FROM shared_carts
        WHERE organizer_user_id = $1 AND status = 'open'
        LIMIT 1`,
      [userId]
    );
    if (openRows.length >= CONFIG.MAX_OPEN_PER_ORGANIZER) {
      const err = new Error('Vous avez déjà une liste ouverte. Fermez-la avant d\'en publier une nouvelle.');
      err.code = 'open_list_exists';
      err.existing_token = openRows[0].token;
      throw err;
    }

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      throw new Error('Le panier est vide, impossible de partager');
    }

    const productIds = [...new Set(cartItems.map(i => i.product_id).filter(Boolean))];
    if (productIds.length === 0) throw new Error('Aucun produit valide dans le panier');

    // Mandat §8 — boundary canonique. Ce writer ne reconstruit plus
    // manuellement resolveActiveSku + contrôle stock + computeSellablePricing
    // + products.image_url : resolveSellableUnit() (product-admin-service.js)
    // est l'unique point d'entrée, y compris pour le média (SKU canonique via
    // product_sku_media → catalog_media, fallback products.image_url — §9).
    // Un produit introuvable/inactif reste un skip silencieux (comportement
    // historique de ce writer lors de la création du snapshot) ;
    // une combinaison/stock invalide reste un refus explicite (rollback),
    // jamais un skip qui ferait disparaître l'article sans le dire (GAP-07
    // §9.1 — "ne jamais agréger uniquement par product_id").
    const enrichedItems = [];
    for (const item of cartItems) {
      const qty = r(item.quantity || 1);
      if (!item.product_id || qty <= 0) continue;

      const variantComboRaw = (item.variant_combo && typeof item.variant_combo === 'object' && !Array.isArray(item.variant_combo))
        ? item.variant_combo
        : null;

      let unit;
      try {
        unit = await productAdminService.resolveSellableUnit(client, {
          productId: item.product_id,
          variantCombo: variantComboRaw,
          quantity: qty,
        });
      } catch (err) {
        if (err.code === 'product_not_found') continue;
        throw err;
      }
      if (unit.effective_unit_price_kmf <= 0) continue;

      enrichedItems.push({
        product_id: unit.product_id,
        sku_id: unit.sku_id,
        variant_combo: unit.variant_combo,
        name: unit.name,
        image_url: unit.image_url,
        category: unit.category,
        quantity: qty,
        unit_price_kmf: unit.effective_unit_price_kmf,
        line_total_kmf: unit.effective_unit_price_kmf * qty,
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
           shared_cart_id, product_id, sku_id, variant_combo_snapshot,
           product_name_snapshot, product_image_snapshot, product_category_snapshot,
           quantity, unit_price_kmf_snapshot, line_total_kmf_snapshot
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          sharedCart.id, it.product_id, it.sku_id,
          it.variant_combo ? JSON.stringify(it.variant_combo) : null,
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
