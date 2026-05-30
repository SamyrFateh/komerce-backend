'use strict';
/**
 * TOMBSTONE — COLLECTIVE-CLEANUP (backend, 2026-05-30)
 *
 * Le système collective_workspaces a été démonté :
 *   - routes/collective-workspaces.js → 410
 *   - admin-collective-repairs router → non monté (api-routes.js)
 *   - front boutique/js/collective-*.js → déjà tombstonés
 *
 * Ce service backend était resté en implémentation complète mais ORPHELIN
 * (aucun appelant actif). On l'aligne sur le reste du démontage : stub no-op
 * qui lève, pour éviter qu'une éventuelle ré-exposition de route ne réintroduise
 * silencieusement le bug payment_mode='collective' (valeur absente de l'enum).
 *
 * Si la feature doit revenir : restaurer l'implémentation ET ajouter la valeur
 * d'enum 'collective' à payment_mode AVANT de re-monter la route.
 */

async function createOrderFromReadyWorkspace() {
  throw new Error('collective_workspace_disabled');
}

module.exports = { createOrderFromReadyWorkspace };
