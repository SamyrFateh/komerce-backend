/**
 * @komerce-arch-lite
 * @role live-simulation-visibility
 * @domain dashboard
 * @layer service
 * @owner backend-core
 * @purpose Source unique du filtre « recette » (simulation_scope) des listes Hub Live / Relais Live.
 * @impact-areas dashboard, hub, relay
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

module.exports = { wantsSimulation, simulationClause };
