/**
 * @komerce-arch
 * @role          shared-cart-state-machine
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        cart_id, token, cart_items, creator_action
 * @outputs       shared_cart, items, events
 * @depends       db.js
 * @used-by       routes/shared-cart.js
 * @db-read       basket_items, baskets, order_items, products, shared_cart_items, shared_carts, users
 * @db-write      basket_items, baskets, shared_cart_events, shared_cart_items, shared_carts
 * @db-txn        required_for_state_transition, snapshot_consistency
 * @doctrine      domaine_minimal_boutique_first, panier_ouvert_ferme, snapshot_fige
 * @impact-areas  participant-flow, creator-flow, checkout
 * @version       2026-08
 */

/**
 * KOMERCE — Shared Cart Engine (Boutique First, domaine minimal)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Barrel de ré-export — API publique réduite au domaine minimal.
 *
 * SUPPRIMÉ vs V4.1 (migration 124 + Lot 2/3) :
 *   startContribution, attachStripeSession, markContributionFailed
 *     → services/shared-cart-contributions.js SUPPRIMÉ (plus de paiement
 *       groupé propre à la liste — chaque participant achète
 *       individuellement via POST /api/orders, migration 123)
 *   convertSharedCartToOrder
 *     → plus de conversion de la liste entière en une seule commande
 *   runSharedCartStateMachineTick, expireOldCarts
 *     → plus de machine à états automatique (cron démonté, Lot 3)
 *   incrementViewCount
 *     → colonne view_count supprimée (migration 124)
 *
 * Découpage interne inchangé pour le reste :
 *   services/shared-cart-internals.js  CONFIG, helpers, audit
 *   services/shared-cart-creation.js   createSharedCartFromBasket, createSharedCartFromCartItems, clearCreatorBasketInTx
 *   services/shared-cart-reads.js      getSharedCartForPublic, getSharedCartForOwner, listMySharedCarts
 *   services/shared-cart-lifecycle.js  closeCart, cancelSharedCart
 */

'use strict';

const { CONFIG, generateToken } = require('./shared-cart-internals');
const { createSharedCartFromBasket, createSharedCartFromCartItems, clearCreatorBasketInTx } = require('./shared-cart-creation');
const { getSharedCartForPublic, getSharedCartForOwner, listMySharedCarts } = require('./shared-cart-reads');
const { closeCart, cancelSharedCart } = require('./shared-cart-lifecycle');

module.exports = {
  // Création
  createSharedCartFromBasket,
  createSharedCartFromCartItems,
  clearCreatorBasketInTx,
  // Lecture
  getSharedCartForPublic,
  getSharedCartForOwner,
  listMySharedCarts,
  // Cycle de vie
  closeCart,
  cancelSharedCart,
  // Helpers exposés pour tests
  generateToken,
  // Config
  CONFIG,
};
