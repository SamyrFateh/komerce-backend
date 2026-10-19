/**
 * @komerce-arch-lite
 * @role          rct1-canonical-cost-phase
 * @domain        economic-engine
 * @layer         script
 * @owner         backend-core
 * @purpose       Rattacher les commandes existantes a RCT1 avant couts fictifs via les services canoniques.
 * @impact-areas  staging-only, economic-engine, recette
 */
'use strict';

const { assignOrderSimulationScope } = require('../../services/simulation-scope-service');
const { recordManualCost } = require('../../services/cost-allocation/manual-cost-entry-service');

// Only after upstream checkout and sourcing have created genuine orders.
// This phase NEVER inserts orders, products or a cost directly.
const SAFE_COST_TYPES = new Set(['payment', 'sourcing', 'packaging', 'hub', 'local_distribution']);
function validateManifest(manifest) {
  if (!manifest || manifest.scope !== 'RCT1' || !Array.isArray(manifest.orders)) throw new Error('RCT1_MANIFEST_INVALID');
  const seen = new Set();
  for (const entry of manifest.orders) {
    if (!/^RCT1-[A-Z0-9-]+$/.test(entry.reference || '') || seen.has(entry.reference)) throw new Error('RCT1_REFERENCE_INVALID');
    seen.add(entry.reference);
    if (!Array.isArray(entry.manual_costs)) throw new Error('RCT1_COSTS_REQUIRED');
    for (const cost of entry.manual_costs) {
      if (!SAFE_COST_TYPES.has(cost.cost_type) || !Number.isInteger(cost.amount_kmf) || cost.amount_kmf < 0)
        throw new Error('RCT1_COST_INVALID');
    }
  }
  return manifest;
}
async function execute({ db, manifest, actorId, apply = false, targetConfirmed = false, env = process.env }) {
  validateManifest(manifest);
  if (apply && (!targetConfirmed || !actorId || String(env.KOMERCE_ENV).toLowerCase() !== 'staging'))
    throw new Error('RCT1_APPLY_REQUIRES_STAGING_TARGET_AND_ADMIN');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN' + (apply ? '' : ' READ ONLY'));
    const actions = [];
    for (const entry of manifest.orders) {
      const { rows } = await client.query(
        'SELECT id, reference, simulation_scope FROM orders WHERE reference = $1' + (apply ? ' FOR UPDATE' : ''),
        [entry.reference]);
      if (rows.length !== 1) throw new Error('RCT1_ORDER_NOT_CREATED_CANONICALLY: ' + entry.reference);
      const order = rows[0];
      if (order.simulation_scope && order.simulation_scope !== 'RCT1') throw new Error('RCT1_SCOPE_CONFLICT: ' + entry.reference);
      actions.push({ reference: entry.reference, action: order.simulation_scope === 'RCT1' ? 'scope_already' : 'scope_assign' });
      if (apply) await assignOrderSimulationScope(client, {
        orderId: order.id, scope: 'RCT1', reason: 'RCT1 recette contrôlée', actorId, env
      });
      for (const cost of entry.manual_costs) {
        const key = 'RCT1-' + entry.reference + '-' + cost.cost_type + '-v1';
        const { rows: prior } = await client.query(
          'SELECT id FROM order_cost_entry_events WHERE idempotency_key = $1', [key]);
        if (prior.length) {
          actions.push({ reference: entry.reference, cost_type: cost.cost_type, action: 'already' });
          continue;
        }
        actions.push({ reference: entry.reference, cost_type: cost.cost_type, action: 'record' });
        if (apply) await recordManualCost(client, {
          orderId: order.id, costType: cost.cost_type, amountKmf: cost.amount_kmf,
          provenance: 'FICTIF recette RCT1', reason: 'Scénario RCT1: ' + entry.reference,
          idempotencyKey: key, actorId
        });
      }
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return { mode: apply ? 'APPLY' : 'DRY_RUN', actions, installation_confirmed: false };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}
module.exports = { validateManifest, execute };
