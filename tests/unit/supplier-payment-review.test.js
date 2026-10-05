'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));

const { REVIEW_PREDICATE, normalizeLimit, getSupplierPaymentReview } = require('../../services/supplier-payment-review');

test('le prédicat de revue est canonique et n’invente ni retard requested ni absence de preuve', () => {
  expect(REVIEW_PREDICATE).toContain("status IN ('ambiguous', 'rejected')");
  expect(REVIEW_PREDICATE).toContain("reconciliation_status = 'mismatched'");
  expect(REVIEW_PREDICATE).not.toContain('requested');
  expect(REVIEW_PREDICATE).not.toContain('real_debit_verified');
});

test('préserve identité paiement, montants texte et drill PO exact', async () => {
  const q = { query: jest.fn().mockResolvedValue({ rows: [{
    payment_id: '11111111-1111-4111-8111-111111111111',
    purchase_order_id: '22222222-2222-4222-8222-222222222222',
    provider: 'cj',
    payment_ref: 'PAY-42',
    expected_amount: '19.9900',
    observed_amount: null,
    currency: 'USD',
    status: 'ambiguous',
    reconciliation_status: 'unverified',
    real_debit_verified: false,
    review_reason: 'PAYMENT_AMBIGUOUS_RECONCILIATION_REQUIRED',
    created_at: '2026-10-05T10:00:00Z',
    updated_at: '2026-10-05T10:01:00Z',
    total_count: 2,
  }] }) };

  const review = await getSupplierPaymentReview({ limit: 1, include_internal_identity: true }, q);

  expect(review).toMatchObject({ count: 2, truncated: true, basis: 'current_state_all_time' });
  expect(review.items[0]).toEqual(expect.objectContaining({
    payment_id: '11111111-1111-4111-8111-111111111111',
    purchase_order_id: '22222222-2222-4222-8222-222222222222',
    expected_amount: '19.9900',
    observed_amount: null,
    currency: 'USD',
    drill_to: '/admin/workspaces/purchasing?po=22222222-2222-4222-8222-222222222222',
  }));

  const [sql, params] = q.query.mock.calls[0];
  expect(String(sql)).toContain("status IN ('ambiguous', 'rejected') OR reconciliation_status = 'mismatched'");
  expect(String(sql)).not.toContain("status = 'requested'");
  expect(String(sql)).not.toContain('real_debit_verified = false');
  expect(params).toEqual([1]);
});

test('normalise la limite sans permettre une lecture Finance démesurée', () => {
  expect(normalizeLimit(undefined)).toBe(50);
  expect(normalizeLimit(0)).toBe(50);
  expect(normalizeLimit(12.8)).toBe(12);
  expect(normalizeLimit(999)).toBe(100);
  expect(normalizeLimit(null)).toBeNull();
});


test('par défaut le contrat public ne publie jamais l’UUID interne du paiement', async () => {
  const q = { query: jest.fn().mockResolvedValue({ rows: [{
    payment_id: '11111111-1111-4111-8111-111111111111',
    purchase_order_id: '22222222-2222-4222-8222-222222222222',
    provider: 'cj',
    expected_amount: '1.0000',
    observed_amount: null,
    currency: 'USD',
    status: 'rejected',
    reconciliation_status: 'unverified',
    real_debit_verified: false,
    review_reason: 'PAYMENT_REJECTED_REVIEW_REQUIRED',
    total_count: 1,
  }] }) };

  const review = await getSupplierPaymentReview({ limit: 50 }, q);
  expect(review.items[0]).not.toHaveProperty('payment_id');
  expect(JSON.stringify(review)).not.toContain('11111111-1111-4111-8111-111111111111');
});
