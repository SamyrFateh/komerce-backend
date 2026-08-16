/**
 * @komerce-arch
 * @role          boutique-catalog-presentation-port
 * @domain        operations
 * @layer         ui-infrastructure
 * @criticality   high
 * @inputs        product_snapshot, modal_selection
 * @outputs       catalog_presentation_helpers
 * @depends       shop-schema.js, b-modal-product-fields.js, modal-cart-product-model.js
 * @used-by       b-modal-core.js, b-modal-cart.js
 * @doctrine      feature_boundary_adapter, no_business_rule_ownership
 * @impact-areas  boutique, feature-boundaries
 * @version       2026-08
 */
'use strict';

// Port technique lecture/projection : shared-cart ne dépend plus directement
// des fichiers internes de la feature catalog.
export { normalizeCategoryKey, getCategorySectionEmoji } from '../shop-schema.js';
export { paintProvisionalFields } from '../b-modal-product-fields.js';
export {
  buildModalCartProduct,
  isModalPurchaseReady,
} from '../view-models/modal-cart-product-model.js';
