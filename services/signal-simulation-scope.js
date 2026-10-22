/**
 * @komerce-arch
 * @role          signal-simulation-scope
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   medium
 * @inputs        none
 * @outputs       EXCLUDE_SIMULATED_ORDER_SIGNALS_SQL
 * @depends       none
 * @used-by       services/dashboard-pilotage-market.js, services/dashboard-metrics/control-tower.js, services/dashboard-operations.js, services/action-center-agent-scope.js, routes/admin-dashboard.js
 * @db-read       orders
 * @db-write      none
 * @db-txn        none
 * @doctrine      real_vs_simulation_predicate, fail_safe_filter, no_second_signal_authority
 * @impact-areas  pilotage, action-center, rct1
 * @version       2026-10
 */
'use strict';

// Prédicat réel/RCT1 canonique : orders.simulation_scope IS NULL. La table des signaux n'a pas de scope propre :
// un signal dont l'entité est une commande de simulation (RCT1) ne doit pas apparaître comme une alerte réelle
// dans les surfaces de Pilotage. Les signaux non liés à une commande ne sont pas affectés. Alias requis : `s`.
const EXCLUDE_SIMULATED_ORDER_SIGNALS_SQL = `NOT EXISTS (
    SELECT 1 FROM orders sim_o
     WHERE s.entity_type = 'order'
       AND sim_o.id::text = s.entity_id::text
       AND sim_o.simulation_scope IS NOT NULL
  )`;

module.exports = { EXCLUDE_SIMULATED_ORDER_SIGNALS_SQL };
