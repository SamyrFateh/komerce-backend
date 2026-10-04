'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  CERTIFICATION_VERSION,
  REQUIRED_SCENARIOS,
  EXPLICITLY_UNPROVEN,
  evaluateScenario,
  certifySupplierExecution,
} = require('../../services/supplier-execution-certification');

const valid = (id, overrides = {}) => ({
  id,
  expected_outcome: 'SAFE',
  actual_outcome: 'SAFE',
  canonical_contract_preserved: true,
  replay_safe: true,
  network_used: false,
  real_charge_possible: false,
  provider_secret_exposed: false,
  duplicate_supplier_order: false,
  cross_po_rebind: false,
  ...overrides,
});

describe('supplier execution certification v1', () => {
  test('fige les 14 scénarios d exécution sans certifier le financier', () => {
    expect(CERTIFICATION_VERSION).toBe('supplier-execution-certified-v1');
    expect(REQUIRED_SCENARIOS).toHaveLength(14);
    expect(new Set(REQUIRED_SCENARIOS).size).toBe(14);
    expect(EXPLICITLY_UNPROVEN).toEqual(expect.arrayContaining([
      'supplier_payment_production',
      'supplier_payment_reconciliation',
      'payment_replay_without_double_debit',
      'b2b_accounting_reconciliation',
    ]));
  });

  test('certifie uniquement quand les 14 scénarios sont présents et sûrs', () => {
    const verdict = certifySupplierExecution(REQUIRED_SCENARIOS.map(id => valid(id)));
    expect(verdict).toMatchObject({
      gate: 'SUPPLIER_EXECUTION_CERTIFIED',
      pass: true,
      required: 14,
      observed: 14,
      missing: [],
      failed: [],
    });
    expect(verdict.explicitly_unproven).toEqual(EXPLICITLY_UNPROVEN);
  });

  test('fail-closed si un scénario manque', () => {
    const verdict = certifySupplierExecution(REQUIRED_SCENARIOS.slice(1).map(id => valid(id)));
    expect(verdict.pass).toBe(false);
    expect(verdict.missing).toEqual([REQUIRED_SCENARIOS[0]]);
  });

  test('fail-closed sur doublon, rebind, contrat non canonique ou replay non sûr', () => {
    for (const patch of [
      { duplicate_supplier_order: true },
      { cross_po_rebind: true },
      { canonical_contract_preserved: false },
      { replay_safe: false },
    ]) {
      expect(evaluateScenario(valid('single_create_persisted', patch)).pass).toBe(false);
    }
  });

  test('la certification déterministe refuse réseau et possibilité de débit réel', () => {
    expect(evaluateScenario(valid('single_create_persisted', { network_used: true }))).toMatchObject({
      pass: false,
      reasons: expect.arrayContaining(['network_used']),
    });
    expect(evaluateScenario(valid('single_create_persisted', { real_charge_possible: true }))).toMatchObject({
      pass: false,
      reasons: expect.arrayContaining(['real_charge_possible']),
    });
  });

  test('un scénario inconnu ne peut jamais élargir silencieusement le contrat', () => {
    expect(evaluateScenario(valid('payment_is_green_now'))).toMatchObject({
      pass: false,
      reasons: expect.arrayContaining(['unknown_scenario']),
    });
  });
});
