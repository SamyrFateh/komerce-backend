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

const proof = require('../../scripts/cj-p2-confirm-pay-sandbox-proof');
const contract = require('../../services/suppliers/cj-purchasing-contract');

function env(extra = {}) {
  return {
    DATABASE_URL: 'postgres://ephemeral',
    NODE_ENV: 'test',
    KOMERCE_ENV: 'staging',
    KOMERCE_ALLOW_CJ_P2_CONFIRM_PAY: '1',
    KOMERCE_CJ_SANDBOX: '1',
    ...extra,
  };
}

test('P2 refuse production', () => {
  expect(() => proof.guard(env({ KOMERCE_ENV: 'production' })))
    .toThrow('CJ P2 confirm/pay interdit en production');
});

test('P2 exige une autorisation dédiée et sandbox explicite', () => {
  const noAllow = env();
  delete noAllow.KOMERCE_ALLOW_CJ_P2_CONFIRM_PAY;
  expect(() => proof.guard(noAllow)).toThrow('KOMERCE_ALLOW_CJ_P2_CONFIRM_PAY=1 requis');
  expect(() => proof.guard(env({ KOMERCE_CJ_SANDBOX: '0' })))
    .toThrow('KOMERCE_CJ_SANDBOX=1 requis');
});

test('contrat confirmOrder exige et vérifie le même orderId', () => {
  expect(contract.buildConfirmOrderPayload('CJ-1')).toEqual({ orderId: 'CJ-1' });
  expect(contract.parseConfirmOrderResponse({
    result: true,
    data: 'CJ-1',
    requestId: 'REQ-1',
  }, 'CJ-1')).toMatchObject({
    order_id: 'CJ-1',
    confirmation_verdict: 'confirmed_unpaid',
  });
  expect(() => contract.parseConfirmOrderResponse({
    result: true,
    data: 'CJ-OTHER',
  }, 'CJ-1')).toThrow('CJ_CONFIRM_ORDER_ID_MISMATCH');
});

test('contrat payBalanceV2 utilise shipmentOrderId sans payId obligatoire', () => {
  expect(contract.buildPayBalanceV2Payload('SHIP-1')).toEqual({
    shipmentOrderId: 'SHIP-1',
  });
  expect(contract.parsePayBalanceV2Response({
    result: true,
    data: null,
    requestId: 'REQ-2',
  })).toMatchObject({
    payment_verdict: 'paid',
  });
});

test('read-back payé accepte uniquement les états post-paiement connus', () => {
  expect(contract.verifyPaidOrderDetail({
    data: { orderId: 'CJ-1', orderStatus: 'PENDING', productList: [] },
  }, 'CJ-1')).toMatchObject({ status: 'PENDING' });

  expect(() => contract.verifyPaidOrderDetail({
    data: { orderId: 'CJ-1', orderStatus: 'UNPAID', productList: [] },
  }, 'CJ-1')).toThrow('CJ_PAID_STATUS_UNEXPECTED:UNPAID');
});


test('P2 accepte shipmentOrderId issu du read-back si absent du create', () => {
  const facts = contract.readOrderDetailFacts({
    data: {
      orderId: 'CJ-1',
      shipmentOrderId: 'SHIP-RB-1',
      orderStatus: 'CREATED',
      productList: [],
    },
  });
  expect(facts.shipment_order_id).toBe('SHIP-RB-1');
  expect(contract.buildPayBalanceV2Payload(facts.shipment_order_id)).toEqual({
    shipmentOrderId: 'SHIP-RB-1',
  });
});


test('P2 sandbox paie un ordre direct par orderId sans parent shipmentOrderId', () => {
  expect(contract.buildSandboxSimulatePayPayload('CJ-ORDER-1')).toEqual({
    orderId: 'CJ-ORDER-1',
  });
  expect(contract.parseSandboxSimulatePayResponse({
    result: true,
    data: true,
    requestId: 'REQ-SIM',
  })).toMatchObject({
    sandbox: true,
    payment_verdict: 'simulated_paid',
  });
});

test('P2 sandbox refuse une simulation provider non confirmée', () => {
  expect(() => contract.parseSandboxSimulatePayResponse({
    result: true,
    data: false,
  })).toThrow('CJ_SANDBOX_SIMULATE_PAY_REJECTED');
});


test('P2 résout une logistique réellement retournée par CJ', async () => {
  const call = jest.fn(async (path) => {
    expect(path).toBe('/logistic/freightCalculate');
    return {
      result: true,
      data: [
        { logisticName: 'CJPacket Ordinary' },
        { logisticName: 'CJPacket Sensitive' },
      ],
    };
  });
  await expect(proof.resolveLogistic({
    call,
    accessToken: 'token',
    vid: 'VID-1',
    fromCountryCode: 'CN',
    destination: { country_code: 'US' },
    preferred: 'CJPacket Sensitive',
  })).resolves.toBe('CJPacket Sensitive');

  expect(call).toHaveBeenCalledWith('/logistic/freightCalculate', expect.objectContaining({
    method: 'POST',
    body: {
      startCountryCode: 'CN',
      endCountryCode: 'US',
      products: [{ quantity: 1, vid: 'VID-1' }],
    },
    accessToken: 'token',
  }));
});

test('P2 retombe sur la première route CJ si la préférence est indisponible', async () => {
  const call = jest.fn(async () => ({
    result: true,
    data: [{ logisticName: 'CJPacket Ordinary' }],
  }));
  await expect(proof.resolveLogistic({
    call,
    accessToken: 'token',
    vid: 'VID-1',
    fromCountryCode: 'CN',
    destination: { country_code: 'US' },
    preferred: 'CJPacket',
  })).resolves.toBe('CJPacket Ordinary');
});


test('P2 expose un intervalle de sécurité supérieur à 1 seconde entre appels CJ', () => {
  expect(proof.CJ_MIN_CALL_GAP_MS).toBeGreaterThan(1000);
});
