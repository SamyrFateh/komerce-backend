'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockReadOrderDetail = jest.fn();

jest.mock('../../services/suppliers/aliexpress-fulfillment-adapter', () => ({
  readOrderDetail: (...args) => mockReadOrderDetail(...args),
}));

const reader = require('../../services/suppliers/aliexpress-fulfillment-reader');

beforeEach(() => {
  jest.clearAllMocks();
});

test('AliExpress WAIT_SELLER_SEND_GOODS reste PENDING même avec quantité exacte', async () => {
  mockReadOrderDetail.mockResolvedValue({
    facts: {
      order_id: '123456789',
      status: 'WAIT_SELLER_SEND_GOODS',
      child_orders: [{
        child_order_id: 'child-1',
        sku_id: '12000052119244345',
        quantity: 2,
        logistics_no: null,
        logistics_service: null,
      }],
    },
  });

  const result = await reader.readAndReconcile({
    supplierOrderId: '123456789',
    supplierUnitRef: '12000052119244345',
    expectedQuantity: 2,
  });

  expect(result).toMatchObject({
    scope: 'FULFILLMENT',
    provider: 'aliexpress',
    verdict: 'PENDING',
    reason: 'FULFILLMENT_PROVIDER_PENDING',
    observed: {
      supplier_order_id: '123456789',
      supplier_unit_ref: '12000052119244345',
      quantity: 2,
      provider_status: 'WAIT_SELLER_SEND_GOODS',
      pending: true,
    },
  });
});

test('AliExpress WAIT_BUYER_ACCEPT_GOODS + quantité exacte devient MATCHED', async () => {
  mockReadOrderDetail.mockResolvedValue({
    facts: {
      order_id: '123456789',
      status: 'WAIT_BUYER_ACCEPT_GOODS',
      logistics_no: 'AE-TRACK-1',
      logistics_service: 'CAINIAO_STANDARD',
      child_orders: [{
        child_order_id: 'child-1',
        sku_id: '12000052119244345',
        quantity: 2,
        logistics_no: null,
        logistics_service: null,
      }],
    },
  });

  const result = await reader.readAndReconcile({
    supplierOrderId: '123456789',
    supplierUnitRef: '12000052119244345',
    expectedQuantity: 2,
  });

  expect(result).toMatchObject({
    scope: 'FULFILLMENT',
    verdict: 'MATCHED',
    observed: {
      quantity: 2,
      provider_status: 'WAIT_BUYER_ACCEPT_GOODS',
      carrier: 'CAINIAO_STANDARD',
      tracking_number: 'AE-TRACK-1',
      pending: false,
    },
  });
});

test('AliExpress statut terminé avec quantité différente reste MISMATCH', async () => {
  mockReadOrderDetail.mockResolvedValue({
    facts: {
      order_id: '123456789',
      status: 'FINISH',
      child_orders: [{
        sku_id: '12000052119244345',
        quantity: 1,
      }],
    },
  });

  const result = await reader.readAndReconcile({
    supplierOrderId: '123456789',
    supplierUnitRef: '12000052119244345',
    expectedQuantity: 2,
  });

  expect(result).toMatchObject({
    verdict: 'MISMATCH',
    reason: 'FULFILLMENT_QUANTITY_MISMATCH',
    observed: { quantity: 1, provider_status: 'FINISH', pending: false },
  });
});

test('AliExpress agrège uniquement les child orders de l unité exacte', () => {
  const mapped = reader.mapOrderFactsToFulfillment({
    supplierOrderId: '123456789',
    supplierUnitRef: 'SKU-A',
    facts: {
      order_id: '123456789',
      status: 'WAIT_BUYER_ACCEPT_GOODS',
      child_orders: [
        { sku_id: 'SKU-A', quantity: 1, logistics_no: 'T-A', logistics_service: 'S-A' },
        { sku_id: 'SKU-A', quantity: 2 },
        { sku_id: 'SKU-B', quantity: 9, logistics_no: 'T-B', logistics_service: 'S-B' },
      ],
    },
  });

  expect(mapped).toMatchObject({
    observed: {
      quantity: 3,
      carrier: 'S-A',
      tracking_number: 'T-A',
      pending: false,
    },
    evidence: {
      proof_source: 'aliexpress_trade_ds_order_get',
      proof_ref: '123456789',
      child_order_count: 2,
    },
  });
});
