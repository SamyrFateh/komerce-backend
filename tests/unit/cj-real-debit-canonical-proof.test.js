'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
const mockClose = jest.fn();

jest.mock('../../db', () => ({
  query: (...args) => mockQuery(...args),
  pool: { end: jest.fn() },
}));
jest.mock('../../services/suppliers/cj-supplier-payment-runtime', () => ({
  closeCjSupplierPayment: (...args) => mockClose(...args),
}));

const proof = require('../../scripts/cj-real-debit-canonical-proof');

const paymentId = '11111111-1111-4111-8111-111111111111';
const env = {
  KOMERCE_ALLOW_CJ_REAL_DEBIT_PROOF: '1',
  KOMERCE_ALLOW_CJ_REAL_PAYMENT: '1',
  KOMERCE_CJ_REAL_MAX_USD: '20',
};

function row(overrides = {}) {
  return {
    id: paymentId,
    purchase_order_id: '22222222-2222-4222-8222-222222222222',
    provider: 'cj',
    status: 'succeeded',
    reconciliation_status: 'matched',
    real_debit_verified: true,
    expected_amount: '7.0000',
    observed_amount: '7.0000',
    currency: 'USD',
    payment_ref: 'SHIP-1',
    proof_source: 'cj_wallet_billing_history',
    proof_ref: 'BILL-1',
    proof_observed_amount: '7.0000',
    proof_currency: 'USD',
    debit_confirmed: true,
    sandbox: false,
    simulated: false,
    occurred_at: '2026-10-07T10:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('guard requires both explicit real-debit and real-payment opt-ins', () => {
  expect(() => proof.guard({ ...env, KOMERCE_ALLOW_CJ_REAL_DEBIT_PROOF: '0' }, paymentId))
    .toThrow('KOMERCE_ALLOW_CJ_REAL_DEBIT_PROOF=1 requis');
  expect(() => proof.guard({ ...env, KOMERCE_ALLOW_CJ_REAL_PAYMENT: '0' }, paymentId))
    .toThrow('KOMERCE_ALLOW_CJ_REAL_PAYMENT=1 requis');
  expect(() => proof.guard({ ...env, KOMERCE_CJ_SANDBOX: '1' }, paymentId))
    .toThrow('CJ_REAL_PROOF_SANDBOX_FORBIDDEN');
  expect(() => proof.guard(env, 'not-a-uuid'))
    .toThrow('CJ_REAL_SUPPLIER_PAYMENT_ID_INVALID');
});

test('canonical closure requires persisted billingHistory proof and exact amount/currency', () => {
  expect(proof.assertCanonicalClosure(row())).toMatchObject({
    supplier_payment_id: paymentId,
    real_debit_verified: true,
    proof_source: 'cj_wallet_billing_history',
    proof_ref: 'BILL-1',
  });

  expect(() => proof.assertCanonicalClosure(row({ real_debit_verified: false })))
    .toThrow('CJ_REAL_CANONICAL_DEBIT_NOT_VERIFIED');
  expect(() => proof.assertCanonicalClosure(row({ proof_ref: null })))
    .toThrow('CJ_REAL_CANONICAL_PROOF_REF_MISSING');
  expect(() => proof.assertCanonicalClosure(row({ sandbox: true })))
    .toThrow('CJ_REAL_CANONICAL_PROOF_NOT_REAL');
  expect(() => proof.assertCanonicalClosure(row({ proof_observed_amount: '6.0000' })))
    .toThrow('CJ_REAL_CANONICAL_PROOF_AMOUNT_MISMATCH');
});

test('run closes the persisted payment through the canonical runtime then rereads durable proof', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [row({ real_debit_verified: false, proof_source: null, proof_ref: null, proof_observed_amount: null, proof_currency: null, debit_confirmed: null })] })
    .mockResolvedValueOnce({ rows: [row()] });

  mockClose.mockResolvedValueOnce({
    invoked: true,
    closed: true,
    payment_id: paymentId,
    reconciliation: { verified: true },
  });

  const result = await proof.run(env, {
    args: { paymentId },
    db: { query: (...args) => mockQuery(...args) },
    closeCjSupplierPayment: (...args) => mockClose(...args),
  });

  expect(mockClose).toHaveBeenCalledWith(expect.anything(), {
    supplierPaymentId: paymentId,
    context: {
      env,
      operator_authorized: true,
    },
  });
  expect(result).toMatchObject({
    proof: 'CJ_REAL_DEBIT_CANONICAL',
    invoked: true,
    closed: true,
    real_debit_verified: true,
    proof_ref: 'BILL-1',
  });
  expect(mockQuery).toHaveBeenCalledTimes(2);
});

test('run fails closed if provider runtime returns but durable canonical promotion is absent', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [row({ real_debit_verified: false, proof_source: null, proof_ref: null, proof_observed_amount: null, proof_currency: null, debit_confirmed: null })] })
    .mockResolvedValueOnce({ rows: [row({ real_debit_verified: false })] });

  mockClose.mockResolvedValueOnce({
    invoked: true,
    closed: true,
    payment_id: paymentId,
    reconciliation: { verified: true },
  });

  await expect(proof.run(env, {
    args: { paymentId },
    db: { query: (...args) => mockQuery(...args) },
    closeCjSupplierPayment: (...args) => mockClose(...args),
  })).rejects.toThrow('CJ_REAL_CANONICAL_DEBIT_NOT_VERIFIED');
});

test('readback never needs provider credentials or raw provider payloads', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [row()] });
  const out = await proof.readCanonicalProof({ query: (...args) => mockQuery(...args) }, paymentId);
  expect(out.proof_ref).toBe('BILL-1');
  const sql = String(mockQuery.mock.calls[0][0]);
  expect(sql).toContain('supplier_execution_payment_proofs');
  expect(sql).toContain("proof_source = 'cj_wallet_billing_history'");
  expect(sql).not.toMatch(/token|credential|provider_facts/i);
});
