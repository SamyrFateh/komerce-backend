/**
 * @komerce-arch
 * @role          shared-cart-surface-public-api
 * @domain        shared-cart
 * @layer         adapter
 * @criticality   critical
 * @inputs        shared_cart_context, cart_surface, participant_token
 * @outputs       surface_state, drawer_render, shared_list_activation
 * @depends       group-side-cart.js
 * @used-by       ../b-cart.js, ../b-tracking.js
 * @doctrine      feature_first_public_boundary
 */
'use strict';

/**
 * Frontière publique shared-cart pour les consommateurs cross-feature qui
 * pilotent uniquement la surface canonique panier/liste. Les détails du
 * contrôleur group-side-cart.js restent internes à shared-cart.
 */
export {
  isSharedListSurfaceActive,
  hasOpenSharedListInSlot,
  renderSharedListInCart,
  exitSharedListRenderMode,
  setCartSurface,
  reopenSharedListCart,
  activateFromParticipantUrl,
} from './group-side-cart.js';
