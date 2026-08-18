'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  TransportPricingError,
  resolveOrderItemTransportRail,
  computeTaxableWeightKg,
  quoteTransportPriceForItem,
  quoteTransportPriceForOrder,
} = require('../../services/transport-pricing');

const RATES = {
  SEA_WM_KG_PER_M3: 1000,
  SEA_KMF_PER_KG_COMMERCIAL: 65,
  AIR_KMF_PER_KG_TAXABLE: 2500,
  AIR_VOLUMETRIC_DIVISOR: 6000,
};

describe('resolveOrderItemTransportRail', () => {
  test('sans choix explicite, résout sur le seul rail commercialement exposé (SEA_STANDARD)', () => {
    expect(resolveOrderItemTransportRail(null)).toBe('SEA_STANDARD');
    expect(resolveOrderItemTransportRail(undefined)).toBe('SEA_STANDARD');
  });

  test('un choix explicite pour un rail non exposé (AIR_EXPRESS) échoue', () => {
    expect(() => resolveOrderItemTransportRail('AIR_EXPRESS')).toThrow(TransportPricingError);
    expect(() => resolveOrderItemTransportRail('AIR_EXPRESS')).toThrow('non commercialisable');
  });

  test('un choix explicite pour le rail exposé (SEA_STANDARD) est accepté', () => {
    expect(resolveOrderItemTransportRail('SEA_STANDARD')).toBe('SEA_STANDARD');
  });

  test('un code de rail inconnu échoue avec le message du registre logistics', () => {
    expect(() => resolveOrderItemTransportRail('ROAD_FAST')).toThrow();
  });
});

describe('computeTaxableWeightKg — alias W/M', () => {
  test('SEA_STANDARD retourne le poids équivalent W/M, pas seulement le poids réel', () => {
    expect(computeTaxableWeightKg({
      railCode: 'SEA_STANDARD',
      weightKg: 2,
      volumeCm3: 200000,
      seaWmKgPerM3: 1000,
    })).toBeCloseTo(200, 10);
  });

  test('AIR_EXPRESS utilise max(poids réel, poids volumétrique)', () => {
    expect(computeTaxableWeightKg({
      railCode: 'AIR_EXPRESS', weightKg: 1, volumeCm3: 12000, airVolumetricDivisor: 6000,
    })).toBe(2);

    expect(computeTaxableWeightKg({
      railCode: 'AIR_EXPRESS', weightKg: 5, volumeCm3: 12000, airVolumetricDivisor: 6000,
    })).toBe(5);
  });
});

describe('quoteTransportPriceForItem', () => {
  test('SEA volume-dominant facture la quantité W/M au tarif commercial KMF/kg équivalent', () => {
    const quote = quoteTransportPriceForItem({
      requestedTransportRailCode: null,
      weightKg: 1.5,
      volumeCm3: 200000,
      quantity: 2,
      rates: RATES,
    });
    expect(quote).toMatchObject({
      transport_rail: 'SEA_STANDARD',
      taxable_weight_kg: 200,
      chargeable_quantity: 0.2,
      chargeable_unit: 'm3',
      dominant_measure: 'volume',
      unit_price_kmf_per_kg: 65,
      price_kmf: Math.round(200 * 2 * 65),
    });
  });

  test('SEA poids-dominant conserve le même prix que le poids réel', () => {
    const quote = quoteTransportPriceForItem({
      requestedTransportRailCode: null,
      weightKg: 1.5,
      volumeCm3: 0,
      quantity: 2,
      rates: RATES,
    });
    expect(quote.price_kmf).toBe(Math.round(1.5 * 2 * 65));
    expect(quote.dominant_measure).toBe('weight');
  });

  test('poids et volume absents → valeur économique nulle, jamais mesure inventée', () => {
    const quote = quoteTransportPriceForItem({
      requestedTransportRailCode: null,
      weightKg: undefined,
      volumeCm3: undefined,
      quantity: 3,
      rates: RATES,
    });
    expect(quote.price_kmf).toBe(0);
  });

  test('rejette une demande explicite AIR_EXPRESS (rail non commercialement exposé)', () => {
    expect(() => quoteTransportPriceForItem({
      requestedTransportRailCode: 'AIR_EXPRESS',
      weightKg: 1,
      quantity: 1,
      rates: RATES,
    })).toThrow(TransportPricingError);
  });

  test('tarif commercial manquant ou invalide → échec explicite', () => {
    expect(() => quoteTransportPriceForItem({
      requestedTransportRailCode: null,
      weightKg: 1,
      quantity: 1,
      rates: { SEA_WM_KG_PER_M3: 1000, SEA_KMF_PER_KG_COMMERCIAL: 0 },
    })).toThrow(TransportPricingError);
  });

  test('policy SEA W/M manquante → échec explicite', () => {
    expect(() => quoteTransportPriceForItem({
      requestedTransportRailCode: null,
      weightKg: 1,
      volumeCm3: 200000,
      quantity: 1,
      rates: { SEA_KMF_PER_KG_COMMERCIAL: 65 },
    })).toThrow('SEA_WM_KG_PER_M3');
  });

  test('quantité invalide conserve le comportement historique : retombe sur 1', () => {
    const quote = quoteTransportPriceForItem({
      requestedTransportRailCode: null,
      weightKg: 2,
      quantity: -5,
      rates: RATES,
    });
    expect(quote.price_kmf).toBe(Math.round(2 * 1 * 65));
  });
});

describe('quoteTransportPriceForOrder', () => {
  test('agrège le prix transport W/M sur plusieurs lignes', () => {
    const result = quoteTransportPriceForOrder({
      items: [
        { product_id: 'p1', weight_kg: 1, volume_cm3: 200000, quantity: 2, requested_transport_rail: null },
        { product_id: 'p2', weight_kg: 0.5, volume_cm3: 0, quantity: 3, requested_transport_rail: 'SEA_STANDARD' },
      ],
      rates: RATES,
    });

    const expectedP1 = Math.round(200 * 2 * 65);
    const expectedP2 = Math.round(0.5 * 3 * 65);

    expect(result.transport_price_kmf).toBe(expectedP1 + expectedP2);
    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0]).toMatchObject({ product_id: 'p1', price_kmf: expectedP1 });
    expect(result.breakdown[1]).toMatchObject({ product_id: 'p2', price_kmf: expectedP2 });
  });

  test('panier vide → transport_price_kmf = 0, aucune erreur', () => {
    const result = quoteTransportPriceForOrder({ items: [], rates: RATES });
    expect(result.transport_price_kmf).toBe(0);
    expect(result.breakdown).toEqual([]);
  });

  test('une seule ligne demandant explicitement AIR_EXPRESS fait échouer tout le devis commande', () => {
    expect(() => quoteTransportPriceForOrder({
      items: [
        { product_id: 'p1', weight_kg: 1, quantity: 1, requested_transport_rail: null },
        { product_id: 'p2', weight_kg: 1, quantity: 1, requested_transport_rail: 'AIR_EXPRESS' },
      ],
      rates: RATES,
    })).toThrow(TransportPricingError);
  });
});
