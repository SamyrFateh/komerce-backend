/**
 * @komerce-arch-lite
 * @role live-simulation-visibility
 * @domain dashboard
 * @layer service
 * @owner backend-core
 * @purpose Source unique du filtre « recette » (simulation_scope) des listes Hub Live / Relais Live.
 * @impact-areas dashboard, hub, relay
 * @db-read       e2e_test_accounts
 */
'use strict';


// Par défaut une commande de recette (simulation_scope non nul) n'apparaît jamais.
// Seul le rôle admin peut l'inclure explicitement (?include_simulation=1). Pour tout autre rôle
// le paramètre est IGNORÉ (pas de 403 : l'écran est partagé et aucune information n'est révélée).
// Les KPI/compteurs n'utilisent jamais ce filtre : ils restent strictement réels.
function wantsSimulation(user, query) {
  if (!user || user.role !== 'admin') return false;
  const v = query && query.include_simulation;
  return v === '1' || v === 'true';
}

function simulationClause(alias, includeSimulation) {
  return includeSimulation ? 'TRUE' : `${alias}.simulation_scope IS NULL`;
}

// Workspace operations canonique : la simulation n'est visible que pour un compte present dans e2e_test_accounts
// (marqueur pose par staging-e2e-provision). Les comptes reels (admin compris, sans opt-in) ne la voient jamais ;
// table vide = personne. Predicat unique reutilise par toutes les files du workspace. Distinct de wantsSimulation (#3413).
async function isE2eTestAccount(userId, executor = null) {
  if (!userId) return false;
  const db = executor || require('../db');
  const { rows } = await db.query('SELECT 1 FROM e2e_test_accounts WHERE user_id = $1::uuid LIMIT 1', [String(userId)]);
  return rows.length > 0;
}

module.exports = { wantsSimulation, simulationClause, isE2eTestAccount };
