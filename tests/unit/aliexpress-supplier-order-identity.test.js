'use strict';

const { normalizeDsProduct } = require('../../services/suppliers/connectors/aliexpress-connector');
const { validateNormalizedProduct } = require('../../services/suppliers/normalized-product');

describe('AliExpress Supplier Order Identity', () => {
  test('projette sku_id + sku_attr dans le contrat V2, pas seulement dans raw_payload', () => {
    const product = normalizeDsProduct({
      result: {
        ae_item_base_info_dto: {
          product_id: '10000012345',
          subject: 'Produit identité',
          currency_code: 'USD',
        },
        ae_item_sku_info_dtos: {
          ae_item_sku_info_d_t_o: [{
            id: '20000098765',
            sku_code: 'AE-RED-M',
            sku_available_stock: 7,
            offer_sale_price: '4.20',
            currency_code: 'USD',
            ae_sku_property_dtos: {
              ae_sku_property_d_t_o: [
                { sku_property_id: '14', sku_property_value: '10', property_value_definition_name: 'Red', sku_property_name: 'Color' },
                { sku_property_id: '5', sku_property_value: '361386', property_value_definition_name: 'M', sku_property_name: 'Size' },
              ],
            },
          }],
        },
      },
    }, {});

    expect(validateNormalizedProduct(product)).toEqual({ valid: true, errors: [] });
    expect(product.sellable_units[0]).toEqual(expect.objectContaining({
      supplier_sku: 'AE-RED-M',
      supplier_unit_ref: '20000098765',
      supplier_order_identity: {
        provider: 'aliexpress',
        version: 1,
        payload: {
          sku_id: '20000098765',
          sku_attr: '14:10;5:361386',
        },
      },
    }));
  });
});
