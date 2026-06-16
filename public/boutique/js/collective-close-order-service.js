/**
 * @komerce-arch-lite
 * @role          shared-cart-collective-close-order-service
 * @domain        shared-cart
 * @layer         ui-component
 * @owner         public/boutique/js/b-group-view.js
 * @purpose       supports public/boutique/js/b-group-view.js
 * @impact-areas  shared-cart, checkout
 * @version       2026-06
 */

'use strict';
/**
 * TOMBSTONE — COLLECTIVE-CLEANUP (2026-05-26)
 *
 * Ce service faisait partie du flow collectif legacy désactivé (PR #486).
 * Il n'est plus appelé depuis aucune route ou service actif.
 * Conservé comme stub no-op pour éviter des erreurs d'import si une
 * référence résiduelle existe.
 *
 * Appelant unique : collective-ready-to-order-orchestrator.js (lui-même tombstone)
 */

async function createOrderFromReadyWorkspace() {
  throw new Error('collective_workspace_disabled');
}

module.exports = { createOrderFromReadyWorkspace };
