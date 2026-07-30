/**
 * @komerce-arch
 * @role          shared-cart-lifecycle
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        shared_cart_id, user_id, options, payment_event, timer_event
 * @outputs       shared_cart, order, transition_count
 * @depends       db.js, services/shared-cart-internals.js, services/whatsapp-meta.js, services/order-service.js, services/routing.js, services/order-payment-confirmation.js, utils/rates.js
 * @used-by       routes/shared-cart.js, bootstrap/crons.js
 * @db-read       orders, products, recipients, relais, shared_cart_contributions, shared_cart_items, shared_carts, users
 * @db-write      basket_items, baskets, order_items, order_status_history, orders, recipients, shared_cart_events, shared_carts
 * @db-txn        required_for_state_transition, idempotent_payment_events, snapshot_consistency
 * @doctrine      paiement_seul_acte_engageant, panier_ouvert_ferme, snapshot_fige, fenetre_paiement_48h, choix_createur_72h, idempotence_financiere
 * @impact-areas  creator-flow, checkout, orders, notifications, stock, economic-engine
 * @version       2026-06
 */

'use strict';

const crypto = require('crypto');
const db = require('../db');
const { CONFIG, r, withTransaction, addEvent } = require('./shared-cart-internals');
const { appendOrderHistoryNote } = require('./order-status-machine');
const { sendTemplateWhatsApp } = require('./whatsapp-meta');
const { getUniqueRef } = require('./order-service');
const { ensureSecretGenerated, cacheCodeForReveal } = require('./pickup-secret-service');
const { resolveRoutingFromRelais, RoutingError } = require('./routing');
const { confirmPaymentCycle } = require('./order-payment-confirmation');
const { getRates } = require('../utils/rates');
const log = require('../utils/logger').child({ module: 'shared-cart-lifecycle' });

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
    const liveRates = await getRates();
    const eurKmf = liveRates?.eur_kmf || 492;
    const totalEur = parseFloat((totalKmf / eurKmf).toFixed(2));

    const { rows: [order] } = await client.query(
      `INSERT INTO orders (
         id, reference, user_id, recipient_id, relais_id,
         tracking_phone,
         total_kmf, total_eur,
         payment_mode, payment_status,
         cash_ref_code,
         status,
         shared_cart_id, prepaid_amount_kmf, remaining_cash_kmf,
         destination_island, routing_mode, transit_hub
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6,
         $7, $8,
         'mixed_shared_cart_cash', 'pending',
         NULL,
         'pending',
         $9, $10, $11,
         $12, $13, $14
       )
       RETURNING *`,
      [
        orderId, reference, userId, recipientId, relais.id,
        recipientPhone || null,
        totalKmf, totalEur,
        sharedCartId, prepaidKmf, remainingCashKmf,
        routing.destination_island,
        routing.routing_mode,
        routing.transit_hub,
      ]
    );

    await appendOrderHistoryNote(client, order.id, 'pending',
      'Commande créée depuis panier partagé V4.1', userId);

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
    let sharedCartPickupCode = null;
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

      // Code de retrait canonique — généré ici, à la confirmation du paiement
      // (jamais à la création). Cas B (cash résiduel) : pas de code tant que
      // le cash n'a pas été encaissé — voir services/cash-operations.js.
      const secretResult = await ensureSecretGenerated({
        orderId:  order.id,
        relaisId: relais.id,
        channel:  'shared_cart_full_payment',
        dbClient: client,
      });
      if (secretResult.code) sharedCartPickupCode = secretResult.code;
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
      // Clair, one-shot — le caller doit le passer à cacheCodeForReveal()
      // APRÈS commit puis le jeter. Null si cas B (cash résiduel).
      pickupCodeToCache: sharedCartPickupCode,
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
  closeCart,
  convertSharedCartToOrder,
  cancelSharedCart,
  runSharedCartStateMachineTick,
  expireOldCarts,
};
