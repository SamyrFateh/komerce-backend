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

  test('SEA is migration-ready from canonical W/M + commercial rate + existing finance cost', () => {
    const rules = indexRules([
      { key: 'SEA_WM_KG_PER_M3', value: { value: 1000 } },
      { key: 'SEA_KMF_PER_KG_COMMERCIAL', value: { value: 65 } },
      { key: 'AIR_VOLUMETRIC_DIVISOR', value: { value: 6000 } },
      { key: 'AIR_KMF_PER_KG_TAXABLE', value: { value: 2500 } },
    ]);
    const result = targetReadiness({ rules, legacySeaCostEurPerM3: 180 });
    expect(result.sea_migration_ready).toBe(true);
    expect(result.sea_runtime_ready).toBe(false);
    expect(result.sea_runtime_missing).toEqual(['SEA_EUR_PER_M3_COST']);
    expect(result.air_activation_ready).toBe(false);
    expect(result.air_activation_missing).toEqual(['AIR_KMF_PER_KG_COST']);
    expect(result.sea_wm_kg_per_m3).toBe(1000);
    expect(result.sea_legacy_cost_eur_per_m3).toBe(180);
  });

  test('SEA runtime is ready only when the dedicated cost policy exists', () => {
    const rules = indexRules([
      { key: 'SEA_WM_KG_PER_M3', value: { value: 1000 } },
      { key: 'SEA_EUR_PER_M3_COST', value: { value: 180 } },
      { key: 'SEA_KMF_PER_KG_COMMERCIAL', value: { value: 65 } },
    ]);
    const result = targetReadiness({ rules, legacySeaCostEurPerM3: 180 });
    expect(result.sea_migration_ready).toBe(true);
    expect(result.sea_runtime_ready).toBe(true);
    expect(result.sea_runtime_missing).toEqual([]);
    expect(result.sea_cost_eur_per_m3).toBe(180);
  });

  test('SEA migration blocks if both dedicated and legacy cost authority are absent', () => {
    const rules = indexRules([
      { key: 'SEA_WM_KG_PER_M3', value: { value: 1000 } },
      { key: 'SEA_KMF_PER_KG_COMMERCIAL', value: { value: 65 } },
    ]);
    const result = targetReadiness({ rules });
    expect(result.sea_migration_ready).toBe(false);
    expect(result.sea_migration_missing).toContain('SEA_EUR_PER_M3_COST|finance_config.fret_eur_per_m3');
  });

  test('AIR activation is ready only with distinct cost, price and divisor', () => {
    const rules = indexRules([
      { key: 'SEA_WM_KG_PER_M3', value: { value: 1000 } },
      { key: 'SEA_EUR_PER_M3_COST', value: { value: 180 } },
      { key: 'SEA_KMF_PER_KG_COMMERCIAL', value: { value: 65 } },
      { key: 'AIR_KMF_PER_KG_COST', value: { value: 777 } },
      { key: 'AIR_KMF_PER_KG_TAXABLE', value: { value: 2500 } },
      { key: 'AIR_VOLUMETRIC_DIVISOR', value: { value: 6000 } },
    ]);
    expect(targetReadiness({ rules }).air_activation_ready).toBe(true);
  });
});
