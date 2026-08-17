/**
 * @komerce-arch
 * @role          shared-cart-library-public-api
 * @domain        shared-cart
 * @layer         adapter
 * @criticality   high
 * @inputs        viewer_session, organizer_identity
 * @outputs       shared_cart_library, canonical_list_label
 * @depends       group-api.js, group-list-labels.js
 * @used-by       ../b-tracking.js
 * @doctrine      feature_first_public_boundary
 */
'use strict';

/**
 * Frontière publique shared-cart dédiée à la bibliothèque « Mes listes ».
 * Elle expose uniquement la lecture de bibliothèque et le libellé canonique,
 * sans livrer les primitives réseau ou presenters internes du domaine.
 */
export { getSharedCartLibrary } from './group-api.js';
export { sharedListDisplayLabel } from './group-list-labels.js';
