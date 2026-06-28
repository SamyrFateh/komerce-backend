/**
 * @komerce-arch
 * @role          economic-engine-cost-allocation-helpers
 * @domain        economic-engine
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       ../order-cost-snapshot
 * @used-by       allocate.js, variance.js (services/cost-allocation/*)
 * @db-read       (none)
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine
 * @version       2026-06
 */

/**
 * KOMERCE — Cost Allocation — Helpers & constantes (Lot C5)
 * ════════════════════════════════════════════════════════════════════════
 *
 * Extrait de services/cost-allocation.js (914L) — Lot B/C Refacto.
 * Contient les briques communes utilisées par allocate.js et variance.js :
 * constantes doctrine, helpers purs de ventilation, et le verrouillage
 * des coûts estimés (délégué à order-cost-snapshot).
 *
 * COST_TYPES alignes sur cost_components (migration 043) :
 *   product_purchase, sourcing, hub, packaging,
 *   freight, customs, port_transitaire, local_distribution, relay,
 *   payment, risk_provision, fixed_overhead,
 *   incident, marketing
 */

'use strict';

// ─── Constantes doctrine (alignees sur cost_components migration 043) ──
const COST_TYPES = Object.freeze([
  'product_purchase', 'sourcing', 'hub', 'packaging',
  'freight', 'customs', 'port_transitaire', 'local_distribution', 'relay',
  'payment', 'risk_provision', 'fixed_overhead',
  'incident', 'marketing',
]);

const ALLOCATION_METHODS = Object.freeze([
  'direct', 'by_value', 'by_weight', 'by_volume', 'by_taxable_weight',
  'per_item', 'per_order', 'manual', 'estimated_fallback',
]);

// Cost types qui sont "variables tracables" (alloues au fil de l'eau)
const VARIABLE_COST_TYPES = Object.freeze([
  'product_purchase', 'sourcing', 'freight', 'customs',
  'port_transitaire', 'local_distribution', 'relay', 'payment',
]);

// Cost types qui sont "fixes mensuels" (alloues en fin de mois)
const FIXED_COST_TYPES = Object.freeze([
  'hub', 'packaging', 'risk_provision', 'fixed_overhead',
]);

// Cost types exceptionnels (tjrs is_actual=true, manuels)
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
  // Delegue a order-cost-snapshot pour eviter la duplication de logique.
  const snapshot = require('../order-cost-snapshot');
  return await snapshot.lockEstimatedCostsForOrder(orderId, dbClient, options);
}

module.exports = {
  COST_TYPES, ALLOCATION_METHODS,
  VARIABLE_COST_TYPES, FIXED_COST_TYPES, EXCEPTIONAL_COST_TYPES,
  shareByWeight, taxableWeight,
  lockEstimatedCostsForOrder,
};
