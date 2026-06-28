/**
 * @komerce-arch
 * @role          shared-cart-creation
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        user_id, basket_id, cart_items, options
 * @outputs       shared_cart, items, token
 * @depends       db.js, services/shared-cart-internals.js, services/shared-cart-estimation-service.js
 * @used-by       routes/shared-cart.js
 * @db-read       basket_items, baskets, products, shared_cart_estimations, shared_cart_items, shared_carts, users
 * @db-write      basket_items, baskets, shared_cart_events, shared_cart_items, shared_carts
 * @db-txn        required_for_state_transition, snapshot_consistency
 * @doctrine      panier_ouvert_ferme, snapshot_fige
 * @impact-areas  creator-flow
 * @version       2026-06
 */

'use strict';

const db = require('../db');
const { CONFIG, generateToken, r, withTransaction, addEvent } = require('./shared-cart-internals');

async function createSharedCartFromBasket(userId, basketId, options = {}) {
  return withTransaction(async (client) => {
    // 1. Vérifier limite paniers actifs (statuts actifs V4.1)
    const { rows: activeCount } = await client.query(
      `SELECT COUNT(*)::int AS n FROM shared_carts
        WHERE beneficiary_user_id = $1
          AND status IN ('open', 'closed', 'awaiting_choice')`,
      [userId]
    );
    if (activeCount[0].n >= CONFIG.MAX_ACTIVE_CARTS_PER_USER) {
      throw new Error(`Limite atteinte : ${CONFIG.MAX_ACTIVE_CARTS_PER_USER} paniers partagés actifs maximum`);
    }

    // 2. Charger user + basket + items
    const { rows: userRows } = await client.query(
      `SELECT id, full_name, phone FROM users WHERE id = $1`, [userId]
    );
    if (!userRows.length) throw new Error('Utilisateur introuvable');
    const user = userRows[0];

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

    // 3. Calculer total snapshot
    const totalKmf = items.reduce((s, it) => s + r(it.price_kmf) * r(it.quantity), 0);
    if (totalKmf <= 0) throw new Error('Total panier invalide');

    // 4. Générer token unique (retry si collision)
    let token;
    for (let attempt = 0; attempt < 5; attempt++) {
      token = generateToken();
      const { rows } = await client.query(
        `SELECT 1 FROM shared_carts WHERE token = $1 LIMIT 1`, [token]
      );
      if (!rows.length) break;
      if (attempt === 4) throw new Error('Impossible de générer un token unique');
    }

    // 5. Créer le shared_cart — statut OPEN, target_date optionnel
    const targetDate = options.targetDate || null;
    const expiresAt = targetDate
      ? new Date(new Date(targetDate).getTime() + 7 * 86_400_000).toISOString()
      : new Date(Date.now() + 90 * 86_400_000).toISOString();

    const { rows: cartRows } = await client.query(
      `INSERT INTO shared_carts (
         token, beneficiary_user_id,
         beneficiary_phone_snapshot, beneficiary_name_snapshot,
         source_basket_id, title, message,
         currency_snapshot, total_kmf_snapshot, contributed_kmf, remaining_kmf,
         delivery_relay_id, status, target_date, expires_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         'KMF', $8, 0, $8,
         $9, 'open', $10, $11
       ) RETURNING *`,
      [
        token, userId,
        user.phone, user.full_name,
        basketId, options.title || null, options.message || null,
        totalKmf,
        options.deliveryRelayId || null,
        targetDate,
        expiresAt,
      ]
    );
    const sharedCart = cartRows[0];

    // 6. Snapshot les items
    const insertedItems = [];
    for (const it of items) {
      const lineTotal = r(it.price_kmf) * r(it.quantity);
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

    // 7. Audit
    await addEvent(client, sharedCart.id, 'shared_cart_created',
      { type: 'user', id: userId },
      { total_kmf: totalKmf, items_count: items.length, target_date: targetDate }
    );

    return { sharedCart, items: insertedItems, token };
  });
}

// ───────────────────────────────────────────────────────────────────────
// Doctrine v4.2 — N4-CLEAR
// ───────────────────────────────────────────────────────────────────────
/**
 * Vide le panier boutique DB du créateur dans la transaction en cours.
 * Cible uniquement les paniers non verrouillés et non-gift.
 *
 * Appelé APRÈS l'insertion du shared_cart et de ses items (snapshot sauvegardé),
 * DANS la même transaction — atomicité garantie.
 *
 * @param {object} client — client pg dans la transaction active
 * @param {string} userId — id du créateur
 * @returns {number} nombre de basket_items supprimés
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
// ─── fin N4-CLEAR helper ────────────────────────────────────────────────────

/**
 * Crée un panier partagé directement depuis une liste d'items
 * (sans passer par baskets DB). Statut initial : OPEN.
 *
 * @param {string} userId — bénéficiaire (peut être un guest fraichement créé)
 * @param {Array} cartItems — [{ product_id, quantity }]
 * @param {Object} options — { title, message, targetDate, deliveryRelayId }
 *   targetDate : ISO date string optionnel. Le cron fermera automatiquement
 *   le panier à cette date.
 * @returns {Object} { sharedCart, items, token, clearLocalCart }
 */
async function createSharedCartFromCartItems(userId, cartItems, options = {}) {
  return withTransaction(async (client) => {
    if (!userId) throw new Error('user_id requis');

    // 1. Vérifier limite paniers actifs
    const { rows: activeCount } = await client.query(
      `SELECT COUNT(*)::int AS n FROM shared_carts
        WHERE beneficiary_user_id = $1
          AND status IN ('open', 'closed', 'awaiting_choice')`,
      [userId]
    );
    if (activeCount[0].n >= CONFIG.MAX_ACTIVE_CARTS_PER_USER) {
      throw new Error(`Limite atteinte : ${CONFIG.MAX_ACTIVE_CARTS_PER_USER} paniers partagés actifs maximum`);
    }

    // 2. Validation items
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      throw new Error('Le panier est vide, impossible de partager');
    }

    // 3. Charger les produits depuis la DB (source de vérité prix)
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

    // 4. Reconstruire les items snapshot avec les vrais prix DB
    const enrichedItems = [];
    for (const item of cartItems) {
      const p = productsById[item.product_id];
      if (!p || !p.is_active) continue;
      const qty = r(item.quantity || 1);
      if (qty <= 0) continue;
      const now = new Date();
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

    // 5. Total snapshot
    const totalKmf = enrichedItems.reduce((s, it) => s + it.line_total_kmf, 0);
    if (totalKmf <= 0) throw new Error('Total panier invalide');

    // 6. Récupérer infos bénéficiaire
    const { rows: userRows } = await client.query(
      `SELECT full_name, phone FROM users WHERE id = $1`, [userId]
    );
    if (!userRows.length) throw new Error('Utilisateur introuvable');
    const user = userRows[0];

    // 7. Générer token public (collision check)
    let token;
    for (let attempt = 0; attempt < 5; attempt++) {
      token = generateToken();
      const { rows } = await client.query(
        `SELECT 1 FROM shared_carts WHERE token = $1 LIMIT 1`, [token]
      );
      if (!rows.length) break;
      if (attempt === 4) throw new Error('Impossible de générer un token unique');
    }

    // 8. Insérer le shared_cart
    const targetDate = options.targetDate || null;

    // Nature du panier (doctrine §5) — par défaut « à valider » (= open).
    // Rétrocompatible : tout appel sans shareMode garde le comportement actuel.
    const readyToPay = options.shareMode === 'ready_to_pay';
    const status   = readyToPay ? 'closed' : 'open';
    const closedAt = readyToPay ? new Date().toISOString() : null;

    // Fenêtre de paiement « prêt à payer » : la date choisie par le créateur
    // (fin de journée), sinon 48 h ; plancher 48 h, plafond 14 j (doctrine §9).
    let paymentWindowEndsAt = null;
    if (readyToPay) {
      const now = Date.now();
      const floorMs = now + CONFIG.PAYMENT_WINDOW_HOURS * 3_600_000;
      const capMs   = now + CONFIG.PAYMENT_WINDOW_MAX_DAYS * 86_400_000;
      const chosenMs = targetDate
        ? new Date(targetDate).getTime() + 86_400_000 - 1000   // fin de journée
        : floorMs;
      paymentWindowEndsAt = new Date(Math.min(capMs, Math.max(floorMs, chosenMs))).toISOString();
    }

    // expires_at : NOT NULL legacy — 90 j par défaut (la V4.1 pilote via payment_window_ends_at)
    const expiresAt = targetDate
      ? new Date(new Date(targetDate).getTime() + 7 * 86_400_000).toISOString()
      : new Date(Date.now() + 90 * 86_400_000).toISOString();

    const { rows: cartRows } = await client.query(
      `INSERT INTO shared_carts (
         token, beneficiary_user_id,
         beneficiary_phone_snapshot, beneficiary_name_snapshot,
         source_basket_id, title, message,
         currency_snapshot, total_kmf_snapshot, contributed_kmf, remaining_kmf,
         delivery_relay_id, status, target_date, expires_at,
       closed_at, payment_window_ends_at
       ) VALUES (
         $1, $2, $3, $4, NULL, $5, $6,
         'KMF', $7, 0, $7,
         $8, $9, $10, $11,
         $12, $13
       ) RETURNING *`,
      [
        token, userId,
        user.phone, user.full_name,
        options.title || null, options.message || null,
        totalKmf,
        options.deliveryRelayId || null,
        status,
        targetDate,
        expiresAt,
        closedAt,
        paymentWindowEndsAt,
      ]
    );
    const sharedCart = cartRows[0];

    // 9. Snapshot des items
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

    // 10. Audit création
    await addEvent(client, sharedCart.id, 'shared_cart_created',
      { type: 'user', id: userId },
      {
        total_kmf: totalKmf,
        items_count: enrichedItems.length,
        target_date: targetDate,
        source: 'cart_items',
        share_mode: readyToPay ? 'ready_to_pay' : 'needs_validation',
      }
    );

    // Panier « prêt à payer » : on ouvre le paiement dès la création, dans la
    // MÊME transaction (pas d'appel à closeCart → pas de transaction imbriquée).
    if (readyToPay) {
      await addEvent(client, sharedCart.id, 'cart_closed',
        { type: 'user', id: userId },
        {
          closed_at: sharedCart.closed_at,
          payment_window_ends_at: sharedCart.payment_window_ends_at,
          via: 'ready_to_pay_on_create',
        }
      );
    }

    return { sharedCart, items: insertedItems, token, clearLocalCart: true };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 2. LECTURE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Lecture publique d'un panier partagé via son token.
 * EXPOSE UNIQUEMENT les données safe (pas de téléphone/email complets).
 * Inclut l'agrégat des estimations + countdown basé sur les timestamps V4.1.
 */

module.exports = {
  createSharedCartFromBasket,
  createSharedCartFromCartItems,
  clearCreatorBasketInTx,
};
