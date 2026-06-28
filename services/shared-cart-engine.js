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
 * Barrel de ré-export — API publique inchangée.
 *
 * Découpage interne (Lot C1 — 2026-06-28) :
 *   services/shared-cart-internals.js     CONFIG, helpers, audit (generateToken, r, withTransaction, addEvent)
 *   services/shared-cart-creation.js      createSharedCartFromBasket, createSharedCartFromCartItems, clearCreatorBasketInTx
 *   services/shared-cart-reads.js         getSharedCartForPublic, getSharedCartForOwner, listMySharedCarts, incrementViewCount
 *   services/shared-cart-contributions.js startContribution, attachStripeSession, markContributionFailed
 *   services/shared-cart-lifecycle.js     closeCart, convertSharedCartToOrder, cancelSharedCart, runSharedCartStateMachineTick, expireOldCarts
 *
 * Zéro changement d'interface : routes/shared-cart.js et bootstrap/crons.js
 * continuent de require('./shared-cart-engine') sans modification.
 */

'use strict';

const { CONFIG, generateToken } = require('./shared-cart-internals');
const { createSharedCartFromBasket, createSharedCartFromCartItems, clearCreatorBasketInTx } = require('./shared-cart-creation');
const { getSharedCartForPublic, getSharedCartForOwner, listMySharedCarts, incrementViewCount } = require('./shared-cart-reads');
const { startContribution, attachStripeSession, markContributionFailed } = require('./shared-cart-contributions');
const { closeCart, convertSharedCartToOrder, cancelSharedCart, runSharedCartStateMachineTick, expireOldCarts } = require('./shared-cart-lifecycle');

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
