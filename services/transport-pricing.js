/**
 * @komerce-arch
 * @role          transport-pricing-quote
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        requested_transport_rail, weight_kg, volume_cm3, quantity, business_rules
 * @outputs       transport_price_kmf, transport_rail_breakdown
 * @depends       services/transport-rails.js
 * @used-by       routes/orders/create.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_TRANSPORT_RAILS.md §8 (chantier reprise Air Shipped)
 * @impact-areas  orders, economic-engine, logistics
 * @version       2026-07
 */
'use strict';

/**
 * KOMERCE — Devis transport commercial (§8)
 *
 * Avant ce module, aucune valeur de transport n'était jamais ajoutée au total
 * payé par le client : `routes/orders/create.js` ne calculait qu'un coût de
 * fret interne (`cost_estimated_kmf`, invisible du client), utilisé
 * uniquement pour l'estimation de marge. Le client ne payait donc jamais le
 * transport, ce qui est le blocage structurel identifié dans le chantier de
 * reprise Air Shipped / Livraison Express.
 *
 * Ce module fournit un devis transport commercial (price_kmf) par ligne de
 * commande puis agrégé au niveau commande, en respectant la doctrine
 * transport rails :
 *
 *   - Invariant §4/1 : « Aucun rail implicite ». Si le client n'a fait aucun
 *     choix explicite (requested_transport_rail = null), ce module ne code
 *     JAMAIS 'SEA_STANDARD' en dur : il interroge le registre `logistics`
 *     (services/transport-rails.js → listCommercialTransportRails()) pour
 *     connaître le ou les rails réellement commercialisables aujourd'hui.
 *     S'il n'y en a qu'un seul, il sert de base de valorisation. S'il y en a
 *     zéro ou plusieurs, la commande échoue explicitement plutôt que de
 *     deviner (voir TRANSPORT_PRICING_NO_RAIL_AVAILABLE /
 *     TRANSPORT_PRICING_AMBIGUOUS_RAIL_CHOICE).
 *   - Invariant §4/3 : « Pas d'exposition sans valorisation ». Un rail dont
 *     `pricing_status != ACTIVE` (ex. AIR_EXPRESS aujourd'hui) ne peut jamais
 *     être valorisé ici — assertTransportRailCommerciallyExposed() le
 *     garantit avant tout calcul de prix.
 *   - Aucun tarif n'est inventé dans le code : les taux (KMF/kg) viennent de
 *     `business_rules` (SEA_KMF_PER_KG_COMMERCIAL, AIR_KMF_PER_KG_TAXABLE,
 *     AIR_VOLUMETRIC_DIVISOR), injectés par l'appelant via `rates`.
 */

const {
  assertTransportRailCommerciallyExposed,
  listCommercialTransportRails,
  TransportRailError,
} = require('./transport-rails');

class TransportPricingError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TransportPricingError';
    this.code = code;
  }
}

// Clé business_rules du tarif commercial (KMF/kg) par rail.
const RATE_KEY_BY_RAIL = Object.freeze({
  SEA_STANDARD: 'SEA_KMF_PER_KG_COMMERCIAL',
  AIR_EXPRESS: 'AIR_KMF_PER_KG_TAXABLE',
});

const DEFAULT_AIR_VOLUMETRIC_DIVISOR = 6000;

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
 * Poids taxable : poids réel pour SEA_STANDARD, max(poids réel, poids
 * volumétrique) pour AIR_EXPRESS (doctrine migration 115).
 */
function computeTaxableWeightKg({ railCode, weightKg, volumeCm3, airVolumetricDivisor }) {
  const weight = Number(weightKg) || 0;
  if (railCode !== 'AIR_EXPRESS') return weight;

  const divisor = Number(airVolumetricDivisor) > 0
    ? Number(airVolumetricDivisor)
    : DEFAULT_AIR_VOLUMETRIC_DIVISOR;
  const volumetricWeight = (Number(volumeCm3) || 0) / divisor;
  return Math.max(weight, volumetricWeight);
}

/**
 * Devis transport pour une ligne (un product_id × quantity).
 */
function quoteTransportPriceForItem({
  requestedTransportRailCode = null,
  weightKg = 0,
  volumeCm3 = 0,
  quantity = 1,
  rates = {},
} = {}) {
  const railCode = resolveOrderItemTransportRail(requestedTransportRailCode);
  const rateKey = RATE_KEY_BY_RAIL[railCode];
  const kmfPerKg = Number(rates[rateKey]);

  if (!(kmfPerKg > 0)) {
    throw new TransportPricingError(
      `Tarif commercial manquant ou invalide pour ${railCode} (business_rules.${rateKey})`,
      'TRANSPORT_PRICING_RATE_MISSING'
    );
  }

  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const taxable_weight_kg = computeTaxableWeightKg({
    railCode,
    weightKg,
    volumeCm3,
    airVolumetricDivisor: rates.AIR_VOLUMETRIC_DIVISOR,
  });

  const price_kmf = Math.round(taxable_weight_kg * qty * kmfPerKg);

  return {
    transport_rail: railCode,
    taxable_weight_kg,
    unit_price_kmf_per_kg: kmfPerKg,
    price_kmf,
  };
}

/**
 * Devis transport agrégé pour une commande complète (somme des lignes).
 *
 * @param {Array<{product_id?:string, requested_transport_rail?:string|null,
 *   weight_kg?:number, volume_cm3?:number, quantity?:number}>} items
 * @param {object} rates business_rules injectées par l'appelant
 * @returns {{transport_price_kmf:number, breakdown:Array}}
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

module.exports = {
  TransportPricingError,
  RATE_KEY_BY_RAIL,
  resolveOrderItemTransportRail,
  computeTaxableWeightKg,
  quoteTransportPriceForItem,
  quoteTransportPriceForOrder,
};
