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

  test('CURRENT target is ready with canonical SEA_WM policy even if AIR cost is absent', () => {
    const rules = indexRules([
      { key: 'SEA_WM_KG_PER_M3', value: { value: 1000 } },
      { key: 'SEA_KMF_PER_KG_COMMERCIAL', value: { value: 65 } },
      { key: 'AIR_VOLUMETRIC_DIVISOR', value: { value: 6000 } },
      { key: 'AIR_KMF_PER_KG_TAXABLE', value: { value: 2500 } },
    ]);
    expect(targetReadiness({ rules })).toEqual({
      current_ready: true,
      current_missing: [],
      air_activation_ready: false,
      air_activation_missing: ['AIR_KMF_PER_KG_COST'],
      sea_wm_kg_per_m3: 1000,
      sea_commercial_kmf_per_kg: 65,
      air_cost_kmf_per_kg: null,
      air_commercial_kmf_per_kg: 2500,
      air_volumetric_divisor_cm3_per_kg: 6000,
    });
  });

  test('CURRENT target blocks if canonical SEA W/M policy is absent', () => {
    const rules = indexRules([
      { key: 'SEA_KMF_PER_KG_COMMERCIAL', value: { value: 65 } },
    ]);
    const result = targetReadiness({ rules });
    expect(result.current_ready).toBe(false);
    expect(result.current_missing).toContain('SEA_WM_KG_PER_M3');
  });

  test('AIR activation is ready only with distinct cost, price and divisor', () => {
    const rules = indexRules([
      { key: 'SEA_WM_KG_PER_M3', value: { value: 1000 } },
      { key: 'SEA_KMF_PER_KG_COMMERCIAL', value: { value: 65 } },
      { key: 'AIR_KMF_PER_KG_COST', value: { value: 777 } },
      { key: 'AIR_KMF_PER_KG_TAXABLE', value: { value: 2500 } },
      { key: 'AIR_VOLUMETRIC_DIVISOR', value: { value: 6000 } },
    ]);
    expect(targetReadiness({ rules }).air_activation_ready).toBe(true);
  });
});
