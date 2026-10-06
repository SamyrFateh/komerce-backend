'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const { reconcileFulfillment } = require('../../services/suppliers/supplier-fulfillment-reconciliation');

test('FULFILLMENT is provider-agnostic and fail-closed', () => {
  expect(reconcileFulfillment({
    provider: 'cj',
    externalRef: 'CJ-ORDER-1',
    expected: { quantity: 2 },
    observed: { quantity: 2, provider_status: 'SHIPPED', tracking_number: 'TRK-1' },
    evidence: { source: 'provider_order_detail', ref: 'E-1' },
  })).toMatchObject({ scope: 'FULFILLMENT', verdict: 'MATCHED' });

  expect(reconcileFulfillment({
    provider: 'aliexpress',
    expected: { quantity: 2 },
    observed: { quantity: 1, provider_status: 'SHIPPED' },
    evidence: { source: 'provider_order_detail', ref: 'E-2' },
  })).toMatchObject({ verdict: 'MISMATCH', reason: 'FULFILLMENT_QUANTITY_MISMATCH' });

  expect(reconcileFulfillment({
    provider: 'cj',
    expected: { quantity: 1 },
    observed: { quantity: 1 },
    evidence: { source: 'provider_order_detail', ref: 'E-3' },
  })).toMatchObject({ verdict: 'PENDING', reason: 'FULFILLMENT_PROVIDER_FACT_INCOMPLETE' });

  expect(reconcileFulfillment({
    provider: 'cj',
    expected: { quantity: 1 },
    observed: { not_found: true },
    evidence: { source: 'provider_order_detail', ref: 'E-4' },
  })).toMatchObject({ verdict: 'NOT_FOUND' });
});
