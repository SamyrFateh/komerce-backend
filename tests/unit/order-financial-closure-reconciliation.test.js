'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockHandoff = jest.fn();
const mockMaturity = jest.fn();
jest.mock('../../services/customer-handoff-reconciliation', () => ({
  reconcileCustomerHandoff: (...args) => mockHandoff(...args),
}));
jest.mock('../../services/pricing-maturity', () => ({
  getOrderMaturity: (...args) => mockMaturity(...args),
}));

const {
  reconcileOrderFinancialClose,
  supplierPaymentAssessment,
} = require('../../services/order-financial-closure-reconciliation');

function client({ order, incidents = [], refunds = [], supplierPayments = [] }) {
  const query = jest.fn()
    .mockResolvedValueOnce({ rows: [order] })
    .mockResolvedValueOnce({ rows: incidents })
    .mockResolvedValueOnce({ rows: refunds })
    .mockResolvedValueOnce({ rows: supplierPayments });
  return { query };
}

const baseOrder = (overrides = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  reference: 'K-CLOSE-1',
  status: 'collected',
  payment_status: 'paid',
  payment_mode: 'stripe_eur',
  total_kmf: 25000,
  total_eur: '50.00',
  ...overrides,
});

const supplierPayment = (overrides = {}) => ({
  id: 'pay-1',
  provider: 'cj',
  status: 'succeeded',
  reconciliation_status: 'matched',
  real_debit_verified: true,
  expected_amount: '7.0000',
  observed_amount: '7.0000',
  currency: 'USD',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockHandoff.mockResolvedValue({
    scope: 'CUSTOMER_HANDOFF',
    verdict: 'HANDOFF_MATCHED',
    reason: null,
  });
  mockMaturity.mockResolvedValue({
    mature: true,
    maturity_status: 'MATURE',
    blocking_reasons: [],
  });
});

test('normal path closes only with proven handoff and reconciled finances', async () => {
  const c = client({
    order: baseOrder(),
    supplierPayments: [supplierPayment()],
  });

  await expect(reconcileOrderFinancialClose(c, { orderId: baseOrder().id }))
    .resolves.toMatchObject({
      verdict: 'FINANCIAL_CLOSE_MATCHED',
      reason: null,
      mode: 'normal',
      order_status: 'collected',
      payment_status: 'paid',
      handoff_verdict: 'HANDOFF_MATCHED',
      economic_maturity: {
        mature: true,
        maturity_status: 'MATURE',
        blocking_reasons: [],
      },
    });
});

test('normal path remains pending until economic facts are mature', async () => {
  mockMaturity.mockResolvedValueOnce({
    mature: false,
    maturity_status: 'IMMATURE',
    blocking_reasons: ['customs_cost_reconciled', 'freight_reconciled'],
  });
  const c = client({
    order: baseOrder(),
    supplierPayments: [supplierPayment()],
  });

  await expect(reconcileOrderFinancialClose(c, { orderId: baseOrder().id }))
    .resolves.toMatchObject({
      verdict: 'FINANCIAL_CLOSE_PENDING',
      reason: 'FINANCIAL_CLOSE_ECONOMIC_FACTS_PENDING',
      mode: 'financial',
      economic_maturity: {
        mature: false,
        maturity_status: 'IMMATURE',
        blocking_reasons: ['customs_cost_reconciled', 'freight_reconciled'],
      },
    });
});

test('active incident keeps financial close pending', async () => {
  const c = client({
    order: baseOrder(),
    incidents: [{
      id: 'inc-1',
      status: 'open',
      incident_type: 'damaged_item',
      resolution_type: null,
    }],
    supplierPayments: [supplierPayment()],
  });

  await expect(reconcileOrderFinancialClose(c, { orderId: baseOrder().id }))
    .resolves.toMatchObject({
      verdict: 'FINANCIAL_CLOSE_PENDING',
      reason: 'FINANCIAL_CLOSE_ACTIVE_INCIDENT',
      mode: 'exception',
    });
});

test('pending refund keeps close pending even after incident resolution', async () => {
  const c = client({
    order: baseOrder(),
    incidents: [{
      id: 'inc-1',
      status: 'resolved',
      incident_type: 'damaged_item',
      resolution_type: 'refund',
    }],
    refunds: [{
      id: 'ref-1',
      refund_type: 'partial',
      refund_method: 'stripe',
      status: 'pending',
      amount_kmf: 5000,
      amount_eur: '10.00',
    }],
    supplierPayments: [supplierPayment()],
  });

  await expect(reconcileOrderFinancialClose(c, { orderId: baseOrder().id }))
    .resolves.toMatchObject({
      verdict: 'FINANCIAL_CLOSE_PENDING',
      reason: 'FINANCIAL_CLOSE_REFUND_PENDING',
    });
});

test('refunded terminal without completed refund fact is a mismatch', async () => {
  mockHandoff.mockResolvedValue({ verdict: 'HANDOFF_PENDING', reason: 'not_collected' });
  const c = client({
    order: baseOrder({ status: 'refunded', payment_status: 'refunded' }),
  });

  await expect(reconcileOrderFinancialClose(c, { orderId: baseOrder().id }))
    .resolves.toMatchObject({
      verdict: 'FINANCIAL_CLOSE_MISMATCH',
      reason: 'FINANCIAL_CLOSE_REFUND_FACT_MISSING',
      mode: 'refund',
    });
});

test('refunded terminal closes with completed refund and no active incident', async () => {
  mockHandoff.mockResolvedValue({ verdict: 'HANDOFF_PENDING', reason: 'not_collected' });
  const c = client({
    order: baseOrder({ status: 'refunded', payment_status: 'refunded' }),
    refunds: [{
      id: 'ref-1',
      refund_type: 'full',
      refund_method: 'stripe',
      status: 'completed',
      amount_kmf: 25000,
      amount_eur: '50.00',
      completed_at: '2026-10-06T20:00:00Z',
    }],
  });

  await expect(reconcileOrderFinancialClose(c, { orderId: baseOrder().id }))
    .resolves.toMatchObject({
      verdict: 'FINANCIAL_CLOSE_MATCHED',
      reason: null,
      mode: 'refund',
    });
});

test('paid cancellation without completed refund is a mismatch', async () => {
  mockHandoff.mockResolvedValue({ verdict: 'HANDOFF_PENDING' });
  const c = client({
    order: baseOrder({ status: 'cancelled', payment_status: 'paid' }),
  });

  await expect(reconcileOrderFinancialClose(c, { orderId: baseOrder().id }))
    .resolves.toMatchObject({
      verdict: 'FINANCIAL_CLOSE_MISMATCH',
      reason: 'FINANCIAL_CLOSE_PAID_CANCEL_WITHOUT_REFUND',
      mode: 'cancel',
    });
});

test('supplier payment ambiguity blocks financial close', async () => {
  const c = client({
    order: baseOrder(),
    supplierPayments: [supplierPayment({
      status: 'ambiguous',
      reconciliation_status: 'unverified',
      real_debit_verified: false,
    })],
  });

  await expect(reconcileOrderFinancialClose(c, { orderId: baseOrder().id }))
    .resolves.toMatchObject({
      verdict: 'FINANCIAL_CLOSE_MISMATCH',
      reason: 'FINANCIAL_CLOSE_SUPPLIER_PAYMENT_MISMATCH',
      mode: 'financial',
    });
});

test('supplier payment succeeded but real debit unverified remains pending', async () => {
  const c = client({
    order: baseOrder(),
    supplierPayments: [supplierPayment({ real_debit_verified: false })],
  });

  await expect(reconcileOrderFinancialClose(c, { orderId: baseOrder().id }))
    .resolves.toMatchObject({
      verdict: 'FINANCIAL_CLOSE_PENDING',
      reason: 'FINANCIAL_CLOSE_SUPPLIER_PAYMENT_PENDING',
    });
});

test('resolved reship closes as replacement only after handoff matched', async () => {
  const c = client({
    order: baseOrder(),
    incidents: [{
      id: 'inc-1',
      status: 'resolved',
      incident_type: 'missing_item',
      resolution_type: 'reship',
    }],
    supplierPayments: [supplierPayment()],
  });

  await expect(reconcileOrderFinancialClose(c, { orderId: baseOrder().id }))
    .resolves.toMatchObject({
      verdict: 'FINANCIAL_CLOSE_MATCHED',
      mode: 'replacement',
    });

  mockHandoff.mockResolvedValue({ verdict: 'HANDOFF_PENDING', reason: 'replacement_in_transit' });
  const c2 = client({
    order: baseOrder({ status: 'available' }),
    incidents: [{
      id: 'inc-1',
      status: 'resolved',
      incident_type: 'missing_item',
      resolution_type: 'reship',
    }],
    supplierPayments: [supplierPayment()],
  });

  await expect(reconcileOrderFinancialClose(c2, { orderId: baseOrder().id }))
    .resolves.toMatchObject({
      verdict: 'FINANCIAL_CLOSE_PENDING',
      reason: 'FINANCIAL_CLOSE_HANDOFF_PENDING',
    });
});

test('supplier payment assessment is fail-closed', () => {
  expect(supplierPaymentAssessment([])).toEqual({ state: 'none', blocking: [], pending: [] });
  expect(supplierPaymentAssessment([
    supplierPayment({ status: 'requested', reconciliation_status: 'pending', real_debit_verified: false }),
  ]).state).toBe('pending');
  expect(supplierPaymentAssessment([
    supplierPayment({ reconciliation_status: 'mismatched' }),
  ]).state).toBe('mismatch');
});
