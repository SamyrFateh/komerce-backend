'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockReadOrderDetail = jest.fn();

jest.mock('../../services/suppliers/cj-fulfillment-adapter', () => ({
  readOrderDetail: (...args) => mockReadOrderDetail(...args),
}));

const reader = require('../../services/suppliers/cj-fulfillment-reader');

beforeEach(() => {
  jest.clearAllMocks();
});

test('CJ UNSHIPPED reste PENDING même avec quantité exacte', async () => {
  mockReadOrderDetail.mockResolvedValue({
    request_id: 'REQ-1',
    facts: {
      order_id: 'CJ-1',
      cj_order_code: 'SD-1',
      shipment_order_id: 'SHIP-1',
      status: 'UNSHIPPED',
      sub_status: 'PROCESSING',
      logistic_name: 'CJPacket',
      tracking_number: null,
      tracking_provider: null,
      tracking_url: null,
      is_sandbox: false,
      variants: [{ vid: 'VID-1', quantity: 2 }],
    },
  });

  const result = await reader.readAndReconcile({
    supplierOrderId: 'CJ-1',
    supplierUnitRef: 'VID-1',
    expectedQuantity: 2,
  });

  expect(result).toMatchObject({
    scope: 'FULFILLMENT',
    provider: 'cj',
    verdict: 'PENDING',
    reason: 'FULFILLMENT_PROVIDER_PENDING',
    observed: {
      supplier_order_id: 'CJ-1',
      supplier_unit_ref: 'VID-1',
      quantity: 2,
      provider_status: 'UNSHIPPED',
      provider_sub_status: 'PROCESSING',
      pending: true,
    },
    evidence: {
      proof_source: 'cj_order_detail',
      proof_ref: 'CJ-1',
      request_id: 'REQ-1',
    },
  });
});

test('CJ SHIPPED + quantité exacte produit MATCHED avec tracking borné', async () => {
  mockReadOrderDetail.mockResolvedValue({
    request_id: 'REQ-2',
    facts: {
      order_id: 'CJ-2',
      cj_order_code: 'SD-2',
      shipment_order_id: 'SHIP-2',
      status: 'SHIPPED',
      sub_status: null,
      logistic_name: 'CJPacket',
      tracking_number: 'TRACK-2',
      tracking_provider: 'Carrier X',
      tracking_url: 'https://tracking.example/TRACK-2',
      is_sandbox: false,
      variants: [{ vid: 'VID-2', quantity: 3 }],
    },
  });

  const result = await reader.readAndReconcile({
    supplierOrderId: 'CJ-2',
    supplierUnitRef: 'VID-2',
    expectedQuantity: 3,
  });

  expect(result).toMatchObject({
    scope: 'FULFILLMENT',
    verdict: 'MATCHED',
    observed: {
      quantity: 3,
      provider_status: 'SHIPPED',
      carrier: 'Carrier X',
      tracking_number: 'TRACK-2',
      tracking_url: 'https://tracking.example/TRACK-2',
      pending: false,
    },
  });
});

test('CJ SHIPPED avec quantité différente reste MISMATCH', async () => {
  mockReadOrderDetail.mockResolvedValue({
    request_id: 'REQ-3',
    facts: {
      order_id: 'CJ-3',
      status: 'SHIPPED',
      logistic_name: 'CJPacket',
      variants: [{ vid: 'VID-3', quantity: 1 }],
    },
  });

  const result = await reader.readAndReconcile({
    supplierOrderId: 'CJ-3',
    supplierUnitRef: 'VID-3',
    expectedQuantity: 2,
  });

  expect(result).toMatchObject({
    verdict: 'MISMATCH',
    reason: 'FULFILLMENT_QUANTITY_MISMATCH',
    observed: { quantity: 1, provider_status: 'SHIPPED', pending: false },
  });
});

test('CJ order/payment states ne sont jamais promus en fulfillment terminé', () => {
  for (const status of ['CREATED', 'IN_CART', 'UNPAID', 'PENDING', 'PROCESSING', 'UNSHIPPED', 'CANCELLED']) {
    const mapped = reader.mapOrderFactsToFulfillment({
      supplierOrderId: 'CJ-X',
      supplierUnitRef: 'VID-X',
      facts: {
        order_id: 'CJ-X',
        status,
        variants: [{ vid: 'VID-X', quantity: 1 }],
      },
    });
    expect(mapped.observed.pending).toBe(true);
  }

  for (const status of ['SHIPPED', 'DELIVERED']) {
    const mapped = reader.mapOrderFactsToFulfillment({
      supplierOrderId: 'CJ-X',
      supplierUnitRef: 'VID-X',
      facts: {
        order_id: 'CJ-X',
        status,
        variants: [{ vid: 'VID-X', quantity: 1 }],
      },
    });
    expect(mapped.observed.pending).toBe(false);
  }
});
