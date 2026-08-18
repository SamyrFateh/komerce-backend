'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  jsonRuleValue,
  finitePositive,
  computeLegacySeaKmfPerM3,
  indexRules,
  targetReadiness,
} = require('../../tools/lot1b/preflight-economic-canonization');

describe('LOT 1B-0 — economic truth preflight', () => {
  test('parse business_rules JSONB without inventing a zero', () => {
    expect(jsonRuleValue({ value: 65 })).toBe(65);
    expect(jsonRuleValue('{"value":6000}')).toBe(6000);
    expect(jsonRuleValue('{}')).toBeNull();
    expect(jsonRuleValue('garbage')).toBeNull();
  });

  test('finitePositive rejects null, zero and invalid values', () => {
    expect(finitePositive('180')).toBe(180);
    expect(finitePositive(0)).toBeNull();
    expect(finitePositive(null)).toBeNull();
    expect(finitePositive('nope')).toBeNull();
  });

  test('legacy SEA KMF/m3 is exactly EUR/m3 × EUR/KMF', () => {
    expect(computeLegacySeaKmfPerM3({ fretEurPerM3: 180, eurKmf: 495 })).toBe(89100);
    expect(computeLegacySeaKmfPerM3({ fretEurPerM3: null, eurKmf: 495 })).toBeNull();
  });

  test('target remains blocked while SEA density or AIR cost rate is absent', () => {
    const rules = indexRules([
      { key: 'AIR_VOLUMETRIC_DIVISOR', value: { value: 6000 } },
    ]);
    expect(targetReadiness({ rules })).toEqual({
      ready: false,
      missing: ['SEA_DENSITY_KG_PER_M3', 'AIR_KMF_PER_KG_COST'],
      sea_density_kg_per_m3: null,
      air_cost_kmf_per_kg: null,
      air_volumetric_divisor_cm3_per_kg: 6000,
    });
  });

  test('target is ready only when all three W/M policies are positive', () => {
    const rules = indexRules([
      { key: 'SEA_DENSITY_KG_PER_M3', value: { value: 321 } },
      { key: 'AIR_KMF_PER_KG_COST', value: { value: 777 } },
      { key: 'AIR_VOLUMETRIC_DIVISOR', value: { value: 6000 } },
    ]);
    expect(targetReadiness({ rules })).toEqual({
      ready: true,
      missing: [],
      sea_density_kg_per_m3: 321,
      air_cost_kmf_per_kg: 777,
      air_volumetric_divisor_cm3_per_kg: 6000,
    });
  });
});
