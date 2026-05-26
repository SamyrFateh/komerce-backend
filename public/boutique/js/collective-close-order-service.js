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
