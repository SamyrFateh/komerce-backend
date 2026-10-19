/**
 * @komerce-arch
 * @role          simulation-scope
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        order id, scope (ex. RCT1), actor, reason
 * @outputs       scoped order (immutable), SQL predicates real activity vs recette scope
 * @depends       none
 * @used-by       services/dashboard-metrics/_helpers.js, services/manual-cost-entry-service.js, readers of cross-order aggregates
 * @db-read       orders
 * @db-write      orders, order_cost_entry_events
 * @db-txn        caller_transaction_preserved
 * @doctrine      simulated_facts_never_real_activity, single_margin_engine, no_silent_requalification
 * @impact-areas  finance, dashboards, recette
 * @version       2026-10
 */
'use strict';


/**
 * L3 — Faits simulés de recette. Un seul moteur : les mêmes calculs s'appliquent ; seule la SÉLECTION
 * change. Une commande à `simulation_scope` non NULL appartient à un périmètre de recette identifié :
 *   - elle participe aux calculs quand ce périmètre est demandé explicitement ;
 *   - elle est exclue de tout agrégat d'activité réelle (défaut).
 * Le périmètre est posé une fois (immuable, trigger DB) et tracé.
 */
const SIMULATION_SCOPE_RE = /^[A-Z][A-Z0-9-]{1,31}$/;
const SIMULATED_PROVENANCE_RE = /^FICTIF\b/i;

/** Même règle que middleware/require-non-production : KOMERCE_ENV prime, sinon NODE_ENV. */
function runtimeEnv(env) {
  return String(env.KOMERCE_ENV || env.NODE_ENV || '').trim().toLowerCase();
}

function isValidScope(scope) {
  return typeof scope === 'string' && SIMULATION_SCOPE_RE.test(scope);
}

function isSimulatedProvenance(provenance) {
  return typeof provenance === 'string' && SIMULATED_PROVENANCE_RE.test(provenance.trim());
}

/** Prédicat : commande d'activité réelle (alias orders). */
function realActivityOrderSql(alias) {
  return `${alias}.simulation_scope IS NULL`;
}

/** Prédicat : ligne (allocation/imputation portant order_id) rattachée à une commande d'activité réelle. */
function realActivityByOrderIdSql(alias) {
  return `NOT EXISTS (
        SELECT 1 FROM orders sim_o
         WHERE sim_o.id = ${alias}.order_id AND sim_o.simulation_scope IS NOT NULL)`;
}

async function assignOrderSimulationScope(executor, { orderId, scope, actorId = null, reason, env = process.env } = {}) {
  if (!executor || typeof executor.query !== 'function') throw new TypeError('executor requis');
  const fail = (code, message) => Object.assign(new Error(message), { code, status: 409 });
  const runtime = runtimeEnv(env);
  if (runtime === 'production') throw fail('SIMULATION_FORBIDDEN_IN_PRODUCTION', 'Périmètre de recette interdit en production');
  if (!isValidScope(scope)) throw fail('SIMULATION_SCOPE_INVALID', 'Périmètre invalide (ex. RCT1)');
  if (!reason || !String(reason).trim()) throw fail('SIMULATION_REASON_REQUIRED', 'Motif requis');

  const { rows: [order] } = await executor.query(
    'SELECT id, simulation_scope FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  if (!order) throw Object.assign(new Error('Commande introuvable'), { code: 'ORDER_NOT_FOUND', status: 404 });
  if (order.simulation_scope === scope) return { order_id: orderId, simulation_scope: scope, already: true };
  if (order.simulation_scope) throw fail('SIMULATION_SCOPE_IMMUTABLE', `Commande déjà dans le périmètre ${order.simulation_scope}`);

  await executor.query('UPDATE orders SET simulation_scope = $2 WHERE id = $1 AND simulation_scope IS NULL', [orderId, scope]);
  await executor.query(
    `INSERT INTO order_cost_entry_events (order_id, event_type, new_value, reason, actor_id)
     VALUES ($1, 'simulation_scope_assigned', $2::jsonb, $3, $4)`,
    [orderId, JSON.stringify({ simulation_scope: scope }), String(reason).trim(), actorId]);
  return { order_id: orderId, simulation_scope: scope, already: false };
}

module.exports = {
  SIMULATION_SCOPE_RE,
  isValidScope,
  isSimulatedProvenance,
  realActivityOrderSql,
  realActivityByOrderIdSql,
  assignOrderSimulationScope,
};
