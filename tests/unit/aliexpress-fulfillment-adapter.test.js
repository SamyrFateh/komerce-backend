'use strict';

const adapter = require('../../services/suppliers/aliexpress-fulfillment-adapter');
const { VERDICT, result } = require('../../services/suppliers/supplier-fulfillment-readiness');

function db() {
  return {
    query: jest.fn(async () => ({ rows: [{ supplier_product_id: '1005010358671233' }] })),
  };
}

function baseArgs(context = {}) {
  return {
    db: db(),
    row: {
      id: 'sku-komerce-1',
      product_id: 'product-komerce-1',
      supplier_sku: '14:771#1pcs;200001036:200746126',
      supplier_unit_ref: '12000052119244345',
    },
    identity: {
      provider: 'aliexpress',
      version: 1,
      payload: { sku_id: '12000052119244345', sku_attr: '14:Beige;200001036:1m' },
    },
    quantity: 1,
    destination: { country_code: 'AE' },
    procurementRoute: {
      mode: 'PROCUREMENT_HUB',
      hub: { code: 'DXB', country_code: 'AE' },
    },
    context,
    VERDICT,
    result,
  };
}

function liveProduct() {
  return {
    raw_payload: {
      aliexpress: {
        detail: {
          ae_store_info: { store_country_code: 'CN' },
        },
      },
    },
  };
}

describe('AliExpress fulfillment adapter', () => {
  test('garde sku_id/freight.get à la frontière provider et renvoie un verdict canonique', async () => {
    const buildFreightQuoteParams = jest.fn(() => ({
      country_code: 'AE',
      send_goods_country_code: 'CN',
      product_id: 1005010358671233,
      product_num: 1,
      sku_id: '12000052119244345',
    }));
    const invokeTop = jest.fn(async () => ({
      result: {
        success: true,
        aeop_freight_calculate_result_for_buyer_dtolist: {
          aeop_freight_calculate_result_for_buyer_d_t_o: [{
            service_name: 'CAINIAO_FULFILLMENT_STD',
          }],
        },
      },
    }));

    const out = await adapter.evaluate(baseArgs({
      aliexpressConnected: {
        fetchProducts: jest.fn(async () => ({ products: [liveProduct()] })),
        invokeTop,
      },
      aliexpressPreflight: {
        METHODS: { FREIGHT: 'aliexpress.logistics.buyer.freight.get' },
        resolveOrderableUnit: jest.fn(() => ({
          supplier_sku: '14:771#1pcs;200001036:200746126',
          raw_sku_id: '12000052119244345',
          stock_available: 205,
          unit_price: 3.19,
          currency: 'USD',
        })),
        buildFreightQuoteParams,
        summarizeFreightResponse: jest.fn(() => ({ success: true, has_options: true, error: null })),
        classifyApiError: jest.fn(() => 'other'),
      },
    }));

    expect(out.status).toBe('FULFILLMENT_READY');
    expect(out.ready).toBe(true);
    expect(out.evidence.provider).toBe('aliexpress');
    expect(out.evidence.supplier_origin_country_code).toBe('CN');
    expect(out.evidence.exact_unit_resolved).toBe(true);
    expect(out.evidence.auto_order_ready).toBe(false);
    expect(out.evidence.execution_mode).toBe('manual');
    expect(out.evidence.place_order_invoked).toBe(false);
    expect(out.evidence.payment_invoked).toBe(false);
    expect(buildFreightQuoteParams).toHaveBeenCalledWith(
      expect.objectContaining({ raw_sku_id: '12000052119244345' }),
      expect.objectContaining({ country_code: 'AE', send_goods_country_code: 'CN' })
    );
    expect(invokeTop).toHaveBeenCalledWith(
      'aliexpress.logistics.buyer.freight.get',
      expect.objectContaining({ sku_id: '12000052119244345' }),
      expect.any(Object)
    );
  });

  test('n annonce auto_order_ready que sous autorisation explicite', async () => {
    const out = await adapter.evaluate(baseArgs({
      env: { KOMERCE_ALIEXPRESS_AUTO_ORDER_ENABLED: '1' },
      aliexpressConnected: {
        fetchProducts: jest.fn(async () => ({ products: [liveProduct()] })),
        invokeTop: jest.fn(async () => ({
          result: {
            success: true,
            aeop_freight_calculate_result_for_buyer_dtolist: {
              aeop_freight_calculate_result_for_buyer_d_t_o: [{ service_name: 'CAINIAO_FULFILLMENT_STD' }],
            },
          },
        })),
      },
      aliexpressPreflight: {
        METHODS: { FREIGHT: 'aliexpress.logistics.buyer.freight.get' },
        resolveOrderableUnit: jest.fn(() => ({
          supplier_sku: '14:771#1pcs;200001036:200746126',
          raw_sku_id: '12000052119244345',
          stock_available: 205,
          unit_price: 3.19,
          currency: 'USD',
        })),
        buildFreightQuoteParams: jest.fn(() => ({
          country_code: 'AE',
          send_goods_country_code: 'CN',
          product_id: 1005010358671233,
          product_num: 1,
          sku_id: '12000052119244345',
        })),
        summarizeFreightResponse: jest.fn(() => ({ success: true, has_options: true, error: null })),
        classifyApiError: jest.fn(() => 'other'),
      },
    }));

    expect(out.ready).toBe(true);
    expect(out.evidence.auto_order_ready).toBe(true);
    expect(out.evidence.execution_mode).toBe('api');
    expect(out.evidence.place_order_invoked).toBe(false);
    expect(out.evidence.payment_invoked).toBe(false);
  });

  test('ne fabrique jamais une origine fournisseur absente', async () => {
    const out = await adapter.evaluate(baseArgs({
      env: {},
      aliexpressConnected: {
        fetchProducts: jest.fn(async () => ({ products: [{ raw_payload: { aliexpress: { detail: {} } } }] })),
      },
      aliexpressPreflight: {
        resolveOrderableUnit: jest.fn(() => ({
          raw_sku_id: '12000052119244345',
          stock_available: 205,
          unit_price: 3.19,
          currency: 'USD',
        })),
        classifyApiError: jest.fn(() => 'other'),
      },
    }));

    expect(out.status).toBe('FREIGHT_UNAVAILABLE');
    expect(out.ready).toBe(false);
    expect(out.reason).toMatch(/origine d’expédition fournisseur non résolue/i);
  });

  test('construit un placeOrder natif depuis les items canoniques et le preflight prouvé', async () => {
    const payload = await adapter.buildOrderPayload({
      items: [{
        identity: {
          provider: 'aliexpress',
          version: 1,
          payload: { product_id: '1005010358671233', sku_id: '12000052119244345', sku_attr: '14:Beige;200001036:1m' },
        },
        supplier_unit_ref: '12000052119244345',
        quantity: 2,
      }],
      preflights: [{
        ready: true,
        evidence: {
          provider: 'aliexpress',
          auto_order_ready: true,
          supplier_product_id: '1005010358671233',
          freight: { service_name: 'CAINIAO_FULFILLMENT_STD' },
        },
      }],
      context: {
        procurement_destination: {
          address1: 'Hub Komerce',
          city: 'Dubai',
          country_code: 'AE',
          province: 'Dubai',
          postal_code: '00000',
          customer_name: 'Komerce Hub',
          phone: '+971500000000',
        },
      },
    });

    const native = JSON.parse(payload.native.param_place_order_request4_open_api_d_t_o);
    expect(native.product_items).toEqual([expect.objectContaining({
      product_count: 2,
      product_id: 1005010358671233,
      sku_attr: '14:Beige;200001036:1m',
      logistics_service_name: 'CAINIAO_FULFILLMENT_STD',
    })]);
    expect(native.logistics_address).toEqual(expect.objectContaining({
      address: 'Hub Komerce',
      city: 'Dubai',
      country: 'AE',
      province: 'Dubai',
      zip: '00000',
      contact_person: 'Komerce Hub',
      mobile_no: '500000000',
      phone_country: '+971',
    }));
  });

  test('refuse de construire une commande sans service logistique prouvé', async () => {
    await expect(adapter.buildOrderPayload({
      items: [{
        identity: {
          provider: 'aliexpress',
          version: 1,
          payload: { product_id: '1005010358671233', sku_id: '12000052119244345', sku_attr: '14:Beige' },
        },
        supplier_unit_ref: '12000052119244345',
        quantity: 1,
      }],
      preflights: [{
        ready: true,
        evidence: {
          provider: 'aliexpress',
          auto_order_ready: true,
          supplier_product_id: '1005010358671233',
          freight: { success: true, has_options: true },
        },
      }],
      context: {
        procurement_destination: {
          address1: 'Hub Komerce',
          city: 'Dubai',
          country_code: 'AE',
          province: 'Dubai',
          postal_code: '00000',
          customer_name: 'Komerce Hub',
          phone: '+971500000000',
        },
      },
    })).rejects.toThrow('ALIEXPRESS_LOGISTICS_SERVICE_REQUIRED');
  });

  test('remonte le code et le message provider quand placeOrder est refusé', () => {
    expect(() => adapter.parseCreatedOrder({
      result: {
        is_success: false,
        error_code: 'B_DROPSHIPPER_DELIVERY_ADDRESS_IS_NULL',
        error_msg: 'delivery address is null',
      },
    })).toThrow(
      'ALIEXPRESS_PLACE_ORDER_REJECTED:B_DROPSHIPPER_DELIVERY_ADDRESS_IS_NULL:delivery address is null'
    );
  });

  test('placeOrder reste fermé sans opt-in runtime', async () => {
    await expect(adapter.placeOrder({ provider: 'aliexpress', native: { x: 1 } }, { env: {} }))
      .rejects.toThrow('ALIEXPRESS_EXECUTION_NOT_AUTHORIZED');
  });

  test('placeOrder crée puis relit obligatoirement la commande sans déclencher de paiement', async () => {
    const invokeTop = jest.fn()
      .mockResolvedValueOnce({ result: { is_success: true, order_list: { number: ['123456789'] } } })
      .mockResolvedValueOnce({ result: { order_id: '123456789', order_status: 'PLACE_ORDER_SUCCESS' } });

    const out = await adapter.placeOrder(
      { provider: 'aliexpress', native: { param_place_order_request4_open_api_d_t_o: '{}' } },
      {
        env: { KOMERCE_ALIEXPRESS_AUTO_ORDER_ENABLED: '1' },
        aliexpressConnected: { invokeTop },
      }
    );

    expect(invokeTop).toHaveBeenNthCalledWith(
      1,
      'aliexpress.trade.buy.placeorder',
      expect.any(Object),
      expect.any(Object)
    );
    expect(invokeTop).toHaveBeenNthCalledWith(
      2,
      'aliexpress.trade.ds.order.get',
      { single_order_query: JSON.stringify({ order_id: '123456789' }) },
      expect.any(Object)
    );
    expect(out).toMatchObject({
      provider: 'aliexpress',
      supplier_order_id: '123456789',
      commitment_verdict: 'created_unpaid',
      payment_invoked: false,
      execution_recovery: 'CREATED_NOW_NO_NATIVE_IDEMPOTENCY',
    });
  });
});


test('readOrderDetail relit la commande AliExpress et borne les faits fulfillment natifs', async () => {
  const invokeTop = jest.fn().mockResolvedValue({
    result: {
      order_id: '123456789',
      order_status: 'WAIT_BUYER_ACCEPT_GOODS',
      logistics_no: 'TRACK-AE-1',
      logistics_service_name: 'CAINIAO_STANDARD',
      child_order_list: {
        ae_child_order_info: [{
          child_order_id: 'child-1',
          sku_id: '12000052119244345',
          product_count: 2,
        }],
      },
    },
  });

  const out = await adapter.readOrderDetail('123456789', {
    env: {},
    aliexpressConnected: { invokeTop },
  });

  expect(invokeTop).toHaveBeenCalledWith(
    'aliexpress.trade.ds.order.get',
    { single_order_query: JSON.stringify({ order_id: '123456789' }) },
    expect.any(Object)
  );
  expect(out.facts).toMatchObject({
    order_id: '123456789',
    status: 'WAIT_BUYER_ACCEPT_GOODS',
    logistics_no: 'TRACK-AE-1',
    logistics_service: 'CAINIAO_STANDARD',
    child_orders: [{
      child_order_id: 'child-1',
      sku_id: '12000052119244345',
      quantity: 2,
    }],
  });
});
