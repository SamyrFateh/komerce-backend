'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  REQUIRED_SCENARIOS,
  evaluateScenario,
  certifyGateA,
} = require('../../services/sourcing-certification-gate-a');

function pass(id, outcome = 'SAFE') {
  return {
    id,
    expected_outcome: outcome,
    actual_outcome: outcome,
    provenance_preserved: true,
    network_used: false,
    paid_ai_used: false,
    state_corrupted: false,
    duplicate_identity: false,
    silent_loss: false,
  };
}

describe('Gate A — SOURCING_CERTIFIED', () => {
  test('freezes the complete deterministic torture inventory', () => {
    expect(REQUIRED_SCENARIOS).toEqual([
      'duplicate_same_page', 'duplicate_across_pages', 'pages_reordered',
      'repeated_cursor', 'empty_intermediate_page', 'partial_response',
      'timeout', 'http_429', 'http_5xx', 'invalid_auth', 'field_type_drift',
      'supplier_sku_attribute_change', 'disappears_full_snapshot',
      'disappears_partial_snapshot', 'archived_product_returns',
      'crash_after_checkpoint', 'concurrent_imports', 'unknown_extra_source_fields',
    ]);
  });

  test('certifies only when every torture scenario passes locally', () => {
    const out = certifyGateA(REQUIRED_SCENARIOS.map(id => pass(id)));
    expect(out).toMatchObject({
      gate: 'SOURCING_CERTIFIED',
      pass: true,
      required: 18,
      observed: 18,
      missing: [],
      failed: [],
    });
  });

  test('fails closed when one required scenario is missing', () => {
    const rows = REQUIRED_SCENARIOS.slice(1).map(id => pass(id));
    const out = certifyGateA(rows);
    expect(out.pass).toBe(false);
    expect(out.missing).toEqual(['duplicate_same_page']);
  });

  test.each([
    ['network_used', true, 'network_used'],
    ['paid_ai_used', true, 'paid_ai_used'],
    ['state_corrupted', true, 'state_corrupted'],
    ['duplicate_identity', true, 'duplicate_identity'],
    ['silent_loss', true, 'silent_loss'],
    ['provenance_preserved', false, 'provenance_not_preserved'],
  ])('fails a scenario on invariant breach: %s', (key, value, reason) => {
    const row = pass('timeout', 'RETRY');
    row[key] = value;
    const verdict = evaluateScenario(row);
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons).toContain(reason);
  });

  test('fails on outcome mismatch instead of accepting a green-looking execution', () => {
    const verdict = evaluateScenario({
      ...pass('http_429', 'RETRY'),
      actual_outcome: 'ACCEPT',
    });
    expect(verdict).toMatchObject({ pass: false });
    expect(verdict.reasons).toContain('outcome_mismatch');
  });
});
