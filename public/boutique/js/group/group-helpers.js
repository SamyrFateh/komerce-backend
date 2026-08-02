/**
 * @komerce-arch-lite
 * @role          shared-cart-front-helpers
 * @domain        shared-cart
 * @layer         util-ui
 * @owner         public/boutique/js/b-group-view.js
 * @purpose       supports public/boutique/js/b-group-view.js
 * @impact-areas  shared-cart
 * @version       2026-08
 */
'use strict';

/**
 * @module group/group-helpers.js
 * @owner Boutique First — helper de calcul pur restant après le retrait
 * des concepts V4.1 (estimations, engagements, fenêtre de paiement,
 * statuts de règlement). La liste partageable Boutique First ne connaît
 * que trois statuts (open/closed/cancelled), portés tels quels par le
 * backend — plus de projection de statut technique côté front.
 *
 * Fonction stateless, aucun import réseau, aucune mutation de state,
 * aucun accès DOM. Testable unitairement sans setup.
 */

/**
 * Arrondit n à l'entier le plus proche. Tolère null / undefined / NaN.
 * @param {number|string|null} n
 * @returns {number}
 */
export function r(n) { return Math.round(Number(n) || 0); }
