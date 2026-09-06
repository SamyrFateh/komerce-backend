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
 * Contient les briques communes utilisées par allocate.js et variance.js.
 * La classification économique N1/N2/N3 vient exclusivement de cost-types.js
 * afin qu'un même `cost_type` ne change jamais de nature selon le consommateur.
 *
 * Invariant :
 *   - `hub` = Hub variable N1 dans order_item_real_cost_allocations ;
 *   - `risk_provision` = N2 variable ;
 *   - `fixed_overhead` = legacy structure/order-allocation seulement ;
 *   - la structure Hub physique future est N3 de période, hors de cette table.
 */

'use strict';

const {
  VARIABLE_COST_TYPES,
  ORDER_ALLOCATION_STRUCTURE_COST_TYPES,
} = require('./cost-types');

// ─── Constantes doctrine (alignées sur cost_components migration 043) ──
const COST_TYPES = Object.freeze([
  ...VARIABLE_COST_TYPES,
  ...ORDER_ALLOCATION_STRUCTURE_COST_TYPES,
  'incident', 'marketing',
]);

const ALLOCATION_METHODS = Object.freeze([
  'direct', 'by_value', 'by_weight', 'by_volume', 'by_taxable_weight',
  'per_item', 'per_order', 'manual', 'estimated_fallback',
]);

// Alias de compatibilité. La vérité vient de cost-types.js.
const FIXED_COST_TYPES = ORDER_ALLOCATION_STRUCTURE_COST_TYPES;

// Cost types exceptionnels (toujours explicites, hors N1/N2 canonique).
const EXCEPTIONAL_COST_TYPES = Object.freeze([
  'incident', 'marketing',
]);

// ═══════════════════════════════════════════════════════════════════════
// HELPERS PURS (testables sans BDD)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calcule les parts proportionnelles d'un total selon un poids.
 * @param {number} total
 * @param {Array<{id, weight}>} entries
 * @returns {Array<{id, share, share_pct}>}
 */
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

/**
 * Poids taxable selon norme transport (max poids reel vs volumetrique).
 */
function taxableWeight(weightKg, volumeM3, mode = 'sea') {
  const factor = mode === 'air' ? 167 : 1000;
  const volumetricKg = (Number(volumeM3) || 0) * factor;
  return Math.max(Number(weightKg) || 0, volumetricKg);
}

// ═══════════════════════════════════════════════════════════════════════
// lockEstimatedCostsForOrder — delegue a order-cost-snapshot
// ═══════════════════════════════════════════════════════════════════════

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
