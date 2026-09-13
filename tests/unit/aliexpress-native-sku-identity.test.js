'use strict';

const { normalizeDsProduct } = require('../../services/suppliers/connectors/aliexpress-connector');

function detailWithDualSkuIdentity() {
  return {
    result: {
      ae_item_base_info_dto: {
        product_id: '1005010358671233',
        subject: 'Golden product',
        currency_code: 'USD',
      },
      ae_item_sku_info_dtos: {
        ae_item_sku_info_d_t_o: [{
          id: '14:771#1pcs;200001036:200746126',
          sku_id: '12000052119244345',
          sku_available_stock: 205,
          offer_sale_price: '3.19',
          currency_code: 'USD',
          ae_sku_property_dtos: {
            ae_sku_property_d_t_o: [
              {
                sku_property_id: 14,
                sku_property_name: 'Color',
                sku_property_value: 'Beige',
                property_value_id: 771,
              },
              {
                sku_property_id: 200001036,
                sku_property_name: 'Length',
                sku_property_value: '1m',
                property_value_id: 200746126,
              },
            ],
          },
        }],
      },
    },
  };
}

describe('AliExpress native SKU identity', () => {
  test('préfère sku_id natif à id composite dans la Supplier Order Identity', () => {
    const product = normalizeDsProduct(detailWithDualSkuIdentity(), {});
    expect(product.sellable_units).toHaveLength(1);

    const unit = product.sellable_units[0];
    expect(unit.supplier_sku).toBe('14:771#1pcs;200001036:200746126');
    expect(unit.supplier_unit_ref).toBe('12000052119244345');
    expect(unit.supplier_order_identity).toEqual({
      provider: 'aliexpress',
      version: 1,
      payload: expect.objectContaining({
        sku_id: '12000052119244345',
      }),
    });
    expect(unit.supplier_order_identity.payload.sku_id)
      .not.toBe('14:771#1pcs;200001036:200746126');
  });
});
