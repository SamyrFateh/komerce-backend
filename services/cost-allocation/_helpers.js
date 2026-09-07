/**
 * @komerce-arch
 * @role          economic-engine-cost-allocation-helpers
 * @domain        economic-engine
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       ../order-cost-snapshot, ./cost-types
 * @used-by       allocate.js, variance.js (services/cost-allocation/*)
 * @db-read       (none)
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      pricing_market_viability_cost_scope
 * @impact-areas  economic-engine
 * @version       2026-09
 */

/**
 * KOMERCE — Cost Allocation — Helpers & constantes (Lot C5)
 * ════════════════════════════════════════════════════════════════════════
 *
 * La classification économique vient exclusivement de cost-types.js.
 *
 * Invariants :
 *   - `hub` = Hub variable N1 dans order_item_real_cost_allocations ;
 *   - `payment` = N2 transactionnel réconciliable commande ;
 *   - `risk_provision` = N2 de contribution, réconcilié en période ;
 *   - `fixed_overhead` = legacy structure/order-allocation seulement ;
 *   - la structure Hub physique future est N3 de période, hors de cette table.
 */

'use strict';

const {
  VARIABLE_COST_TYPES,
  CONTRIBUTION_COST_TYPES,
  ORDER_ALLOCATION_STRUCTURE_COST_TYPES,
} = require('./cost-types');

// Tous les types techniquement admis dans l'allocation historique.
const COST_TYPES = Object.freeze([
  ...CONTRIBUTION_COST_TYPES,
  ...ORDER_ALLOCATION_STRUCTURE_COST_TYPES,
  'incident', 'marketing',
]);

const ALLOCATION_METHODS = Object.freeze([
  'direct', 'by_value', 'by_weight', 'by_volume', 'by_taxable_weight',
  'per_item', 'per_order', 'manual', 'estimated_fallback',
]);

// Alias de compatibilité : VARIABLE_COST_TYPES = coûts réellement
// réconciliables au niveau commande (N1 + payment).
const FIXED_COST_TYPES = ORDER_ALLOCATION_STRUCTURE_COST_TYPES;

const EXCEPTIONAL_COST_TYPES = Object.freeze([
  'incident', 'marketing',
]);

function shareByWeight(total, entries) {
  const totalWeight = entries.reduce((s, e) => s + Number(e.weight || 0), 0);
  if (totalWeight === 0 || !entries.length) {
    return entries.map(e => ({ id: e.id, share: 0, share_pct: 0 }));
  }
  return entries.map(e => {
    const w = Number(e.weight || 0);
    return {
      id: e.id,
      share: Math.round(total * w / totalWeight),
      share_pct: Math.round((w / totalWeight) * 10000) / 100,
    };
  });
}

function taxableWeight(weightKg, volumeM3, mode = 'sea') {
  const factor = mode === 'air' ? 167 : 1000;
  const volumetricKg = (Number(volumeM3) || 0) * factor;
  return Math.max(Number(weightKg) || 0, volumetricKg);
}

async function lockEstimatedCostsForOrder(orderId, dbClient, options = {}) {
  const snapshot = require('../order-cost-snapshot');
  return await snapshot.lockEstimatedCostsForOrder(orderId, dbClient, options);
}

module.exports = {
  COST_TYPES, ALLOCATION_METHODS,
  VARIABLE_COST_TYPES, FIXED_COST_TYPES, EXCEPTIONAL_COST_TYPES,
  shareByWeight, taxableWeight,
  lockEstimatedCostsForOrder,
};
