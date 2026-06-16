/**
 * @komerce-arch
 * @role          shared-cart-items-update-service
 * @domain        shared-cart
 * @layer         service
 * @criticality   high
 * @inputs        shared_cart_id, cart_items, actor_identity, open_cart_state
 * @outputs       updated_cart_items, snapshot_recalculation, participant_notification_signal
 * @depends       db.js, services/shared-cart-queries.js, services/shared-cart-v41-transitions.js
 * @used-by       routes/shared-cart.js, public/boutique/js/b-cart.js
 * @doctrine      panier_ouvert_modifiable, snapshot_fige_apres_fermeture, participant_lecture_seule
 * @impact-areas  shared-cart-editing, creator-flow, participant-flow, cart, notifications
 * @version       2026-06
 */

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

// V4.1 : modifications de liste autorisées uniquement si status === 'open'
// ET aucun paiement confirmé (contributed_kmf === 0).
function assertCartCanUpdateItems(cart) {
  if (!cart) throw httpError('Panier partagé introuvable', 404, 'shared_cart_not_found');
  if (cart.status !== 'open') {
    throw httpError(`Ce panier n'est plus modifiable (statut : ${cart.status})`, 409, 'cart_not_editable');
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
  adjustAwaitingCartItems,
};

/**
 * V4.1 — Cas B « Ajuster le panier » (doctrine, sortie 2 d'AWAITING_CHOICE).
 *
 * Le CRÉATEUR édite la liste (la plateforme ne choisit jamais les articles
 * à retirer à sa place) ; le panier repart ensuite en fenêtre de paiement
 * de 48 h sur le solde réduit.
 *
 * Guards :
 *   - statut awaiting_choice uniquement ;
 *   - nouveau total ≤ total actuel (un ajustement est une réduction) ;
 *   - nouveau total ≥ contributed_kmf (jamais de trop-perçu à rembourser).
 *
 * Transition : AWAITING_CHOICE → CLOSED (nouvelle fenêtre 48 h).
 */
async function adjustAwaitingCartItems(sharedCartId, userId, cartItems = []) {
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

    if (cart.status !== 'awaiting_choice') {
      throw httpError(
        `Ajustement impossible (statut : ${cart.status}). Le panier doit être en attente de décision.`,
        409, 'cart_not_awaiting_choice'
      );
    }

    const contributed = r(cart.contributed_kmf);
    const previousTotal = r(cart.total_kmf_snapshot);

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

    const totalKmf = enrichedItems.reduce((sum, it) => sum + r(it.line_total_kmf), 0);
    if (totalKmf <= 0) throw httpError('Total panier invalide', 400, 'invalid_total');
    if (totalKmf > previousTotal) {
      throw httpError(
        'Un ajustement est une réduction : le nouveau total doit être inférieur ou égal au total actuel.',
        400, 'adjustment_must_reduce'
      );
    }
    if (totalKmf < contributed) {
      throw httpError(
        `Nouveau total (${totalKmf} KMF) inférieur aux paiements déjà reçus (${contributed} KMF). ` +
        'Retirez moins d\'articles : aucun remboursement n\'est géré par l\'ajustement.',
        400, 'adjustment_below_contributed'
      );
    }

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

    const newRemaining = Math.max(0, totalKmf - contributed);
    const { rows: updatedRows } = await client.query(
      `UPDATE shared_carts
          SET total_kmf_snapshot = $1,
              remaining_kmf = $2,
              status = 'closed',
              closed_at = NOW(),
              payment_window_ends_at = NOW() + INTERVAL '48 hours',
              awaiting_choice_started_at = NULL,
              awaiting_choice_deadline = NULL,
              metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
              updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [
        totalKmf, newRemaining, sharedCartId,
        JSON.stringify({
          adjusted_from_awaiting_choice_at: new Date().toISOString(),
          adjusted_previous_total_kmf: previousTotal,
        }),
      ]
    );

    await addEvent(client, sharedCartId, 'cart_adjusted_reopened', { type: 'user', id: userId }, {
      previous_total_kmf: previousTotal,
      new_total_kmf: totalKmf,
      contributed_kmf: contributed,
      new_remaining_kmf: newRemaining,
      items_count: insertedItems.length,
      doctrine: 'awaiting_choice_adjust',
    });

    return { cart: updatedRows[0], items: insertedItems };
  });
}
