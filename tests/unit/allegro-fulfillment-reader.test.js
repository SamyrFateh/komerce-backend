'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockReadOrderDetail = jest.fn();

jest.mock('../../services/suppliers/allegro-fulfillment-adapter', () => ({
  readOrderDetail: (...args) => mockReadOrderDetail(...args),
}));

const reader = require('../../services/suppliers/allegro-fulfillment-reader');

beforeEach(() => {
  jest.clearAllMocks();
});

test('Allegro READY_FOR_PROCESSING sans fulfillment SENT reste PENDING', async () => {
  mockReadOrderDetail.mockResolvedValue({
    facts: {
      checkout_form_id: '11111111-1111-4111-8111-111111111111',
      order_status: 'READY_FOR_PROCESSING',
      fulfillment_status: 'PROCESSING',
      delivery_method: 'Kurier',
      line_items: [{ offer_id: '7782182471', quantity: 2 }],
    },
  });

  const result = await reader.readAndReconcile({
    checkoutFormId: '11111111-1111-4111-8111-111111111111',
    supplierUnitRef: '7782182471',
    expectedQuantity: 2,
  });

  expect(result).toMatchObject({
    scope: 'FULFILLMENT',
    provider: 'allegro',
    verdict: 'PENDING',
    reason: 'FULFILLMENT_PROVIDER_PENDING',
    observed: {
      quantity: 2,
      provider_status: 'PROCESSING',
      carrier: 'Kurier',
      pending: true,
    },
    evidence: {
      proof_source: 'allegro_checkout_form',
      order_status: 'READY_FOR_PROCESSING',
    },
  });
});

test('Allegro fulfillment SENT + quantité exacte devient MATCHED', async () => {
  mockReadOrderDetail.mockResolvedValue({
    facts: {
      checkout_form_id: '22222222-2222-4222-8222-222222222222',
      order_status: 'READY_FOR_PROCESSING',
      fulfillment_status: 'SENT',
      delivery_method: 'Allegro One',
      line_items: [{ offer_id: '7782182471', quantity: 3 }],
    },
  });

  const result = await reader.readAndReconcile({
    checkoutFormId: '22222222-2222-4222-8222-222222222222',
    supplierUnitRef: '7782182471',
    expectedQuantity: 3,
  });

  expect(result).toMatchObject({
    scope: 'FULFILLMENT',
    verdict: 'MATCHED',
    observed: {
      quantity: 3,
      provider_status: 'SENT',
      carrier: 'Allegro One',
      tracking_number: null,
      pending: false,
    },
  });
});

test('Allegro SENT avec quantité différente reste MISMATCH', async () => {
  mockReadOrderDetail.mockResolvedValue({
    facts: {
      checkout_form_id: '33333333-3333-4333-8333-333333333333',
      order_status: 'READY_FOR_PROCESSING',
      fulfillment_status: 'SENT',
      line_items: [{ offer_id: '7782182471', quantity: 1 }],
    },
  });

  const result = await reader.readAndReconcile({
    checkoutFormId: '33333333-3333-4333-8333-333333333333',
    supplierUnitRef: '7782182471',
    expectedQuantity: 2,
  });

  expect(result).toMatchObject({
    verdict: 'MISMATCH',
    reason: 'FULFILLMENT_QUANTITY_MISMATCH',
    observed: { quantity: 1, provider_status: 'SENT', pending: false },
  });
});

test('Allegro agrège uniquement l offre exacte', () => {
  const mapped = reader.mapOrderFactsToFulfillment({
    checkoutFormId: '44444444-4444-4444-8444-444444444444',
    supplierUnitRef: '7782182471',
    facts: {
      checkout_form_id: '44444444-4444-4444-8444-444444444444',
      order_status: 'READY_FOR_PROCESSING',
      fulfillment_status: 'SENT',
      line_items: [
        { offer_id: '7782182471', quantity: 1 },
        { offer_id: '7782182471', quantity: 2 },
        { offer_id: '9999999999', quantity: 9 },
      ],
    },
  });

  expect(mapped.observed.quantity).toBe(3);
  expect(mapped.observed.pending).toBe(false);
});
