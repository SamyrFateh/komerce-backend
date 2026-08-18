/**
 * @komerce-arch
 * @role          transport-pricing-quote
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        requested_transport_rail, weight_kg, volume_cm3, quantity, business_rules
 * @outputs       transport_price_kmf, transport_cost_kmf, transport_rail_breakdown
 * @depends       services/transport-rails.js, services/transport-valuation.js
 * @used-by       routes/orders/create.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/adr/ADR-013-fret-transport-rails-wm.md
 * @impact-areas  orders, economic-engine, logistics
 * @version       2026-08
 */
'use strict';

/**
 * KOMERCE — devis transport commercial + coût interne.
 *
 * LOT 1B : le choix du rail reste sous autorité logistics, mais la quantité
 * valorisée est fournie par la boundary économique W/M commune. Coût et prix
 * commercial partagent donc le même rail et la même mesure, jamais le même taux.
 */

const {
  assertTransportRailCommerciallyExposed,
  listCommercialTransportRails,
  TransportRailError,
} = require('./transport-rails');
const {
  COMMERCIAL_RATE_KEY_BY_RAIL: RATE_KEY_BY_RAIL,
  COST_RATE_KEY_BY_RAIL,
  TransportValuationError,
  computeTransportMeasure,
  quoteTransportCommercial,
  quoteTransportCost,
} = require('./transport-valuation');

class TransportPricingError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TransportPricingError';
    this.code = code;
  }
}

/**
 * Résout le rail à utiliser pour valoriser une ligne de commande.
 *
 * - Choix explicite du client → vérifié commercialement exposé, sinon erreur.
 * - Aucun choix → dérivé du registre logistics, jamais codé en dur.
 */
function resolveOrderItemTransportRail(requestedRailCode) {
  if (requestedRailCode) {
    try {
      return assertTransportRailCommerciallyExposed(requestedRailCode).code;
    } catch (e) {
      if (e instanceof TransportRailError) {
        throw new TransportPricingError(e.message, e.code);
      }
      throw e;
    }
  }

  const exposed = listCommercialTransportRails();

  if (exposed.length === 0) {
    throw new TransportPricingError(
      'Aucun rail de transport commercialement exposé — impossible de valoriser la commande',
      'TRANSPORT_PRICING_NO_RAIL_AVAILABLE'
    );
  }

  if (exposed.length > 1) {
    throw new TransportPricingError(
      'Plusieurs rails sont commercialement exposés — un choix explicite du client est requis',
      'TRANSPORT_PRICING_AMBIGUOUS_RAIL_CHOICE'
    );
  }

  return exposed[0].code;
}

/**
 * Alias de compat historique : retourne désormais le poids équivalent de la
 * mesure W/M canonique. SEA exige donc SEA_WM_KG_PER_M3, AIR le diviseur air.
 */
function computeTaxableWeightKg({
  railCode,
  weightKg,
  volumeCm3,
  airVolumetricDivisor,
  seaWmKgPerM3,
}) {
  const measure = computeTransportMeasure({
    railCode,
    weightKg,
    volumeCm3,
    policies: {
      AIR_VOLUMETRIC_DIVISOR: airVolumetricDivisor,
      SEA_WM_KG_PER_M3: seaWmKgPerM3,
    },
  });
  return measure.chargeable_equivalent_kg;
}

function toPricingError(err) {
  if (!(err instanceof TransportValuationError)) return err;

  const message = String(err.message || '');
  const isCommercialRate = Object.values(RATE_KEY_BY_RAIL)
    .some(key => message.includes(key));
  const isCostRate = Object.values(COST_RATE_KEY_BY_RAIL)
    .some(key => message.includes(key));

  return new TransportPricingError(
    err.message,
    isCommercialRate
      ? 'TRANSPORT_PRICING_RATE_MISSING'
      : isCostRate
        ? 'TRANSPORT_COST_RATE_MISSING'
        : 'TRANSPORT_PRICING_POLICY_MISSING'
  );
}

function buildPublicPriceQuote(railCode, quote) {
  return {
    transport_rail: railCode,
    // Alias historique conservé pour les consommateurs existants.
    taxable_weight_kg: quote.chargeable_equivalent_kg,
    chargeable_quantity: quote.chargeable_quantity,
    chargeable_unit: quote.chargeable_unit,
    dominant_measure: quote.dominant_measure,
    unit_price_kmf_per_kg: quote.commercial_rate,
    price_kmf: quote.price_kmf,
  };
}

/**
 * Devis transport commercial pour une ligne (compatibilité historique).
 */
function quoteTransportPriceForItem({
  requestedTransportRailCode = null,
  weightKg = 0,
  volumeCm3 = 0,
  quantity = 1,
  rates = {},
} = {}) {
  const railCode = resolveOrderItemTransportRail(requestedTransportRailCode);

  try {
    const quote = quoteTransportCommercial({
      railCode,
      weightKg,
      volumeCm3,
      quantity,
      policies: rates,
    });
    return buildPublicPriceQuote(railCode, quote);
  } catch (err) {
    throw toPricingError(err);
  }
}

/**
 * Valorisation unique d'une ligne : même rail, même mesure W/M, deux taux.
 * C'est le contrat à utiliser quand l'appelant doit calculer à la fois la
 * recette client et le coût interne (checkout / marge).
 */
function quoteTransportForItem({
  requestedTransportRailCode = null,
  weightKg = 0,
  volumeCm3 = 0,
  quantity = 1,
  rates = {},
} = {}) {
  const railCode = resolveOrderItemTransportRail(requestedTransportRailCode);

  try {
    const commercial = quoteTransportCommercial({
      railCode,
      weightKg,
      volumeCm3,
      quantity,
      policies: rates,
    });
    const cost = quoteTransportCost({
      railCode,
      weightKg,
      volumeCm3,
      quantity,
      policies: rates,
    });

    if (
      commercial.chargeable_quantity !== cost.chargeable_quantity ||
      commercial.chargeable_unit !== cost.chargeable_unit ||
      commercial.dominant_measure !== cost.dominant_measure
    ) {
      throw new TransportPricingError(
        `Divergence interne coût/prix sur la mesure W/M ${railCode}`,
        'TRANSPORT_MEASURE_DIVERGENCE'
      );
    }

    return {
      ...buildPublicPriceQuote(railCode, commercial),
      cost_rate_key: cost.cost_rate_key,
      cost_rate: cost.cost_rate,
      cost_currency: cost.cost_currency,
      fx_key: cost.fx_key,
      fx_rate: cost.fx_rate,
      cost_kmf: cost.cost_kmf,
    };
  } catch (err) {
    if (err instanceof TransportPricingError) throw err;
    throw toPricingError(err);
  }
}

/**
 * Devis transport commercial agrégé pour une commande complète.
 * Contrat historique conservé pour les consommateurs qui ne veulent que le prix.
 */
function quoteTransportPriceForOrder({ items = [], rates = {} } = {}) {
  let transport_price_kmf = 0;
  const breakdown = [];

  for (const item of items) {
    const quote = quoteTransportPriceForItem({
      requestedTransportRailCode: item.requested_transport_rail ?? null,
      weightKg: item.weight_kg,
      volumeCm3: item.volume_cm3,
      quantity: item.quantity,
      rates,
    });
    transport_price_kmf += quote.price_kmf;
    breakdown.push({ product_id: item.product_id ?? null, ...quote });
  }

  return { transport_price_kmf, breakdown };
}

/**
 * Checkout canonique : agrège prix ET coût à partir de la même mesure W/M.
 */
function quoteTransportForOrder({ items = [], rates = {} } = {}) {
  let transport_price_kmf = 0;
  let transport_cost_kmf = 0;
  const breakdown = [];

  for (const item of items) {
    const quote = quoteTransportForItem({
      requestedTransportRailCode: item.requested_transport_rail ?? null,
      weightKg: item.weight_kg,
      volumeCm3: item.volume_cm3,
      quantity: item.quantity,
      rates,
    });
    transport_price_kmf += quote.price_kmf;
    transport_cost_kmf += quote.cost_kmf;
    breakdown.push({ product_id: item.product_id ?? null, ...quote });
  }

  return { transport_price_kmf, transport_cost_kmf, breakdown };
}

module.exports = {
  TransportPricingError,
  RATE_KEY_BY_RAIL,
  resolveOrderItemTransportRail,
  computeTaxableWeightKg,
  quoteTransportPriceForItem,
  quoteTransportForItem,
  quoteTransportPriceForOrder,
  quoteTransportForOrder,
};
