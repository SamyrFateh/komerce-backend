/**
 * @komerce-arch
 * @role          orders-cart-public-api
 * @domain        boutique
 * @layer         adapter
 * @criticality   high
 * @inputs        product_id, cart_state
 * @outputs       cart_mutation, cart_summary, cart_open
 * @depends       b-cart.js, cart-product-summary.js
 * @used-by       b-modal-suggestions.js
 * @doctrine      feature_first_public_boundary
 */
'use strict';

/**
 * Frontière publique orders-client pour les consommateurs cross-feature.
 * Les consommateurs ne doivent jamais importer b-cart.js ou
 * cart-product-summary.js directement : cette façade garde la liberté de
 * refactorer l'implémentation interne du panier sans propager le couplage.
 */
import { quickAdd, quickRemove, openCartWithHighlight } from './b-cart.js';
import { getProductCartSummary } from './cart-product-summary.js';

export {
  quickAdd,
  quickRemove,
  openCartWithHighlight,
  getProductCartSummary,
};
