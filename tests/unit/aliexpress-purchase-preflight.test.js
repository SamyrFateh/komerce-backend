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
      supplier_unit_ref: '20000098765',
      supplier_order_identity: {
        provider: 'aliexpress',
        version: 1,
        payload: {
          sku_id: '20000098765',
          sku_attr: '14:10;5:361386',
        },
      },
      option_values: { p_14: 'Red', p_5: 'M' },
      stock_available: 8,
      purchase_price: 3.21,
      currency: 'USD',
      is_active: true,
    }],
    ...overrides,
  };
}

describe('AliExpress purchase preflight', () => {
  test('résout le SKU V2 depuis la Supplier Order Identity sans raw_payload', () => {
    const resolved = preflight.resolveOrderableUnit(contract(), 'AE-SKU-RED-M', 2);
    expect(resolved).toEqual(expect.objectContaining({
      supplier_product_id: '10000012345',
      supplier_sku: 'AE-SKU-RED-M',
      supplier_unit_ref: '20000098765',
      raw_sku_id: '20000098765',
      sku_attr: '14:10;5:361386',
      quantity: 2,
      stock_available: 8,
      unit_price: 3.21,
      currency: 'USD',
    }));
  });

  test('utilise le endpoint Dropshipper freight.get et son paramètre canonique', () => {
    expect(preflight.METHODS.FREIGHT).toBe('aliexpress.logistics.buyer.freight.get');
    const resolved = preflight.resolveOrderableUnit(contract(), 'AE-SKU-RED-M', 1);
    const params = preflight.buildFreightBusinessParams(resolved, {
      country_code: 'KM',
      send_goods_country_code: 'CN',
    });
    expect(Object.keys(params)).toEqual(['aeopFreightCalculateForBuyerDTO']);
    const dto = JSON.parse(params.aeopFreightCalculateForBuyerDTO);
    expect(dto).toEqual({
      product_id: 10000012345,
      product_num: 1,
      sku_id: '20000098765',
      country_code: 'KM',
      price: '3.21',
      price_currency: 'USD',
      send_goods_country_code: 'CN',
    });
  });

  test('une identité sku_attr-only reste valide pour place-order mais bloque freight.get sans inventer sku_id', () => {
    const c = contract();
    c.sellable_units[0].supplier_unit_ref = '14:Field Green';
    delete c.sellable_units[0].supplier_order_identity.payload.sku_id;
    c.sellable_units[0].supplier_order_identity.payload.sku_attr = '14:Field Green';

    const resolved = preflight.resolveOrderableUnit(c, 'AE-SKU-RED-M', 1);
    expect(resolved.raw_sku_id).toBeNull();
    expect(resolved.sku_attr).toBe('14:Field Green');
    expect(() => preflight.buildFreightBusinessParams(resolved, {
      country_code: 'KM',
      send_goods_country_code: 'CN',
    })).toThrow(/BLOCKED_SUPPLIER_IDENTITY.*sku_id natif AliExpress requis/i);

    const placeOrder = preflight.buildPlaceOrderBusinessParams(resolved, {
      address: 'Hub staging',
      city: 'Dubai',
      country: 'AE',
      full_name: 'Komerce Staging',
    });
    const placeOrderDto = JSON.parse(placeOrder.param_place_order_request4_open_api_d_t_o);
    expect(placeOrderDto.product_items[0].sku_attr).toBe('14:Field Green');
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
    expect(() => preflight.resolveOrderableUnit(c, 'AE-SKU-RED-M', 1))
      .toThrow(/stock fournisseur inconnu/i);
  });

  test('fail-closed par défaut si l’identité commandable manque', () => {
    const c = contract();
    delete c.sellable_units[0].supplier_order_identity;
    delete c.sellable_units[0].supplier_unit_ref;
    expect(() => preflight.resolveOrderableUnit(c, 'AE-SKU-RED-M', 1))
      .toThrow(/BLOCKED_SUPPLIER_IDENTITY.*supplier_order_identity requis/i);
  });

  test('un snapshot historique peut être identifié explicitement pour refresh mais ne peut pas construire du fret', () => {
    const c = contract();
    delete c.sellable_units[0].supplier_order_identity;
    delete c.sellable_units[0].supplier_unit_ref;
    const legacy = preflight.resolveOrderableUnit(c, 'AE-SKU-RED-M', 1, { requireOrderIdentity: false });
    expect(legacy.supplier_order_identity).toBeNull();
    expect(() => preflight.buildFreightBusinessParams(legacy, { country_code: 'KM' }))
      .toThrow(/BLOCKED_SUPPLIER_IDENTITY/i);
  });

  test('refuse une identité d’un autre fournisseur', () => {
    const c = contract();
    c.sellable_units[0].supplier_order_identity.provider = 'cj';
    expect(() => preflight.resolveOrderableUnit(c, 'AE-SKU-RED-M', 1))
      .toThrow(/BLOCKED_SUPPLIER_IDENTITY.*incompatible avec AliExpress/i);
  });
});
