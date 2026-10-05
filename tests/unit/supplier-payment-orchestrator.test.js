'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../services/supplier-payment-state', () => ({
  prepareSupplierPayment: jest.fn(),
  canInvokeProviderPayment: jest.fn(),
  markPaymentRequested: jest.fn(),
  markPaymentAmbiguous: jest.fn(),
  markPaymentSucceeded: jest.fn(),
  markPaymentRejected: jest.fn(),
}));

const state = require('../../services/supplier-payment-state');
const { executeSupplierPayment } = require('../../services/supplier-payment-orchestrator');

const prepared = {
  id:'pay-1',
  provider:'cj',
  payment_execution_key:'PEK-1',
  payment_ref:'PAY-1',
  expected_amount:'62.0700',
  currency:'USD',
  status:'prepared',
};

beforeEach(() => {
  jest.clearAllMocks();
  state.prepareSupplierPayment.mockResolvedValue(prepared);
  state.canInvokeProviderPayment.mockResolvedValue({
    allowed:true,
    reason:'READY_TO_REQUEST',
    payment:prepared,
  });
  state.markPaymentRequested.mockResolvedValue({ ...prepared, status:'requested' });
});

test('happy path marque requested avant appel provider puis succeeded', async () => {
  state.markPaymentSucceeded.mockResolvedValue({
    ...prepared,
    status:'succeeded',
    observed_amount:'62.0700',
    reconciliation_status:'matched',
    real_debit_verified:false,
  });
  const invoke = jest.fn(async () => ({
    verdict:'succeeded',
    observed_amount:62.07,
    reconciliation_status:'matched',
    payment_ref:'PAY-1',
    real_debit_verified:false,
  }));

  const out = await executeSupplierPayment({}, {
    payment:{
      purchaseOrderId:'po-1', provider:'cj', paymentExecutionKey:'PEK-1',
      supplierExecutionGroupId:'grp-1', expectedAmount:62.07, currency:'USD',
      paymentRef:'PAY-1',
    },
    invokeProviderPayment:invoke,
  });

  expect(state.markPaymentRequested).toHaveBeenCalledBefore(invoke);
  expect(state.markPaymentSucceeded).toHaveBeenCalledWith({}, expect.objectContaining({
    provider:'cj',
    paymentExecutionKey:'PEK-1',
    observedAmount:62.07,
    reconciliationStatus:'matched',
    paymentRef:'PAY-1',
    realDebitVerified:false,
  }));
  expect(out).toMatchObject({ invoked:true, outcome:'succeeded' });
});

test('timeout/exception non classée devient ambiguous, jamais retry local', async () => {
  state.markPaymentAmbiguous.mockResolvedValue({ ...prepared, status:'ambiguous' });
  const invoke = jest.fn(async () => { throw new Error('socket timeout'); });

  const out = await executeSupplierPayment({}, {
    payment:{
      purchaseOrderId:'po-1', provider:'cj', paymentExecutionKey:'PEK-1',
      supplierExecutionGroupId:'grp-1', expectedAmount:62.07, currency:'USD',
    },
    invokeProviderPayment:invoke,
  });

  expect(invoke).toHaveBeenCalledTimes(1);
  expect(state.markPaymentAmbiguous).toHaveBeenCalled();
  expect(state.markPaymentSucceeded).not.toHaveBeenCalled();
  expect(out).toMatchObject({
    invoked:true,
    outcome:'ambiguous',
    provider_error:'socket timeout',
  });
});

test('erreur explicitement rejetée devient rejected', async () => {
  state.markPaymentRejected.mockResolvedValue({ ...prepared, status:'rejected' });
  const invoke = jest.fn(async () => { throw new Error('insufficient balance'); });

  const out = await executeSupplierPayment({}, {
    payment:{
      purchaseOrderId:'po-1', provider:'cj', paymentExecutionKey:'PEK-1',
      supplierExecutionGroupId:'grp-1', expectedAmount:62.07, currency:'USD',
    },
    invokeProviderPayment:invoke,
    classifyProviderError:() => 'rejected',
  });

  expect(state.markPaymentRejected).toHaveBeenCalled();
  expect(state.markPaymentAmbiguous).not.toHaveBeenCalled();
  expect(out).toMatchObject({ invoked:true, outcome:'rejected' });
});

test('résultat provider non concluant devient ambiguous', async () => {
  state.markPaymentAmbiguous.mockResolvedValue({ ...prepared, status:'ambiguous' });

  const out = await executeSupplierPayment({}, {
    payment:{
      purchaseOrderId:'po-1', provider:'cj', paymentExecutionKey:'PEK-1',
      supplierExecutionGroupId:'grp-1', expectedAmount:62.07, currency:'USD',
    },
    invokeProviderPayment:async () => ({ verdict:'unknown' }),
  });

  expect(state.markPaymentAmbiguous).toHaveBeenCalled();
  expect(out).toMatchObject({ invoked:true, outcome:'ambiguous' });
});

test('gate bloque tout nouvel appel si le paiement existe déjà en ambiguous', async () => {
  state.canInvokeProviderPayment.mockResolvedValue({
    allowed:false,
    reason:'PAYMENT_AMBIGUOUS_RECONCILIATION_REQUIRED',
    payment:{ ...prepared, status:'ambiguous' },
  });
  const invoke = jest.fn();

  const out = await executeSupplierPayment({}, {
    payment:{
      purchaseOrderId:'po-1', provider:'cj', paymentExecutionKey:'PEK-1',
      supplierExecutionGroupId:'grp-1', expectedAmount:62.07, currency:'USD',
    },
    invokeProviderPayment:invoke,
  });

  expect(invoke).not.toHaveBeenCalled();
  expect(state.markPaymentRequested).not.toHaveBeenCalled();
  expect(out).toMatchObject({
    invoked:false,
    reason:'PAYMENT_AMBIGUOUS_RECONCILIATION_REQUIRED',
  });
});

test('gate bloque tout nouvel appel si le paiement est déjà succeeded', async () => {
  state.canInvokeProviderPayment.mockResolvedValue({
    allowed:false,
    reason:'PAYMENT_ALREADY_SUCCEEDED',
    payment:{ ...prepared, status:'succeeded' },
  });
  const invoke = jest.fn();

  const out = await executeSupplierPayment({}, {
    payment:{
      purchaseOrderId:'po-1', provider:'cj', paymentExecutionKey:'PEK-1',
      supplierExecutionGroupId:'grp-1', expectedAmount:62.07, currency:'USD',
    },
    invokeProviderPayment:invoke,
  });

  expect(invoke).not.toHaveBeenCalled();
  expect(out).toMatchObject({
    invoked:false,
    reason:'PAYMENT_ALREADY_SUCCEEDED',
  });
});
