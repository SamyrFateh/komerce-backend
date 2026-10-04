'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../../services/suppliers/connectors/cj-connector', () => ({
  BASE_URL: 'https://developers.cjdropshipping.com/api2.0/v1',
  getAccessToken: jest.fn(async () => 'token'),
}));

const proof = require('../../scripts/cj-p2-grouped-parent-sandbox-proof');
const contract = require('../../services/suppliers/cj-purchasing-contract');

function env(extra = {}) {
  return {
    DATABASE_URL: 'postgres://ephemeral',
    NODE_ENV: 'test',
    KOMERCE_ENV: 'staging',
    KOMERCE_ALLOW_CJ_P2_GROUPED_PARENT: '1',
    KOMERCE_CJ_SANDBOX: '1',
    ...extra,
  };
}

test('grouped proof refuse production et exige le sandbox', () => {
  expect(() => proof.guard(env({ KOMERCE_ENV: 'production' })))
    .toThrow('CJ grouped parent proof interdit en production');
  expect(() => proof.guard(env({ KOMERCE_CJ_SANDBOX: '0' })))
    .toThrow('KOMERCE_CJ_SANDBOX=1 requis');
});

test('shipmentOrderId est résolu depuis create puis read-back', () => {
  expect(proof.resolveShipmentOrderId(
    { shipment_order_id: 'SHIP-CREATE' },
    { shipment_order_id: 'SHIP-RB' }
  )).toBe('SHIP-CREATE');
  expect(proof.resolveShipmentOrderId(
    { shipment_order_id: null },
    { shipment_order_id: 'SHIP-RB' }
  )).toBe('SHIP-RB');
  expect(() => proof.resolveShipmentOrderId({}, {}))
    .toThrow('CJ_P2_GROUPED_SHIPMENT_ORDER_ID_MISSING');
});

test('sandbox simulatePay parent utilise shipmentOrderId, jamais orderId', () => {
  expect(contract.buildSandboxSimulatePayParentPayload('SHIP-1')).toEqual({
    shipmentOrderId: 'SHIP-1',
  });
});

test('grouped proof demande une route commune pour les deux VIDs', async () => {
  const call = jest.fn(async () => ({
    result: true,
    data: [{ logisticName: 'CJPacket Ordinary' }],
  }));
  await expect(proof.resolveLogistic({
    call,
    accessToken: 'token',
    vids: ['VID-1', 'VID-2'],
    fromCountryCode: 'CN',
    destination: { country_code: 'US' },
  })).resolves.toBe('CJPacket Ordinary');
  expect(call).toHaveBeenCalledWith(
    contract.ENDPOINTS.freight_calculate,
    expect.objectContaining({
      body: {
        startCountryCode: 'CN',
        endCountryCode: 'US',
        products: [
          { quantity: 1, vid: 'VID-1' },
          { quantity: 1, vid: 'VID-2' },
        ],
      },
    })
  );
});

test('grouped proof respecte plus de 1 seconde entre appels CJ', () => {
  expect(proof.CJ_MIN_CALL_GAP_MS).toBeGreaterThan(1000);
});
