/**
 * @komerce-arch
 * @role          economic-engine-cost-type-classification
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        cost_type
 * @outputs       canonical_cost_type_classification
 * @depends       @none
 * @used-by       services/cost-allocation/variance.js, services/dashboard-metrics/_helpers.js
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
 * IMPORTANT : `hub` désigne ici exclusivement le Hub VARIABLE réellement
 * causé par le flux (QC, étiquetage, packaging/manutention unitaire selon
 * allocation). La structure physique du Hub (loyer, personnel, capacité) est
 * du N3 de période et ne doit jamais être écrite sous `cost_type = 'hub'` dans
 * cette table. Le futur modèle de structure de période utilisera une famille
 * distincte (`hub_structure`) hors des allocations article/commande.
 *
 * N2 canonique = payment + risk_provision.
 */

const N1_COST_TYPES = Object.freeze([
  'product_purchase',
  'sourcing',
  'hub',
  'packaging',
  'freight',
  'customs',
  'port_transitaire',
  'local_distribution',
  'relay',
]);

const N2_COST_TYPES = Object.freeze([
  'payment',
  'risk_provision',
]);

const VARIABLE_COST_TYPES = Object.freeze([
  ...N1_COST_TYPES,
  ...N2_COST_TYPES,
]);

// Legacy/order-allocation only. N3 canonique est une vérité de période ;
// `fixed_overhead` peut encore exister dans les allocations historiques mais
// ne doit pas devenir la source de vérité du futur ratio de couverture.
const ORDER_ALLOCATION_STRUCTURE_COST_TYPES = Object.freeze([
  'fixed_overhead',
]);

const VARIABLE_COST_TYPE_SET = new Set(VARIABLE_COST_TYPES);
const ORDER_ALLOCATION_STRUCTURE_COST_TYPE_SET = new Set(ORDER_ALLOCATION_STRUCTURE_COST_TYPES);

function classifyOrderAllocationCostType(costType) {
  if (VARIABLE_COST_TYPE_SET.has(costType)) return 'variable';
  if (ORDER_ALLOCATION_STRUCTURE_COST_TYPE_SET.has(costType)) return 'structure_legacy';
  return 'unknown';
}

module.exports = {
  N1_COST_TYPES,
  N2_COST_TYPES,
  VARIABLE_COST_TYPES,
  ORDER_ALLOCATION_STRUCTURE_COST_TYPES,
  classifyOrderAllocationCostType,
};
