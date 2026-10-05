'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../services/supplier-payment-state', () => ({
  loadByKey: jest.fn(),
  markPaymentSucceeded: jest.fn(),
}));

const paymentState = require('../../services/supplier-payment-state');
const {
  classifyCjPaymentReadback,
  recoverAmbiguousCjPayment,
} = require('../../services/suppliers/cj-payment-recovery');

const detail = (status) => ({
  data: { orderId: 'CJ-1', orderStatus: status, productList: [] },
});

beforeEach(() => jest.clearAllMocks());

test('tous les enfants post-paiement => paid_confirmed', () => {
  expect(classifyCjPaymentReadback([
    detail('UNSHIPPED'),
    detail('PROCESSING'),
  ])).toMatchObject({
    verdict: 'paid_confirmed',
    statuses: ['UNSHIPPED', 'PROCESSING'],
  });
});

test('tous les enfants UNPAID n autorisent jamais un retry automatique', () => {
  expect(classifyCjPaymentReadback([
    detail('UNPAID'),
    detail('CREATED'),
  ])).toMatchObject({
    verdict: 'unpaid_observed',
    retry_authorized: false,
    reason: 'OBSERVATION_DOES_NOT_PROVE_SAFE_RETRY',
  });
});

test('états mixtes ou inconnus restent unknown et bloquent le retry', () => {
  expect(classifyCjPaymentReadback([
    detail('UNSHIPPED'),
    detail('UNPAID'),
  ])).toMatchObject({
    verdict: 'unknown',
    retry_authorized: false,
  });

  expect(classifyCjPaymentReadback([
    detail('SOMETHING_NEW'),
  ])).toMatchObject({
    verdict: 'unknown',
    retry_authorized: false,
  });
});

test('recovery positif ferme ambiguous en succeeded sans prétendre prouver un débit réel', async () => {
  paymentState.loadByKey.mockResolvedValue({
    id:'pay-1',
    provider:'cj',
    payment_execution_key:'PEK-1',
    expected_amount:'62.0700',
    status:'ambiguous',
  });
  paymentState.markPaymentSucceeded.mockResolvedValue({
    id:'pay-1',
    status:'succeeded',
    reconciliation_status:'matched',
    observed_amount:'62.0700',
    real_debit_verified:false,
  });

  const out = await recoverAmbiguousCjPayment({}, {
    paymentExecutionKey:'PEK-1',
    details:[detail('UNSHIPPED'), detail('PROCESSING')],
    observedAmount:62.07,
    paymentRef:'PAY-1',
  });

  expect(paymentState.markPaymentSucceeded).toHaveBeenCalledWith({}, {
    provider:'cj',
    paymentExecutionKey:'PEK-1',
    observedAmount:62.07,
    reconciliationStatus:'matched',
    paymentRef:'PAY-1',
    realDebitVerified:false,
  });
  expect(out).toMatchObject({
    resolved:true,
    retry_authorized:false,
    recovery:{
      verdict:'paid_confirmed',
      amount_verdict:'matched',
      real_debit_verified:false,
    },
  });
});

test('read-back unpaid laisse le paiement ambiguous et bloque tout retry provider', async () => {
  paymentState.loadByKey.mockResolvedValue({
    id:'pay-1',
    provider:'cj',
    payment_execution_key:'PEK-1',
    expected_amount:'62.0700',
    status:'ambiguous',
  });

  const out = await recoverAmbiguousCjPayment({}, {
    paymentExecutionKey:'PEK-1',
    details:[detail('UNPAID'), detail('UNPAID')],
    observedAmount:62.07,
  });

  expect(paymentState.markPaymentSucceeded).not.toHaveBeenCalled();
  expect(out).toMatchObject({
    resolved:false,
    retry_authorized:false,
    recovery:{ verdict:'unpaid_observed' },
  });
});

test('mismatch de montant bloque la résolution même si CJ apparaît payé', async () => {
  paymentState.loadByKey.mockResolvedValue({
    id:'pay-1',
    provider:'cj',
    payment_execution_key:'PEK-1',
    expected_amount:'62.0700',
    status:'ambiguous',
  });

  const out = await recoverAmbiguousCjPayment({}, {
    paymentExecutionKey:'PEK-1',
    details:[detail('UNSHIPPED')],
    observedAmount:61.00,
  });

  expect(paymentState.markPaymentSucceeded).not.toHaveBeenCalled();
  expect(out).toMatchObject({
    resolved:false,
    retry_authorized:false,
    recovery:{
      verdict:'amount_mismatch',
      expected_amount:62.07,
      observed_amount:61,
    },
  });
});

test('recovery refuse tout paiement qui n est pas ambiguous', async () => {
  paymentState.loadByKey.mockResolvedValue({
    id:'pay-1',
    status:'prepared',
  });

  await expect(recoverAmbiguousCjPayment({}, {
    paymentExecutionKey:'PEK-1',
    details:[detail('UNSHIPPED')],
    observedAmount:62.07,
  })).rejects.toThrow('CJ_PAYMENT_RECOVERY_REQUIRES_AMBIGUOUS:prepared');
});
