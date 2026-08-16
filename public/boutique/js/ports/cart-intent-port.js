/**
 * @komerce-arch
 * @role          boutique-cart-intent-port
 * @domain        operations
 * @layer         ui-infrastructure
 * @criticality   high
 * @inputs        cart_intents, cart_state, product_id
 * @outputs       cart_commands, cart_projection_queries
 * @depends       b-cart.js, b-cart-core.js, cart-product-summary.js
 * @used-by       b-catalog.js, render-product-card.js, b-modal-suggestions.js, b-modal-desktop-product.js, b-modal-buybox-shared.js
 * @doctrine      feature_boundary_adapter, no_business_rule_ownership
 * @impact-areas  boutique, feature-boundaries
 * @version       2026-08
 */
'use strict';

// Port technique : les slices de découverte expriment une intention panier
// sans importer directement l'implémentation de la feature orders.
export {
  renderCartBody,
  toggleFav,
  quickAdd,
  quickRemove,
  markAllCartButtons,
  pruneObsoleteCart,
  openCartWithHighlight,
  addToCart,
} from '../b-cart.js';
export {
  showToast,
  cartQty,
  updateCartBadge,
  isFav,
} from '../b-cart-core.js';
export { getProductCartSummary } from '../cart-product-summary.js';
