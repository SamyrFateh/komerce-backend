'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const {
  evaluateDeterministicScenario,
  certifyScenarioGate,
} = require('../../services/pipeline-certification-scenario-core');

describe('pipeline-certification-scenario-core', () => {
  test('accepts a deterministic scenario only when every fail-closed invariant holds', () => {
    expect(evaluateDeterministicScenario({
      id: 'happy',
      network_used: false,
      paid_ai_used: false,
      state_corrupted: false,
      duplicate_identity: false,
      silent_loss: false,
      expected_outcome: 'PASS',
      actual_outcome: 'PASS',
      provenance_preserved: true,
    }, ['happy'])).toEqual({ id: 'happy', pass: true, reasons: [] });
  });

  test('reports missing required scenarios and observed failures', () => {
    const result = certifyScenarioGate({
      gate: 'B',
      version: 'test',
      requiredScenarios: ['happy', 'corrupt'],
      scenarios: [{
        id: 'happy',
        expected_outcome: 'PASS',
        actual_outcome: 'FAIL',
        provenance_preserved: false,
      }],
    });

    expect(result.pass).toBe(false);
    expect(result.missing).toEqual(['corrupt']);
    expect(result.failed[0].reasons).toEqual(
      expect.arrayContaining(['outcome_mismatch', 'provenance_not_preserved'])
    );
  });
});
