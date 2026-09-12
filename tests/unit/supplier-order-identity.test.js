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

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('Une erreur était attendue');
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
    const error = captureError(() => identity.resolveSupplierUnit(c, 'SKU-1', 1));
    expect(error.code).toBe(identity.BLOCKED_SUPPLIER_IDENTITY);
    expect(error.message).toMatch(/supplier_order_identity requis/i);
  });

  test('0 résolution est BLOCKED_SUPPLIER_IDENTITY', () => {
    const error = captureError(() => identity.resolveSupplierUnit(contract(), 'SKU-ABSENT', 1));
    expect(error.code).toBe(identity.BLOCKED_SUPPLIER_IDENTITY);
    expect(error.details).toEqual({ supplier_sku: 'SKU-ABSENT', matches: 0 });
  });

  test('plusieurs résolutions sont BLOCKED_SUPPLIER_IDENTITY', () => {
    const c = contract();
    c.sellable_units.push({
      ...c.sellable_units[0],
      supplier_unit_ref: 'UNIT-10',
      supplier_order_identity: {
        provider: 'supplier-x',
        version: 1,
        payload: { variant_id: 'UNIT-10' },
      },
    });
    const error = captureError(() => identity.resolveSupplierUnit(c, 'SKU-1', 1));
    expect(error.code).toBe(identity.BLOCKED_SUPPLIER_IDENTITY);
    expect(error.details).toEqual({ supplier_sku: 'SKU-1', matches: 2 });
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
    const error = captureError(() => identity.resolveSupplierUnit(c, 'SKU-1', 1));
    expect(error.code).toBe(identity.BLOCKED_SUPPLIER_IDENTITY);
    expect(error.message).toMatch(/payload doit être un objet non vide/i);
  });
});
