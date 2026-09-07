/**
 * @komerce-arch
 * @role          shared-cart-creation
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        user_id, basket_id, cart_items, options
 * @outputs       shared_cart, items, token
 * @depends       db.js, services/shared-cart-internals.js, services/product-admin-service.js, services/market-local-price-resolution-service.js
 * @used-by       routes/shared-cart.js
 * @db-read       basket_items, baskets, product_skus, products, relais, shared_carts, users
 * @db-write      basket_items, baskets, shared_cart_events, shared_cart_items, shared_carts
 * @db-txn        required_for_state_transition, snapshot_consistency
 * @doctrine      domaine_minimal_boutique_first, snapshot_fige, relay_market_is_server_price_anchor, only_LOCAL_ACTIVE_is_buyer_effective
 * @impact-areas  creator-flow, market-autonomy
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const { CONFIG, generateToken, r, withTransaction, addEvent } = require('./shared-cart-internals');
const productAdminService = require('./product-admin-service');
const { resolveActiveProductMarketPricingById } = require('./market-local-price-resolution-service');

function httpError(message, status = 400, code = null) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

async function resolveRelayMarketId(client, relayId) {
  if (!relayId) return null;
  const { rows } = await client.query(
    `SELECT market_id
       FROM relais
      WHERE id = $1 AND is_active = TRUE
      LIMIT 1`,
    [relayId]
  );
  if (!rows.length) {
    throw httpError('Relais de livraison introuvable ou inactif.', 404, 'shared_cart_delivery_relay_not_found');
  }
  if (!rows[0].market_id) {
    throw httpError('Le relais de livraison n’est rattaché à aucun marché.', 409, 'shared_cart_delivery_relay_market_missing');
  }
  return rows[0].market_id;
}

async function effectiveUnitPriceForMarket(client, marketId, productId, fallbackKmf) {
  if (!marketId) return Number(fallbackKmf) || 0;
  const local = await resolveActiveProductMarketPricingById(client, { marketId, productId });
  return local ? local.effective_unit_price_kmf : (Number(fallbackKmf) || 0);
}

async function resolveExistingOpenToken(userId) {
  try {
    const { rows } = await db.query(
      `SELECT token FROM shared_carts
        WHERE organizer_user_id = $1 AND status = 'open'
        LIMIT 1`,
      [userId]
    );
    return rows[0]?.token || null;
  } catch (_) {
    return null;
  }
}

function isOneOpenPerOrganizerViolation(err) {
  return err?.code === '23505' && String(err.constraint || '').includes('one_open_per_organizer');
}

async function createSharedCartFromBasket(userId, basketId, options = {}) {
  try {
    return await withTransaction(async (client) => {
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

      const { rows: userRows } = await client.query(`SELECT id FROM users WHERE id = $1`, [userId]);
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

      const skuItem = items.find((it) => it.inventory_model === 'SKU');
      if (skuItem) {
        throw httpError(
          'Ce panier ancien ne conserve pas la variante choisie. ' +
          'Ajoutez de nouveau ce produit depuis la Boutique avant de partager la liste.',
          409,
          'sellable_unit_identity_missing'
        );
      }

      const marketId = await resolveRelayMarketId(client, options.deliveryRelayId || null);

      let token;
      for (let attempt = 0; attempt < 5; attempt++) {
        token = generateToken();
        const { rows } = await client.query(`SELECT 1 FROM shared_carts WHERE token = $1 LIMIT 1`, [token]);
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
        const unitPrice = await effectiveUnitPriceForMarket(client, marketId, it.product_id, it.price_kmf);
        const lineTotal = r(unitPrice) * r(it.quantity);
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
            r(it.quantity), r(unitPrice), lineTotal,
          ]
        );
        insertedItems.push(itemRows[0]);
      }
      if (totalKmf <= 0) throw new Error('Total panier invalide');

      await addEvent(client, sharedCart.id, 'shared_cart_created',
        { type: 'user', id: userId },
        { total_kmf: totalKmf, items_count: items.length, source: 'basket', market_id: marketId }
      );

      return { sharedCart, items: insertedItems, token };
    });
  } catch (err) {
    if (isOneOpenPerOrganizerViolation(err)) {
      err.code = 'open_list_exists';
      err.existing_token = await resolveExistingOpenToken(userId);
    }
    throw err;
  }
}

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

async function createSharedCartFromCartItems(userId, cartItems, options = {}) {
  try {
    return await withTransaction(async (client) => {
      if (!userId) throw new Error('user_id requis');

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

      const marketId = await resolveRelayMarketId(client, options.deliveryRelayId || null);
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

        const unitPrice = await effectiveUnitPriceForMarket(
          client,
          marketId,
          unit.product_id,
          unit.effective_unit_price_kmf
        );

        enrichedItems.push({
          product_id: unit.product_id,
          sku_id: unit.sku_id,
          variant_combo: unit.variant_combo,
          name: unit.name,
          image_url: unit.image_url,
          category: unit.category,
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

      const { rows: userRows } = await client.query(`SELECT id FROM users WHERE id = $1`, [userId]);
      if (!userRows.length) throw new Error('Utilisateur introuvable');

      let token;
      for (let attempt = 0; attempt < 5; attempt++) {
        token = generateToken();
        const { rows } = await client.query(`SELECT 1 FROM shared_carts WHERE token = $1 LIMIT 1`, [token]);
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
        { total_kmf: totalKmf, items_count: enrichedItems.length, source: 'cart_items', market_id: marketId }
      );

      return { sharedCart, items: insertedItems, token, clearLocalCart: true };
    });
  } catch (err) {
    if (isOneOpenPerOrganizerViolation(err)) {
      err.code = 'open_list_exists';
      err.existing_token = await resolveExistingOpenToken(userId);
    }
    throw err;
  }
}

module.exports = {
  createSharedCartFromBasket,
  createSharedCartFromCartItems,
  clearCreatorBasketInTx,
};