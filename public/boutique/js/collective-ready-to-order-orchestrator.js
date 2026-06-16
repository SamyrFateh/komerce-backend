/**
 * @komerce-arch-lite
 * @role          shared-cart-collective-ready-to-order-orchestrator
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
 * Orchestrateur du flow collectif legacy désactivé (PR #486).
 * Routes /api/collective-workspaces répondent 410.
 * Ce service n'est importé depuis aucune route ou bootstrap actif.
 *
 * Les fonctions sont conservées comme stubs no-op pour compatibilité
 * avec d'éventuelles références résiduelles (repair-collective-ready-to-capture).
 */

const log = require('../utils/logger').child({ module: 'collective-ready-to-order-orchestrator-disabled' });

function _disabled(name) {
  return async function() {
    log.warn({ fn: name }, 'collective workspace disabled — no-op');
    return { ignored: true, reason: 'collective_workspace_disabled' };
  };
}

module.exports = {
  onPaymentAuthorized:        _disabled('onPaymentAuthorized'),
  confirmCashContribution:    _disabled('confirmCashContribution'),
  markSessionReadyToOrder:    _disabled('markSessionReadyToOrder'),
  closeReadyToOrderByCreator: _disabled('closeReadyToOrderByCreator'),
};
