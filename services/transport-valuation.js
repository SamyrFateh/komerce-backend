'use strict';

/**
 * @komerce-arch
 * @role          transport-economic-valuation
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        transport_rail, weight_kg, volume_cm3, quantity, transport_policies
 * @outputs       chargeable_measure, transport_cost_kmf, transport_price_kmf
 * @depends       none
 * @used-by       services/transport-pricing.js, services/pricing-cdr.js, routes/orders/create.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/adr/ADR-013-fret-transport-rails-wm.md
 * @impact-areas  economic-engine, logistics, orders
 * @version       2026-08
 */

/**
 * LOT 1B — boundary économique pure du transport.
 *
 * Une seule règle de quantité facturable par rail :
 *   SEA : max(volume_m3, poids_kg / SEA_WM_KG_PER_M3)
 *   AIR : max(poids_kg, volume_cm3 / AIR_VOLUMETRIC_DIVISOR)
 *
 * Le coût et le prix commercial partagent la même quantité W/M mais utilisent
 * des taux distincts. Aucune valeur économique n'est inventée ici : toute
 * POLICY / tout taux manquant provoque un échec explicite.
 */

class TransportValuationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TransportValuationError';
    this.code = code;
  }
}

const COMMERCIAL_RATE_KEY_BY_RAIL = Object.freeze({
  SEA_STANDARD: 'SEA_KMF_PER_KG_COMMERCIAL',
  AIR_EXPRESS: 'AIR_KMF_PER_KG_TAXABLE',
});

const COST_RATE_KEY_BY_RAIL = Object.freeze({
  SEA_STANDARD: 'SEA_EUR_PER_M3_COST',
  AIR_EXPRESS: 'AIR_KMF_PER_KG_COST',
});

function finiteNonNegative(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function positivePolicy(policies, key) {
  const n = Number(policies?.[key]);
  if (!(Number.isFinite(n) && n > 0)) {
    throw new TransportValuationError(
      `Policy transport manquante ou invalide: ${key}`,
      'TRANSPORT_VALUATION_POLICY_MISSING'
    );
  }
  return n;
}

function normalizedQuantity(raw) {
  return Math.max(1, parseInt(raw, 10) || 1);
}

function computeTransportMeasure({
  railCode,
  weightKg = 0,
  volumeCm3 = 0,
  policies = {},
} = {}) {
  const rail = String(railCode || '').trim().toUpperCase();
  const weight = finiteNonNegative(weightKg);
  const volume = finiteNonNegative(volumeCm3);

  if (rail === 'SEA_STANDARD') {
    const kgPerM3 = positivePolicy(policies, 'SEA_WM_KG_PER_M3');
    const volumeM3 = volume / 1_000_000;
    const weightEquivalentM3 = weight / kgPerM3;
    const chargeableM3 = Math.max(volumeM3, weightEquivalentM3);

    return {
      transport_rail: rail,
      chargeable_quantity: chargeableM3,
      chargeable_unit: 'm3',
      chargeable_equivalent_kg: chargeableM3 * kgPerM3,
      actual_weight_kg: weight,
      volume_cm3: volume,
      wm_policy_key: 'SEA_WM_KG_PER_M3',
      wm_policy_value: kgPerM3,
      dominant_measure: volumeM3 >= weightEquivalentM3 ? 'volume' : 'weight',
    };
  }

  if (rail === 'AIR_EXPRESS') {
    const divisor = positivePolicy(policies, 'AIR_VOLUMETRIC_DIVISOR');
    const volumetricWeightKg = volume / divisor;
    const chargeableKg = Math.max(weight, volumetricWeightKg);

    return {
      transport_rail: rail,
      chargeable_quantity: chargeableKg,
      chargeable_unit: 'kg',
      chargeable_equivalent_kg: chargeableKg,
      actual_weight_kg: weight,
      volume_cm3: volume,
      volumetric_weight_kg: volumetricWeightKg,
      wm_policy_key: 'AIR_VOLUMETRIC_DIVISOR',
      wm_policy_value: divisor,
      dominant_measure: weight >= volumetricWeightKg ? 'weight' : 'volume',
    };
  }

  throw new TransportValuationError(
    `Rail de transport non supporté par la valorisation: ${rail || 'UNASSIGNED'}`,
    'TRANSPORT_VALUATION_RAIL_UNKNOWN'
  );
}

function quoteTransportCommercial({
  railCode,
  weightKg = 0,
  volumeCm3 = 0,
  quantity = 1,
  policies = {},
} = {}) {
  const measure = computeTransportMeasure({ railCode, weightKg, volumeCm3, policies });
  const rateKey = COMMERCIAL_RATE_KEY_BY_RAIL[measure.transport_rail];
  const rate = positivePolicy(policies, rateKey);
  const qty = normalizedQuantity(quantity);

  const priceKmf = measure.transport_rail === 'SEA_STANDARD'
    ? Math.round(measure.chargeable_equivalent_kg * qty * rate)
    : Math.round(measure.chargeable_quantity * qty * rate);

  return {
    ...measure,
    quantity: qty,
    commercial_rate_key: rateKey,
    commercial_rate: rate,
    price_kmf: priceKmf,
  };
}

function quoteTransportCost({
  railCode,
  weightKg = 0,
  volumeCm3 = 0,
  quantity = 1,
  policies = {},
} = {}) {
  const measure = computeTransportMeasure({ railCode, weightKg, volumeCm3, policies });
  const rateKey = COST_RATE_KEY_BY_RAIL[measure.transport_rail];
  const rate = positivePolicy(policies, rateKey);
  const qty = normalizedQuantity(quantity);

  let costKmf;
  let costCurrency;
  let fxKey = null;
  let fxRate = null;

  if (measure.transport_rail === 'SEA_STANDARD') {
    fxKey = 'EUR_KMF';
    fxRate = positivePolicy(policies, fxKey);
    costCurrency = 'EUR';
    costKmf = Math.round(measure.chargeable_quantity * qty * rate * fxRate);
  } else {
    costCurrency = 'KMF';
    costKmf = Math.round(measure.chargeable_quantity * qty * rate);
  }

  return {
    ...measure,
    quantity: qty,
    cost_rate_key: rateKey,
    cost_rate: rate,
    cost_currency: costCurrency,
    fx_key: fxKey,
    fx_rate: fxRate,
    cost_kmf: costKmf,
  };
}

module.exports = {
  TransportValuationError,
  COMMERCIAL_RATE_KEY_BY_RAIL,
  COST_RATE_KEY_BY_RAIL,
  computeTransportMeasure,
  quoteTransportCommercial,
  quoteTransportCost,
};
