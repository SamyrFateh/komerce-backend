'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockExecuteSupplierPayment = jest.fn();
const mockReconcileBilling = jest.fn();
const mockGetAccessToken = jest.fn(async () => 'token');
const mockInvoke = jest.fn();

jest.mock('../../services/supplier-payment-orchestrator', () => ({
  executeSupplierPayment: (...args) => mockExecuteSupplierPayment(...args),
}));
jest.mock('../../services/suppliers/cj-billing-history-reconciliation', () => ({
  reconcileCjBillingHistory: (...args) => mockReconcileBilling(...args),
}));
jest.mock('../../services/suppliers/connectors/cj-connector', () => ({
  getAccessToken: (...args) => mockGetAccessToken(...args),
}));
jest.mock('../../services/suppliers/cj-fulfillment-adapter', () => ({
  _invoke: (...args) => mockInvoke(...args),
}));

const contract = require('../../services/suppliers/cj-purchasing-contract');
const runtime = require('../../services/suppliers/cj-supplier-payment-runtime');

function clientWithPayment(payment) {
  return {
    query: jest.fn(async () => ({ rows: [payment] })),
  };
}

const basePayment = {
  id: 'pay-1',
  purchase_order_id: 'po-1',
  provider: 'cj',
  payment_execution_key: 'payexec-1',
  supplier_execution_order_id: 'exec-1',
  supplier_execution_group_id: null,
  supplier_order_id: 'CJ-1',
  supplier_parent_order_id: null,
  expected_amount: '7.0000',
  currency: 'USD',
  status: 'prepared',
  reconciliation_status: 'pending',
  real_debit_verified: false,
  payment_ref: null,
};

const env = {
  KOMERCE_ALLOW_CJ_REAL_PAYMENT: '1',
  KOMERCE_CJ_REAL_MAX_USD: '20',
  KOMERCE_PROVIDER_EXECUTION_ENV: 'LIVE',
};

const certifiedRegistry = {
  providers: {
    cj: [{
      capability: 'purchasing.real_debit',
      classification: 'CONFIRMED',
      availability: 'PROVEN',
      highest_proof: 'P4',
      environment: 'LIVE',
      evidence: ['test'],
      limitations: [],
    }],
  },
};

function certifiedContext(extra = {}) {
  return {
    env,
    operator_authorized: true,
    certification_registry: certifiedRegistry,
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('real debit is fail-closed on certification before operator authorization', () => {
  expect(() => runtime.guardAuthorization({ env, operator_authorized: true }, basePayment))
    .toThrow('CERTIFICATION_CAPABILITY_GAP');
});

test('certified real debit still requires explicit operator authorization and bounded USD amount', () => {
  expect(() => runtime.guardAuthorization({
    env,
    certification_registry: certifiedRegistry,
  }, basePayment)).toThrow('CJ_REAL_PAYMENT_NOT_AUTHORIZED');

  expect(() => runtime.guardAuthorization(certifiedContext({
    env: { ...env, KOMERCE_CJ_REAL_MAX_USD: '21' },
  }), basePayment)).toThrow('CJ_REAL_MAX_USD_INVALID');

  expect(() => runtime.guardAuthorization(
    certifiedContext(),
    { ...basePayment, expected_amount: '25' }
  )).toThrow('CJ_REAL_DEBIT_CAP_EXCEEDED');

  expect(runtime.guardAuthorization(certifiedContext(), basePayment))
    .toEqual({ cap: 20, amount: 7 });
});

test('prepared payment executes one provider payment then requires billingHistory proof', async () => {
  const client = clientWithPayment(basePayment);

  mockExecuteSupplierPayment.mockImplementation(async (_client, { invokeProviderPayment }) => {
    const providerResult = await invokeProviderPayment();
    return {
      invoked: true,
      outcome: 'succeeded',
      payment: {
        ...basePayment,
        status: 'succeeded',
        reconciliation_status: 'matched',
        payment_ref: providerResult.payment_ref,
      },
      provider_result: providerResult,
    };
  });

  mockInvoke
    .mockResolvedValueOnce({
      result: true,
      data: {
        orderId: 'CJ-1',
        orderStatus: 'UNPAID',
        shipmentOrderId: 'SHIP-1',
        isSandbox: 0,
      },
    })
    .mockResolvedValueOnce({ result: true, data: true });

  mockReconcileBilling.mockResolvedValue({
    verified: true,
    already_verified: false,
    payment_id: 'pay-1',
    proof: { id: 'proof-1' },
  });

  const out = await runtime.closeCjSupplierPayment(client, {
    supplierPaymentId: 'pay-1',
    context: {
      ...certifiedContext(),
      invoke: mockInvoke,
    },
  });

  expect(mockInvoke.mock.calls.filter(([path]) => path === contract.ENDPOINTS.pay_balance_v2))
    .toHaveLength(1);
  expect(mockReconcileBilling).toHaveBeenCalledTimes(1);
  expect(out).toMatchObject({
    closed: true,
    payment_id: 'pay-1',
    reconciliation: { verified: true },
  });
});

test('succeeded+matched unverified payment performs billing read only and never debits again', async () => {
  const payment = {
    ...basePayment,
    status: 'succeeded',
    reconciliation_status: 'matched',
    payment_ref: 'SHIP-1',
  };
  const client = clientWithPayment(payment);

  mockReconcileBilling.mockResolvedValue({
    verified: true,
    already_verified: false,
    payment_id: 'pay-1',
    proof: { id: 'proof-1' },
  });

  const out = await runtime.closeCjSupplierPayment(client, {
    supplierPaymentId: 'pay-1',
    context: {
      ...certifiedContext(),
      invoke: mockInvoke,
    },
  });

  expect(mockExecuteSupplierPayment).not.toHaveBeenCalled();
  expect(mockInvoke.mock.calls.filter(([path]) => path === contract.ENDPOINTS.pay_balance_v2))
    .toHaveLength(0);
  expect(mockReconcileBilling).toHaveBeenCalledTimes(1);
  expect(out.closed).toBe(true);
});

test.each(['requested', 'ambiguous', 'rejected'])('%s payment is never auto-retried', async (status) => {
  const payment = {
    ...basePayment,
    status,
    reconciliation_status: status === 'ambiguous' ? 'unverified' : 'pending',
  };
  const client = clientWithPayment(payment);

  await expect(runtime.closeCjSupplierPayment(client, {
    supplierPaymentId: 'pay-1',
    context: certifiedContext({ invoke: mockInvoke }),
  })).resolves.toMatchObject({
    invoked: false,
    closed: false,
    reason: 'CJ_PAYMENT_REQUIRES_REVIEW',
  });

  expect(mockExecuteSupplierPayment).not.toHaveBeenCalled();
  expect(mockInvoke).not.toHaveBeenCalled();
  expect(mockReconcileBilling).not.toHaveBeenCalled();
});

test('already verified payment is a no-op', async () => {
  const payment = { ...basePayment, status: 'succeeded', reconciliation_status: 'matched', real_debit_verified: true };
  const client = clientWithPayment(payment);

  const out = await runtime.closeCjSupplierPayment(client, {
    supplierPaymentId: 'pay-1',
    context: certifiedContext(),
  });

  expect(out).toMatchObject({ invoked: false, already_verified: true });
  expect(mockExecuteSupplierPayment).not.toHaveBeenCalled();
  expect(mockReconcileBilling).not.toHaveBeenCalled();
});
