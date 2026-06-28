/**
 * @komerce-arch
 * @role          shared-cart-collective-workspace-engine
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       services/collective-workspace-internals.js, services/collective-workspace-creation.js, services/collective-workspace-reads.js, services/collective-workspace-items.js, services/collective-workspace-contributions.js, services/collective-workspace-lifecycle.js
 * @used-by       routes/collective-workspaces.js, services/collective-stock-reservation-service.js
 * @db-read       collective_payment_sessions, collective_payment_tokens, collective_workspace_contributions, collective_workspace_items, collective_workspaces, products, relais
 * @db-write      collective_payment_sessions, collective_payment_tokens, collective_workspace_contributions, collective_workspace_events, collective_workspace_items, collective_workspaces
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  shared-cart
 * @version       2026-06
 */

/**
 * KOMERCE — Collective Workspace Engine (V1) — barrel
 * ═══════════════════════════════════════════════════════════════════
 * Lot C4 2026-06-28 : monolithe 983L découpé en 6 modules.
 * Ce barrel conserve l'interface publique intacte pour tous les appelants.
 * ═══════════════════════════════════════════════════════════════════
 */

'use strict';

const { _generateToken, _hashToken, logEvent, CONFIG } = require('./collective-workspace-internals');
const { createWorkspace }                               = require('./collective-workspace-creation');
const { getWorkspaceByPublicToken,
        getWorkspaceByCreatorToken,
        getTokenInfo,
        deriveWorkspacePhase }                          = require('./collective-workspace-reads');
const { addItem, updateItem, removeItem }               = require('./collective-workspace-items');
const { addContribution,
        cancelContribution,
        cancelContributionByCreator }                   = require('./collective-workspace-contributions');
const { finalizationReview,
        finalizeWorkspace,
        resumeWorkspace }                               = require('./collective-workspace-lifecycle');

module.exports = {
  // Helpers (exposés pour tests / orchestrateur paiement)
  _generateToken, _hashToken, logEvent, CONFIG,

  // Création
  createWorkspace,

  // Lecture
  getWorkspaceByPublicToken,
  getWorkspaceByCreatorToken,
  getTokenInfo,
  deriveWorkspacePhase,

  // Items
  addItem, updateItem, removeItem,

  // Contributions
  addContribution, cancelContribution, cancelContributionByCreator,

  // Cycle de vie
  finalizationReview,
  finalizeWorkspace,
  resumeWorkspace,
};
