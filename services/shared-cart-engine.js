/**
 * KOMERCE — Shared Cart Engine
 * ═══════════════════════════════════════════════════════════════════
 *
 * Moteur du Panier Partagé Responsable.
 *
 * DOCTRINE :
 *   "Komerce transforme l'aide familiale en achat visible,
 *    traçable et livré."
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

// ─── Configuration ─────────────────────────────────────────────────────
const CONFIG = {
  TOKEN_LENGTH: 16,                     // 16 caractères Base58 ≈ 95 bits
  DEFAULT_EXPIRATION_DAYS: 30,
  MIN_CONTRIBUTION_KMF: 2500,           // ~5 EUR
  MAX_CONTRIBUTION_KMF: 500000,         // ~1000 EUR — au-delà, KYC requis
  MAX_ACTIVE_CARTS_PER_USER: 5,
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
 * Snapshot figé immédiatement.
 *
 * @param {string} userId — bénéficiaire authentifié
 * @param {string} basketId — basket source
 * @param {Object} options — { title, message, expirationDays, deliveryRelayId }
 * @returns {Object} { sharedCart, items, token }
 */
async function createSharedCartFromBasket(userId, basketId, options = {}) {
  return withTransaction(async (client) => {
    // 1. Vérifier limite paniers actifs
    const { rows: activeCount } = await client.query(
      `SELECT COUNT(*)::int AS n FROM shared_carts
        WHERE beneficiary_user_id = $1
          AND status IN ('active', 'partially_funded', 'fully_funded')`,
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

    // 5. Créer le shared_cart
    const expirationDays = Math.max(1, Math.min(90, options.expirationDays || CONFIG.DEFAULT_EXPIRATION_DAYS));
    const { rows: cartRows } = await client.query(
      `INSERT INTO shared_carts (
         token, beneficiary_user_id,
         beneficiary_phone_snapshot, beneficiary_name_snapshot,
         source_basket_id, title, message,
         currency_snapshot, total_kmf_snapshot, contributed_kmf, remaining_kmf,
         delivery_relay_id, status, expires_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         'KMF', $8, 0, $8,
         $9, 'active',
         NOW() + ($10 || ' days')::INTERVAL
       ) RETURNING *`,
      [
        token, userId,
        user.phone, user.full_name,
        basketId, options.title || null, options.message || null,
        totalKmf,
        options.deliveryRelayId || null,
        String(expirationDays),
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
      { total_kmf: totalKmf, items_count: items.length, expires_at: sharedCart.expires_at }
    );

    return { sharedCart, items: insertedItems, token };
  });
}

// ───────────────────────────────────────────────────────────────────────
// Refresh 28/04/26 — Variante "from cart items"
// Le panier mobile boutique vit en localStorage côté client (pas de basket
// DB sync). Cette fonction crée un shared_cart à partir des items envoyés
// directement.
// L'authentification est gérée en amont via authenticateOrCreateGuest :
// le user_id est toujours présent (créé à la volée à partir du phone du
// bénéficiaire si besoin). Donc pas besoin de creator_token séparé —
// l'auth Komerce existante (cookie httpOnly) suffit.
// ───────────────────────────────────────────────────────────────────────

/**
 * Crée un panier partagé directement depuis une liste d'items
 * (sans passer par baskets DB).
 *
 * @param {string} userId — bénéficiaire (peut être un guest fraichement créé)
 * @param {Array} cartItems — [{ product_id, quantity }]
 * @param {Object} options — { title, message, expirationDays, deliveryRelayId }
 * @returns {Object} { sharedCart, items, token }
 */
async function createSharedCartFromCartItems(userId, cartItems, options = {}) {
  return withTransaction(async (client) => {
    if (!userId) throw new Error('user_id requis');

    // 1. Vérifier limite paniers actifs
    const { rows: activeCount } = await client.query(
      `SELECT COUNT(*)::int AS n FROM shared_carts
        WHERE beneficiary_user_id = $1
          AND status IN ('active', 'partially_funded', 'fully_funded')`,
      [userId]
    );
    if (activeCount[0].n >= CONFIG.MAX_ACTIVE_CARTS_PER_USER) {
      throw new Error(`Limite atteinte : ${CONFIG.MAX_ACTIVE_CARTS_PER_USER} paniers partagés actifs maximum`);
    }

    // 2. Validation items
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      throw new Error('Le panier est vide, impossible de partager');
    }

    // 3. Charger les produits depuis la DB (source de vérité prix —
    //    on ne fait JAMAIS confiance aux prix envoyés par le client)
    const productIds = [...new Set(cartItems.map(i => i.product_id).filter(Boolean))];
    if (productIds.length === 0) throw new Error('Aucun produit valide dans le panier');

    const { rows: products } = await client.query(
      `SELECT id, name, image_url, category, price_kmf, promo_price_kmf, is_active
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
      const unitPrice = r(p.promo_price_kmf || p.price_kmf || 0);
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

    // 8. Insérer le shared_cart (source_basket_id = NULL : le panier vient
    //    du localStorage, pas d'une table basket)
    const expirationDays = Math.max(1, Math.min(90, options.expirationDays || CONFIG.DEFAULT_EXPIRATION_DAYS));
    const { rows: cartRows } = await client.query(
      `INSERT INTO shared_carts (
         token, beneficiary_user_id,
         beneficiary_phone_snapshot, beneficiary_name_snapshot,
         source_basket_id, title, message,
         currency_snapshot, total_kmf_snapshot, contributed_kmf, remaining_kmf,
         delivery_relay_id, status, expires_at
       ) VALUES (
         $1, $2, $3, $4, NULL, $5, $6,
         'KMF', $7, 0, $7,
         $8, 'active',
         NOW() + ($9 || ' days')::INTERVAL
       ) RETURNING *`,
      [
        token, userId,
        user.phone, user.full_name,
        options.title || null, options.message || null,
        totalKmf,
        options.deliveryRelayId || null,
        String(expirationDays),
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

    // 10. Audit
    await addEvent(client, sharedCart.id, 'shared_cart_created',
      { type: 'user', id: userId },
      {
        total_kmf: totalKmf,
        items_count: enrichedItems.length,
        expires_at: sharedCart.expires_at,
        source: 'cart_items',  // distingue from-basket vs from-cart-items
      }
    );

    return { sharedCart, items: insertedItems, token };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 2. LECTURE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Lecture publique d'un panier partagé via son token.
 * EXPOSE UNIQUEMENT les données safe (pas de téléphone/email complets).
 */
async function getSharedCartForPublic(token) {
  const { rows: cartRows } = await db.query(
    `SELECT id, token, beneficiary_name_snapshot, title, message,
            currency_snapshot, total_kmf_snapshot, contributed_kmf, remaining_kmf,
            status, expires_at, finalized_at, view_count,
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

  // Compteur de vues (incrémenté côté route, pas ici)
  return {
    cart: {
      ...cart,
      // Pas d'expose interne
      id: undefined,
    },
    items,
    contributions: contribs,
  };
}

/**
 * Lecture privée par le bénéficiaire (toutes infos sauf Stripe IDs).
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

  return { cart, items, contributions };
}

/**
 * Liste des paniers partagés du bénéficiaire.
 */
async function listMySharedCarts(userId) {
  const { rows } = await db.query(
    `SELECT id, token, title, status,
            total_kmf_snapshot, contributed_kmf, remaining_kmf,
            expires_at, finalized_at, finalized_order_id, created_at,
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
// 3. CONTRIBUTION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Démarre une contribution (status='pending'). Ne déclenche PAS Stripe
 * — c'est la responsabilité de la route qui appellera l'API Stripe.
 *
 * Vérifications :
 *   - Le panier est ouvert (active / partially_funded)
 *   - Le panier n'est pas expiré
 *   - Le montant respecte min/max
 *   - Le montant ne dépasse pas remaining_kmf
 *
 * @returns {Object} contribution (avec id) — à utiliser pour créer la session Stripe
 */
async function startContribution(token, contributorInfo) {
  return withTransaction(async (client) => {
    // 1. Charger le panier avec verrou
    const { rows: cartRows } = await client.query(
      `SELECT * FROM shared_carts WHERE token = $1 FOR UPDATE`,
      [token]
    );
    if (!cartRows.length) throw new Error('Panier partagé introuvable');
    const cart = cartRows[0];

    // 2. Vérifier statut
    if (!['active', 'partially_funded'].includes(cart.status)) {
      throw new Error(`Ce panier n'accepte plus de contributions (statut : ${cart.status})`);
    }
    if (new Date(cart.expires_at) < new Date()) {
      throw new Error('Ce panier partagé a expiré');
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

    // 4. Créer la contribution
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
 * Confirme une contribution suite au webhook Stripe checkout.session.completed.
 * IDEMPOTENT : si déjà traitée, retourne null sans rien faire.
 *
 * @param {Object} session — l'objet Stripe Checkout Session
 * @returns {Object|null} { cart, contribution } ou null si déjà traité
 */
async function confirmContributionFromStripe(session) {
  return withTransaction(async (client) => {
    const sessionId = session.id;
    const paymentIntentId = session.payment_intent || null;

    // 1. Trouver la contribution
    const { rows: contribRows } = await client.query(
      `SELECT * FROM shared_cart_contributions
        WHERE stripe_session_id = $1
        FOR UPDATE`,
      [sessionId]
    );
    if (!contribRows.length) {
      // Possible : event reçu avant qu'on ait stocké session_id (race)
      // OU event qui ne nous concerne pas. On retourne null.
      return null;
    }
    const contribution = contribRows[0];

    // 2. IDEMPOTENCE : si déjà paid, ne rien faire
    if (contribution.status === 'paid') return null;

    if (contribution.status !== 'pending') {
      throw new Error(`Contribution dans un état inattendu : ${contribution.status}`);
    }

    // 3. Vérifier que Stripe confirme bien le paiement
    if (session.payment_status !== 'paid') {
      // Peut arriver pour 'unpaid' ou 'no_payment_required'
      // On ne marque pas paid mais on log
      await addEvent(client, contribution.shared_cart_id, 'contribution_stripe_pending',
        { type: 'stripe' },
        { session_id: sessionId, payment_status: session.payment_status }
      );
      return null;
    }

    // 4. Lock le panier
    const { rows: cartRows } = await client.query(
      `SELECT * FROM shared_carts WHERE id = $1 FOR UPDATE`,
      [contribution.shared_cart_id]
    );
    if (!cartRows.length) throw new Error('Panier introuvable lors de la confirmation');
    const cart = cartRows[0];

    // 5. Marquer la contribution paid
    await client.query(
      `UPDATE shared_cart_contributions
          SET status = 'paid',
              paid_at = NOW(),
              stripe_payment_intent_id = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [paymentIntentId, contribution.id]
    );

    // 6. Recalculer le panier
    const newContributed = r(cart.contributed_kmf) + r(contribution.amount_kmf);
    const newRemaining = Math.max(0, r(cart.total_kmf_snapshot) - newContributed);
    let newStatus = cart.status;
    if (newRemaining === 0) newStatus = 'fully_funded';
    else if (newContributed > 0) newStatus = 'partially_funded';

    await client.query(
      `UPDATE shared_carts
          SET contributed_kmf = $1, remaining_kmf = $2, status = $3, updated_at = NOW()
        WHERE id = $4`,
      [newContributed, newRemaining, newStatus, cart.id]
    );

    // 7. Audit
    await addEvent(client, cart.id, 'contribution_paid',
      { type: 'stripe' },
      {
        contribution_id: contribution.id,
        amount_kmf: contribution.amount_kmf,
        amount_paid: contribution.amount_paid,
        currency: contribution.currency_paid,
        stripe_session_id: sessionId,
        new_status: newStatus,
      }
    );

    if (newStatus === 'fully_funded') {
      await addEvent(client, cart.id, 'cart_fully_funded',
        { type: 'system' },
        { contributed_kmf: newContributed }
      );
    } else if (cart.status !== 'partially_funded' && newStatus === 'partially_funded') {
      await addEvent(client, cart.id, 'cart_partially_funded',
        { type: 'system' },
        { contributed_kmf: newContributed, remaining_kmf: newRemaining }
      );
    }

    const updatedCart = (await client.query(
      `SELECT * FROM shared_carts WHERE id = $1`, [cart.id]
    )).rows[0];

    const updatedContrib = (await client.query(
      `SELECT * FROM shared_cart_contributions WHERE id = $1`, [contribution.id]
    )).rows[0];

    return { cart: updatedCart, contribution: updatedContrib };
  });
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
// 4. FINALISATION → COMMANDE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Le bénéficiaire finalise son panier partagé.
 * Crée une commande Komerce. Le reste à payer (si pas 100%) sera collecté
 * en cash relais selon le flux Komerce existant.
 *
 * NOTE : la création complète d'order avec ses items dépend de la logique
 * orders existante. Ici on fait l'essentiel : vérification + créa order
 * minimale + lien shared_cart_id <-> order. La logique métier orders
 * (items, shipment, etc.) doit être déclenchée par la route.
 *
 * @returns { sharedCart, order, prepaidKmf, remainingCashKmf }
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

    if (!['active', 'partially_funded', 'fully_funded'].includes(cart.status)) {
      throw new Error(`Impossible de finaliser un panier au statut ${cart.status}`);
    }
    if (new Date(cart.expires_at) < new Date()) {
      throw new Error('Ce panier partagé a expiré');
    }
    if (cart.finalized_order_id) {
      throw new Error('Ce panier est déjà finalisé');
    }

    // 2. Reste à payer cash
    const prepaidKmf = r(cart.contributed_kmf);
    const remainingCashKmf = r(cart.total_kmf_snapshot) - prepaidKmf;

    // 3. Charger les items snapshot pour la commande
    const { rows: items } = await client.query(
      `SELECT * FROM shared_cart_items WHERE shared_cart_id = $1`,
      [sharedCartId]
    );

    // 4. Vérifier stock + prix sur products (re-check au moment de finaliser)
    const stockIssues = [];
    for (const it of items) {
      if (!it.product_id) continue; // produit supprimé du catalogue → ignorer la check
      const { rows: prodRows } = await client.query(
        `SELECT id, name, stock, price_kmf, is_active FROM products WHERE id = $1`,
        [it.product_id]
      );
      if (!prodRows.length || !prodRows[0].is_active) {
        stockIssues.push({ name: it.product_name_snapshot, issue: 'unavailable' });
      } else if (r(prodRows[0].stock) < r(it.quantity)) {
        stockIssues.push({
          name: it.product_name_snapshot,
          issue: 'low_stock',
          available: prodRows[0].stock,
          requested: it.quantity,
        });
      }
    }
    if (stockIssues.length && !options.acceptStockIssues) {
      throw new Error(JSON.stringify({ code: 'stock_issues', issues: stockIssues }));
    }

    // 5. Créer la commande (squelette ; les items sont créés par la route via la logique orders existante)
    // On suppose ici un INSERT minimal compatible avec orders
    const reference = await generateOrderReference(client);
    const paymentMode = (remainingCashKmf > 0)
      ? 'mixed_shared_cart_cash'
      : (prepaidKmf > 0 ? 'stripe_eur' : 'cash_relais');

    const paymentStatus = (remainingCashKmf === 0 && prepaidKmf > 0)
      ? 'paid'
      : (prepaidKmf > 0 ? 'partially_paid' : 'pending');

    const relayId = options.deliveryRelayId || cart.delivery_relay_id;
    if (!relayId) throw new Error('Point relais requis pour finaliser');

    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (
         reference, user_id, basket_id, relais_id,
         total_kmf, payment_mode, payment_status,
         shared_cart_id, prepaid_amount_kmf, remaining_cash_kmf
       ) VALUES ($1, $2, $3, $4, $5, $6::payment_mode, $7::payment_status, $8, $9, $10)
       RETURNING *`,
      [
        reference, userId, cart.source_basket_id, relayId,
        cart.total_kmf_snapshot, paymentMode, paymentStatus,
        sharedCartId, prepaidKmf, remainingCashKmf,
      ]
    );
    const order = orderRows[0];

    // 6. Marquer le panier comme converti
    await client.query(
      `UPDATE shared_carts
          SET status = 'converted_to_order',
              finalized_at = NOW(),
              finalized_order_id = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [order.id, sharedCartId]
    );

    // 7. Audit
    await addEvent(client, sharedCartId, 'cart_converted_to_order',
      { type: 'user', id: userId },
      {
        order_id: order.id,
        order_reference: reference,
        prepaid_kmf: prepaidKmf,
        remaining_cash_kmf: remainingCashKmf,
        stock_issues: stockIssues.length ? stockIssues : undefined,
      }
    );

    return { sharedCart: cart, order, items, prepaidKmf, remainingCashKmf };
  });
}

async function generateOrderReference(client) {
  const year = new Date().getFullYear();
  const { rows } = await client.query(
    `SELECT COUNT(*)::int + 1 AS n FROM orders WHERE reference LIKE $1`,
    [`KOM-${year}-%`]
  );
  return `KOM-${year}-${String(rows[0].n).padStart(4, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════
// 5. ANNULATION / EXPIRATION
// ═══════════════════════════════════════════════════════════════════════

async function cancelSharedCart(sharedCartId, userId, reason) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM shared_carts WHERE id = $1 AND beneficiary_user_id = $2 FOR UPDATE`,
      [sharedCartId, userId]
    );
    if (!rows.length) throw new Error('Panier introuvable ou non autorisé');
    const cart = rows[0];

    if (!['active', 'partially_funded', 'fully_funded'].includes(cart.status)) {
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
    // (cf. brief §6 règle "expire only, pas d'opération financière auto")

    return cart;
  });
}

async function expireOldCarts() {
  const { rows } = await db.query(
    `UPDATE shared_carts
        SET status = 'expired', updated_at = NOW()
      WHERE status IN ('active', 'partially_funded')
        AND expires_at < NOW()
      RETURNING id, beneficiary_user_id, contributed_kmf`
  );

  for (const cart of rows) {
    await db.query(
      `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, payload)
         VALUES ($1, 'cart_expired', 'system', $2)`,
      [cart.id, { contributed_kmf: cart.contributed_kmf }]
    );
  }

  return rows.length;
}

// ═══════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════
module.exports = {
  // API principale
  createSharedCartFromBasket,
  createSharedCartFromCartItems,         // Refresh 28/04/26
  getSharedCartForPublic,
  getSharedCartForOwner,
  listMySharedCarts,
  incrementViewCount,
  startContribution,
  attachStripeSession,
  confirmContributionFromStripe,
  markContributionFailed,
  convertSharedCartToOrder,
  cancelSharedCart,
  expireOldCarts,
  // Helpers exposés pour tests
  generateToken,
  // Config
  CONFIG,
};
