'use strict';
/**
 * TOMBSTONE — COLLECTIVE-CLEANUP (backend, 2026-05-30)
 *
 * Orchestrateur du flow collective_workspaces, démonté (routes 410, front
 * tombstoné, admin-collective-repairs non monté). Resté en implémentation
 * complète mais ORPHELIN. Aligné sur le démontage : stubs no-op qui lèvent.
 *
 * Exports préservés (mêmes noms) pour ne casser aucun require résiduel.
 */

async function markSessionReadyToOrder() {
  throw new Error('collective_workspace_disabled');
}

async function onPaymentAuthorized() {
  throw new Error('collective_workspace_disabled');
}

async function confirmCashContribution() {
  throw new Error('collective_workspace_disabled');
}

async function closeReadyToOrderByCreator() {
  throw new Error('collective_workspace_disabled');
}

module.exports = {
  onPaymentAuthorized,
  confirmCashContribution,
  markSessionReadyToOrder,
  closeReadyToOrderByCreator,
};
