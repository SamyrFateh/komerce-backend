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
 * @db-read       customs_shipment_fees, customs_shipment_parcels, customs_shipments, order_items, parcel_items, parcels, products
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

// ── Conservation des coûts réels d'expédition ─────────────────────────────
// Une charge réelle déclarée ne disparaît jamais, n'est jamais comptée deux
// fois et ne devient jamais artificiellement nulle :
//   - NULL (customs_paid_kmf / freight_kmf) = inconnu → rien n'est ventilé
//     pour ce type ; 0 explicite = aucun frais confirmé ;
//   - ventilation au CENTIME par plus grand reste : la somme des lignes
//     écrites égale exactement le montant déclaré ;
//   - une part sans porteur fait échouer l'opération
//     (COST_ALLOCATION_INCOMPLETE) au lieu d'être perdue en silence.

function toCents(value) {
  return Math.round(Number(value) * 100);
}

function fromCentShares(shares) {
  return shares.map(share => ({ ...share, share: share.share / 100 }));
}

function sumCents(shares) {
  return shares.reduce((sum, share) => sum + toCents(share.share), 0);
}

function splitConserving(totalKmf, entries) {
  return fromCentShares(shareByWeight(toCents(totalKmf), entries));
}

function weightsOrFallback(entries, fallbackWeight) {
  const sum = entries.reduce((total, entry) => total + (Number(entry.weight) || 0), 0);
  if (sum > 0) return { entries, fallback: false };
  return { entries: entries.map(entry => ({ ...entry, weight: fallbackWeight(entry) })), fallback: true };
}

function allocationIncomplete(costType, details) {
  const error = new Error(`Ventilation ${costType} incomplète : ${details}`);
  error.status = 422;
  error.code = 'COST_ALLOCATION_INCOMPLETE';
  return error;
}

/**
 * Fret au centime sur le contrat transport existant. Rail inconnu sans aucun
 * poids : répartition égale signalée (estimated_fallback/low) plutôt qu'un
 * fret entier perdu. AIR non calibré reste fail-closed (doctrine).
 */
function allocateFreightConserving({ total, transportRail, entries, options }) {
  const allocation = allocateFreightShares({
    total: toCents(total),
    transportRail,
    entries,
    options,
  });
  const shares = fromCentShares(allocation.shares);
  if (sumCents(shares) === toCents(total) || !entries.length) {
    return { ...allocation, shares };
  }
  return {
    shares: splitConserving(total, entries.map(entry => ({ id: entry.id, weight: 1 }))),
    allocationMethod: 'estimated_fallback',
    confidence: 'low',
  };
}

/**
 * Allocation réelle d'un shipment vers parcels puis order_items.
 *
 * Les rails explicites consomment le contrat transport-cost-allocation.
 * Un transport_mode absent/inconnu conserve temporairement le comportement
 * legacy by_weight, sans être converti silencieusement en SEA_STANDARD.
 *
 * Expédition désactivée : ses allocations sont retirées (aucune allocation
 * active ne subsiste) ; le fait source — montant, méthode, deactivated_at,
 * deactivated_reason — reste porté par customs_shipments.
 */
async function allocateShipmentRealCosts(shipmentId, dbClient = null, options = {}) {
  const ownTx = !dbClient;
  const db = ownTx ? require('../db') : null;
  const client = dbClient || await db.pool.connect();

  try {
    if (ownTx) await client.query('BEGIN');

    const shipRes = await client.query(
      `SELECT cs.*,
              COALESCE((SELECT SUM(CASE WHEN f.kind = 'credit' THEN -f.amount_kmf ELSE f.amount_kmf END)
                          FROM customs_shipment_fees f WHERE f.shipment_id = cs.id), 0) AS fees_net_kmf
         FROM customs_shipments cs WHERE cs.id = $1`,
      [shipmentId]
    );
    if (!shipRes.rows.length) {
      if (ownTx) await client.query('ROLLBACK');
      return { shipment_id: shipmentId, allocations_count: 0, error: 'shipment_not_found' };
    }
    const ship = shipRes.rows[0];

    if (ship.is_active === false) {
      const removed = await client.query(
        'DELETE FROM order_item_real_cost_allocations WHERE shipment_id = $1',
        [shipmentId]
      );
      if (ownTx) await client.query('COMMIT');
      return {
        shipment_id: shipmentId,
        allocations_count: 0,
        allocations_removed: removed.rowCount || 0,
        reason: 'inactive',
      };
    }

    const customsKnown = ship.customs_paid_kmf != null;
    const freightKnown = ship.freight_kmf != null;
    const totalCustoms = customsKnown ? Number(ship.customs_paid_kmf) : 0;
    const totalFreight = freightKnown ? Number(ship.freight_kmf) : 0;
    // Frais typés (manutention, transitaire…) : net charges − credits, jamais négatif.
    const totalFees = Number(ship.fees_net_kmf) || 0;
    if (toCents(totalFees) < 0) {
      throw allocationIncomplete('port_transitaire', `frais nets négatifs (${totalFees})`);
    }

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
      // Un montant réel non nul sans colis porteur serait imputé nulle part.
      if (toCents(totalCustoms) > 0) throw allocationIncomplete('customs', 'aucun colis rattaché à l\'expédition');
      if (toCents(totalFreight) > 0) throw allocationIncomplete('freight', 'aucun colis rattaché à l\'expédition');
      if (toCents(totalFees) > 0) throw allocationIncomplete('port_transitaire', 'aucun colis rattaché à l\'expédition');
      if (ownTx) await client.query('COMMIT');
      return { shipment_id: shipmentId, allocations_count: 0, reason: 'no_parcels' };
    }
    const parcels = parcelsRes.rows;

    await client.query(
      'DELETE FROM order_item_real_cost_allocations WHERE shipment_id = $1',
      [shipmentId]
    );

    const allocMethod = ship.allocation_method || 'by_cif_value';
    const transportRail = resolveShipmentTransportRail(ship.transport_mode);

    // customs_share_kmf saisi (0 compris) fait foi pour tous les colis ;
    // il doit alors couvrir exactement le montant déclaré.
    const allCustomsSharesSet = parcels.every(parcel => parcel.customs_share_kmf != null);
    let customsShares;
    if (!customsKnown) {
      customsShares = parcels.map(parcel => ({
        parcel_id: parcel.parcel_id, order_id: parcel.order_id, customs_share: 0,
      }));
    } else if (allCustomsSharesSet) {
      customsShares = parcels.map(parcel => ({
        parcel_id: parcel.parcel_id,
        order_id: parcel.order_id,
        customs_share: Number(parcel.customs_share_kmf),
      }));
      const declaredSharesCents = customsShares.reduce((sum, share) => sum + toCents(share.customs_share), 0);
      if (declaredSharesCents !== toCents(totalCustoms)) {
        throw allocationIncomplete('customs',
          `parts colis (${declaredSharesCents / 100}) ≠ montant déclaré (${totalCustoms})`);
      }
    } else {
      const { entries: weights } = weightsOrFallback(parcels.map(parcel => ({
        id: parcel.parcel_id,
        order_id: parcel.order_id,
        weight: allocMethod === 'by_weight'
          ? Number(parcel.parcel_weight_kg) || 0
          : Number(parcel.parcel_cif_kmf) || 0,
      })), () => 1);
      const shares = splitConserving(totalCustoms, weights);
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

    const freightAllocation = toCents(totalFreight) > 0
      ? allocateFreightConserving({
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

    // Frais typés : même clé de répartition que la douane (valeur CIF / poids), conservée au centime.
    const { entries: feeWeights } = weightsOrFallback(parcels.map(parcel => ({
      id: parcel.parcel_id,
      weight: allocMethod === 'by_weight'
        ? Number(parcel.parcel_weight_kg) || 0
        : Number(parcel.parcel_cif_kmf) || 0,
    })), () => 1);
    const feeShares = toCents(totalFees) > 0
      ? splitConserving(totalFees, feeWeights)
      : feeWeights.map(entry => ({ id: entry.id, share: 0 }));

    let totalAllocations = 0;
    let insertedCustomsCents = 0;
    let insertedFreightCents = 0;
    let insertedFeesCents = 0;

    for (const parcel of parcels) {
      const customsShare = customsShares.find(item => item.parcel_id === parcel.parcel_id)?.customs_share || 0;
      const freightShare = freightShares.find(item => item.parcel_id === parcel.parcel_id)?.freight_share || 0;
      const feeShare = feeShares.find(item => item.id === parcel.parcel_id)?.share || 0;
      const parcelHasCost = toCents(customsShare) > 0 || toCents(freightShare) > 0 || toCents(feeShare) > 0;

      let parcelItemsRes = await client.query(
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

      // Colis sans parcel_items : parcels.order_id est NOT NULL, donc sa part
      // reste sur SA commande, ventilée sur ses lignes et signalée
      // estimated_fallback / low — jamais perdue.
      let itemsFallback = false;
      if (!parcelItemsRes.rows.length && parcelHasCost) {
        parcelItemsRes = await client.query(
          `SELECT
             oi.id AS order_item_id,
             oi.quantity AS parcel_qty,
             oi.price_kmf,
             oi.quantity AS order_item_qty,
             oi.product_id,
             p.weight_kg,
             p.volume_cm3,
             p.cost_kmf
           FROM order_items oi
           LEFT JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = $1`,
          [parcel.order_id]
        );
        itemsFallback = true;
      }
      if (!parcelItemsRes.rows.length) {
        if (parcelHasCost) {
          throw allocationIncomplete('customs/freight',
            `aucune ligne de commande porteuse pour le colis ${parcel.parcel_id}`);
        }
        continue;
      }
      const items = parcelItemsRes.rows;
      const quantityOf = entry => {
        const row = items.find(item => item.order_item_id === entry.id);
        return Number(row && row.parcel_qty) || 1;
      };

      // Coûts produit inconnus partout → répartition par quantité, signalée.
      const { entries: customsWeights, fallback: customsValueFallback } = weightsOrFallback(items.map(item => ({
        id: item.order_item_id,
        weight: (Number(item.cost_kmf) || 0) * (Number(item.parcel_qty) || 1),
      })), quantityOf);
      const customsSplit = splitConserving(customsShare, customsWeights);
      const feeSplit = splitConserving(feeShare, customsWeights);
      const customsFallback = itemsFallback || customsValueFallback;

      let freightSplit;
      let freightRowMethod = freightAllocation.allocationMethod;
      let freightRowConfidence = freightAllocation.confidence;
      if (toCents(freightShare) > 0) {
        const itemFreightEntries = items.map(item => ({
          id: item.order_item_id,
          actual_weight_kg: (Number(item.weight_kg) || 0) * (Number(item.parcel_qty) || 1),
          volume_m3: ((Number(item.volume_cm3) || 0) * (Number(item.parcel_qty) || 1)) / 1_000_000,
        }));
        const itemFreight = allocateFreightConserving({
          total: freightShare,
          transportRail,
          entries: itemFreightEntries,
          options: options.transport_cost_allocation || {},
        });
        freightSplit = itemFreight.shares;
        if (itemsFallback || itemFreight.allocationMethod === 'estimated_fallback') {
          freightRowMethod = 'estimated_fallback';
          freightRowConfidence = 'low';
        }
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
             VALUES ($1,$2,$3,$4,'customs',$5,$6,'customs_shipments',TRUE,$7)`,
            [
              parcel.order_id,
              item.order_item_id,
              parcel.parcel_id,
              shipmentId,
              customsItemShare,
              customsFallback ? 'estimated_fallback' : 'by_value',
              customsFallback ? 'low' : 'high',
            ]
          );
          insertedCustomsCents += toCents(customsItemShare);
          totalAllocations += 1;
        }

        const feeItemShare = feeSplit[index].share;
        if (feeItemShare > 0) {
          await client.query(
            `INSERT INTO order_item_real_cost_allocations
               (order_id, order_item_id, parcel_id, shipment_id,
                cost_type, amount_kmf, allocation_method,
                source, is_actual, confidence)
             VALUES ($1,$2,$3,$4,'port_transitaire',$5,$6,'customs_shipment_fees',TRUE,$7)`,
            [
              parcel.order_id,
              item.order_item_id,
              parcel.parcel_id,
              shipmentId,
              feeItemShare,
              customsFallback ? 'estimated_fallback' : 'by_value',
              customsFallback ? 'low' : 'high',
            ]
          );
          insertedFeesCents += toCents(feeItemShare);
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
              freightRowMethod,
              freightRowConfidence,
            ]
          );
          insertedFreightCents += toCents(freightItemShare);
          totalAllocations += 1;
        }
      }
    }

    // Conservation : ce qui est écrit égale exactement ce qui est déclaré.
    if (customsKnown && insertedCustomsCents !== toCents(totalCustoms)) {
      throw allocationIncomplete('customs',
        `lignes écrites (${insertedCustomsCents / 100}) ≠ montant déclaré (${totalCustoms})`);
    }
    if (insertedFeesCents !== toCents(totalFees)) {
      throw allocationIncomplete('port_transitaire',
        `lignes écrites (${insertedFeesCents / 100}) ≠ frais enregistrés (${totalFees})`);
    }
    if (freightKnown && insertedFreightCents !== toCents(totalFreight)) {
      throw allocationIncomplete('freight',
        `lignes écrites (${insertedFreightCents / 100}) ≠ montant déclaré (${totalFreight})`);
    }

    if (ownTx) await client.query('COMMIT');

    return {
      shipment_id: shipmentId,
      allocations_count: totalAllocations,
      total_customs_kmf: totalCustoms,
      total_freight_kmf: totalFreight,
      total_fees_kmf: totalFees,
      customs_known: customsKnown,
      freight_known: freightKnown,
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
