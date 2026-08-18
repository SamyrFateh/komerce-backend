'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  RELAY_COMMISSION_COMPONENT_KEY,
  RELAY_COMMISSION_CURRENT_FALLBACK_KMF,
  resolveRelayCommissionCurrent,
} = require('../../utils/relay-commission');

const golden = require('../../tools/golden-cdr/golden/cdr.golden.json');

describe('LOT 1A-3 — priorité commission relais', () => {
  test('cost_components est l’autorité nominale devant finance_config.standard', () => {
    expect(resolveRelayCommissionCurrent({
      componentValue: '620.0000',
      legacyStandardValue: 500,
    })).toEqual({
      amount_kmf: 620,
      source: 'cost_components.commission_relais_kmf',
      fallback_used: false,
    });
  });

  test('finance_config.standard reste un fallback legacy explicite', () => {
    expect(resolveRelayCommissionCurrent({
      componentValue: null,
      legacyStandardValue: '600',
    })).toEqual({
      amount_kmf: 600,
      source: 'finance_config.commission_relais_standard_kmf',
      fallback_used: true,
    });
  });

  test('fallback ultime CURRENT = 500 KMF', () => {
    expect(resolveRelayCommissionCurrent({})).toEqual({
      amount_kmf: RELAY_COMMISSION_CURRENT_FALLBACK_KMF,
      source: 'literal_current_fallback',
      fallback_used: true,
    });
    expect(RELAY_COMMISSION_CURRENT_FALLBACK_KMF).toBe(500);
  });

  test('zéro est une valeur explicite valide, pas un signal de fallback', () => {
    expect(resolveRelayCommissionCurrent({
      componentValue: 0,
      legacyStandardValue: 500,
    }).amount_kmf).toBe(0);
  });

  test('le Golden CURRENT prouve l’égalité des deux sources actives à 500 KMF', () => {
    const component = golden.frozen_config.components.find(
      (c) => c.key === RELAY_COMMISSION_COMPONENT_KEY && c.is_active
    );
    expect(component).toBeDefined();
    expect(Number(component.default_value)).toBe(500);
    expect(Number(golden.frozen_config.finance.commission_relais_standard_kmf)).toBe(500);
    expect(Number(golden.frozen_config.finance.commission_relais_showroom_kmf)).toBe(750);
    expect(Number(golden.frozen_config.finance.commission_relais_pct)).toBe(5);
  });
});
