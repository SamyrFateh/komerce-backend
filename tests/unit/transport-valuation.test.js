'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  TransportValuationError,
  computeTransportMeasure,
  quoteTransportCommercial,
  quoteTransportCost,
} = require('../../services/transport-valuation');

const POLICIES = Object.freeze({
  SEA_WM_KG_PER_M3: 1000,
  SEA_KMF_PER_KG_COMMERCIAL: 65,
  SEA_EUR_PER_M3_COST: 180,
  EUR_KMF: 495,
  AIR_VOLUMETRIC_DIVISOR: 6000,
  AIR_KMF_PER_KG_TAXABLE: 2500,
  AIR_KMF_PER_KG_COST: 1800,
});

describe('transport valuation — W/M commun', () => {
  test('SEA retient le volume quand il domine', () => {
    const result = computeTransportMeasure({
      railCode: 'SEA_STANDARD',
      weightKg: 50,
      volumeCm3: 200000,
      policies: POLICIES,
    });

    expect(result.chargeable_quantity).toBeCloseTo(0.2, 10);
    expect(result.chargeable_unit).toBe('m3');
    expect(result.chargeable_equivalent_kg).toBeCloseTo(200, 10);
    expect(result.dominant_measure).toBe('volume');
  });

  test('SEA retient le poids ramené au m3 quand il domine', () => {
    const result = computeTransportMeasure({
      railCode: 'SEA_STANDARD',
      weightKg: 400,
      volumeCm3: 100000,
      policies: POLICIES,
    });

    expect(result.chargeable_quantity).toBeCloseTo(0.4, 10);
    expect(result.chargeable_equivalent_kg).toBeCloseTo(400, 10);
    expect(result.dominant_measure).toBe('weight');
  });

  test('AIR retient max(poids réel, poids volumétrique)', () => {
    const volumeDominant = computeTransportMeasure({
      railCode: 'AIR_EXPRESS',
      weightKg: 1,
      volumeCm3: 12000,
      policies: POLICIES,
    });
    expect(volumeDominant.chargeable_quantity).toBe(2);
    expect(volumeDominant.dominant_measure).toBe('volume');

    const weightDominant = computeTransportMeasure({
      railCode: 'AIR_EXPRESS',
      weightKg: 5,
      volumeCm3: 12000,
      policies: POLICIES,
    });
    expect(weightDominant.chargeable_quantity).toBe(5);
    expect(weightDominant.dominant_measure).toBe('weight');
  });
});

describe('transport valuation — coût ≠ prix', () => {
  test('SEA partage le W/M mais valorise coût EUR/m3 et prix commercial KMF/kg séparément', () => {
    const commercial = quoteTransportCommercial({
      railCode: 'SEA_STANDARD',
      weightKg: 50,
      volumeCm3: 200000,
      quantity: 1,
      policies: POLICIES,
    });
    const cost = quoteTransportCost({
      railCode: 'SEA_STANDARD',
      weightKg: 50,
      volumeCm3: 200000,
      quantity: 1,
      policies: POLICIES,
    });

    expect(commercial.price_kmf).toBe(13000); // 0.2 m3 × 1000 kg/m3 × 65
    expect(cost.cost_kmf).toBe(17820);        // 0.2 m3 × 180 EUR/m3 × 495
    expect(commercial.commercial_rate_key).toBe('SEA_KMF_PER_KG_COMMERCIAL');
    expect(cost.cost_rate_key).toBe('SEA_EUR_PER_M3_COST');
  });

  test('AIR partage le poids taxable mais garde deux taux KMF/kg distincts', () => {
    const commercial = quoteTransportCommercial({
      railCode: 'AIR_EXPRESS',
      weightKg: 1,
      volumeCm3: 12000,
      quantity: 1,
      policies: POLICIES,
    });
    const cost = quoteTransportCost({
      railCode: 'AIR_EXPRESS',
      weightKg: 1,
      volumeCm3: 12000,
      quantity: 1,
      policies: POLICIES,
    });

    expect(commercial.price_kmf).toBe(5000);
    expect(cost.cost_kmf).toBe(3600);
    expect(commercial.commercial_rate).toBe(2500);
    expect(cost.cost_rate).toBe(1800);
  });

  test('AIR cost absent échoue explicitement — jamais de copie du prix commercial', () => {
    expect(() => quoteTransportCost({
      railCode: 'AIR_EXPRESS',
      weightKg: 1,
      volumeCm3: 12000,
      policies: {
        AIR_VOLUMETRIC_DIVISOR: 6000,
        AIR_KMF_PER_KG_TAXABLE: 2500,
      },
    })).toThrow(TransportValuationError);
  });

  test('policy W/M absente échoue explicitement', () => {
    expect(() => computeTransportMeasure({
      railCode: 'SEA_STANDARD',
      weightKg: 1,
      volumeCm3: 1000,
      policies: {},
    })).toThrow('SEA_WM_KG_PER_M3');
  });
});
