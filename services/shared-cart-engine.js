/**
 * @komerce-arch
 * @role          shared-cart-state-machine
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        cart_id, token, cart_items, payment_event, timer_event, creator_action
 * @outputs       shared_cart, contribution, next_status, order, events
 * @depends       db.js, services/whatsapp-meta.js, services/order-service.js, services/routing.js, services/order-payment-confirmation.js, utils/rates.js
 * @used-by       routes/shared-cart.js, bootstrap/crons.js
 * @db-read       basket_items, baskets, orders, products, recipients, relais, shared_cart_contributions, shared_cart_estimations, shared_cart_items, shared_carts, users
 * @db-write      basket_items, baskets, order_items, order_status_history, orders, recipients, shared_cart_contributions, shared_cart_events, shared_cart_items, shared_carts
 * @db-txn        required_for_state_transition, idempotent_payment_events, snapshot_consistency
 * @doctrine      paiement_seul_acte_engageant, panier_ouvert_ferme, snapshot_fige, fenetre_paiement_48h, choix_createur_72h, idempotence_financiere
 * @impact-areas  participant-flow, creator-flow, checkout, orders, notifications, stock, economic-engine
 * @version       2026-06
 */

/**
 * KOMERCE — Shared Cart Engine  V4.1
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Moteur du Panier Partagé Responsable.
 *
 * DOCTRINE V4.1 (gelée) :
 *   Machine d'état à 5 statuts visibles + 2 techniques :
 *
 *   OPEN           → construction libre, estimations facultatives
 *   CLOSED         → fenêtre paiement fixe 48h, liste figée
 *   AWAITING_CHOICE→ fin fenêtre, <100% financé, créateur décide (72h)
 *   ORDERED        → commande créée
 *   CANCELLED      → annulé
 *   expired (tech) → 72h sans décision en AWAITING_CHOICE
 *   archived (tech)→ nettoyage final
 *
 * RÈGLES MÉTIER FORTES :
 *   1. Le panier est un SNAPSHOT FIGÉ au moment du partage
 *   2. Aucune modification du snapshot après 1ère contribution payée
 *   3. Les contributions sont confirmées UNIQUEMENT via webhook Stripe
 *   4. Idempotence : un même webhook ne crée jamais de double contribution
 *   5. La contribution max = remaining_kmf (jamais de surpaiement)
 *   6. Toutes les opérations financières sont transactionnelles
 *   7. Audit complet via shared_cart_events
 *
 * Ce service est PUR : il ne fait pas d'I/O hors BDD (pas d'envoi mail,
 * pas d'appel Stripe direct). L'orchestration vit dans les routes.
 */

'use strict';

const crypto = require('crypto');
const db = require('../db');
const { sendTemplateWhatsApp } = require('./whatsapp-meta');
const { getUniqueRef, generatePickupCode } = require('./order-service');
const { resolveRoutingFromRelais, RoutingError } = require('./routing');
const { confirmPaymentCycle } = require('./order-payment-confirmation');
const { getRates } = require('../utils/rates');

// ─── Configuration ─────────────────────────────────────────────────────
const CONFIG = {
  TOKEN_LENGTH: 16,                     // 16 caractères Base58 ≈ 95 bits
  DEFAULT_EXPIRATION_DAYS: 30,
  MIN_CONTRIBUTION_KMF: 2500,           // ~5 EUR
  MAX_CONTRIBUTION_KMF: 500000,         // ~1000 EUR — au-delà, KYC requis
  MAX_ACTIVE_CARTS_PER_USER: 5,
  PAYMENT_WINDOW_HOURS: 48,             // Fenêtre paiement CLOSED → AWAITING_CHOICE
  PAYMENT_WINDOW_MAX_DAYS: 14,          // Plafond fenêtre « prêt à payer » (doctrine §5/§9)
  AWAITING_CHOICE_HOURS: 72,            // Délai créateur AWAITING_CHOICE → expired
  ARCHIVE_AFTER_DAYS: 7,               // expired → archived
};

// Base58 (sans 0/O/I/l) pour token URL-safe lisible
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function generateToken() {
  const bytes = crypto.randomBytes(CONFIG.TOKEN_LENGTH);
  let token = '';
  for (let i = 0; i < CONFIG.TOKEN_LENGTH; i++) {
    token += BASE58_ALPHABET[bytes[i] % BASE58_ALPHABET.length];
  }
  return token;
}

// ─── Helpers ──────────────────────────────────────────────────────────
function r(n) { return Math.round(Number(n) || 0); }

async function withTransaction(callback) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Audit ────────────────────────────────────────────────────────────
async function addEvent(client, sharedCartId, eventType, actor, payload) {
  await client.query(
    `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, actor_id, payload)
       VALUES ($1, $2, $3, $4, $5)`,
    [sharedCartId, eventType, actor?.type || null, actor?.id || null, payload || {}]
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 1. CRÉATION DU PANIER PARTAGÉ
// ═══════════════════════════════════════════════════════════════════════

/**
 * Crée un panier partagé depuis le panier (basket) du bénéficiaire.
 * Snapshot figé immédiatement. Statut initial : OPEN.
 *
 * @param {string} userId — bénéficiaire authentifié
 * @param {string} basketId — basket source
 * @param {Object} options — { title, message, targetDate, deliveryRelayId }
 *   targetDate : ISO date string optionnel (ex: "2026-07-15"). Le cron
 *   fermera automatiquement le panier à cette date.
 * @returns {Object} { sharedCart, items, token }
 */
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

// ═══════════════════════════════════════════════════════════════════════
// 3. FERMETURE MANUELLE (OPEN → CLOSED)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Le créateur ferme manuellement son panier.
 * Ouvre la fenêtre de paiement fixe de 48h.
 * Remplace openSettlement() de V4.
 *
 * @param {string} sharedCartId
 * @param {string} userId
 * @returns {Object} shared_cart mis à jour
 */
async function closeCart(sharedCartId, userId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM shared_carts WHERE id = $1 AND beneficiary_user_id = $2 FOR UPDATE`,
      [sharedCartId, userId]
    );
    if (!rows.length) throw new Error('Panier introuvable ou non autorisé');
    const cart = rows[0];

    if (cart.status !== 'open') {
      throw new Error(`Impossible de fermer un panier au statut ${cart.status}`);
    }

    const { rows: [updated] } = await client.query(
      `UPDATE shared_carts
          SET status = 'closed',
              closed_at = NOW(),
              payment_window_ends_at = NOW() + INTERVAL '48 hours',
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [sharedCartId]
    );

    await addEvent(client, sharedCartId, 'cart_closed',
      { type: 'user', id: userId },
      {
        closed_at: updated.closed_at,
        payment_window_ends_at: updated.payment_window_ends_at,
      }
    );

    return updated;
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 4. CONTRIBUTION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Démarre une contribution (status='pending'). Ne déclenche PAS Stripe
 * — c'est la responsabilité de la route qui appellera l'API Stripe.
 *
 * Autorisé UNIQUEMENT si le panier est en statut CLOSED et dans sa
 * fenêtre de paiement (payment_window_ends_at > NOW()).
 *
 * @returns {Object} contribution (avec id) — à utiliser pour créer la session Stripe
 */
async function startContribution(token, contributorInfo, options = {}) {
  return withTransaction(async (client) => {
    // 1. Charger le panier avec verrou
    const { rows: cartRows } = await client.query(
      `SELECT * FROM shared_carts WHERE token = $1 FOR UPDATE`,
      [token]
    );
    if (!cartRows.length) throw new Error('Panier partagé introuvable');
    const cart = cartRows[0];

    // 2. Guard V4.1 : status CLOSED dans la fenêtre de paiement.
    //    Exception explicite : AWAITING_CHOICE si options.allowAwaitingChoice
    //    (cas « le créateur complète le gap » — la route a déjà vérifié que
    //    l'appelant est le créateur ; un participant ne passe jamais par là).
    const isAwaitingCreatorTopUp =
      cart.status === 'awaiting_choice' && options.allowAwaitingChoice === true;

    if (cart.status !== 'closed' && !isAwaitingCreatorTopUp) {
      throw new Error(`Ce panier n'accepte pas de contributions (statut : ${cart.status})`);
    }
    if (cart.status === 'closed' &&
        cart.payment_window_ends_at && new Date(cart.payment_window_ends_at) < new Date()) {
      throw new Error('La fenêtre de paiement de ce panier est expirée');
    }

    // 3. Validation contributeur
    const { name, email, phone, amountKmf, amountPaid, currency, message, fxRate } = contributorInfo;
    if (!name || !email) throw new Error('Nom et email du contributeur requis');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email invalide');

    const amount = r(amountKmf);
    if (amount < CONFIG.MIN_CONTRIBUTION_KMF) {
      throw new Error(`Contribution minimum : ${CONFIG.MIN_CONTRIBUTION_KMF} KMF`);
    }
    if (amount > CONFIG.MAX_CONTRIBUTION_KMF) {
      throw new Error(`Contribution maximum : ${CONFIG.MAX_CONTRIBUTION_KMF} KMF (KYC requis au-delà)`);
    }
    if (amount > cart.remaining_kmf) {
      throw new Error(`Le panier ne nécessite plus que ${cart.remaining_kmf} KMF (votre contribution : ${amount} KMF)`);
    }

    // 4. Créer la contribution (sans commitment_id — table supprimée en V4.1)
    const { rows: contribRows } = await client.query(
      `INSERT INTO shared_cart_contributions (
         shared_cart_id, contributor_name, contributor_email, contributor_phone,
         amount_kmf, amount_paid, currency_paid, fx_rate_used,
         status, message
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
       RETURNING *`,
      [
        cart.id, name.trim(), email.trim().toLowerCase(), phone || null,
        amount, amountPaid, currency || 'EUR', fxRate || null,
        message || null,
      ]
    );
    const contribution = contribRows[0];

    await addEvent(client, cart.id, 'contribution_started',
      { type: 'contributor' },
      { contribution_id: contribution.id, amount_kmf: amount, amount_paid: amountPaid, currency }
    );

    return { contribution, cart };
  });
}

/**
 * Lie une contribution pending à une session Stripe.
 * Appelée APRÈS création de la session par la route.
 */
async function attachStripeSession(contributionId, stripeSessionId) {
  await db.query(
    `UPDATE shared_cart_contributions
        SET stripe_session_id = $1, updated_at = NOW()
      WHERE id = $2 AND status = 'pending'`,
    [stripeSessionId, contributionId]
  );
}

/**
 * Marque une contribution comme failed (suite à webhook Stripe expiration).
 */
async function markContributionFailed(stripeSessionId, reason) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE shared_cart_contributions
          SET status = 'failed',
              failed_at = NOW(),
              metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE stripe_session_id = $1 AND status = 'pending'
        RETURNING *`,
      [stripeSessionId, JSON.stringify({ failure_reason: reason || 'stripe_expired' })]
    );
    if (rows.length) {
      await addEvent(client, rows[0].shared_cart_id, 'contribution_failed',
        { type: 'stripe' },
        { contribution_id: rows[0].id, reason }
      );
    }
    return rows[0] || null;
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 5. FINALISATION → COMMANDE (CLOSED/AWAITING_CHOICE → ORDERED)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Le créateur finalise son panier partagé et crée une commande Komerce.
 *
 * V4.1 — Cas A (100% financé) uniquement : remaining_kmf doit être 0.
 * Cas B (AWAITING_CHOICE + gap) : le créateur complète via le flux
 * startContribution normal, puis appelle finalize quand remaining === 0.
 *
 * @returns { sharedCart, order, prepaidKmf }
 */
async function convertSharedCartToOrder(sharedCartId, userId, options = {}) {
  return withTransaction(async (client) => {
    // 1. Verrou panier
    const { rows: cartRows } = await client.query(
      `SELECT * FROM shared_carts WHERE id = $1 AND beneficiary_user_id = $2 FOR UPDATE`,
      [sharedCartId, userId]
    );
    if (!cartRows.length) throw new Error('Panier partagé introuvable ou non autorisé');
    const cart = cartRows[0];

    const ALLOWED_FINALIZE_STATUSES = ['settlement_in_progress', 'ready_to_finalize'];
    if (!ALLOWED_FINALIZE_STATUSES.includes(cart.status)) {
      throw new Error(
        `Impossible de finaliser : veuillez d'abord passer au paiement (statut actuel : ${cart.status})`
      );
    }
    if (cart.finalized_order_id) {
      throw new Error('Ce panier est déjà finalisé');
    }
    const remainingCashKmf = Math.max(0, r(cart.remaining_kmf));
    if (remainingCashKmf > 0 && !options.creatorCoversGap) {
      throw new Error(
        `Il reste ${cart.remaining_kmf} KMF à financer. ` +
        'Utilisez l\'option creatorCoversGap pour couvrir le solde restant en cash.'
      );
    }

    const prepaidKmf = r(cart.contributed_kmf);
    const totalKmf   = r(cart.total_kmf_snapshot);
    if (totalKmf <= 0) throw new Error('Total panier invalide');

    // 2. Charger les items snapshot
    const { rows: items } = await client.query(
      `SELECT * FROM shared_cart_items WHERE shared_cart_id = $1 ORDER BY created_at`,
      [sharedCartId]
    );
    if (!items.length) throw new Error('Impossible de finaliser : panier sans articles');

    const productIds = [...new Set(items.map(i => i.product_id).filter(Boolean))];

    const { rows: products } = await client.query(
      `SELECT id, name, stock, is_active FROM products WHERE id = ANY($1) FOR UPDATE`,
      [productIds]
    );
    const productById = {};
    products.forEach(p => { productById[p.id] = p; });

    const stockIssues = [];
    for (const it of items) {
      const p = productById[it.product_id];
      if (!p || !p.is_active) {
        stockIssues.push({
          product_id: it.product_id,
          product_name: it.product_name_snapshot,
          reason: 'product_inactive_or_missing',
        });
        continue;
      }
      if (p.stock !== null && Number(p.stock) < Number(it.quantity)) {
        stockIssues.push({
          product_id: it.product_id,
          product_name: it.product_name_snapshot,
          available: Number(p.stock),
          needed: Number(it.quantity),
        });
      }
    }

    if (stockIssues.length > 0 && !options.acceptStockIssues) {
      throw new Error(JSON.stringify({
        code: 'stock_issues',
        message: 'Stock insuffisant pour finaliser le panier partagé',
        items: stockIssues,
      }));
    }

    // 3. Relais obligatoire
    const relayId = options.deliveryRelayId || cart.delivery_relay_id;
    if (!relayId) {
      throw new Error('delivery_relay_id requis pour finaliser le panier partagé');
    }

    const { rows: [relais] } = await client.query(
      `SELECT * FROM relais WHERE id = $1 AND is_active = TRUE`,
      [relayId]
    );
    if (!relais) throw new Error('Relais introuvable ou inactif');

    let routing = { destination_island: null, routing_mode: null, transit_hub: null };
    try {
      routing = resolveRoutingFromRelais(relais);
    } catch (e) {
      if (e instanceof RoutingError) throw new Error(e.message);
      throw e;
    }

    // 4. Bénéficiaire + recipient
    const { rows: [user] } = await client.query(
      `SELECT id, full_name, phone FROM users WHERE id = $1`,
      [userId]
    );
    if (!user) throw new Error('Utilisateur introuvable');

    let recipientId = null;
    const recipientName = user.full_name || cart.beneficiary_name_snapshot || 'Bénéficiaire';
    const recipientPhone = user.phone || cart.beneficiary_phone_snapshot;

    if (recipientPhone) {
      const { rows: [existingRecipient] } = await client.query(
        `SELECT id FROM recipients
          WHERE user_id = $1 AND phone = $2 AND relais_id = $3
          LIMIT 1`,
        [userId, recipientPhone, relais.id]
      );

      if (existingRecipient) {
        recipientId = existingRecipient.id;
      } else {
        const { rows: [newRecipient] } = await client.query(
          `INSERT INTO recipients (user_id, full_name, phone, relais_id, is_default)
           VALUES ($1, $2, $3, $4, FALSE)
           RETURNING id`,
          [userId, recipientName, recipientPhone, relais.id]
        );
        recipientId = newRecipient.id;
      }
    }

    // 5. Créer la commande complète
    const orderId = crypto.randomUUID();
    const reference = await getUniqueRef(db);
    const pickupCode = generatePickupCode();
    const liveRates = await getRates();
    const eurKmf = liveRates?.eur_kmf || 492;
    const totalEur = parseFloat((totalKmf / eurKmf).toFixed(2));

    const { rows: [order] } = await client.query(
      `INSERT INTO orders (
         id, reference, user_id, recipient_id, relais_id,
         tracking_phone,
         total_kmf, total_eur,
         payment_mode, payment_status,
         cash_ref_code, pickup_code,
         status,
         shared_cart_id, prepaid_amount_kmf, remaining_cash_kmf,
         destination_island, routing_mode, transit_hub
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6,
         $7, $8,
         'mixed_shared_cart_cash', 'pending',
         NULL, $9,
         'pending',
         $10, $11, $12,
         $13, $14, $15
       )
       RETURNING *`,
      [
        orderId, reference, userId, recipientId, relais.id,
        recipientPhone || null,
        totalKmf, totalEur,
        pickupCode,
        sharedCartId, prepaidKmf, remainingCashKmf,
        routing.destination_island,
        routing.routing_mode,
        routing.transit_hub,
      ]
    );

    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, 'pending', 'Commande créée depuis panier partagé V4.1', $2)`,
      [order.id, userId]
    );

    // 6. Créer les order_items depuis le snapshot figé
    // Gel de la classification douanière — I-DOUANE-1 (doctrine DOUANE_DECLARATION_PIVOT)
    const { resolveFrozenClassification } = require('./customs-classification');

    for (const it of items) {
      const clf = await resolveFrozenClassification(client, it.product_category_snapshot);

      await client.query(
        `INSERT INTO order_items (
           order_id, product_id, quantity, price_kmf,
           customs_category_key, sh_code, douane_pct, tva_pct, taxe_add_pct,
           classification_defaulted
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          order.id,
          it.product_id,
          r(it.quantity),
          r(it.unit_price_kmf_snapshot),
          clf.customs_category_key,
          clf.sh_code,
          clf.douane_pct,
          clf.tva_pct,
          clf.taxe_add_pct,
          clf.classification_defaulted,
        ]
      );
    }

    // 7. Cycle paiement + stock (cas A : 100% financé — remaining_cash_kmf = 0)
    //    Cas B (creatorCoversGap, remaining > 0) : pas de confirmPaymentCycle ici,
    //    le cash résiduel sera encaissé à la livraison (doctrine §5.7).
    if (remainingCashKmf === 0) {
      const cycleResult = await confirmPaymentCycle({
        orderId: order.id,
        actor: { id: userId, role: 'system' },
        source: 'shared_cart_full_payment',
        dbClient: client,
        note: 'Paiement intégral via panier partagé V4',
      });

      if (!cycleResult.success && !cycleResult.noop) {
        throw new Error(cycleResult.error || 'Cycle paiement panier partagé échoué');
      }
      if (cycleResult.stockBlocked) {
        throw new Error(JSON.stringify({
          code: 'stock_issues',
          message: 'Stock insuffisant pour finaliser le panier partagé',
          items: cycleResult.insufficientItems,
        }));
      }
    }

    // 8. Marquer le panier comme ORDERED (converted_to_order)
    await client.query(
      `UPDATE shared_carts -- converted_to_order
          SET status = 'ordered',
              finalized_order_id = $1,
              remaining_kmf = $3,
              finalized_at = NOW(),
              updated_at = NOW()
        WHERE id = $2`,
      [order.id, sharedCartId, remainingCashKmf]
    );

    await addEvent(client, sharedCartId, 'cart_converted_to_order',
      { type: 'user', id: userId },
      {
        order_id: order.id,
        order_reference: order.reference,
        prepaid_kmf: prepaidKmf,
        remaining_cash_kmf: remainingCashKmf,
      }
    );

    const { rows: [finalOrder] } = await client.query(
      `SELECT * FROM orders WHERE id = $1`,
      [order.id]
    );

    return {
      sharedCart: { ...cart, status: 'ordered', finalized_order_id: order.id },
      order: finalOrder || order,
      prepaidKmf,
      remainingCashKmf,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 6. ANNULATION
// ═══════════════════════════════════════════════════════════════════════

/**
 * @deprecated Phase A (GAP-A) — superseded par
 * `services/cancel-shared-cart-with-refunds.js#cancelSharedCartWithRefunds`,
 * utilisé par les routes `/cancel` et `/awaiting-choice/cancel` depuis
 * juin 2026 (remboursement automatique des contributions `paid`).
 * Conservée pour compatibilité (tests, scripts internes) — ne pas appeler
 * depuis de nouveaux endpoints : elle n'effectue AUCUN remboursement.
 */
async function cancelSharedCart(sharedCartId, userId, reason) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM shared_carts WHERE id = $1 AND beneficiary_user_id = $2 FOR UPDATE`,
      [sharedCartId, userId]
    );
    if (!rows.length) throw new Error('Panier introuvable ou non autorisé');
    const cart = rows[0];

    if (!['open', 'closed', 'awaiting_choice'].includes(cart.status)) {
      throw new Error(`Impossible d'annuler un panier au statut ${cart.status}`);
    }

    await client.query(
      `UPDATE shared_carts
          SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [sharedCartId]
    );

    await addEvent(client, sharedCartId, 'cart_cancelled',
      { type: 'user', id: userId },
      { reason: reason || null, contributed_kmf: cart.contributed_kmf }
    );

    // NOTE : refunds des contributions = action manuelle admin pour le MVP
    return cart;
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 7. MACHINE D'ÉTAT — CRON TICK
// ═══════════════════════════════════════════════════════════════════════

/**
 * Exécute toutes les transitions automatiques de la machine d'état V4.1.
 * Idempotent. Appelé par le cron (remplace startExpireCartsCron/expireOldCarts).
 *
 * Transitions gérées :
 *   T1 : OPEN + target_date atteinte        → CLOSED (ouvre fenêtre 48h)
 *   T2 : CLOSED + fenêtre expirée + reste>0 → AWAITING_CHOICE (+deadline 72h)
 *   T3 : CLOSED + fenêtre expirée + reste=0 → émet cart_ready_to_order (finalize manuelle ou auto)
 *   T4 : AWAITING_CHOICE + deadline expirée → expired
 *   T5 : expired depuis > ARCHIVE_AFTER_DAYS → archived
 *
 * @returns {number} nombre total de transitions effectuées
 */
async function runSharedCartStateMachineTick() {
  let transitions = 0;

  // T1 — OPEN + target_date atteinte → CLOSED
  const { rows: autoClosedCarts } = await db.query(
    `UPDATE shared_carts
        SET status = 'closed',
            closed_at = NOW(),
            payment_window_ends_at = NOW() + INTERVAL '48 hours',
            updated_at = NOW()
      WHERE status = 'open'
        AND target_date IS NOT NULL
        AND target_date <= CURRENT_DATE
      RETURNING id, contributed_kmf`
  );
  for (const cart of autoClosedCarts) {
    await db.query(
      `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, payload)
         VALUES ($1, 'cart_auto_closed', 'system', $2)`,
      [cart.id, { reason: 'target_date_reached' }]
    );
  }
  transitions += autoClosedCarts.length;

  // T2 — CLOSED + fenêtre expirée + remaining > 0 → AWAITING_CHOICE
  const { rows: awaitingCarts } = await db.query(
    `UPDATE shared_carts sc
        SET status = 'awaiting_choice',
            awaiting_choice_started_at = NOW(),
            awaiting_choice_deadline = NOW() + INTERVAL '72 hours',
            updated_at = NOW()
       FROM users u
      WHERE u.id = sc.beneficiary_user_id
        AND sc.status = 'closed'
        AND sc.payment_window_ends_at < NOW()
        AND sc.remaining_kmf > 0
      RETURNING sc.id, sc.remaining_kmf, sc.contributed_kmf,
                sc.title, u.phone AS creator_phone, u.full_name AS creator_name`
  );
  for (const cart of awaitingCarts) {
    await db.query(
      `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, payload)
         VALUES ($1, 'cart_awaiting_choice', 'system', $2)`,
      [cart.id, { remaining_kmf: cart.remaining_kmf, contributed_kmf: cart.contributed_kmf }]
    );
    // B-01 — Notifier le créateur : financement incomplet, 3 options disponibles (72h)
    if (cart.creator_phone) {
      sendTemplateWhatsApp({
        to:           cart.creator_phone,
        templateName: 'shared_cart_awaiting_choice',
        components: [
          { type: 'body', parameters: [
            { type: 'text', text: cart.creator_name || 'Créateur' },
            { type: 'text', text: cart.title || 'Votre panier' },
            { type: 'text', text: String(cart.remaining_kmf) },
          ]},
        ],
      }).catch(err => log.warn({ err, cart_id: cart.id }, '[cron-T2] notif WhatsApp failed'));
    }
  }
  transitions += awaitingCarts.length;

  // T3 — CLOSED + fenêtre expirée + remaining = 0 → signal auto-finalisation
  // (la création d'order nécessite convertSharedCartToOrder — ce tick émet
  //  un événement, la route de finalization ou un job dédié s'en charge)
  const { rows: readyCarts } = await db.query(
    `SELECT sc.id, sc.contributed_kmf, sc.title,
            u.phone AS creator_phone, u.full_name AS creator_name
       FROM shared_carts sc
       JOIN users u ON u.id = sc.beneficiary_user_id
      WHERE sc.status = 'closed'
        AND sc.payment_window_ends_at < NOW()
        AND sc.remaining_kmf = 0
        AND sc.finalized_order_id IS NULL`
  );
  for (const cart of readyCarts) {
    // Idempotent via ON CONFLICT — évite les doublons si le tick tourne avant finalize
    await db.query(
      `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, payload)
         VALUES ($1, 'cart_ready_to_order', 'system', $2)
         ON CONFLICT DO NOTHING`,
      [cart.id, { contributed_kmf: cart.contributed_kmf }]
    );
    // B-02 — Notifier le créateur : financement complet, confirmer la commande
    if (cart.creator_phone) {
      sendTemplateWhatsApp({
        to:           cart.creator_phone,
        templateName: 'shared_cart_ready_to_order',
        components: [
          { type: 'body', parameters: [
            { type: 'text', text: cart.creator_name || 'Créateur' },
            { type: 'text', text: cart.title || 'Votre panier' },
            { type: 'text', text: String(cart.contributed_kmf) },
          ]},
        ],
      }).catch(err => log.warn({ err, cart_id: cart.id }, '[cron-T3] notif WhatsApp failed'));
    }
  }

  // T4 — AWAITING_CHOICE + deadline expirée → expired
  const { rows: expiredCarts } = await db.query(
    `UPDATE shared_carts
        SET status = 'expired',
            updated_at = NOW()
      WHERE status = 'awaiting_choice'
        AND awaiting_choice_deadline < NOW()
      RETURNING id, contributed_kmf`
  );
  for (const cart of expiredCarts) {
    await db.query(
      `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, payload)
         VALUES ($1, 'cart_expired', 'system', $2)`,
      [cart.id, { contributed_kmf: cart.contributed_kmf }]
    );
  }
  transitions += expiredCarts.length;

  // T5 — expired depuis > ARCHIVE_AFTER_DAYS → archived
  const { rows: archivedCarts } = await db.query(
    `UPDATE shared_carts
        SET status = 'archived',
            updated_at = NOW()
      WHERE status = 'expired'
        AND updated_at < NOW() - ($1 || ' days')::INTERVAL
      RETURNING id`,
    [String(CONFIG.ARCHIVE_AFTER_DAYS)]
  );
  transitions += archivedCarts.length;

  return transitions;
}

/**
 * Alias legacy pour compatibilité cron existant (bootstrap/crons.js).
 * Le cron appelle engine.expireOldCarts() — on délègue à la machine d'état V4.1.
 */
async function expireOldCarts() {
  return runSharedCartStateMachineTick();
}

// ═══════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════
module.exports = {
  // API principale
  createSharedCartFromBasket,
  createSharedCartFromCartItems,
  clearCreatorBasketInTx,             // Doctrine v4.2 N4-CLEAR — exposé pour tests
  getSharedCartForPublic,
  getSharedCartForOwner,
  listMySharedCarts,
  incrementViewCount,
  // Cycle de vie
  closeCart,                          // V4.1 — remplace openSettlement
  startContribution,
  attachStripeSession,
  markContributionFailed,
  convertSharedCartToOrder,
  cancelSharedCart,
  // Cron / machine d'état
  runSharedCartStateMachineTick,      // V4.1 — appelé par le cron
  expireOldCarts,                     // Alias legacy — délègue à runSharedCartStateMachineTick
  // Helpers exposés pour tests
  generateToken,
  // Config
  CONFIG,
};
