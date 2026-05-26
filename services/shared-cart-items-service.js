'use strict';

/**
 * KOMERCE — Shared cart v4 item update service
 *
 * Panier ouvert / concertation :
 *   - le créateur peut modifier le snapshot d'articles ;
 *   - les engagements restent indicatifs ;
 *   - aucun paiement ne doit déjà être compté ;
 *   - impossible après passage au règlement.
 */

const db = require('../db');
const settlement = require('./shared-cart-v4-settlement');

function r(n) { return Math.round(Number(n) || 0); }

function httpError(message, status = 400, code = null) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

async function tx(fn) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function addEvent(client, cartId, eventType, actor, payload) {
  await client.query(
    `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, actor_id, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [cartId, eventType, actor?.type || null, actor?.id || null, payload || {}]
  );
}

function normalizeItems(cartItems) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    throw httpError('cart_items requis (panier vide)', 400, 'cart_items_required');
  }

  const qtyByProduct = new Map();
  for (const raw of cartItems) {
    const productId = raw?.product_id;
    if (!productId) continue;
    const qty = r(raw.quantity || 1);
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

function assertCartCanUpdateItems(cart) {
  if (!cart) throw httpError('Panier partagé introuvable', 404, 'shared_cart_not_found');
  if (!['active', 'draft', 'commitment_open'].includes(cart.status)) {
    throw httpError(`Ce panier n'est plus modifiable (statut : ${cart.status})`, 409, 'cart_not_editable');
  }
  if (new Date(cart.expires_at) < new Date()) {
    throw httpError('Ce panier partagé a expiré', 400, 'shared_cart_expired');
  }
  if (settlement.isSettlementOpen(cart)) {
    throw httpError('Le panier est déjà passé au règlement. Les articles ne peuvent plus être modifiés.', 409, 'settlement_already_open');
  }
  if (r(cart.contributed_kmf) > 0) {
    throw httpError('Ce panier a déjà des paiements confirmés. Les articles ne peuvent plus être modifiés.', 409, 'paid_contributions_exist');
  }
}

async function updateOpenSharedCartItems(sharedCartId, userId, cartItems = []) {
  const normalized = normalizeItems(cartItems);

  return tx(async (client) => {
    const { rows: cartRows } = await client.query(
      `SELECT * FROM shared_carts
        WHERE id = $1 AND beneficiary_user_id = $2
        FOR UPDATE`,
      [sharedCartId, userId]
    );
    if (!cartRows.length) throw httpError('Panier partagé introuvable ou non autorisé', 404, 'shared_cart_not_found');
    const cart = cartRows[0];
    assertCartCanUpdateItems(cart);

    const paid = await client.query(
      `SELECT COUNT(*)::int AS n
         FROM shared_cart_contributions
        WHERE shared_cart_id = $1 AND status = 'paid'`,
      [sharedCartId]
    );
    if (paid.rows[0]?.n > 0) {
      throw httpError('Ce panier a déjà des paiements confirmés. Les articles ne peuvent plus être modifiés.', 409, 'paid_contributions_exist');
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

    const previousTotal = r(cart.total_kmf_snapshot);
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
          SET total_kmf_snapshot = $1,
              remaining_kmf = $1,
              metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
              updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [
        totalKmf,
        sharedCartId,
        JSON.stringify({
          open_phase_items_updated_at: new Date().toISOString(),
          open_phase_previous_total_kmf: previousTotal,
          open_phase_current_total_kmf: totalKmf,
        }),
      ]
    );

    await addEvent(client, sharedCartId, 'shared_cart_items_updated', { type: 'user', id: userId }, {
      previous_total_kmf: previousTotal,
      new_total_kmf: totalKmf,
      items_count: insertedItems.length,
      doctrine: 'open_concertation_phase',
    });

    return { cart: updatedRows[0], items: insertedItems };
  });
}

module.exports = {
  updateOpenSharedCartItems,
};
