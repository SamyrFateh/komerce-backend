/**
 * @komerce-arch
 * @role          loyalty-service
 * @domain        loyalty
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/notification-service.js, utils/logger.js
 * @used-by       routes/admin-finance-config.js, routes/cash.js, routes/orders/create.js, routes/pickup-secret.js, routes/shared-cart.js, services/payment-cash-confirm.js, services/payment-stripe.js
 * @db-read       finance_config, loyalty_rewards, orders, users
 * @db-write      loyalty_rewards
 * @db-write-via:user-mutation-service users
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  loyalty
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — services/loyalty-service.js
 * ═══════════════════════════════════════════════════════════════════════
 * Système de fidélité basé sur les "gros paniers" (big_basket_count)
 *
 * Règle métier :
 *   Un "gros panier" = commande dont total_kmf >= loyalty_threshold_kmf
 *                      ET passée en status 'confirmed' (paiement validé)
 *
 *   À partir de la Nᵉ commande gros panier (loyalty_trigger_count = 3 par défaut),
 *   le client devient éligible à un cadeau de fidélité.
 *
 *   L'admin décide manuellement du cadeau (produit offert, crédit, etc.)
 *   depuis le Control Tower — mais le système notifie automatiquement le client
 *   par WhatsApp dès qu'il devient éligible.
 *
 * Activation / désactivation :
 *   finance_config.loyalty_active = false → désactive complètement le système
 *   (plus de notif, plus de création d'enregistrement loyalty_rewards)
 *
 * Ce service est appelé par :
 *   - routes/pickup-secret.js quand une commande passe à 'confirmed' (cash)
 *   - routes/payments.js quand un paiement Stripe est validé
 * ═══════════════════════════════════════════════════════════════════════
 */

const db = require('../db');
const log = require('../utils/logger').forModule('loyalty-service');
const {
  incrementBigBasketCount,
  markBigBasketNotified,
  recalculateUserLoyalty,
} = require('./user-mutation-service');

// ─── Cache de la config (5 min) pour éviter de requêter à chaque commande ───
let _configCache = null;
let _configCacheAt = 0;
const CONFIG_TTL_MS = 5 * 60 * 1000;

async function getFinanceConfig() {
  const now = Date.now();
  if (_configCache && (now - _configCacheAt) < CONFIG_TTL_MS) {
    return _configCache;
  }
  try {
    const { rows: [cfg] } = await db.query('SELECT * FROM finance_config WHERE id = 1');
    _configCache = cfg || null;
    _configCacheAt = now;
    return _configCache;
  } catch (err) {
    // Table pas encore créée — on ignore
    if (err.code === '42P01') {
      log.warn({ err }, 'finance_config table not yet created');
      return null;
    }
    throw err;
  }
}

// Invalidation manuelle du cache (appelée après PUT /api/admin/finance-config)
function invalidateConfigCache() {
  _configCache = null;
  _configCacheAt = 0;
}

/**
 * Appelé dans le hook post-confirmed d'une commande.
 * Incrémente big_basket_count si le panier dépasse le seuil,
 * déclenche la notification WhatsApp si le seuil de trigger est atteint.
 *
 * Non-bloquant : toute erreur est loggée mais n'empêche pas le flow.
 *
 * @param {object} opts
 * @param {string} opts.orderId
 * @param {object} [opts.dbClient]  — si dans une transaction, passer le client
 */
async function handleOrderConfirmed({ orderId, dbClient = null }) {
  const dbHandle = dbClient || db;

  try {
    const cfg = await getFinanceConfig();
    if (!cfg || !cfg.loyalty_active) {
      return { skipped: true, reason: 'loyalty_disabled' };
    }

    // 1. Récupérer la commande et le user
    const { rows: [order] } = await dbHandle.query(`
      SELECT o.id, o.reference, o.user_id, o.total_kmf, o.status,
             u.full_name, u.phone, u.big_basket_count, u.big_basket_last_notified_count
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
    `, [orderId]);

    if (!order) {
      log.warn({ orderId }, 'order not found');
      return { skipped: true, reason: 'order_not_found' };
    }

    // Pas de user associé (guest checkout) → pas de fidélité
    if (!order.user_id) {
      return { skipped: true, reason: 'guest_order' };
    }

    // Panier sous le seuil → rien à faire
    const totalKmf = Number(order.total_kmf || 0);
    if (totalKmf < Number(cfg.loyalty_threshold_kmf)) {
      return { skipped: true, reason: 'below_threshold', total_kmf: totalKmf };
    }

    // 2. Incrémenter le compteur (en DB directement pour atomicité)
    const { rows: [updated] } =
      await incrementBigBasketCount(
        dbHandle,
        order.user_id
      );

    const newCount       = Number(updated.big_basket_count);
    const lastNotified   = Number(updated.big_basket_last_notified_count);
    const triggerCount   = Number(cfg.loyalty_trigger_count);

    log.info({ userId: order.user_id, count: newCount, orderRef: order.reference, totalKmf }, 'big basket count incremented');

    // 3. Déclenchement si on atteint ou dépasse un palier de trigger
    //    (par défaut 3, puis chaque tranche de 3 supplémentaire : 6, 9, 12...)
    //    La condition : newCount est un multiple de triggerCount
    //                   ET on n'a pas encore notifié à ce palier
    const hasReachedNewTier =
      triggerCount > 0 &&
      newCount % triggerCount === 0 &&
      newCount > lastNotified;

    if (!hasReachedNewTier) {
      return { skipped: false, incremented: true, notified: false, count: newCount };
    }

    // 4. Créer l'enregistrement loyalty_rewards (status 'pending' = à traiter admin)
    await dbHandle.query(`
      INSERT INTO loyalty_rewards (user_id, triggered_by_order_id, basket_count_at_trigger, status)
      VALUES ($1, $2, $3, 'pending')
    `, [order.user_id, orderId, newCount]);

    // 5. Mémoriser qu'on a notifié à ce palier (évite les re-triggers)
    await markBigBasketNotified(dbHandle, {
      userId: order.user_id,
      count: newCount,
    });

    // 6. Notifier le client par WhatsApp (fire-and-forget, non-bloquant)
    try {
      const notifSvc = require('./notification-service');
      if (typeof notifSvc.notifyLoyaltyEarned === 'function') {
        notifSvc.notifyLoyaltyEarned({
          userId:     order.user_id,
          userName:   updated.full_name,
          phone:      updated.phone,
          orderRef:   order.reference,
          basketCount: newCount,
        }).catch(e => log.error({ err: e, userId: order.user_id, orderRef: order.reference }, 'loyalty notification error'));
      }
    } catch(e) { log.warn({ err: e }, 'loyalty notification require error'); }

    log.info({ userId: order.user_id, count: newCount, triggerCount }, 'client eligible for loyalty reward');

    return {
      skipped: false,
      incremented: true,
      notified: true,
      count: newCount,
      tier: Math.floor(newCount / triggerCount),
    };

  } catch (err) {
    log.error({ err, orderId }, 'handleOrderConfirmed error');
    return { skipped: true, reason: 'error', error: err.message };
  }
}

/**
 * Calcule le statut fidélité d'un utilisateur (pour /api/orders/me et la boutique)
 *
 * @returns {object} { count, threshold_kmf, trigger_count, next_step, pending_reward }
 */
async function getUserLoyaltyStatus(userId) {
  if (!userId) return null;

  const cfg = await getFinanceConfig();
  if (!cfg || !cfg.loyalty_active) {
    return { active: false };
  }

  const { rows: [user] } = await db.query(`
    SELECT big_basket_count, big_basket_last_notified_count FROM users WHERE id = $1
  `, [userId]);

  if (!user) return null;

  const count        = Number(user.big_basket_count);
  const trigger      = Number(cfg.loyalty_trigger_count);
  const threshold    = Number(cfg.loyalty_threshold_kmf);

  // Combien de gros paniers encore à faire pour atteindre le prochain palier ?
  const nextTier       = Math.ceil((count + 1) / trigger) * trigger;
  const remaining      = nextTier - count;

  // Y a-t-il un cadeau pending pas encore accordé pour ce user ?
  const { rows: [pending] } = await db.query(`
    SELECT id, basket_count_at_trigger, created_at
    FROM loyalty_rewards
    WHERE user_id = $1 AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1
  `, [userId]);

  return {
    active: true,
    count,
    threshold_kmf: threshold,
    trigger_count: trigger,
    next_tier: nextTier,
    remaining_to_next_tier: remaining,
    pending_reward: pending ? {
      id: pending.id,
      at_count: Number(pending.basket_count_at_trigger),
      created_at: pending.created_at,
    } : null,
    // État synthétique pour l'UI boutique
    status: pending ? 'reward_pending' :
            (remaining === 1 ? 'one_more' :
            (count > 0 ? 'active' : 'inactive')),
  };
}

module.exports = {
  handleOrderConfirmed,
  getUserLoyaltyStatus,
  getFinanceConfig,
  invalidateConfigCache,
  getLoyaltyDiscount,
  recalculateLoyalty,
};

// ══════════════════════════════════════════════════════════════════════════
// getLoyaltyDiscount / recalculateLoyalty
// ══════════════════════════════════════════════════════════════════════════
// O7.3 (provider loyalty) : extraites de routes/loyalty.js (une route, pas
// une boundary de feature — déjà auto-documentée "FONCTIONS UTILITAIRES
// exportées, utilisées par orders.js"). Comportement repris à l'identique,
// y compris la signature (db, userId) : les appelants passent parfois un
// client de transaction, jamais le pool module-level de ce service. Voir
// docs/O7_3_BOUNDARY_ANALYSIS.md, provider loyalty.

/**
 * getLoyaltyDiscount(db, userId)
 * Retourne { discountPct, discountLabel } pour un client donné.
 * discountPct  = 0 si aucun palier actif
 * discountLabel = label du palier (ex: "Bronze", "Silver") ou null
 */
async function getLoyaltyDiscount(db, userId) {
  try {
    const { rows } = await db.query(
      `SELECT discount_pct, tier_label FROM v_loyalty_summary WHERE id = $1`,
      [userId]
    );
    if (!rows.length) return { discountPct: 0, discountLabel: null };
    return {
      discountPct:   parseFloat(rows[0].discount_pct)  || 0,
      discountLabel: rows[0].tier_label || null
    };
  } catch (err) {
    // En cas d'erreur DB, on ne bloque pas la commande — remise = 0
    log.error({ err }, '[LOYALTY] getLoyaltyDiscount error:');
    return { discountPct: 0, discountLabel: null };
  }
}

/**
 * recalculateLoyalty(db, userId)
 * Recalcule le palier d'un client après une commande.
 * Fire-and-forget : les erreurs sont loguées mais n'interrompent pas le flux.
 */
async function recalculateLoyalty(db, userId) {
  try {
    await recalculateUserLoyalty(db, userId);
  } catch (err) {
    log.error({ err }, '[LOYALTY] recalculateLoyalty error:');
  }
}
