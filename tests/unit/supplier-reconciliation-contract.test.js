'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  SCOPE,
  VERDICT,
  createResult,
  validateResult,
} = require('../../services/suppliers/supplier-reconciliation-contract');

test('accepte un résultat MATCHED borné', () => {
  const out = createResult({
    scope: SCOPE.ORDER,
    provider: 'AliExpress',
    verdict: VERDICT.MATCHED,
    expected: { supplier_unit_ref: '12000056903119243', quantity: 1, currency: 'USD' },
    observed: { supplier_unit_ref: '12000056903119243', quantity: 1, currency: 'USD' },
    evidence: { proof_source: 'provider_order_readback' },
    external_ref: '3077063738107106',
  });

  expect(out).toMatchObject({
    scope: 'ORDER',
    provider: 'aliexpress',
    verdict: 'MATCHED',
    external_ref: '3077063738107106',
    reason: null,
  });
});

test.each(['NOT_FOUND', 'MISMATCH', 'AMBIGUOUS', 'PENDING'])(
  'un verdict non MATCHED exige une raison: %s',
  verdict => {
    expect(() => createResult({
      scope: SCOPE.ORDER,
      provider: 'allegro',
      verdict,
      expected: {},
      observed: {},
      evidence: {},
    })).toThrow('RECONCILIATION_NON_MATCH_REASON_REQUIRED');
  }
);

test('refuse scope, verdict et evidence invalides', () => {
  expect(validateResult({
    scope: 'NOPE',
    provider: 'cj',
    verdict: VERDICT.MATCHED,
    expected: {},
    observed: {},
    evidence: {},
  })).toEqual({ ok: false, reason: 'RECONCILIATION_SCOPE_INVALID' });

  expect(validateResult({
    scope: SCOPE.PAYMENT,
    provider: 'cj',
    verdict: 'PAID',
    expected: {},
    observed: {},
    evidence: {},
  })).toEqual({ ok: false, reason: 'RECONCILIATION_VERDICT_INVALID' });

  expect(validateResult({
    scope: SCOPE.FULFILLMENT,
    provider: 'cj',
    verdict: VERDICT.MATCHED,
    expected: {},
    observed: {},
    evidence: null,
  })).toEqual({ ok: false, reason: 'RECONCILIATION_EVIDENCE_REQUIRED' });
});
