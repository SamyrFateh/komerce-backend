/**
 * @komerce-arch
 * @role          economic-engine-cost-type-classification
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        cost_type, snapshot_cost_key
 * @outputs       canonical_cost_type_classification, snapshot_to_real_mapping
 * @depends       @none
 * @used-by       services/cost-allocation/variance.js, services/dashboard-metrics/_helpers.js, services/cost-allocation/_helpers.js, services/pricing-maturity.js
 * @db-read       none
 * @db-write      none
 * @db-txn        @none
 * @doctrine      pricing_market_viability_cost_scope
 * @impact-areas  economic-engine, pricing, dashboard, reconciliation
 * @version       2026-09
 */

'use strict';

/**
 * Source canonique des natures économiques portées par
 * order_item_real_cost_allocations.
 *
 * IMPORTANT :
 * - `hub` désigne exclusivement le Hub VARIABLE causé par le flux.
 * - la structure Hub (loyer, personnel, capacité) est du N3 de période,
 *   hors allocations article/commande, sous une famille distincte
 *   (`hub_structure`).
 * - `risk_provision` appartient bien à N2 pour le calcul de contribution,
 *   mais ce n'est pas un décaissement réel d'une commande. Sa vérité se
 *   réconcilie au niveau de période. Elle ne doit donc pas servir de preuve
 *   de maturité transactionnelle d'une commande.
 */

// Vocabulaire snapshot pricing-engine -> vocabulaire allocations réelles.
// La différence port_transitary / port_transitaire est volontaire et ne doit
// plus être recodée en littéraux dispersés.
const SNAPSHOT_LANDED_TO_REAL_COST_TYPE = Object.freeze({
  product_purchase: 'product_purchase',
  sourcing: 'sourcing',
  hub: 'hub',
  packaging: 'packaging',
  freight: 'freight',
  customs: 'customs',
  port_transitary: 'port_transitaire',
  local_distribution: 'local_distribution',
  relay: 'relay',
});

const REAL_TO_SNAPSHOT_LANDED_COST_TYPE = Object.freeze(
  Object.fromEntries(Object.entries(SNAPSHOT_LANDED_TO_REAL_COST_TYPE).map(([snapshotKey, realType]) => [realType, snapshotKey]))
);

const N1_COST_TYPES = Object.freeze(Object.values(SNAPSHOT_LANDED_TO_REAL_COST_TYPE));

// N2 se compose d'un coût transactionnel réellement constatable et d'une
// provision qui reste une grandeur de risque jusqu'à réconciliation de période.
const N2_TRANSACTIONAL_COST_TYPES = Object.freeze(['payment']);
const N2_PROVISION_COST_TYPES = Object.freeze(['risk_provision']);
const N2_COST_TYPES = Object.freeze([
  ...N2_TRANSACTIONAL_COST_TYPES,
  ...N2_PROVISION_COST_TYPES,
]);

// Coûts qui peuvent être réconciliés au niveau commande avec une preuve réelle.
const RECONCILIABLE_VARIABLE_COST_TYPES = Object.freeze([
  ...N1_COST_TYPES,
  ...N2_TRANSACTIONAL_COST_TYPES,
]);

// Coûts utilisés pour la contribution économique avant la réconciliation
// périodique du risque.
const CONTRIBUTION_COST_TYPES = Object.freeze([
  ...N1_COST_TYPES,
  ...N2_COST_TYPES,
]);

// Alias de compatibilité : historiquement VARIABLE_COST_TYPES signifiait N1+N2.
// Les nouveaux lecteurs qui exigent du "réel commande" doivent utiliser
// RECONCILIABLE_VARIABLE_COST_TYPES.
const VARIABLE_COST_TYPES = CONTRIBUTION_COST_TYPES;

// Legacy/order-allocation only. N3 canonique est une vérité de période ;
// `fixed_overhead` peut encore exister dans les allocations historiques mais
// ne doit pas devenir la source de vérité du futur ratio de couverture.
const ORDER_ALLOCATION_STRUCTURE_COST_TYPES = Object.freeze(['fixed_overhead']);

const RECONCILIABLE_VARIABLE_SET = new Set(RECONCILIABLE_VARIABLE_COST_TYPES);
const PROVISION_SET = new Set(N2_PROVISION_COST_TYPES);
const ORDER_ALLOCATION_STRUCTURE_SET = new Set(ORDER_ALLOCATION_STRUCTURE_COST_TYPES);

function classifyOrderAllocationCostType(costType) {
  if (RECONCILIABLE_VARIABLE_SET.has(costType)) return 'variable_actual';
  if (PROVISION_SET.has(costType)) return 'provision';
  if (ORDER_ALLOCATION_STRUCTURE_SET.has(costType)) return 'structure_legacy';
  return 'unknown';
}

module.exports = {
  SNAPSHOT_LANDED_TO_REAL_COST_TYPE,
  REAL_TO_SNAPSHOT_LANDED_COST_TYPE,
  N1_COST_TYPES,
  N2_TRANSACTIONAL_COST_TYPES,
  N2_PROVISION_COST_TYPES,
  N2_COST_TYPES,
  RECONCILIABLE_VARIABLE_COST_TYPES,
  CONTRIBUTION_COST_TYPES,
  VARIABLE_COST_TYPES,
  ORDER_ALLOCATION_STRUCTURE_COST_TYPES,
  classifyOrderAllocationCostType,
};
