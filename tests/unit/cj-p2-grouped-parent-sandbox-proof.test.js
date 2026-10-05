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


test('cart payload utilise les CJ order codes des sous-ordres', () => {
  expect(contract.buildCartPayload(['SD-1', 'SD-2'])).toEqual({
    cjOrderIdList: ['SD-1', 'SD-2'],
  });
});

test('addCartConfirm fournit le vrai shipmentOrderId parent', () => {
  expect(contract.parseAddCartConfirmResponse({
    success: true,
    data: {
      successCount: 2,
      submitSuccess: true,
      shipmentsId: 'SHIP-PARENT-1',
    },
  })).toMatchObject({
    shipment_order_id: 'SHIP-PARENT-1',
    success_count: 2,
  });
});

test('saveGenerateParentOrder conserve parent et payId', () => {
  expect(contract.parseSaveGenerateParentOrderResponse({
    success: true,
    data: {
      submitSuccess: true,
      payId: 'PAY-1',
      orderMoney: 42.5,
    },
  }, 'SHIP-PARENT-1')).toMatchObject({
    shipment_order_id: 'SHIP-PARENT-1',
    pay_id: 'PAY-1',
    order_money: 42.5,
  });
});


test('addCartConfirm rejeté conserve le payload provider pour diagnostic', () => {
  const body = {
    success: true,
    code: 200,
    data: { successCount: 2, submitSuccess: false, shipmentsId: '', result: 1 },
  };
  try {
    contract.parseAddCartConfirmResponse(body);
    throw new Error('expected rejection');
  } catch (error) {
    expect(error.message).toBe('CJ_SHIPMENT_ORDER_ID_MISSING');
    expect(error.payload).toBe(body);
  }
});


test('addCartConfirm ambigu mais matérialisé conserve shipmentOrderId sans prétendre succès final', () => {
  expect(contract.parseAddCartConfirmResponse({
    success: true,
    code: 200,
    data: {
      successCount: 2,
      submitSuccess: false,
      shipmentsId: 'CJ26100457942791057581',
      result: 0,
      interceptOrders: [],
    },
  })).toMatchObject({
    shipment_order_id: 'CJ26100457942791057581',
    success_count: 2,
    submit_success: false,
    result: 0,
    intercept_orders: [],
  });
});


test('saveGenerateParentOrder matérialisé accepte payId même si submitSuccess=false', () => {
  expect(contract.parseSaveGenerateParentOrderResponse({
    success: true,
    code: 200,
    data: {
      orderMoney: 62.07,
      payId: 'P2106837253178396672',
      result: 0,
      submitSuccess: false,
      unMatchOrderCodes: [],
      unMatchProductCodes: [],
      interceptOrders: [],
      paymentInformation: {
        actualPayment: 62.07,
        payableAmount: 0,
      },
    },
  }, 'SHIP-1')).toMatchObject({
    shipment_order_id: 'SHIP-1',
    pay_id: 'P2106837253178396672',
    order_money: 62.07,
    submit_success: false,
    result: 0,
  });
});

test('saveGenerateParentOrder reste fail-closed sans payId ou avec mismatch/intercept', () => {
  expect(() => contract.parseSaveGenerateParentOrderResponse({
    success: true,
    data: {
      payId: '',
      submitSuccess: false,
      unMatchOrderCodes: [],
      unMatchProductCodes: [],
      interceptOrders: [],
    },
  }, 'SHIP-1')).toThrow('CJ_SAVE_PARENT_ORDER_REJECTED');

  expect(() => contract.parseSaveGenerateParentOrderResponse({
    success: true,
    data: {
      payId: 'PAY-1',
      submitSuccess: false,
      unMatchOrderCodes: ['SD-X'],
      unMatchProductCodes: [],
      interceptOrders: [],
    },
  }, 'SHIP-1')).toThrow('CJ_SAVE_PARENT_ORDER_REJECTED');
});


test('reconcileSandboxParentAmount valide les montants provider avant simulatePay', () => {
  const contract = require('../../services/suppliers/cj-purchasing-contract');
  expect(contract.reconcileSandboxParentAmount({
    order_money: 62.07,
    payment_information: {
      actualPayment: 62.07,
      orderOriginalAmount: 62.07,
    },
  })).toEqual({
    expected_amount: 62.07,
    provider_actual_payment: 62.07,
    provider_order_original_amount: 62.07,
    currency: null,
    amount_verdict: 'provider_amounts_match',
    real_debit_verified: false,
  });
});

test('reconcileSandboxParentAmount refuse tout mismatch provider', () => {
  const contract = require('../../services/suppliers/cj-purchasing-contract');
  expect(() => contract.reconcileSandboxParentAmount({
    order_money: 62.07,
    payment_information: {
      actualPayment: 61.00,
      orderOriginalAmount: 62.07,
    },
  })).toThrow('CJ_SANDBOX_PAYMENT_AMOUNT_MISMATCH');
});


test('grouped sandbox peut exercer payBalanceV2 sur un parent 100% sandbox sans charge réelle', async () => {
  const contract = require('../../services/suppliers/cj-purchasing-contract');
  expect(contract.buildPayBalanceV2Payload('SHIP-1', 'PAY-1')).toEqual({
    shipmentOrderId: 'SHIP-1',
    payId: 'PAY-1',
  });
  expect(contract.parsePayBalanceV2Response({
    result: true,
    data: true,
    requestId: 'REQ-PAY',
  })).toMatchObject({
    payment_verdict: 'paid',
    request_id: 'REQ-PAY',
  });
});

test('mode grouped payment inconnu reste fail-closed', async () => {
  const env = {
    DATABASE_URL: 'postgres://ephemeral',
    NODE_ENV: 'test',
    KOMERCE_ENV: 'staging',
    KOMERCE_ALLOW_CJ_P2_GROUPED_PARENT: '1',
    KOMERCE_CJ_SANDBOX: '1',
    KOMERCE_CJ_P2_GROUPED_PAYMENT_MODE: 'something-else',
  };
  const proof = require('../../scripts/cj-p2-grouped-parent-sandbox-proof');
  const skus = [
    { product_sku_id:'sku-1', supplier_order_identity:{ provider:'cj', version:1, payload:{ pid:'p1', vid:'v1', variant_sku:'s1' } } },
    { product_sku_id:'sku-2', supplier_order_identity:{ provider:'cj', version:1, payload:{ pid:'p2', vid:'v2', variant_sku:'s2' } } },
  ];
  const invoke = jest.fn()
    .mockResolvedValueOnce({ data:[{ logisticName:'Route' }] })
    .mockResolvedValueOnce({ result:true, data:{ orderId:'O1', orderNumber:'K-1' } })
    .mockResolvedValueOnce({ data:{ orderId:'O1', cjOrderCode:'C1', orderStatus:'CREATED', productList:[{ vid:'v1', quantity:1 }] } })
    .mockResolvedValueOnce({ result:true, data:{ orderId:'O2', orderNumber:'K-2' } })
    .mockResolvedValueOnce({ data:{ orderId:'O2', cjOrderCode:'C2', orderStatus:'CREATED', productList:[{ vid:'v2', quantity:1 }] } })
    .mockResolvedValueOnce({ success:true, data:{ successCount:2 } })
    .mockResolvedValueOnce({ success:true, data:{ shipmentsId:'SHIP-1', successCount:2, interceptOrders:[], result:0, submitSuccess:true } })
    .mockResolvedValueOnce({ success:true, data:{ payId:'PAY-1', orderMoney:10, paymentInformation:{ actualPayment:10, orderOriginalAmount:10 }, interceptOrders:[], unMatchOrderCodes:[], unMatchProductCodes:[], submitSuccess:true } });

  await expect(proof.run(env, {
    selectTwoExactSkus: async () => skus,
    invoke,
    sleep: async () => {},
  })).rejects.toThrow('CJ_P2_GROUPED_PAYMENT_MODE_UNSUPPORTED');
});
