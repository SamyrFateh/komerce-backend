/**
 * @komerce-arch
 * @role          economic-engine-cost-allocation
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       ./_helpers, ./allocate, ./variance, ../transport-cost-allocation
 * @used-by       routes/admin-costing.js, services/customs-shipment-service.js
 * @db-read       customs_shipment_parcels, customs_shipments, finance_config, order_item_cost_imputations, order_item_real_cost_allocations, order_items, orders, parcel_items, parcels, products
 * @db-write      order_item_real_cost_allocations
 * @db-txn        resolve_before_behavior_change
 * @doctrine      docs/doctrine/DOCTRINE_TRANSPORT_COST_ALLOCATION.md
 * @impact-areas  economic-engine, logistics, orders, customs, dashboard
 * @version       2026-07
 */

/**
 * KOMERCE — Cost Allocation Service (P4 — Reventilation reelle terrain)
 * ════════════════════════════════════════════════════════════════════════
 *
 * DOCTRINE :
 *   - pricing-engine                      = estimation
 *   - order_item_cost_imputations         = verite estimee figee (P3)
 *   - order_item_real_cost_allocations    = verite reelle reventilee (P4 — ce module)
 *   - admin-costing endpoints             = lecture de verite
 *
 *   Ce service NE refait PAS d'estimation. Il consomme les couts reels saisis
 *   par admin (factures transitaire, douane, parcel livre) et les ventile
 *   par cost_type vers les order_items.
 *
 * COST_TYPES alignes sur cost_components (migration 043) :
 *   product_purchase, sourcing, hub, packaging,
 *   freight, customs, port_transitaire, local_distribution, relay,
 *   payment, risk_provision, fixed_overhead,
 *   incident, marketing
 *
 * REGLE ABSOLUE :
 *   Si un coût reel manque, on NE le met JAMAIS a 0.
 *   Au lieu de ca, getOrderCostTruth retourne :
 *     - cost_status = 'partial_real' ou 'incomplete'
 *     - missing_cost_fields = ['fixed_overhead', 'payment', ...]
 *
 *   Le dashboard utilise ces flags pour ne JAMAIS afficher une marge
 *   reelle si elle est partielle, sans le signaler explicitement.
 *
 * Le freight shipment est désormais délégué au contrat transverse
 * transport-cost-allocation. Les trois autres allocations réelles restent
 * dans allocate.js.
 */

'use strict';

const helpers = require('./_helpers');
const allocate = require('./allocate');
const variance = require('./variance');
const transportCostAllocation = require('../transport-cost-allocation');

module.exports = {
  // Constantes doctrine
  COST_TYPES: helpers.COST_TYPES,
  ALLOCATION_METHODS: helpers.ALLOCATION_METHODS,
  VARIABLE_COST_TYPES: helpers.VARIABLE_COST_TYPES,
  FIXED_COST_TYPES: helpers.FIXED_COST_TYPES,
  EXCEPTIONAL_COST_TYPES: helpers.EXCEPTIONAL_COST_TYPES,

  // Helpers purs
  shareByWeight: helpers.shareByWeight,
  taxableWeight: helpers.taxableWeight,

  // Snapshot estime (delegue)
  lockEstimatedCostsForOrder: helpers.lockEstimatedCostsForOrder,

  // Allocations reelles
  allocateShipmentRealCosts: transportCostAllocation.allocateShipmentRealCosts,
  allocateParcelRealCosts: allocate.allocateParcelRealCosts,
  allocateProductPurchaseCosts: allocate.allocateProductPurchaseCosts,
  allocateMonthlyFixedCosts: allocate.allocateMonthlyFixedCosts,

  // Lecture
  computeOrderCostVariance: variance.computeOrderCostVariance,
  computeProductCostVariance: variance.computeProductCostVariance,
  getOrderCostTruth: variance.getOrderCostTruth,
};
