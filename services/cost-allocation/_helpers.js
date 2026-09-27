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

// shareByWeight — ventilation proportionnelle qui conserve le total.
//
// AVANT (bug corrigé ici) : chaque part était arrondie indépendamment
// (Math.round par entrée), donc la somme des parts pouvait ne PAS égaler
// `total` — ex. shareByWeight(100, [poids 1, 1, 1]) rendait 33+33+33=99,
// perdant 1 KMF qui n'atterrissait dans aucun order_item_real_cost_
// allocations. Sur assez de ventilations customs/freight, cet écart
// s'accumule en dérive de réconciliation comptable jamais tracée.
//
// APRÈS : méthode du plus grand reste (même idiome que allocateConserving,
// services/pricing-period-structure.js) — on arrondit chaque part vers le
// bas, puis on distribue le reliquat entier (nécessairement < nombre
// d'entrées) une unité à la fois aux entrées dont la partie fractionnaire
// tronquée était la plus grande. Départage déterministe par id pour un
// résultat reproductible entre deux appels avec les mêmes entrées.
function shareByWeight(total, entries) {
  const totalWeight = entries.reduce((s, e) => s + Number(e.weight || 0), 0);
  if (totalWeight === 0 || !entries.length) {
    return entries.map(e => ({ id: e.id, share: 0, share_pct: 0 }));
  }

  const totalAmount = Math.round(Number(total) || 0);

  const raw = entries.map((e, index) => {
    const w = Number(e.weight || 0);
    const rawShare = totalAmount * w / totalWeight;
    const floorShare = Math.floor(rawShare);
    return {
      index,
      id: e.id,
      floorShare,
      remainder: rawShare - floorShare,
      share_pct: Math.round((w / totalWeight) * 10000) / 100,
    };
  });

  let remaining = totalAmount - raw.reduce((s, r) => s + r.floorShare, 0);
  const byLargestRemainder = [...raw].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return String(a.id).localeCompare(String(b.id));
  });
  for (let i = 0; i < remaining; i += 1) {
    byLargestRemainder[i % byLargestRemainder.length].floorShare += 1;
  }

  return raw
    .sort((a, b) => a.index - b.index)
    .map(r => ({ id: r.id, share: r.floorShare, share_pct: r.share_pct }));
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
