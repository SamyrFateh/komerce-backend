/**
 * @komerce-arch
 * @role          boutique-shared-list-projection-port
 * @domain        operations
 * @layer         ui-infrastructure
 * @criticality   high
 * @inputs        shared_list_token, shared_list_context
 * @outputs       shared_list_projection_commands, shared_list_library_projection
 * @depends       group-side-cart.js, group-api.js, group-list-labels.js
 * @used-by       b-cart.js, b-tracking.js
 * @doctrine      feature_boundary_adapter, no_business_rule_ownership
 * @impact-areas  boutique, feature-boundaries
 * @version       2026-08
 */
'use strict';

// Port technique : orders déclenche/projette une liste partagée sans importer
// directement les modules internes de la feature shared-cart.
export {
  isSharedListSurfaceActive,
  hasOpenSharedListInSlot,
  renderSharedListInCart,
  exitSharedListRenderMode,
  setCartSurface,
  reopenSharedListCart,
  activateFromParticipantUrl,
} from '../group/group-side-cart.js';
export { getSharedCartLibrary } from '../group/group-api.js';
export { sharedListDisplayLabel } from '../group/group-list-labels.js';
