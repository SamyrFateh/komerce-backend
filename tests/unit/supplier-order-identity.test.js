'use strict';

const identity = require('../../services/suppliers/supplier-order-identity');

function contract(overrides = {}) {
  return {
    schema_version: '2',
    supplier_name: 'Supplier X',
    supplier_product_id: 'P-1',
    product_name: 'Produit',
    currency: 'USD',
    sellable_units: [{
      supplier_sku: 'SKU-1',
      supplier_unit_ref: 'UNIT-9',
      supplier_order_identity: {
        provider: 'supplier-x',
        version: 1,
        payload: { variant_id: 'UNIT-9' },
      },
      option_values: { color: 'Red' },
      stock_available: 4,
      purchase_price: 2.5,
      currency: 'USD',
      is_active: true,
    }],
    ...overrides,
  };
}

describe('Supplier Order Identity', () => {
  test('résout une unité sans connaître le fournisseur', () => {
    expect(identity.resolveSupplierUnit(contract(), 'SKU-1', 2)).toEqual({
      supplier_product_ref: 'P-1',
      supplier_sku: 'SKU-1',
      supplier_unit_ref: 'UNIT-9',
      supplier_order_identity: {
        provider: 'supplier-x',
        version: 1,
        payload: { variant_id: 'UNIT-9' },
      },
      option_values: { color: 'Red' },
      quantity: 2,
      stock_available: 4,
      unit_price: 2.5,
      currency: 'USD',
    });
  });

  test('fail-closed sans identité de commande', () => {
    const c = contract();
    delete c.sellable_units[0].supplier_order_identity;
    expect(() => identity.resolveSupplierUnit(c, 'SKU-1', 1)).toThrow(/supplier_order_identity requis/i);
  });

  test('autorise explicitement un snapshot legacy pour refresh, jamais pour commander', () => {
    const c = contract();
    delete c.sellable_units[0].supplier_order_identity;
    delete c.sellable_units[0].supplier_unit_ref;
    const resolved = identity.resolveSupplierUnit(c, 'SKU-1', 1, { requireOrderIdentity: false });
    expect(resolved.supplier_order_identity).toBeNull();
    expect(resolved.supplier_unit_ref).toBeNull();
  });

  test('refuse une identité ambiguë ou vide', () => {
    const c = contract();
    c.sellable_units[0].supplier_order_identity.payload = {};
    expect(() => identity.resolveSupplierUnit(c, 'SKU-1', 1)).toThrow(/payload doit être un objet non vide/i);
  });
});
