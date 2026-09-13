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
});
