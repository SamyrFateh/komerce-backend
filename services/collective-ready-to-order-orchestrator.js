/**
 * @komerce-arch
 * @role          shared-cart-collective-ready-to-order-orchestrator
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  shared-cart, checkout
 * @version       2026-06
 */

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
