/**
 * @komerce-arch
 * @role          transport-cost-allocation-contract
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        transport_rail, cost_component, allocation_key, entries, shipment_id
 * @outputs       allocation_contract, allocated_shares, persisted_real_cost_allocations
 * @depends       ./cost-allocation/_helpers, db (lazy for shipment persistence)
 * @used-by       services/cost-allocation/index.js, future shipment cost ingestion
 * @db-read       customs_shipment_parcels, customs_shipments, order_items, parcel_items, parcels, products
 * @db-write      order_item_real_cost_allocations
 * @db-txn        allocateShipmentRealCosts
 * @doctrine      docs/doctrine/DOCTRINE_TRANSPORT_COST_ALLOCATION.md
 * @impact-areas  economic-engine, logistics, orders, customs, dashboard
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
    throw new TransportCostAllocationError(
      `Rail sans profil d'allocation: ${rail || 'UNASSIGNED'}`,
      'TRANSPORT_COST_ALLOCATION_RAIL_UNKNOWN'
    );
  }
  const rule = profile[costComponent];
  if (!rule) {
    throw new TransportCostAllocationError(
      `Composante ${costComponent || 'UNASSIGNED'} sans règle pour ${rail}`,
      'TRANSPORT_COST_ALLOCATION_COMPONENT_UNKNOWN'
    );
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
      if (!(factor > 0)) {
        throw new TransportCostAllocationError(
          'Facteur volumétrique non calibré',
          'TRANSPORT_COST_ALLOCATION_CALIBRATION_PENDING'
        );
      }
      return volumeM3 * factor;
    }
    case ALLOCATION_KEYS.CHARGEABLE_WEIGHT: {
      const factor = Number(options.volumetric_factor_kg_per_m3);
      if (!(factor > 0)) {
        throw new TransportCostAllocationError(
          'Facteur volumétrique non calibré',
          'TRANSPORT_COST_ALLOCATION_CALIBRATION_PENDING'
        );
      }
      return Math.max(actualWeightKg, volumeM3 * factor);
    }
    default:
      throw new TransportCostAllocationError(
        `Clé d'allocation non supportée: ${allocationKey}`,
        'TRANSPORT_COST_ALLOCATION_KEY_UNKNOWN'
      );
  }
}

function allocateTransportCost({
  total,
  transport_rail,
  component,
  entries = [],
  allocation_key = null,
  options = {},
} = {}) {
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
      throw new TransportCostAllocationError(
        'DIRECT_ASSIGNMENT exige une cible unique',
        'TRANSPORT_COST_ALLOCATION_DIRECT_TARGET_REQUIRED'
      );
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
    throw new TransportCostAllocationError(
      'Aucun signal économique exploitable pour la clé choisie',
      'TRANSPORT_COST_ALLOCATION_NO_SIGNAL'
    );
  }

  return shareByWeight(Number(total) || 0, weighted);
}

function resolveShipmentTransportRail(transportMode) {
  const mode = String(transportMode || '').trim().toLowerCase();
  if (mode === 'sea') return 'SEA_STANDARD';
  if (mode === 'air') return 'AIR_EXPRESS';
  return null;
}

function allocateFreightShares({ total, transportRail, entries, options = {} }) {
  if (!transportRail) {
    return {
      shares: shareByWeight(Number(total) || 0, entries.map(entry => ({
        id: entry.id,
        weight: Number(entry.actual_weight_kg) || 0,
      }))),
      allocationMethod: 'by_weight',
      confidence: 'high',
    };
  }

  const airFactor = Number(options.volumetric_factor_kg_per_m3);
  const explicitAirKey = transportRail === 'AIR_EXPRESS' && airFactor > 0
    ? ALLOCATION_KEYS.CHARGEABLE_WEIGHT
    : null;

  const shares = allocateTransportCost({
    total,
    transport_rail: transportRail,
    component: COST_COMPONENTS.FREIGHT,
    entries,
    allocation_key: explicitAirKey,
    options,
  });

  if (transportRail === 'AIR_EXPRESS') {
    return { shares, allocationMethod: 'by_taxable_weight', confidence: 'high' };
  }

  const hasVolumeSignal = entries.some(entry => Number(entry.volume_m3) > 0);
  return {
    shares,
    allocationMethod: hasVolumeSignal ? 'by_volume' : 'estimated_fallback',
    confidence: hasVolumeSignal ? 'high' : 'low',
  };
}

/**
 * Allocation réelle d'un shipment vers parcels puis order_items.
 *
 * Les rails explicites consomment le contrat transport-cost-allocation.
 * Un transport_mode absent/inconnu conserve temporairement le comportement
 * legacy by_weight, sans être converti silencieusement en SEA_STANDARD.
 */
async function allocateShipmentRealCosts(shipmentId, dbClient = null, options = {}) {
  const ownTx = !dbClient;
  const db = ownTx ? require('../db') : null;
  const client = dbClient || await db.pool.connect();

  try {
    if (ownTx) await client.query('BEGIN');

    const shipRes = await client.query(
      'SELECT * FROM customs_shipments WHERE id = $1',
      [shipmentId]
    );
    if (!shipRes.rows.length) {
      if (ownTx) await client.query('ROLLBACK');
      return { shipment_id: shipmentId, allocations_count: 0, error: 'shipment_not_found' };
    }
    const ship = shipRes.rows[0];

    const parcelsRes = await client.query(
      `SELECT
         p.id AS parcel_id,
         p.order_id,
         csp.parcel_cif_kmf,
         csp.parcel_weight_kg,
         csp.parcel_volume_cm3,
         csp.customs_share_kmf,
         csp.allocation_basis
       FROM customs_shipment_parcels csp
       JOIN parcels p ON p.id = csp.parcel_id
       WHERE csp.shipment_id = $1`,
      [shipmentId]
    );

    if (!parcelsRes.rows.length) {
      if (ownTx) await client.query('COMMIT');
      return { shipment_id: shipmentId, allocations_count: 0, reason: 'no_parcels' };
    }
    const parcels = parcelsRes.rows;

    await client.query(
      'DELETE FROM order_item_real_cost_allocations WHERE shipment_id = $1',
      [shipmentId]
    );

    const totalCustoms = Number(ship.customs_paid_kmf) || 0;
    const totalFreight = Number(ship.freight_kmf) || 0;
    const allocMethod = ship.allocation_method || 'by_cif_value';
    const transportRail = resolveShipmentTransportRail(ship.transport_mode);

    const parcelsCustomsShares = parcels.map(parcel => ({
      parcel_id: parcel.parcel_id,
      order_id: parcel.order_id,
      customs_share: Number(parcel.customs_share_kmf) || null,
    }));

    const allCustomsSharesSet = parcelsCustomsShares.every(parcel => parcel.customs_share != null);
    let customsShares;
    if (allCustomsSharesSet) {
      customsShares = parcelsCustomsShares;
    } else {
      const weights = parcels.map(parcel => ({
        id: parcel.parcel_id,
        order_id: parcel.order_id,
        weight: allocMethod === 'by_weight'
          ? Number(parcel.parcel_weight_kg) || 0
          : Number(parcel.parcel_cif_kmf) || 0,
      }));
      const shares = shareByWeight(totalCustoms, weights);
      customsShares = shares.map((share, index) => ({
        parcel_id: share.id,
        order_id: weights[index].order_id,
        customs_share: share.share,
      }));
    }

    const parcelFreightEntries = parcels.map(parcel => ({
      id: parcel.parcel_id,
      actual_weight_kg: Number(parcel.parcel_weight_kg) || 0,
      volume_m3: (Number(parcel.parcel_volume_cm3) || 0) / 1_000_000,
    }));

    const freightAllocation = totalFreight > 0
      ? allocateFreightShares({
          total: totalFreight,
          transportRail,
          entries: parcelFreightEntries,
          options: options.transport_cost_allocation || {},
        })
      : {
          shares: parcelFreightEntries.map(entry => ({ id: entry.id, share: 0, share_pct: 0 })),
          allocationMethod: transportRail === 'AIR_EXPRESS' ? 'by_taxable_weight' : 'by_weight',
          confidence: 'high',
        };

    const freightShares = freightAllocation.shares.map(share => ({
      parcel_id: share.id,
      freight_share: share.share,
    }));

    let totalAllocations = 0;

    for (const parcel of parcels) {
      const customsShare = customsShares.find(item => item.parcel_id === parcel.parcel_id)?.customs_share || 0;
      const freightShare = freightShares.find(item => item.parcel_id === parcel.parcel_id)?.freight_share || 0;

      const parcelItemsRes = await client.query(
        `SELECT
           pi.order_item_id,
           pi.quantity AS parcel_qty,
           oi.price_kmf,
           oi.quantity AS order_item_qty,
           oi.product_id,
           p.weight_kg,
           p.volume_cm3,
           p.cost_kmf
         FROM parcel_items pi
         JOIN order_items oi ON oi.id = pi.order_item_id
         LEFT JOIN products p ON p.id = oi.product_id
         WHERE pi.parcel_id = $1`,
        [parcel.parcel_id]
      );

      if (!parcelItemsRes.rows.length) continue;
      const items = parcelItemsRes.rows;

      const customsWeights = items.map(item => ({
        id: item.order_item_id,
        weight: (Number(item.cost_kmf) || 0) * (Number(item.parcel_qty) || 1),
      }));
      const customsSplit = shareByWeight(customsShare, customsWeights);

      let freightSplit;
      if (freightShare > 0) {
        const itemFreightEntries = items.map(item => ({
          id: item.order_item_id,
          actual_weight_kg: (Number(item.weight_kg) || 0) * (Number(item.parcel_qty) || 1),
          volume_m3: ((Number(item.volume_cm3) || 0) * (Number(item.parcel_qty) || 1)) / 1_000_000,
        }));
        freightSplit = allocateFreightShares({
          total: freightShare,
          transportRail,
          entries: itemFreightEntries,
          options: options.transport_cost_allocation || {},
        }).shares;
      } else {
        freightSplit = items.map(item => ({ id: item.order_item_id, share: 0, share_pct: 0 }));
      }

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const customsItemShare = customsSplit[index].share;
        const freightItemShare = freightSplit[index].share;

        if (customsItemShare > 0) {
          await client.query(
            `INSERT INTO order_item_real_cost_allocations
               (order_id, order_item_id, parcel_id, shipment_id,
                cost_type, amount_kmf, allocation_method,
                source, is_actual, confidence)
             VALUES ($1,$2,$3,$4,'customs',$5,'by_value','customs_shipments',TRUE,'high')`,
            [parcel.order_id, item.order_item_id, parcel.parcel_id, shipmentId, customsItemShare]
          );
          totalAllocations += 1;
        }

        if (freightItemShare > 0) {
          await client.query(
            `INSERT INTO order_item_real_cost_allocations
               (order_id, order_item_id, parcel_id, shipment_id,
                cost_type, amount_kmf, allocation_method,
                source, is_actual, confidence)
             VALUES ($1,$2,$3,$4,'freight',$5,$6,'customs_shipments',TRUE,$7)`,
            [
              parcel.order_id,
              item.order_item_id,
              parcel.parcel_id,
              shipmentId,
              freightItemShare,
              freightAllocation.allocationMethod,
              freightAllocation.confidence,
            ]
          );
          totalAllocations += 1;
        }
      }
    }

    if (ownTx) await client.query('COMMIT');

    return {
      shipment_id: shipmentId,
      allocations_count: totalAllocations,
      total_customs_kmf: totalCustoms,
      total_freight_kmf: totalFreight,
      transport_rail: transportRail,
      freight_allocation_method: freightAllocation.allocationMethod,
      parcels_processed: parcels.length,
    };
  } catch (error) {
    if (ownTx) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (ownTx) client.release();
  }
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
  resolveShipmentTransportRail,
  allocateFreightShares,
  allocateShipmentRealCosts,
};
