'use strict';

const preflight = require('../../services/suppliers/aliexpress-purchase-preflight');

function contract(overrides = {}) {
  return {
    schema_version: '2',
    supplier_name: 'AliExpress',
    supplier_product_id: '10000012345',
    product_name: 'Produit test',
    currency: 'USD',
    sellable_units: [{
      supplier_sku: 'AE-SKU-RED-M',
      option_values: { p_14: 'Red', p_5: 'M' },
      stock_available: 8,
      purchase_price: 3.21,
      currency: 'USD',
      is_active: true,
    }],
    raw_payload: {
      aliexpress: {
        detail: {
          result: {
            ae_item_sku_info_dtos: {
              ae_item_sku_info_d_t_o: [{
                id: '20000098765',
                sku_code: 'AE-SKU-RED-M',
                sku_available_stock: 8,
                offer_sale_price: 3.21,
                ae_sku_property_dtos: {
                  ae_sku_property_d_t_o: [
                    { sku_property_id: '14', sku_property_value: '10', sku_property_name: 'Color' },
                    { sku_property_id: '5', sku_property_value: '361386', sku_property_name: 'Size' },
                  ],
                },
              }],
            },
          },
        },
      },
    },
    ...overrides,
  };
}

describe('AliExpress purchase preflight', () => {
  test('résout le SKU V2 vers l’identité de commande AliExpress exacte', () => {
    const resolved = preflight.resolveOrderableUnit(contract(), 'AE-SKU-RED-M', 2);
    expect(resolved).toEqual(expect.objectContaining({
      supplier_product_id: '10000012345',
      supplier_sku: 'AE-SKU-RED-M',
      raw_sku_id: '20000098765',
      sku_attr: '14:10;5:361386',
      quantity: 2,
      stock_available: 8,
      unit_price: 3.21,
      currency: 'USD',
    }));
  });

  test('construit le freight DTO sans conversion monétaire silencieuse', () => {
    const resolved = preflight.resolveOrderableUnit(contract(), 'AE-SKU-RED-M', 1);
    const params = preflight.buildFreightBusinessParams(resolved, { country_code: 'KM' });
    const dto = JSON.parse(params.param_aeop_freight_calculate_for_buyer_d_t_o);
    expect(dto).toEqual({
      product_id: 10000012345,
      product_num: 1,
      country_code: 'KM',
      price: '3.21',
      price_currency: 'USD',
      sku_id: '20000098765',
    });
  });

  test('prépare le payload place-order officiel sans l’exécuter', () => {
    const resolved = preflight.resolveOrderableUnit(contract(), 'AE-SKU-RED-M', 1);
    const params = preflight.buildPlaceOrderBusinessParams(resolved, {
      address: 'Hub staging',
      city: 'Dubai',
      country: 'AE',
      full_name: 'Komerce Staging',
    }, { logistics_service_name: 'TEST-LINE' });
    const dto = JSON.parse(params.param_place_order_request4_open_api_d_t_o);
    expect(dto.logistics_address.country).toBe('AE');
    expect(dto.product_items).toEqual([{
      product_count: 1,
      product_id: 10000012345,
      sku_attr: '14:10;5:361386',
      logistics_service_name: 'TEST-LINE',
    }]);
  });

  test('fail-closed si le stock exact du SKU est inconnu', () => {
    const c = contract();
    c.sellable_units[0].stock_available = null;
    expect(() => preflight.resolveOrderableUnit(c, 'AE-SKU-RED-M', 1)).toThrow(/stock fournisseur inconnu/i);
  });

  test('fail-closed si V2 et payload fournisseur ne se réconcilient pas', () => {
    const c = contract();
    c.raw_payload.aliexpress.detail.result.ae_item_sku_info_dtos.ae_item_sku_info_d_t_o[0].sku_code = 'OTHER';
    expect(() => preflight.resolveOrderableUnit(c, 'AE-SKU-RED-M', 1)).toThrow(/introuvable dans le payload AliExpress brut/i);
  });
});
