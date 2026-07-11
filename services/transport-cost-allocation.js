/**
 * @komerce-arch
 * @role          transport-cost-allocation-contract
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        transport_rail, cost_component, allocation_key, entries
 * @outputs       allocation_contract, allocated_shares
 * @depends       ./cost-allocation/_helpers
 * @used-by       future shipment real cost allocation
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_TRANSPORT_COST_ALLOCATION.md
 * @impact-areas  economic-engine, logistics, orders
 * @version       2026-07
 */
'use strict';

const { shareByWeight } = require('./cost-allocation/_helpers');

const COST_COMPONENTS = Object.freeze({
  FREIGHT: 'FREIGHT',
  AWB: 'AWB',
  HANDLING: 'HANDLING',
  SECURITY: 'SECURITY',
  FUEL_SURCHARGE: 'FUEL_SURCHARGE',
  CUSTOMS: 'CUSTOMS',
  OTHER: 'OTHER',
});

const ALLOCATION_KEYS = Object.freeze({
  CHARGEABLE_WEIGHT: 'CHARGEABLE_WEIGHT',
  ACTUAL_WEIGHT: 'ACTUAL_WEIGHT',
  VOLUMETRIC_WEIGHT: 'VOLUMETRIC_WEIGHT',
  VOLUME: 'VOLUME',
  PARCEL_COUNT: 'PARCEL_COUNT',
  ORDER_COUNT: 'ORDER_COUNT',
  DIRECT_ASSIGNMENT: 'DIRECT_ASSIGNMENT',
  EQUAL_SPLIT: 'EQUAL_SPLIT',
});

const CALIBRATION_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  PENDING: 'PENDING',
});

const TRANSPORT_COST_ALLOCATION_PROFILES = Object.freeze({
  SEA_STANDARD: Object.freeze({
    FREIGHT: Object.freeze({
      allocation_key: ALLOCATION_KEYS.VOLUME,
      fallback_key: ALLOCATION_KEYS.EQUAL_SPLIT,
      calibration_status: CALIBRATION_STATUS.ACTIVE,
    }),
  }),
  AIR_EXPRESS: Object.freeze({
    FREIGHT: Object.freeze({
      allocation_key: ALLOCATION_KEYS.CHARGEABLE_WEIGHT,
      fallback_key: null,
      calibration_status: CALIBRATION_STATUS.PENDING,
      volumetric_factor_kg_per_m3: null,
    }),
  }),
});

class TransportCostAllocationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TransportCostAllocationError';
    this.code = code;
  }
}

function getTransportCostAllocationRule(transportRail, component) {
  const rail = String(transportRail || '').trim().toUpperCase();
  const costComponent = String(component || '').trim().toUpperCase();
  const profile = TRANSPORT_COST_ALLOCATION_PROFILES[rail];
  if (!profile) {
    throw new TransportCostAllocationError(`Rail sans profil d'allocation: ${rail || 'UNASSIGNED'}`, 'TRANSPORT_COST_ALLOCATION_RAIL_UNKNOWN');
  }
  const rule = profile[costComponent];
  if (!rule) {
    throw new TransportCostAllocationError(`Composante ${costComponent || 'UNASSIGNED'} sans règle pour ${rail}`, 'TRANSPORT_COST_ALLOCATION_COMPONENT_UNKNOWN');
  }
  return rule;
}

function getAllocationWeight(entry, allocationKey, options = {}) {
  const actualWeightKg = Number(entry.actual_weight_kg) || 0;
  const volumeM3 = Number(entry.volume_m3) || 0;

  switch (allocationKey) {
    case ALLOCATION_KEYS.ACTUAL_WEIGHT:
      return actualWeightKg;
    case ALLOCATION_KEYS.VOLUME:
      return volumeM3;
    case ALLOCATION_KEYS.PARCEL_COUNT:
      return Number(entry.parcel_count) || 0;
    case ALLOCATION_KEYS.ORDER_COUNT:
      return Number(entry.order_count) || 0;
    case ALLOCATION_KEYS.EQUAL_SPLIT:
      return 1;
    case ALLOCATION_KEYS.VOLUMETRIC_WEIGHT: {
      const factor = Number(options.volumetric_factor_kg_per_m3);
      if (!(factor > 0)) throw new TransportCostAllocationError('Facteur volumétrique non calibré', 'TRANSPORT_COST_ALLOCATION_CALIBRATION_PENDING');
      return volumeM3 * factor;
    }
    case ALLOCATION_KEYS.CHARGEABLE_WEIGHT: {
      const factor = Number(options.volumetric_factor_kg_per_m3);
      if (!(factor > 0)) throw new TransportCostAllocationError('Facteur volumétrique non calibré', 'TRANSPORT_COST_ALLOCATION_CALIBRATION_PENDING');
      return Math.max(actualWeightKg, volumeM3 * factor);
    }
    default:
      throw new TransportCostAllocationError(`Clé d'allocation non supportée: ${allocationKey}`, 'TRANSPORT_COST_ALLOCATION_KEY_UNKNOWN');
  }
}

function allocateTransportCost({ total, transport_rail, component, entries = [], allocation_key = null, options = {} } = {}) {
  const rule = getTransportCostAllocationRule(transport_rail, component);
  const key = allocation_key || rule.allocation_key;

  if (!allocation_key && rule.calibration_status === CALIBRATION_STATUS.PENDING) {
    throw new TransportCostAllocationError(
      `Allocation ${transport_rail}/${component} en attente de calibration`,
      'TRANSPORT_COST_ALLOCATION_CALIBRATION_PENDING'
    );
  }

  if (key === ALLOCATION_KEYS.DIRECT_ASSIGNMENT) {
    if (entries.length !== 1) {
      throw new TransportCostAllocationError('DIRECT_ASSIGNMENT exige une cible unique', 'TRANSPORT_COST_ALLOCATION_DIRECT_TARGET_REQUIRED');
    }
    return [{ id: entries[0].id, share: Math.round(Number(total) || 0), share_pct: 100 }];
  }

  const weighted = entries.map(entry => ({
    id: entry.id,
    weight: getAllocationWeight(entry, key, { ...rule, ...options }),
  }));

  const hasSignal = weighted.some(entry => entry.weight > 0);
  if (!hasSignal && rule.fallback_key && !allocation_key) {
    return allocateTransportCost({
      total,
      transport_rail,
      component,
      entries,
      allocation_key: rule.fallback_key,
      options,
    });
  }
  if (!hasSignal && entries.length) {
    throw new TransportCostAllocationError('Aucun signal économique exploitable pour la clé choisie', 'TRANSPORT_COST_ALLOCATION_NO_SIGNAL');
  }

  return shareByWeight(Number(total) || 0, weighted);
}

module.exports = {
  COST_COMPONENTS,
  ALLOCATION_KEYS,
  CALIBRATION_STATUS,
  TRANSPORT_COST_ALLOCATION_PROFILES,
  TransportCostAllocationError,
  getTransportCostAllocationRule,
  getAllocationWeight,
  allocateTransportCost,
};
