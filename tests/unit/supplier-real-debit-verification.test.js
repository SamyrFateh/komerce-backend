'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { verifyRealDebitEvidence } = require('../../services/supplier-real-debit-verification');

const payment = {
  provider:'cj',
  status:'succeeded',
  reconciliation_status:'matched',
  expected_amount:'62.0700',
  currency:'USD',
  payment_ref:'PAY-1',
};

test('preuve réelle complète => verified', () => {
  expect(verifyRealDebitEvidence(payment, {
    provider:'CJ',
    observed_amount:62.07,
    currency:'usd',
    payment_ref:'PAY-1',
    proof_source:'provider_balance_transaction',
    proof_ref:'TX-123',
    debit_confirmed:true,
    sandbox:false,
    simulated:false,
  })).toEqual({
    verified:true,
    reasons:[],
    normalized:{
      provider:'cj',
      payment_ref:'PAY-1',
      observed_amount:62.07,
      currency:'USD',
      proof_source:'provider_balance_transaction',
      proof_ref:'TX-123',
      debit_confirmed:true,
      sandbox:false,
      simulated:false,
    },
  });
});

test('un statut paid seul ne suffit jamais', () => {
  const out = verifyRealDebitEvidence(payment, {
    provider:'cj',
    observed_amount:62.07,
    currency:'USD',
  });
  expect(out.verified).toBe(false);
  expect(out.reasons).toEqual(expect.arrayContaining([
    'PROOF_SOURCE_REQUIRED',
    'PROOF_REF_REQUIRED',
    'DEBIT_NOT_CONFIRMED',
  ]));
});

test('sandbox ou simulation ne peuvent jamais prouver un débit réel', () => {
  expect(verifyRealDebitEvidence(payment, {
    provider:'cj',
    observed_amount:62.07,
    currency:'USD',
    payment_ref:'PAY-1',
    proof_source:'provider_balance_transaction',
    proof_ref:'TX-SBX',
    debit_confirmed:true,
    sandbox:true,
    simulated:false,
  }).reasons).toContain('SANDBOX_EVIDENCE_REJECTED');

  expect(verifyRealDebitEvidence(payment, {
    provider:'cj',
    observed_amount:62.07,
    currency:'USD',
    payment_ref:'PAY-1',
    proof_source:'provider_balance_transaction',
    proof_ref:'TX-SIM',
    debit_confirmed:true,
    sandbox:false,
    simulated:true,
  }).reasons).toContain('SIMULATED_EVIDENCE_REJECTED');
});

test('montant, devise et provider doivent correspondre', () => {
  const out = verifyRealDebitEvidence(payment, {
    provider:'other',
    observed_amount:61,
    currency:'EUR',
    payment_ref:'PAY-1',
    proof_source:'provider_balance_transaction',
    proof_ref:'TX-X',
    debit_confirmed:true,
    sandbox:false,
    simulated:false,
  });
  expect(out.reasons).toEqual(expect.arrayContaining([
    'AMOUNT_MISMATCH',
    'CURRENCY_MISMATCH',
    'PROVIDER_MISMATCH',
  ]));
});

test('le paiement local doit être succeeded et matched', () => {
  const out = verifyRealDebitEvidence({
    ...payment,
    status:'ambiguous',
    reconciliation_status:'unverified',
  }, {
    provider:'cj',
    observed_amount:62.07,
    currency:'USD',
    payment_ref:'PAY-1',
    proof_source:'provider_balance_transaction',
    proof_ref:'TX-X',
    debit_confirmed:true,
    sandbox:false,
    simulated:false,
  });
  expect(out.reasons).toEqual(expect.arrayContaining([
    'PAYMENT_NOT_SUCCEEDED',
    'PAYMENT_NOT_RECONCILED',
  ]));
});
